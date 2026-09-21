import { computeTalkIdFromTalkData } from '../../shared/cid';
import type { GPSCoordinate, User } from '../../shared/types';
import { getAnsweredTalkByContent } from './answer-preferences-storage';
import { getTalkContentKey } from './answer-history-storage';
import { resolveExpiresAtMs } from './broadcast-audience-preview';
import type { CreatorReplyRow } from './creator-replies-view';
import { getMyTalks } from './my-talks-storage';
import { avatarInnerHtml } from './profile-avatar';
import { renderListProgressively } from './render-list-progressively';
import { getPinnedIds, pinnedFirst, toggleListItemPin } from './list-pins';
import { filterIncomingTalkClusters, getTalkIntakeFilters } from './talk-intake-filters';
import { formatTalkExpiryTone, getIncomingQuestionCount } from './talk-list-metadata';
import { escapeHtml, tagAnswerSuffix } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

const TALKS_TAB_STATE_KEY = 'iinpublic_talks_tab_state';
const TALKS_FIRST_CHUNK_SIZE = 25;

type TalkStatsMap = Record<string, { responses: number; matches: number; ignores: number }>;
type PersonTarget = { type: 'person'; id: string; name: string };

type TalksListDocumentState = {
  renderSeq: number;
  mousedownDelegationBound: boolean;
  broadcastCheckboxBound: boolean;
  clickDelegationBound: boolean;
  latestDeps?: DisplayTalksListDeps;
};

const documentStates = new WeakMap<Document, TalksListDocumentState>();

function getDocumentState(): TalksListDocumentState {
  let state = documentStates.get(document);
  if (!state) {
    state = {
      renderSeq: 0,
      mousedownDelegationBound: false,
      broadcastCheckboxBound: false,
      clickDelegationBound: false,
    };
    documentStates.set(document, state);
  }
  return state;
}

export type DisplayTalksListDeps = {
  currentUser: User | undefined;
  currentLocation: GPSCoordinate | undefined;
  creatorReplyRows: CreatorReplyRow[];
  incomingTalkClusters: any[];
  talkStatsMap: TalkStatsMap;
  talksShowIncoming: boolean;
  talksShowOutgoing: boolean;
  talksEnabledTypes: Set<string>;
  talksOutSortMode: 'recent' | 'oldest' | 'latest-reply' | 'matches' | 'responses' | 'match-rate' | 'weighted' | 'title';
  talksQuery: string;
  talksCompletionFilter: 'all' | 'unanswered' | 'answered';
  talksOutcomeFilter: 'all' | 'match' | 'mismatch';
  talksDateFrom: string;
  talksDateTo: string;
  syncStatusBarMatchCount: () => void;
  deleteMyTalk: (talkId: string) => void;
  quickAnswerIncomingTag: (talkId: string, identityKey: string | undefined, checked: boolean) => void;
  showTalkDetail: (talkId: string, identityKey?: string) => void;
  showSurveyStatsDialog: (talkId: string) => void;
  showCreatorRepliesForTalk: (talkId: string, talkTitle: string) => void;
  setTalkDisabled: (talkId: string, disabled: boolean) => void;
  showNotification: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, values: Record<string, string | number>) => string;
  bindTalksRowGestures: () => void;
  getMyConversations: () => Record<string, any>;
  formatReasonCounts: (counts: Record<string, number>) => string;
  displayContextualStatistics: (elementId: string, prefix?: string) => void;
  getCoExchangedPeople: (identityKey: string, excludePeerIds: Set<string>) => Array<{ id: string; name: string }>;
  formatTalkDistanceFromAuthor: (location: { latitude?: number; longitude?: number } | null | undefined) => string;
  formatTalkExpiration: (expiresAt: number | null | undefined) => string;
  formatTalkLanguage: (code: string) => string;
  formatTalkLocation: (radiusMiles: number | null | undefined) => string;
  formatTalkRelativeTime: (date: Date) => string;
  formatTalkType: (type: string) => string;
  getIncomingResponseCount: (talkId: string) => number;
  getPreferredTalkLanguage: () => string;
  pickIncomingRowTalkId: (cluster: any) => string;
  showTalkEditorDialog: (existingTalk?: any) => void;
  navigateToGraphNode: (target: PersonTarget) => void;
  showChooseWhoToDmPicker: (people: Array<{ id: string; name: string }>) => void;
  emit: (event: string, payload: unknown) => unknown;
  persistTalksTabState: () => void;
  getTalksGestureSuppressClickUntil: () => number;
};

