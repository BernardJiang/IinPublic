/**
 * Creator-replies list (Talks tab "Replies to my talks" panel): filter/sort/group the
 * responses a user's own authored talks have received, and render the list with per-row
 * match-percent chips, relationship labels, grouping headers, and "load more" pagination.
 * Extracted from `ui-manager.ts` (UIManager decomposition cluster #11, docs/TODO.md
 * Priority 6) — moved as-is, not rewritten. `UIManager.renderCreatorReplies` remains a thin
 * delegation shim so every internal `this.renderCreatorReplies()` call site keeps compiling
 * unchanged.
 */
import { type KnownPerson } from '../../shared/types';
import { escapeHtml } from './ui-formatters';
import type { UiLanguage, UiTranslationKey } from './ui-translations';
import type { GraphNodeTarget } from './graph-navigation';

export const CREATOR_REPLY_PAGE_SIZE = 25;

export type CreatorReplyRow = {
  responseId: string;
  talkId: string;
  title: string;
  type: string;
  language: string;
  responderId: string;
  responderName: string;
  outcome: 'match' | 'ignore' | 'mismatch';
  answerMode: 'manual' | 'auto';
  date: string;
  answers: Array<{ questionId: string; answerId: string; answerText: string }>;
};

export type CreatorReplyFilterState = {
  query: string;
  outcome: string;
  relationship: string;
  type: string;
  language: string;
  from: string;
  to: string;
  sort: string;
  group: string;
};

const CREATOR_REPLY_FILTERS_KEY = 'creatorReplyFilterState';

/** Reads the current value of every reply-filter/sort control directly from the DOM. */
export function readCreatorReplyFilterState(): CreatorReplyFilterState {
  return {
    query: ((document.getElementById('reply-filter-query') as HTMLInputElement | null)?.value || '').trim(),
    outcome: (document.getElementById('reply-filter-outcome') as HTMLSelectElement | null)?.value || 'all',
    relationship: (document.getElementById('reply-filter-relationship') as HTMLSelectElement | null)?.value || 'all',
    type: (document.getElementById('reply-filter-type') as HTMLSelectElement | null)?.value || 'all',
    language: (document.getElementById('reply-filter-language') as HTMLSelectElement | null)?.value || 'all',
    from: (document.getElementById('reply-filter-from') as HTMLInputElement | null)?.value || '',
    to: (document.getElementById('reply-filter-to') as HTMLInputElement | null)?.value || '',
    sort: (document.getElementById('reply-sort-order') as HTMLSelectElement | null)?.value || 'recent',
    group: (document.getElementById('reply-group-order') as HTMLSelectElement | null)?.value || 'none',
  };
}

/** Persists the current reply-filter/sort control values across reloads. */
export function persistCreatorReplyFilterState(): void {
  try {
    localStorage.setItem(CREATOR_REPLY_FILTERS_KEY, JSON.stringify(readCreatorReplyFilterState()));
  } catch {
    /* local-only preference persistence is optional */
  }
}

/** Restores every reply-filter/sort control's DOM value from the last-persisted state. */
export function restoreCreatorReplyFilterState(): void {
  let state: Partial<CreatorReplyFilterState> = {};
  try {
    const raw = localStorage.getItem(CREATOR_REPLY_FILTERS_KEY);
    state = raw ? JSON.parse(raw) as Partial<CreatorReplyFilterState> : {};
  } catch {
    state = {};
  }
  const values: Array<[string, string | undefined]> = [
    ['reply-filter-query', state.query],
    ['reply-filter-outcome', state.outcome],
    ['reply-filter-relationship', state.relationship],
    ['reply-filter-type', state.type],
    ['reply-filter-language', state.language],
    ['reply-filter-from', state.from],
    ['reply-filter-to', state.to],
    ['reply-sort-order', state.sort],
    ['reply-group-order', state.group],
  ];
  for (const [id, value] of values) {
    if (!value) continue;
    const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (element) element.value = value;
  }
}

export interface RenderCreatorRepliesDeps {
  getRows: () => CreatorReplyRow[];
  readFilterState: () => CreatorReplyFilterState;
  getScopedTalkId: () => string | null;
  getScopedTalkTitle: () => string;
  /** Clears the scoped-talk filter (both id and title) — does not itself re-render. */
  clearScope: () => void;
  getVisibleCount: () => number;
  /** Grows the visible-count page by `CREATOR_REPLY_PAGE_SIZE` — does not itself re-render. */
  growVisibleCount: () => void;
  getMyConversations: () => Record<string, any>;
  getKnownPerson: (userId: string) => KnownPerson | undefined;
  getUiLanguage: () => UiLanguage;
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, values: Record<string, string | number>) => string;
  formatTalkLanguage: (code: string) => string;
  showConversationDetail: (conversationId: string) => void;
  navigateToGraphNode: (target: GraphNodeTarget) => void;
}