/** Owns Talks-tab filtering, rendering, delegated events, and progressive-render lifecycle. */
export function displayTalksList(deps: DisplayTalksListDeps): void {
  const documentState = getDocumentState();
  documentState.latestDeps = deps;
  const talksList = document.getElementById('talks-list');
  if (!talksList) return;
  const renderSeq = ++documentState.renderSeq;
  deps.syncStatusBarMatchCount();

  const myTalks = getMyTalks();
  const pinnedTalkIds = getPinnedIds('talks');
  const incomingPinKey = (cluster: any, talkId: string): string => `in:${String(cluster?.identityKey || talkId)}`;
  const pinButtonHtml = (pinKey: string): string => {
    const pinned = pinnedTalkIds.has(pinKey);
    const label = deps.t(pinned ? 'unpinItem' : 'pinItem');
    return `<button type="button" class="list-pin-button talk-pin-button talk-item-actions ${pinned ? 'is-pinned' : ''}" data-pin-id="${escapeHtml(pinKey)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" aria-pressed="${pinned}">📌</button>`;
  };

  // One-time delegation on body: use mousedown so we run before any re-render can replace the DOM (click fires later and target can be gone)
  if (!documentState.mousedownDelegationBound) {
    documentState.mousedownDelegationBound = true;
    document.body.addEventListener(
      'mousedown',
      (e) => {
        if (e.button !== 0) return; // only left button
        const target = e.target as HTMLElement;
        // #item-details-popup: the long-press details popup relocates a row's
        // .talk-item-details out of #talks-list (showDetailsPopupFor) — its surviving
        // interactive content (survey-stats-btn) needs to still be reachable there.
        if (!target.closest('#talks-list') && !target.closest('#item-details-popup')) return;
        const outgoingTagCheckbox = target.closest('.talk-tag-out-checkbox') as HTMLInputElement | null;
        if (outgoingTagCheckbox) {
          e.preventDefault();
          e.stopPropagation();
          const talkId = outgoingTagCheckbox.dataset.talkId;
          if (talkId) setTimeout(() => deps.deleteMyTalk(talkId), 0);
          return;
        }
        const incomingTagCheckbox = target.closest('.talk-tag-in-checkbox') as HTMLInputElement | null;
        if (incomingTagCheckbox) {
          e.preventDefault();
          e.stopPropagation();
          const talkId = incomingTagCheckbox.dataset.talkId || '';
          const identityKey = incomingTagCheckbox.dataset.identityKey || '';
          const checked = !e.shiftKey;
          setTimeout(() => deps.quickAnswerIncomingTag(talkId, identityKey || undefined, checked), 0);
          return;
        }
        // view-talk-btn only remains on tag pills (the title is itself the button);
        // card rows dropped it — the whole row opens the talk now (click delegation below).
        const viewBtn = target.closest('.view-talk-btn');
        if (viewBtn) {
          e.preventDefault();
          e.stopPropagation();
          const el = viewBtn as HTMLElement;
          const talkId = el.dataset.talkId || '';
          const identityKey = el.dataset.identityKey || '';
          if (talkId || identityKey) {
            setTimeout(() => deps.showTalkDetail(talkId, identityKey || undefined), 0);
          }
          return;
        }
        // Only reachable now from inside the long-press details popup (survey OUT rows).
        const surveyStatsBtn = target.closest('.survey-stats-btn');
        if (surveyStatsBtn) {
          e.preventDefault();
          e.stopPropagation();
          const talkId = (surveyStatsBtn as HTMLElement).dataset.talkId;
          if (talkId) {
            setTimeout(() => void deps.showSurveyStatsDialog(talkId), 0);
          }
          return;
        }
        // Only reachable from inside the long-press details popup (OUT rows with ≥1 response).
        const viewResponsesBtn = target.closest('.talk-view-responses-btn');
        if (viewResponsesBtn) {
          e.preventDefault();
          e.stopPropagation();
          const el = viewResponsesBtn as HTMLElement;
          const talkId = el.dataset.talkId || '';
          const talkTitle = el.dataset.talkTitle || '';
          if (talkId) {
            setTimeout(() => {
              // Close via the popup's own close button (not a raw .remove()) so it
              // properly returns .talk-item-details — this button's own container —
              // to its row first, instead of deleting it along with the modal.
              document.getElementById('close-item-details-popup')?.click();
              deps.showCreatorRepliesForTalk(talkId, talkTitle);
            }, 0);
          }
          return;
        }
      },
      { capture: true },
    );
  }
  // Broadcast on/off is now a real checkbox (same widget as the tag pill's own checkbox),
  // so it uses 'change' — not the mousedown-capture pattern above, which exists to hijack
  // custom-behavior elements before a native default (checked state, focus) applies. A
  // native checkbox's own toggle is exactly the behavior wanted here.
  if (!documentState.broadcastCheckboxBound) {
    documentState.broadcastCheckboxBound = true;
    document.body.addEventListener('change', (e) => {
      const checkbox = (e.target as HTMLElement).closest('.talk-broadcast-toggle-checkbox') as HTMLInputElement | null;
      if (!checkbox) return;
      const talkId = checkbox.dataset.talkId;
      if (!talkId) return;
      const disabled = !checkbox.checked;
      deps.setTalkDisabled(talkId, disabled);
      deps.showNotification(deps.t(disabled ? 'talksBroadcastDisabled' : 'talksBroadcastEnabled'), 'success');
    });
  }
  deps.bindTalksRowGestures();

  // Sort all talks by last interaction
  const allEntries = Object.entries(myTalks)
    .sort(
      ([, a]: [string, any], [, b]: [string, any]) =>
        new Date(b.lastInteraction || 0).getTime() - new Date(a.lastInteraction || 0).getTime(),
    );
  // OUT: talks this user created or copied (can broadcast)
  const conversations = deps.getMyConversations();
  const outMetrics = (talkId: string): {
    responses: number;
    matches: number;
    ignores: number;
    mismatches: number;
    matchRate: number;
    latestResponseAt: number;
    weighted: number;
  } => {
    const stats = deps.talkStatsMap[talkId];
    const replies = deps.creatorReplyRows.filter((reply) => reply.talkId === talkId);
    const derivedMatches = Object.values(conversations).filter((c: any) => c.talkId === talkId).length;
    const matches = Math.max(stats?.matches ?? 0, derivedMatches, replies.filter((reply) => reply.outcome === 'match').length);
    const responses = Math.max(stats?.responses ?? 0, derivedMatches, replies.length);
    const ignores = Math.max(stats?.ignores ?? 0, replies.filter((reply) => reply.outcome === 'ignore').length);
    const mismatches = Math.max(0, replies.filter((reply) => reply.outcome === 'mismatch').length || responses - matches - ignores);
    const matchRate = responses > 0 ? matches / responses : 0;
    const latestResponseAt = replies.reduce((latest, reply) => Math.max(latest, new Date(reply.date).getTime()), 0);
    // Visible factors only: matches dominate, then match rate and reply volume; ignores/mismatches lower rank.
    const weighted = matches * 100 + Math.round(matchRate * 25) + Math.min(responses, 20) - ignores * 4 - mismatches * 2;
    return { responses, matches, ignores, mismatches, matchRate, latestResponseAt, weighted };
  };
  // OUT: talks this user created or copied (can broadcast), with creator-selectable ranking.
  const outEntries = allEntries
    .filter(([, t]: [string, any]) => t.role === 'created' || t.role === 'copied')
    .sort(([idA, a]: [string, any], [idB, b]: [string, any]) => {
      const aa = outMetrics(idA);
      const bb = outMetrics(idB);
      if (deps.talksOutSortMode === 'oldest') return new Date(a.lastInteraction || 0).getTime() - new Date(b.lastInteraction || 0).getTime();
      if (deps.talksOutSortMode === 'latest-reply' && bb.latestResponseAt !== aa.latestResponseAt) return bb.latestResponseAt - aa.latestResponseAt;
      if (deps.talksOutSortMode === 'matches' && bb.matches !== aa.matches) return bb.matches - aa.matches;
      if (deps.talksOutSortMode === 'responses' && bb.responses !== aa.responses) return bb.responses - aa.responses;
      if (deps.talksOutSortMode === 'match-rate' && bb.matchRate !== aa.matchRate) return bb.matchRate - aa.matchRate;
      if (deps.talksOutSortMode === 'weighted' && bb.weighted !== aa.weighted) return bb.weighted - aa.weighted;
      if (deps.talksOutSortMode === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
      return new Date(b.lastInteraction || 0).getTime() - new Date(a.lastInteraction || 0).getTime();
    });
  // IN: backend-consolidated incoming talks (content-hash merged)
  const rawIncomingEntries = (deps.incomingTalkClusters || []).filter((c: any) => c && c.identityKey);
  const incomingFilterResult = filterIncomingTalkClusters(
    rawIncomingEntries,
    deps.currentUser?.talkFilters || getTalkIntakeFilters(),
    deps.currentLocation,
  );
  const hiddenReasonsText = deps.formatReasonCounts(incomingFilterResult.hiddenByReason);
  const answeredByContent = getAnsweredTalkByContent();
  const backendInEntries = incomingFilterResult.visible.filter((cluster: any) => {
    if (cluster?.isAnswered) return false;
    const identityKey = String(cluster?.identityKey || '');
    if (identityKey && answeredByContent[identityKey]) return false;
    try {
      const latestTalk = cluster?.latestTalk;
      if (latestTalk && answeredByContent[getTalkContentKey(latestTalk)]) return false;
      if (latestTalk && answeredByContent[computeTalkIdFromTalkData(latestTalk)]) return false;
    } catch {
      /* keep visible if the cluster cannot be locally identified */
    }
    return true;
  });
  // Answered talks are retained locally after they leave the actionable inbox. Put
  // them back in IN as read-only history so All/IN remains a complete talk ledger.
  const answeredIncomingEntries = allEntries
    .filter(([, talk]: [string, any]) => talk?.role === 'answered')
    .map(([talkId, talk]: [string, any]) => {
      const fullTalk = talk?.fullTalk || {};
      const senderNames = Array.isArray(talk?.senders) ? talk.senders : [];
      const primaryName = String(senderNames[0] || talk?.senderName || deps.t('settingsUnknown'));
      return {
        identityKey: `answered:${talkId}`,
        title: String(talk?.title || fullTalk?.title || deps.t('talksIncomingFallback')),
        type: String(talk?.type || fullTalk?.type || 'flow'),
        language: String(fullTalk?.language || talk?.language || 'en'),
        latestTalk: fullTalk,
        senders: { [talkId]: { senderName: primaryName } },
        isAnswered: true,
        outcome: talk?.outcome,
        questionCount: Array.isArray(fullTalk?.questions) ? fullTalk.questions.length : 0,
        updatedAt: talk?.lastInteraction || talk?.timestamp || Date.now(),
        expiresAt: fullTalk?.expiresAt ?? talk?.expiresAt,
        locationRadiusMiles: fullTalk?.locationRadiusMiles ?? talk?.locationRadiusMiles,
        latestTalkId: talkId,
      };
    });
  const allIncomingEntries = [...answeredIncomingEntries, ...backendInEntries];
  const matchesTalkFilter = (entry: any, isIncoming: boolean): boolean => {
    const talk = isIncoming ? entry : entry[1];
    const type = String(talk?.type || talk?.fullTalk?.type || talk?.latestTalk?.type || 'flow').toLowerCase();
    const title = String(talk?.title || talk?.fullTalk?.title || talk?.latestTalk?.title || '').toLowerCase();
    const query = deps.talksQuery.trim().toLowerCase();
    const answered = isIncoming ? !!talk?.isAnswered : false;
    const outcome = String(talk?.outcome || talk?.latestTalk?.outcome || '').toLowerCase();
    const timestamp = new Date(talk?.updatedAt || talk?.lastInteraction || talk?.timestamp || 0).getTime();
    const from = deps.talksDateFrom ? new Date(`${deps.talksDateFrom}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
    const to = deps.talksDateTo ? new Date(`${deps.talksDateTo}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
    return (!query || title.includes(query))
      && deps.talksEnabledTypes.has(type)
      && (deps.talksOutcomeFilter === 'all' || outcome === deps.talksOutcomeFilter)
      && timestamp >= from && timestamp <= to
      && (deps.talksCompletionFilter === 'all'
        || (deps.talksCompletionFilter === 'answered' && answered)
        || (deps.talksCompletionFilter === 'unanswered' && !answered));
  };
  const filteredOutEntries = deps.talksShowOutgoing
    ? outEntries.filter((entry) => matchesTalkFilter(entry, false))
    : [];
  const inEntries = deps.talksShowIncoming
    ? allIncomingEntries
        .filter((entry) => matchesTalkFilter(entry, true))
        .sort((a: any, b: any) => {
          if (a.isAnswered !== b.isAnswered) return a.isAnswered ? 1 : -1;
          if (deps.talksOutSortMode === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
          if (deps.talksOutSortMode === 'oldest') return new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
          return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
        })
    : [];
  // One combined summary line instead of two (app-bar direction counts + a separate
  // "Stats: ..." row below) — direction counts prefix the same response/match line.
  deps.displayContextualStatistics(
    'talks-stats-strip',
    deps.tf('talksStatusSummary', { incoming: inEntries.length, outgoing: filteredOutEntries.length }) + ' · ',
  );
  const talksIncomingCheckbox = document.getElementById('talks-filter-incoming') as HTMLInputElement | null;
  if (talksIncomingCheckbox) talksIncomingCheckbox.checked = deps.talksShowIncoming;
  const talksOutgoingCheckbox = document.getElementById('talks-filter-outgoing') as HTMLInputElement | null;
  if (talksOutgoingCheckbox) talksOutgoingCheckbox.checked = deps.talksShowOutgoing;
  document.querySelectorAll<HTMLInputElement>('.talks-type-checkbox').forEach((checkbox) => {
    checkbox.checked = deps.talksEnabledTypes.has(checkbox.value);
  });
  const talksSort = document.getElementById('talks-out-sort-order') as HTMLSelectElement | null;
  if (talksSort) talksSort.value = deps.talksOutSortMode;
  const talksQuery = document.getElementById('talks-filter-query') as HTMLInputElement | null;
  if (talksQuery && talksQuery.value !== deps.talksQuery) talksQuery.value = deps.talksQuery;
  const talksCompletionFilter = document.getElementById('talks-filter-completion') as HTMLSelectElement | null;
  if (talksCompletionFilter) talksCompletionFilter.value = deps.talksCompletionFilter;
  const talksOutcomeFilter = document.getElementById('talks-filter-outcome') as HTMLSelectElement | null;
  if (talksOutcomeFilter) talksOutcomeFilter.value = deps.talksOutcomeFilter;
  const talksDateFrom = document.getElementById('talks-filter-date-from') as HTMLInputElement | null;
  const talksDateTo = document.getElementById('talks-filter-date-to') as HTMLInputElement | null;
  if (talksDateFrom) talksDateFrom.value = deps.talksDateFrom;
  if (talksDateTo) talksDateTo.value = deps.talksDateTo;

  if (filteredOutEntries.length === 0 && inEntries.length === 0) {
    talksList.innerHTML = `
      <div class="empty-state" style="padding: 60px 20px; text-align: center;">
        <div style="font-size: 3em; margin-bottom: 16px;">💬</div>
        <p style="font-size: 1.2em; color: #666; margin-bottom: 8px;">${deps.t('talksNoTalks')}</p>
        <p style="font-size: 0.9em; color: #999;">${deps.t('talksNoTalksHelp')}</p>
        ${hiddenReasonsText ? `<p style="font-size: 0.85em; color: #999; margin-top: 8px;">${escapeHtml(hiddenReasonsText)}</p>` : ''}
      </div>
    `;
  } else {
    // TODO §R2: named so it can be passed to renderListProgressively as `renderRow`,
    // instead of an inline .map() callback over the entire list at once.
    const renderOutRow = ([talkId, talk]: [string, any]): string => {
                const stats = deps.talkStatsMap[talkId];
                const matchedPeople = Object.values(conversations)
                  .filter((c: any) => c.talkId === talkId && c.otherUserId)
                  .map((c: any) => ({
                    id: String(c.otherUserId),
                    name: c.respondedByBot ? `${c.otherUserName} 🤖` : String(c.otherUserName || ''),
                  }));
                const matchedNames = matchedPeople.map((p) => p.name);
                const metrics = outMetrics(talkId);
                const statsLine = stats || metrics.responses > 0
                  ? deps.tf('talksStats', {
                      responses: metrics.responses,
                      matches: metrics.matches,
                      mismatches: metrics.mismatches,
                      ignores: metrics.ignores,
                      rate: Math.round(metrics.matchRate * 100),
                    })
                  : deps.t('talksNoStats');
                const rankLine = deps.talksOutSortMode === 'weighted'
                  ? `<div class="talk-weighted-score" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${deps.tf('talksWeightedScore', { score: metrics.weighted })}</div>`
                  : deps.talksOutSortMode === 'latest-reply' && metrics.latestResponseAt > 0
                    ? `<div class="talk-weighted-score" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${deps.tf('talksLatestReplyLabel', { date: escapeHtml(new Date(metrics.latestResponseAt).toLocaleString()) })}</div>`
                    : '';
                const matchedLine =
                  matchedPeople.length > 0
                    ? `<div class="talk-item-matched talk-matched-people" data-matched-people="${escapeHtml(JSON.stringify(matchedPeople))}" style="font-size: 0.85em; color: var(--success-text); margin-top: 4px; cursor: pointer;">${deps.tf('talksMatchedWith', { names: escapeHtml(matchedNames.join(', ')) })}</div>`
                    : '';
                // TODO §Q build-order item 17: "people I've separately exchanged this same
                // content with" — a different talkId sharing the same identityKey (e.g. a
                // separate broadcast round), scoped to this device's own talkLedger only.
                // Excludes people already shown by matchedLine above (this row's own partners).
                const coExchangedPeople = talk.fullTalk
                  ? deps.getCoExchangedPeople(
                      computeTalkIdFromTalkData(talk.fullTalk),
                      new Set(matchedPeople.map((p) => p.id)),
                    )
                  : [];
                const coExchangedLine =
                  coExchangedPeople.length > 0
                    ? `<div class="talk-item-co-exchanged talk-matched-people" data-matched-people="${escapeHtml(JSON.stringify(coExchangedPeople))}" style="font-size: 0.85em; color: var(--accent-text); margin-top: 4px; cursor: pointer;">${deps.tf('talksAlsoExchangedWith', { names: escapeHtml(coExchangedPeople.map((p) => p.name).join(', ')) })}</div>`
                    : '';
                const disabled = !!talk.disabled;
                const expText = deps.formatTalkExpiration(talk.expiresAt);
                const locText = deps.formatTalkLocation(talk.locationRadiusMiles);
                // TODO §Z popup-variant review: match the IN details popup's tone-colored
                // expiry chip (formatTalkExpiryTone) instead of OUT's own plain, uncolored
                // text — my own sent talks approaching expiry deserve the same at-a-glance
                // urgency cue an incoming talk's expiry already gets.
                const expiryTone = formatTalkExpiryTone(talk.expiresAt);
                // Icon-only badges, not text: direction/copy-state and type are already
                // conveyed by shape (this icon) and color (typeAccent border) — a text
                // label alongside both would just repeat the same fact in words. The
                // translated label still exists for a11y/tooltip/screen-reader purposes.
                const roleBadge = talk.role === 'copied'
                  ? `<span class="talk-badge talk-badge-copied" title="${escapeHtml(deps.t('talksCopied'))}" style="background:var(--accent-soft);color:var(--accent-text);">📋<span class="visually-hidden"> ${deps.t('talksCopied')}</span></span>`
                  : `<span class="talk-badge talk-badge-created" title="${escapeHtml(deps.t('talksCreated'))}" style="background:var(--accent-soft);color:var(--accent-text);">📝<span class="visually-hidden"> ${deps.t('talksCreated')}</span></span>`;
                const talkTypeLower = String(talk.type || talk.fullTalk?.type || '').toLowerCase();
                const talkLanguage = String(talk.language || talk.fullTalk?.language || 'en').toLowerCase();
                const typeAccent =
                  talkTypeLower === 'tag' ? '#7c3aed'
                  : talkTypeLower === 'survey' ? 'var(--success)'
                  : talkTypeLower === 'route' ? '#d97706'
                  : 'var(--accent)';
                const typeIcon =
                  talkTypeLower === 'tag' ? '🏷️'
                  : talkTypeLower === 'survey' ? '📊'
                  : talkTypeLower === 'route' ? '🔀'
                  : '➡️';
                if (talkTypeLower === 'tag') {
                  return `
      <div class="talk-list-item talk-tag-chip talk-tag-out ${disabled ? 'talk-broadcast-disabled' : 'talk-broadcast-enabled'}" data-talk-id="${talkId}" data-pin-id="${escapeHtml(`out:${talkId}`)}" data-role="${talk.role || 'created'}" data-talk-type="tag">
        <label class="talk-tag-checkbox-wrap" aria-label="${escapeHtml(deps.t('talksTagChecked'))}">
          <input type="checkbox" class="talk-tag-checkbox talk-tag-out-checkbox" data-talk-id="${escapeHtml(talkId)}" checked>
        </label>
        <span class="talk-tag-text">${escapeHtml(talk.title)}${tagAnswerSuffix(talk)}</span>
        ${pinButtonHtml(`out:${talkId}`)}
      </div>
    `;
                }
                // Row is a single tap target (opens the editor) plus a gesture, not a row of
                // buttons: the checkbox in the top-left badge is the one persistent explicit
                // control (broadcast on/off — same widget as the tag pill's own checkbox, so
                // both "is this actively going out" toggles look and feel the same); everything
                // else that used to be a button moved to a different mechanism — 🗑️ delete ->
                // swipe-left gesture, ℹ️ details -> long-press (still the exact same
                // .talk-item-details/showDetailsPopupFor content, nothing dropped), 📊 survey
                // results -> the at-a-glance number now lives in the stats line, with the full
                // breakdown dashboard one tap away inside that same long-press popup instead of
                // its own row button. matchedLine stays visible on the row: it's the interactive
                // N3 click-to-DM affordance, not decorative detail.
                return `
      <div class="talk-list-item talk-direction-out talk-type-${escapeHtml(talkTypeLower || 'flow')} ${disabled ? 'talk-broadcast-disabled' : 'talk-broadcast-enabled'}" data-talk-id="${talkId}" data-pin-id="${escapeHtml(`out:${talkId}`)}" data-role="${talk.role || 'created'}" data-talk-type="${escapeHtml(talkTypeLower || 'flow')}" style="border-right:5px solid ${typeAccent};background:var(--surface);">
        <div class="talk-item-header">
          <label class="talk-icon-badge" title="${disabled ? deps.t('talksBroadcastOff') : deps.t('talksBroadcastOn')}">
            <input type="checkbox" class="talk-broadcast-toggle-checkbox" data-talk-id="${talkId}" ${disabled ? '' : 'checked'}>
            <span aria-hidden="true">${typeIcon}</span>
          </label>
          <div class="talk-item-title">${escapeHtml(talk.title)}${tagAnswerSuffix(talk)}</div>
          ${pinButtonHtml(`out:${talkId}`)}
          <span class="talk-item-chevron" aria-hidden="true">›</span>
        </div>
        <div class="talk-item-status-line" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;">
          <span class="talk-item-status-summary" style="font-size:0.85em;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(statsLine)} · ${escapeHtml(deps.formatTalkRelativeTime(new Date(talk.lastInteraction || 0)))}</span>
        </div>
        ${matchedLine}
        <div class="talk-item-details" data-talk-id="${talkId}" style="display:none;">
          ${roleBadge}
          <span class="talk-badge talk-badge-type" title="${escapeHtml(deps.formatTalkType(String(talk.type || 'flow')))}">${typeIcon}<span class="visually-hidden"> ${deps.formatTalkType(String(talk.type || 'flow'))}</span></span>
          <span class="talk-badge talk-badge-language" data-language="${escapeHtml(talkLanguage)}">${escapeHtml(deps.formatTalkLanguage(talkLanguage))}</span>
          <div class="talk-item-meta">
            <span class="talk-item-time">${deps.formatTalkRelativeTime(new Date(talk.lastInteraction || 0))}</span>
          </div>
          <div class="talk-info-chips">
            <span class="talk-info-chip talk-expiry-${expiryTone}">${escapeHtml(deps.tf('talksExpiration', { value: expText }))}</span>
            <span class="talk-info-chip">${escapeHtml(deps.tf('talksLocation', { value: locText }))}</span>
          </div>
          <div class="talk-item-stats" style="font-size: 0.85em; color: #666; margin-top: 6px;">
            ${statsLine}
          </div>
          ${rankLine}
          ${talkTypeLower === 'survey' ? `<button type="button" class="btn survey-stats-btn talk-icon-btn" data-talk-id="${escapeHtml(talkId)}" data-testid="survey-stats-button" style="margin-top:6px;color:var(--accent-text);">📊 ${deps.t('talksResults')}</button>` : ''}
          ${metrics.responses > 0 ? `<button type="button" class="btn talk-view-responses-btn talk-icon-btn" data-talk-id="${escapeHtml(talkId)}" data-talk-title="${escapeHtml(talk.title)}" data-testid="talk-view-responses-button" style="margin-top:6px;color:var(--accent-text);">👥 ${escapeHtml(deps.tf('talksViewResponses', { count: metrics.responses }))}</button>` : ''}
          ${coExchangedLine}
        </div>
      </div>
    `;
    };

    // TODO §R2: named so it can be passed to renderListProgressively as `renderRow`.
    const renderInRow = (cluster: any): string => {
              const sendersObj = cluster?.senders && typeof cluster.senders === 'object' ? cluster.senders : {};
              const senderNames = Array.from(
                new Set(
                  Object.values(sendersObj)
                    .map((s: any) => String(s?.senderName || '').trim())
                    .filter(Boolean),
                ),
              );
              const senderList = Object.values(sendersObj) as Array<{ senderId?: string; senderName?: string; headshot?: string }>;
              const primarySender = senderList[0] || {};
              const primarySenderName = String(primarySender.senderName || senderNames[0] || deps.t('settingsUnknown'));
              const senderPeopleById = new Map<string, string>();
              for (const s of senderList) {
                if (s?.senderId && s?.senderName) senderPeopleById.set(String(s.senderId), String(s.senderName));
              }
              const senderPeople = Array.from(senderPeopleById, ([id, name]) => ({ id, name }));
              const senderPeopleJson = escapeHtml(JSON.stringify(senderPeople));
              const senderInitial = primarySenderName.trim().charAt(0).toUpperCase() || '?';
              const talkId = deps.pickIncomingRowTalkId(cluster);
              const identityKey = String(cluster?.identityKey || '');
              const pinKey = incomingPinKey(cluster, talkId);
              // TODO §Q build-order item 17: other people I've separately exchanged this same
              // content with (e.g. a different sender who sent me the identical talk), scoped
              // to this device's own talkLedger only. Excludes this cluster's own sender(s).
              const coExchangedPeople = identityKey
                ? deps.getCoExchangedPeople(identityKey, new Set(senderPeople.map((p) => p.id)))
                : [];
              const coExchangedLine =
                coExchangedPeople.length > 0
                  ? `<div class="talk-item-co-exchanged talk-matched-people" data-matched-people="${escapeHtml(JSON.stringify(coExchangedPeople))}" style="font-size: 0.85em; color: var(--accent-text); margin-top: 4px; cursor: pointer;">${deps.tf('talksAlsoExchangedWith', { names: escapeHtml(coExchangedPeople.map((p) => p.name).join(', ')) })}</div>`
                  : '';
              const isAnswered = !!cluster?.isAnswered;
              const titleStyle = isAnswered
                ? 'font-weight: 500; color: var(--text-muted);'
                : 'font-weight: 700; color: var(--accent-hover);';
              const metaStyle = isAnswered ? 'color: var(--text-muted);' : 'color: var(--text-tertiary);';
              const statusBadge = isAnswered
                ? `<span class="talk-badge" style="background:var(--bg-muted);color:var(--text-tertiary);">✅ ${deps.t('talksAnswered')}</span>`
                : `<span class="talk-badge" style="background:var(--accent-soft);color:var(--accent-hover);font-weight:700;">🆕 ${deps.t('talksNew')}</span>`;
              const incomingType = String(cluster?.type || 'flow').toLowerCase();
              const incomingLanguage = String(cluster?.language || cluster?.latestTalk?.language || 'en').toLowerCase();
              const questionCount = getIncomingQuestionCount(cluster);
              const responseCount = deps.getIncomingResponseCount(talkId);
              const expiresAt = cluster?.expiresAt ?? cluster?.latestTalk?.expiresAt;
              const expiryTone = formatTalkExpiryTone(expiresAt);
              const expText = deps.formatTalkExpiration(Number.isFinite(resolveExpiresAtMs(expiresAt)) ? resolveExpiresAtMs(expiresAt) : null);
              const locRadius = cluster?.locationRadiusMiles ?? cluster?.latestTalk?.locationRadiusMiles;
              const locText = deps.formatTalkLocation(locRadius);
              const distanceText = deps.formatTalkDistanceFromAuthor(cluster?.authorLocation || cluster?.latestTalk?.authorLocation);
              const showLanguageBadge = incomingLanguage && incomingLanguage !== deps.getPreferredTalkLanguage();
              const progressChip = (incomingType === 'flow' || incomingType === 'route') && questionCount > 0
                ? `<span class="talk-info-chip talk-progress-chip" style="--progress: 0%;"><span class="talk-progress-ring" aria-hidden="true"></span>${escapeHtml(`Q1/${questionCount}`)}</span>`
                : questionCount > 0
                  ? `<span class="talk-info-chip">${escapeHtml(`${questionCount} Q`)}</span>`
                  : '';
              const languageChip = showLanguageBadge
                ? `<span class="talk-info-chip talk-language-alert">${escapeHtml(deps.formatTalkLanguage(incomingLanguage))}</span>`
                : '';
              const responseChip = responseCount > 0
                ? `<span class="talk-info-chip">${escapeHtml(deps.tf(responseCount === 1 ? 'talksResponseOne' : 'talksResponses', { count: responseCount }))}</span>`
                : '';
              const distanceChip = distanceText
                ? `<span class="talk-info-chip">${escapeHtml(distanceText)}</span>`
                : '';
              const typeAccent =
                incomingType === 'tag' ? '#7c3aed'
                : incomingType === 'survey' ? 'var(--success)'
                : incomingType === 'route' ? '#d97706'
                : 'var(--accent)';
              const typeIcon =
                incomingType === 'tag' ? '🏷️'
                : incomingType === 'survey' ? '📊'
                : incomingType === 'route' ? '🔀'
                : '➡️';
              if (incomingType === 'tag') {
                return `
      <div class="talk-list-item talk-tag-chip talk-tag-in ${isAnswered ? 'talk-incoming-answered' : 'talk-incoming-new'}" data-talk-id="${talkId}" data-pin-id="${escapeHtml(pinKey)}" data-identity-key="${escapeHtml(identityKey)}" data-role="incoming" data-incoming-type="tag">
        <label class="talk-tag-checkbox-wrap" aria-label="${escapeHtml(deps.t('talksTagUndetermined'))}">
          <input type="checkbox" class="talk-tag-checkbox talk-tag-in-checkbox" data-talk-id="${escapeHtml(talkId)}" data-identity-key="${escapeHtml(identityKey)}" data-indeterminate="true" title="${escapeHtml(deps.t('talksTagQuickDecision'))}">
        </label>
        <button type="button" class="talk-tag-text talk-tag-text-button view-talk-btn" data-talk-id="${talkId}" data-identity-key="${escapeHtml(identityKey)}">${escapeHtml(cluster?.title || deps.t('talksIncomingFallback'))}</button>
        ${pinButtonHtml(pinKey)}
      </div>
    `;
              }
              // Row is a single tap target (opens the talk to answer, with the details below
              // already visible rather than a separate popup) plus two gestures — drag up to
              // ignore the whole talk, drag down to copy it into my own outgoing list without
              // answering — replacing the 🔍/ℹ️ buttons. Long-press still reaches the exact
              // same .talk-item-details/showDetailsPopupFor content the ℹ️ button used to
              // (full sender identity + co-exchanged people), nothing dropped, just a different
              // trigger. Row 2 now carries what fit in the freed-up space: time, sender count,
              // location, question progress — the "quick glance" subset of the popup's fuller
              // detail set.
              const questionProgressText = (incomingType === 'flow' || incomingType === 'route') && questionCount > 0
                ? `Q1/${questionCount}`
                : questionCount > 0 ? `${questionCount} Q` : '';
              const senderCountText = senderNames.length > 1
                ? `👥 ${deps.tf('talksSenders', { count: senderNames.length })}`
                : `👤 ${deps.tf('talksSenderOne', { count: 1 })}`;
              const row2Parts = [
                deps.formatTalkRelativeTime(new Date(cluster?.updatedAt || Date.now())),
                senderCountText,
                `📍 ${locText}`,
                questionProgressText,
              ].filter(Boolean);
              return `
      <div class="talk-list-item talk-direction-in talk-type-${escapeHtml(incomingType)} ${isAnswered ? 'talk-incoming-answered' : 'talk-incoming-new'}" data-talk-id="${talkId}" data-pin-id="${escapeHtml(pinKey)}" data-identity-key="${escapeHtml(identityKey)}" data-role="incoming" data-incoming-type="${escapeHtml(incomingType)}" style="border-left:5px solid ${typeAccent};background:var(--accent-soft);">
        <div class="talk-item-header">
          <span class="talk-icon-badge" title="${escapeHtml(deps.formatTalkType(String(cluster?.type || 'flow')))}" aria-hidden="true">📥 ${typeIcon}</span>
          <button type="button" class="talk-item-title view-talk-btn" data-talk-id="${talkId}" data-identity-key="${escapeHtml(identityKey)}" style="${titleStyle}background:none;border:none;padding:0;text-align:left;cursor:pointer;font:inherit;">${escapeHtml(cluster?.title || deps.t('talksIncomingFallback'))}</button>
          ${pinButtonHtml(pinKey)}
          <span class="talk-item-chevron" aria-hidden="true">›</span>
        </div>
        <div class="talk-item-status-line" style="margin-top:4px;">
          <span class="talk-item-status-summary" style="${metaStyle}font-size:0.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(row2Parts.join(' · '))}</span>
        </div>
        <div class="talk-item-details" data-talk-id="${talkId}" style="display:none;">
          ${statusBadge}
          <span class="talk-badge talk-badge-type" title="${escapeHtml(deps.formatTalkType(String(cluster?.type || 'flow')))}">${typeIcon}<span class="visually-hidden"> ${deps.formatTalkType(String(cluster?.type || 'flow'))}</span></span>
          <div class="talk-incoming-sender talk-sender-people" data-sender-people="${senderPeopleJson}" style="cursor:pointer;display:flex;align-items:center;gap:6px;margin-bottom:8px;margin-top:8px;">
            <span class="talk-incoming-avatar">${avatarInnerHtml(primarySender.headshot, senderInitial, escapeHtml)}</span>
            <span class="talk-incoming-sender-name">${escapeHtml(primarySenderName)}</span>
            ${senderNames.length > 1 ? `<span class="talk-info-chip">${deps.tf('talksSenders', { count: senderNames.length })}</span>` : ''}
          </div>
          <div class="talk-info-chips">
            ${progressChip}
            ${languageChip}
            <span class="talk-info-chip talk-expiry-${expiryTone}">${escapeHtml(expText)}</span>
            <span class="talk-info-chip">${escapeHtml(locText)}</span>
            ${distanceChip}
            ${responseChip}
          </div>
          <div class="talk-item-meta" style="${metaStyle}">
            <span class="talk-item-time">${deps.formatTalkRelativeTime(new Date(cluster?.updatedAt || Date.now()))}</span>
          </div>
          ${coExchangedLine}
        </div>
      </div>
    `;
    };

    const isStale = () => renderSeq !== documentState.renderSeq;

    // TODO §R2: re-applies the indeterminate-checkbox JS property (not representable as
    // a plain HTML attribute) after any render pass — first chunk or deferred remainder.
    const markIndeterminateTagCheckboxes = () => {
      talksList.querySelectorAll<HTMLInputElement>('.talk-tag-in-checkbox[data-indeterminate="true"]').forEach((checkbox) => {
        checkbox.indeterminate = true;
      });
    };

    // One merged, chronologically-sorted list — like an email inbox, not two
    // direction-labeled sections. Direction/type are already conveyed per-row via
    // color (type accent) and icon (direction), so a section header would be
    // redundant wording on top of that. When only one direction is checked, the
    // richer OUT-specific sort modes (matches/responses/weighted/...) still apply;
    // mixing both directions together only makes sense sorted by recency.
    type MergedTalkRow = { direction: 'in' | 'out'; sortTime: number; needsAnswer: boolean; pinKey: string; payload: any };
    const outRows: MergedTalkRow[] = filteredOutEntries.map(([id, talk]: [string, any]) => ({
      direction: 'out' as const,
      sortTime: new Date(talk.lastInteraction || 0).getTime(),
      needsAnswer: false,
      pinKey: `out:${id}`,
      payload: [id, talk] as [string, any],
    }));
    const inRows: MergedTalkRow[] = inEntries.map((cluster: any) => ({
      direction: 'in' as const,
      sortTime: new Date(cluster?.updatedAt || 0).getTime(),
      needsAnswer: !cluster?.isAnswered,
      pinKey: incomingPinKey(cluster, deps.pickIncomingRowTalkId(cluster)),
      payload: cluster,
    }));
    const mergedRowsByCurrentSort: MergedTalkRow[] = (deps.talksShowIncoming && deps.talksShowOutgoing)
      // Unanswered incoming talks are actionable, so they keep floating to the top
      // (an existing invariant, unrelated to this merge) — recency only breaks ties
      // within that same tier, both for the "needs answer" group and everything else.
      ? [...outRows, ...inRows].sort((a, b) => {
          if (a.needsAnswer !== b.needsAnswer) return a.needsAnswer ? -1 : 1;
          return b.sortTime - a.sortTime;
        })
      : [...inRows, ...outRows];
    const mergedRows = pinnedFirst(mergedRowsByCurrentSort, 'talks', (row) => row.pinKey);
    const renderMergedRow = (row: MergedTalkRow): string =>
      row.direction === 'out' ? renderOutRow(row.payload) : renderInRow(row.payload);

    // mergedRows is guaranteed non-empty here — the outer `filteredOutEntries.length
    // === 0 && inEntries.length === 0` check above already handled the true-empty case.
    renderListProgressively(talksList, mergedRows, {
      firstChunkSize: TALKS_FIRST_CHUNK_SIZE,
      renderRow: renderMergedRow,
      isStale,
      onFirstChunkRendered: markIndeterminateTagCheckboxes,
      onRemainderRendered: markIndeterminateTagCheckboxes,
    });

    // Request stats for out talks (created/copied) only
    if (filteredOutEntries.length > 0) {
      const talkIds = filteredOutEntries.map(([id]) => id);
      deps.emit('needTalkStats', { talkIds });
    }

    // TODO §R2: delegated (bound once) — replaces two per-render listener-binding loops
    // so a row landing in renderListProgressively's deferred remainder is interactive
    // immediately, with nothing to (re-)attach. `getMyTalks()` is re-read at click time
    // (not closed over), so a stale snapshot from an earlier render can't be used either.
    if (!documentState.clickDelegationBound) {
      documentState.clickDelegationBound = true;
      // Delegated on body, not #talks-list: the sender/matched-people click-to-DM
      // affordance (§N3) now also lives inside `.talk-item-details`, which the details
      // popup relocates to document.body when opened (showDetailsPopupFor) — a listener
      // scoped to #talks-list would stop catching it once moved. The row-click-to-edit
      // branch below is unaffected: it requires a `.talk-list-item` ancestor, which
      // popup content never has once relocated, so it naturally no-ops there.
      document.body.addEventListener('click', (e) => {
        // A row-drag gesture (ignore/copy/delete) or a long-press-for-details just
        // committed or cancelled — the click that naturally follows pointerup should
        // not also open the talk.
        const currentDeps = documentState.latestDeps || deps;
        if (Date.now() < currentDeps.getTalksGestureSuppressClickUntil()) return;
        const target = e.target as HTMLElement;

        const pinButton = target.closest('.talk-pin-button') as HTMLElement | null;
        if (pinButton) {
          e.preventDefault();
          e.stopPropagation();
          const pinId = pinButton.dataset.pinId;
          if (pinId) {
            toggleListItemPin('talks', pinId);
            displayTalksList(currentDeps);
          }
          return;
        }

        // TODO §N3: trace back from a talk row to whom it was exchanged with, then DM
        // them. Single exchange partner navigates straight through the dispatcher;
        // multiple partners opens the "choose who to DM" picker.
        const peopleEl = target.closest('.talk-matched-people, .talk-sender-people') as HTMLElement | null;
        if (peopleEl) {
          e.stopPropagation();
          let people: Array<{ id: string; name: string }> = [];
          try {
            people = JSON.parse(peopleEl.dataset.matchedPeople || peopleEl.dataset.senderPeople || '[]');
          } catch {
            return;
          }
          if (people.length === 1) {
            deps.navigateToGraphNode({ type: 'person', id: people[0].id, name: people[0].name });
          } else if (people.length > 1) {
            deps.showChooseWhoToDmPicker(people);
          }
          return;
        }

        // Row click opens edit/detail only when not clicking an action button (handled
        // in the mousedown-capture delegation above).
        if (target.closest('.talk-item-actions, .talk-item-inline-actions, .talk-tag-checkbox-wrap, .talk-icon-badge, .view-talk-btn, .talk-matched-people, .talk-sender-people, .talk-item-details')) return;
        const item = target.closest('.talk-list-item') as HTMLElement | null;
        if (!item) return;
        const talkId = item.dataset.talkId || '';
        const identityKey = item.dataset.identityKey || '';
        const role = item.dataset.role;
        if (role === 'incoming' && !talkId && !identityKey) return;
        if (role !== 'incoming' && !talkId) return;
        if (role === 'copied') {
          const copied = getMyTalks()[talkId];
          if (copied?.fullTalk) {
            // docs/TODO.md §Y1: pass the talk as-is (original authorship intact) — the
            // editor dialog itself decides create-vs-update-in-place by comparing
            // existingTalk.authorId to currentUserId. Pre-stamping here would make every
            // copied talk look self-authored before the user has actually edited anything.
            deps.showTalkEditorDialog(copied.fullTalk);
          } else {
            deps.showNotification(deps.t('talksCouldNotLoad'), 'error');
          }
        } else if (role === 'created') {
          deps.emit('loadTalkForEdit', { talkId });
        } else {
          deps.showTalkDetail(talkId, identityKey || undefined);
        }
      });
    }
  }

  // Restore the remembered scroll "spot" for this tab — deferred a tick so it applies
  // after the just-rendered content lands. `.talks-list`'s own `overflow-y:auto` never
  // actually engages (its flex parent, `.view-content`, isn't itself a flex container),
  // so `#talks-view-content` — not `#talks-list` — is the element that really scrolls.
  const talksScrollContainer = document.getElementById('talks-view-content');
  if (talksScrollContainer) {
    if (talksScrollContainer.dataset.talksScrollRestored !== '1') {
      talksScrollContainer.dataset.talksScrollRestored = '1';
      try {
        const raw = localStorage.getItem(TALKS_TAB_STATE_KEY);
        const savedScrollTop = raw ? (JSON.parse(raw) as { scrollTop?: number }).scrollTop : undefined;
        if (typeof savedScrollTop === 'number') {
          window.setTimeout(() => { talksScrollContainer.scrollTop = savedScrollTop; }, 0);
        }
      } catch {
        /* local-only preference persistence is optional */
      }
    }
    if (talksScrollContainer.dataset.talksScrollBound !== '1') {
      talksScrollContainer.dataset.talksScrollBound = '1';
      talksScrollContainer.addEventListener('scroll', () => deps.persistTalksTabState(), { passive: true });
    }
  }

  deps.syncStatusBarMatchCount();
}