export function renderCreatorReplies(deps: RenderCreatorRepliesDeps): void {
  const list = document.getElementById('creator-replies-list');
  const summary = document.getElementById('creator-replies-summary');
  if (!list || !summary) return;
  const state = deps.readFilterState();
  const query = state.query.toLowerCase();
  const fromTime = state.from ? new Date(`${state.from}T00:00:00`).getTime() : undefined;
  const toTime = state.to ? new Date(`${state.to}T23:59:59.999`).getTime() : undefined;
  const metricsByResponder = new Map<string, { replies: number; matches: number; relevance: number }>();
  const metricsByTalk = new Map<string, { replies: number; matches: number; matchRate: number }>();
  // Spec §30.2 matchThreshold routes: a matched row's own conversation (if the responder's
  // reply actually formed one — see conversationId, otherUserId keyed lookup, robust to
  // bidirectional-exchange talkId ambiguity the same way maybeFinalizeConfirmedDeal is,
  // app.ts) carries the stored score/total for the "Matched items" percentage display/sort.
  const conversationsById = deps.getMyConversations();
  const matchInfoByResponder = new Map<string, { conversationId: string; matchScore?: number; matchTotal?: number }>();
  for (const [conversationId, conversation] of Object.entries(conversationsById) as Array<[string, any]>) {
    const otherUserId = conversation?.otherUserId;
    if (!otherUserId || matchInfoByResponder.has(otherUserId)) continue;
    matchInfoByResponder.set(otherUserId, {
      conversationId,
      matchScore: conversation?.matchScore,
      matchTotal: conversation?.matchTotal,
    });
  }
  const matchPercent = (responderId: string): number | null => {
    const info = matchInfoByResponder.get(responderId);
    if (!info || info.matchScore == null || !info.matchTotal) return null;
    return Math.round((info.matchScore / info.matchTotal) * 100);
  };
  const rows = deps.getRows();
  const scopedTalkId = deps.getScopedTalkId();
  for (const row of rows) {
    const metrics = metricsByResponder.get(row.responderId) || { replies: 0, matches: 0, relevance: 0 };
    metrics.replies += 1;
    if (row.outcome === 'match') metrics.matches += 1;
    metrics.relevance = metrics.matches * 100 + metrics.replies;
    metricsByResponder.set(row.responderId, metrics);
    const talkMetrics = metricsByTalk.get(row.talkId) || { replies: 0, matches: 0, matchRate: 0 };
    talkMetrics.replies += 1;
    if (row.outcome === 'match') talkMetrics.matches += 1;
    talkMetrics.matchRate = talkMetrics.matches / talkMetrics.replies;
    metricsByTalk.set(row.talkId, talkMetrics);
  }
  const filtered = rows
    .filter((row) => {
      const known = deps.getKnownPerson(row.responderId);
      const labels = known?.labels && known.labels.length > 0
        ? known.labels.map((l) => l.toLowerCase())
        : ['stranger'];
      const time = new Date(row.date).getTime();
      if (scopedTalkId && row.talkId !== scopedTalkId) return false;
      if (query && !`${row.responderName} ${row.title}`.toLowerCase().includes(query)) return false;
      if (state.outcome !== 'all' && row.outcome !== state.outcome && row.answerMode !== state.outcome) return false;
      if (state.relationship !== 'all' && !labels.includes(state.relationship)) return false;
      if (state.type !== 'all' && String(row.type || 'flow').toLowerCase() !== state.type) return false;
      if (state.language !== 'all' && String(row.language || 'en').toLowerCase() !== state.language) return false;
      if (fromTime != null && time < fromTime) return false;
      if (toTime != null && time > toTime) return false;
      return true;
    })
    .sort((a, b) => {
      const aMetrics = metricsByResponder.get(a.responderId)!;
      const bMetrics = metricsByResponder.get(b.responderId)!;
      const aTalk = metricsByTalk.get(a.talkId)!;
      const bTalk = metricsByTalk.get(b.talkId)!;
      // Pre-sort by group field so contiguous group blocks are formed (prevents duplicate group headers).
      if (state.group === 'responder') {
        const g = a.responderName.localeCompare(b.responderName);
        if (g !== 0) return g;
      } else if (state.group === 'talk') {
        const g = a.title.localeCompare(b.title);
        if (g !== 0) return g;
      } else if (state.group === 'day') {
        const g = new Date(a.date).toLocaleDateString().localeCompare(new Date(b.date).toLocaleDateString());
        if (g !== 0) return g;
      } else if (state.group === 'relationship') {
        const aRel = (deps.getKnownPerson(a.responderId)?.labels || []).join(', ') || 'stranger';
        const bRel = (deps.getKnownPerson(b.responderId)?.labels || []).join(', ') || 'stranger';
        const g = aRel.localeCompare(bRel);
        if (g !== 0) return g;
      }
      if (state.sort === 'oldest') return new Date(a.date).getTime() - new Date(b.date).getTime();
      if (state.sort === 'user') return a.responderName.localeCompare(b.responderName) || a.title.localeCompare(b.title);
      if (state.sort === 'talk') return a.title.localeCompare(b.title) || a.responderName.localeCompare(b.responderName);
      if (state.sort === 'relationship') {
        const byRelationship = ((deps.getKnownPerson(a.responderId)?.labels || []).join(', ') || 'Stranger')
          .localeCompare((deps.getKnownPerson(b.responderId)?.labels || []).join(', ') || 'Stranger');
        if (byRelationship !== 0) return byRelationship;
      }
      if (state.sort === 'match-percent') {
        const aPct = matchPercent(a.responderId) ?? -1;
        const bPct = matchPercent(b.responderId) ?? -1;
        if (bPct !== aPct) return bPct - aPct;
      }
      if (state.sort === 'matches' && bMetrics.matches !== aMetrics.matches) return bMetrics.matches - aMetrics.matches;
      if (state.sort === 'talk-matches' && bTalk.matches !== aTalk.matches) return bTalk.matches - aTalk.matches;
      if (state.sort === 'talk-replies' && bTalk.replies !== aTalk.replies) return bTalk.replies - aTalk.replies;
      if (state.sort === 'weighted' && bMetrics.relevance !== aMetrics.relevance) return bMetrics.relevance - aMetrics.relevance;
      return new Date(b.date).getTime() - new Date(a.date).getTime() || a.responseId.localeCompare(b.responseId);
    });
  const visibleCount = deps.getVisibleCount();
  const shown = Math.min(visibleCount, filtered.length);
  summary.textContent = deps.getUiLanguage() === 'zh'
    ? `显示 ${shown}/${filtered.length} 条筛选回复（共 ${rows.length} 条）`
    : `Showing ${shown} of ${filtered.length} filtered replies (${rows.length} total)`;
  const activeFilters = document.getElementById('creator-replies-active-filters');
  if (activeFilters) {
    const chips = [
      state.query ? `${deps.getUiLanguage() === 'zh' ? '搜索' : 'Search'}: ${state.query}` : '',
      state.outcome !== 'all' ? `${deps.getUiLanguage() === 'zh' ? '结果' : 'Outcome'}: ${state.outcome}` : '',
      state.relationship !== 'all' ? `${deps.getUiLanguage() === 'zh' ? '关系' : 'Relation'}: ${state.relationship}` : '',
      state.type !== 'all' ? `${deps.getUiLanguage() === 'zh' ? '类型' : 'Type'}: ${state.type}` : '',
      state.language !== 'all' ? `${deps.getUiLanguage() === 'zh' ? deps.t('languagesLabel') : 'Language'}: ${deps.formatTalkLanguage(state.language)}` : '',
      state.from ? `${deps.getUiLanguage() === 'zh' ? '起始日期' : 'From'}: ${state.from}` : '',
      state.to ? `${deps.getUiLanguage() === 'zh' ? '结束日期' : 'To'}: ${state.to}` : '',
    ].filter(Boolean);
    const scopedTalkTitle = deps.getScopedTalkTitle();
    activeFilters.innerHTML = chips.map((chip) =>
      `<span class="reply-filter-chip" style="font-size:0.8em;background:var(--border);border-radius:999px;padding:3px 8px;">${escapeHtml(chip)}</span>`,
    ).join('') + (scopedTalkId
      ? `<span class="reply-filter-chip reply-scope-chip" id="reply-scope-chip" style="font-size:0.8em;background:var(--accent-soft);color:var(--accent-text);border-radius:999px;padding:3px 8px;cursor:pointer;font-weight:600;" title="${escapeHtml(deps.t('repliesClearScope'))}">${escapeHtml(deps.tf('repliesScopedToTalk', { title: scopedTalkTitle }))} ×</span>`
      : '');
    document.getElementById('reply-scope-chip')?.addEventListener('click', () => {
      deps.clearScope();
      renderCreatorReplies(deps);
    });
  }
  if (filtered.length === 0) {
    list.innerHTML = `<div style="color:var(--text-muted);padding:8px;">${deps.t('repliesNoMatch')}</div>`;
    return;
  }
  let previousGroup = '';
  list.innerHTML = filtered.slice(0, visibleCount).map((row) => {
    const known = deps.getKnownPerson(row.responderId);
    const label = known?.labels?.length ? known.labels.join(', ') : deps.t('stranger');
    const metrics = metricsByResponder.get(row.responderId)!;
    const score = state.sort === 'weighted'
      ? deps.getUiLanguage() === 'zh'
        ? ` · 得分 ${metrics.relevance}（${metrics.matches} 匹配 x100 + ${metrics.replies} 回复）`
        : ` · Score ${metrics.relevance} (${metrics.matches} matches x100 + ${metrics.replies} replies)`
      : '';
    const answerPreview = row.answers
      .map((answer) => String(answer.answerText || '').trim())
      .filter(Boolean)
      .join(', ');
    const group = state.group === 'responder'
      ? row.responderName
      : state.group === 'talk'
        ? row.title
        : state.group === 'relationship'
          ? String(label)
          : state.group === 'day'
            ? new Date(row.date).toLocaleDateString()
            : '';
    const groupHeader = group && group !== previousGroup
      ? `<div class="creator-reply-group" style="font-weight:700;color:var(--text-secondary);margin-top:5px;">${escapeHtml(group)}</div>`
      : '';
    previousGroup = group;
    // Spec §30.2: a matched row with a stored route matchThreshold score shows its match %
    // (Adam's "Matched items" list) and, when a conversation actually formed, is clickable
    // straight through to it instead of the profile view — review candidates, then DM.
    // Scoped to matchThreshold-route matches only (pct != null) — an ordinary (non-route, or
    // route without matchThreshold) match row keeps its long-standing behavior of navigating
    // to the responder's contact detail instead (09-contacts-talks-cross-navigation.spec.ts).
    const pct = row.outcome === 'match' ? matchPercent(row.responderId) : null;
    const matchConversationId = pct != null ? matchInfoByResponder.get(row.responderId)?.conversationId : undefined;
    const percentChip = pct != null
      ? `<span class="creator-reply-match-percent" data-match-percent="${pct}" style="font-size:0.8em;font-weight:700;color:var(--success-text);margin-left:8px;">${pct}%</span>`
      : '';
    return `${groupHeader}
      <div class="creator-reply-row" data-response-id="${escapeHtml(row.responseId)}" data-responder-id="${escapeHtml(row.responderId)}" data-responder-name="${escapeHtml(row.responderName)}" data-talk-id="${escapeHtml(row.talkId)}" ${matchConversationId ? `data-conversation-id="${escapeHtml(matchConversationId)}"` : ''} style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);cursor:pointer;" role="button" tabindex="0" title="${escapeHtml(deps.t('repliesViewContact'))}">
        <div style="display:flex;justify-content:space-between;gap:10px;">
          <strong>${escapeHtml(row.responderName)}</strong>
          <span>
            <span style="color:${row.outcome === 'match' ? 'var(--success-text)' : 'var(--text-tertiary)'};">${escapeHtml(row.outcome === 'match' ? deps.t('match') : row.outcome === 'mismatch' ? deps.t('mismatch') : row.outcome)}</span>${percentChip}
          </span>
        </div>
        <div style="font-size:0.86em;color:var(--text-secondary);">${escapeHtml(row.title)} · ${escapeHtml(row.type)} · ${escapeHtml(deps.formatTalkLanguage(String(row.language || 'en').toLowerCase()))} · ${escapeHtml(row.answerMode || 'manual')} · ${escapeHtml(String(label))} · ${escapeHtml(new Date(row.date).toLocaleString())}${escapeHtml(score)}</div>
        ${answerPreview ? `<div class="creator-reply-answers" style="font-size:0.84em;color:var(--text-primary);margin-top:4px;">${deps.t('repliesAnswers')}: ${escapeHtml(answerPreview)}</div>` : ''}
      </div>
    `;
  }).join('');
  list.querySelectorAll<HTMLElement>('.creator-reply-row').forEach((row) => {
    row.addEventListener('click', () => {
      const conversationId = row.dataset.conversationId || '';
      if (conversationId) {
        deps.showConversationDetail(conversationId);
        return;
      }
      const id = row.dataset.responderId || '';
      const name = row.dataset.responderName || '';
      if (id) deps.navigateToGraphNode({ type: 'person', id, name });
    });
  });
  if (filtered.length > visibleCount) {
    const moreCount = Math.min(CREATOR_REPLY_PAGE_SIZE, filtered.length - visibleCount);
    list.innerHTML += `<button class="btn" id="reply-load-more" type="button" style="margin-top:6px;">${deps.getUiLanguage() === 'zh' ? `再显示 ${moreCount} 条回复` : `Show ${moreCount} more replies`}</button>`;
    document.getElementById('reply-load-more')?.addEventListener('click', () => {
      deps.growVisibleCount();
      renderCreatorReplies(deps);
    });
  }
}
