import { escapeHtml } from './ui-formatters';
import type { PeerRelationshipStats, TalkHistoryItem } from '../../shared/peer-summary-types';
import type { KnownPerson } from '../../shared/types';
import { avatarInnerHtml } from './profile-avatar';
import type { UiTranslationKey } from './ui-translations';
import {
  localTalkHistoryForPeer,
  readLocalTalkExchanges,
} from '../services/local-peer-derivation';
import { matchScore } from '../../shared/talk-engine';
import { shouldSuppressForPeer } from '../services/web-talk-ledger-store';
import { buildTalkIdentityKey } from '../../shared/cid';

type PublicProfileFoundation = {
  headshot?: string | null;
  languagesJson?: string;
  profileJson?: string;
  interestsJson?: string;
  reputation?: { questionsAnswered?: number; matchesFound?: number; blockCount?: number; isHidden?: boolean };
};

export type UserDetailViewDeps = {
  currentUserId: string;
  apiBase: string;
  getMyConversations: () => Record<string, any>;
  getMyTalks: () => Record<string, any>;
  getCurrentInterests?: () => Array<{ name?: string; weight?: number; popularity?: number } | string>;
  getProfileLanguages?: () => string[];
  showConversationDetail: (conversationId: string, threadTalkId?: string) => void;
  registerTalkForPeer: (talkId: string, talkData: any, peerId: string, peerName: string) => Promise<void>;
  isBlockedByMe: (userId: string) => boolean;
  setBlocked: (userId: string, blocked: boolean) => Promise<void>;
  isSupportContact: (userId: string) => boolean;
  isSupportNotificationsMuted: () => boolean;
  setSupportNotificationsMuted: (muted: boolean) => Promise<void>;
  sendDirectMessage: (peerId: string, peerName: string, text: string) => Promise<void>;
  /** Opens (creating on demand) the pair's DM conversation (C4b). Optional talkId (TODO §O)
   *  scopes the newly-created conversation's active thread to that talk from the first message. */
  openDirectConversation: (peerId: string, peerName: string, talkId?: string) => void;
  /** Switches to the Talks tab and opens #creator-replies-panel scoped to this one talk —
   *  only offered for 'sent' history items, since only talks I authored have a full
   *  responder list available locally. */
  openTalkResponses?: (talkId: string, talkTitle: string) => void;
  /** Renders the relationship/credit context block + edit button into a container (shared with Contacts). */
  renderPeerContext?: (container: HTMLElement, peerId: string, peerName: string) => void;
  getTransportStatus: () => {
    mode: string;
    fallbackReason?: string | null;
    lastHealthyAt?: string | null;
  };
  text: (key: UiTranslationKey) => string;
  formatRelativeTime: (date: Date) => string;
  formatType: (type: string) => string;
  formatLanguage: (code: string) => string;
  getPublicProfileFoundation?: (userId: string) => Promise<PublicProfileFoundation | null>;
  /** Resolves the peer's CURRENT stage name from the live graph (self-heals stale records). */
  resolvePeerStageName?: (userId: string) => Promise<string | null>;
  /**
   * TODO §I — does the viewer have a verified, mutual `LINK_IDENTITY` edge to this peer's
   * SEA identity (i.e. this "peer" is actually one of the viewer's own linked
   * devices/installations)? v1 semantics (docs/architecture/identity-v1-semantics.md):
   * direct mutual links only, no transitive cluster or merged data — this is purely
   * informational display, never a signal to combine Contacts, blocks, reputation,
   * conversations, or Q&A across the two identities.
   */
  isLinkedIdentity?: (peerId: string) => Promise<boolean>;
  knownPerson?: KnownPerson;
};

type SortMode = 'date' | 'outcome';
type FilterMode = 'all' | 'sent' | 'received';
type OutcomeFilterMode = 'all' | 'match' | 'mismatch';
type PeerSendOmitReason = 'talk_expired' | 'broadcast_disabled' | 'peer_already_sent';

type ClassifiedPeerTalk = {
  talkId: string;
  talk: any;
  eligible: boolean;
  omitReasons: PeerSendOmitReason[];
};

function resolveExpiresAtMs(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return new Date(value).getTime();
  return Number.NaN;
}

function omitReasonLabel(deps: UserDetailViewDeps, reason: PeerSendOmitReason): string {
  const key: UiTranslationKey = reason === 'talk_expired'
    ? 'reasonTalkExpired'
    : reason === 'broadcast_disabled'
      ? 'reasonBroadcastDisabled'
      : 'peerOmitAlreadySent';
  return deps.text(key);
}

/**
 * docs/TODO.md §W Gap 2 — the "already sent" check is now the same ledger `shouldSuppressForPeer`
 * every other send path (room broadcast, contact-group broadcast) uses, not a separate
 * `localTalkExchanges`-derived set scoped only to this peer-detail view. This is what actually
 * closes the gap: a talk this peer already got via a room broadcast is now correctly hidden
 * here too, not just talks previously sent through this exact button.
 */
function classifyPeerSendTalks(
  myTalks: Record<string, any>,
  peerId: string,
): { eligible: ClassifiedPeerTalk[]; omitted: ClassifiedPeerTalk[] } {
  const eligible: ClassifiedPeerTalk[] = [];
  const omitted: ClassifiedPeerTalk[] = [];
  const now = Date.now();
  for (const [talkId, talk] of Object.entries(myTalks)) {
    if (talk?.role !== 'created') continue;
    const omitReasons: PeerSendOmitReason[] = [];
    if (talk?.disabled) omitReasons.push('broadcast_disabled');
    const expiresAt = talk?.expiresAt ?? talk?.fullTalk?.expiresAt;
    const expiresAtMs = resolveExpiresAtMs(expiresAt);
    if (Number.isFinite(expiresAtMs) && now > expiresAtMs) omitReasons.push('talk_expired');
    const fullTalk = talk?.fullTalk || talk;
    if (fullTalk && shouldSuppressForPeer(peerId, buildTalkIdentityKey(fullTalk))) {
      omitReasons.push('peer_already_sent');
    }
    const entry: ClassifiedPeerTalk = { talkId, talk, eligible: omitReasons.length === 0, omitReasons };
    if (entry.eligible) eligible.push(entry);
    else omitted.push(entry);
  }
  return { eligible, omitted };
}

/** Module-level state for the currently-open peer detail view. */
let currentState: {
  peerId: string;
  peerName: string;
  deps: UserDetailViewDeps;
  history: TalkHistoryItem[];
  sort: SortMode;
  filter: FilterMode;
  outcomeFilter: OutcomeFilterMode;
} | null = null;

function format(deps: UserDetailViewDeps, key: UiTranslationKey, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (label, [placeholder, value]) => label.replace(`{${placeholder}}`, String(value)),
    deps.text(key),
  );
}

function renderPeerShellCopy(deps: UserDetailViewDeps): void {
  const textBySelector: Array<[string, UiTranslationKey]> = [
    ['#peer-talk-history-title', 'peerTalkHistory'],
    ['.peer-sort-btn[data-sort="date"]', 'peerDate'],
    ['.peer-sort-btn[data-sort="outcome"]', 'peerOutcome'],
    ['.peer-filter-tab[data-filter="all"]', 'all'],
    ['.peer-filter-tab[data-filter="sent"]', 'sent'],
    ['.peer-filter-tab[data-filter="received"]', 'received'],
    ['.peer-outcome-tab[data-outcome="all"]', 'all'],
    ['.peer-outcome-tab[data-outcome="match"]', 'match'],
    ['.peer-outcome-tab[data-outcome="mismatch"]', 'mismatch'],
    ['#peer-auto-mode-text', 'peerAutoMode'],
    ['#peer-dm-label', 'peerSendDirectMessage'],
    ['#peer-messaging-title', 'peerMessages'],
  ];
  for (const [selector, key] of textBySelector) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.textContent = deps.text(key);
  }
  const back = document.getElementById('back-from-peer-detail');
  if (back) {
    back.textContent = '‹';
    back.title = deps.text('back');
  }
  const sendTalks = document.getElementById('peer-send-talks-btn');
  if (sendTalks) {
    sendTalks.innerHTML = `<span class="app-bar-btn-icon">📤</span><span class="app-bar-btn-label">${escapeHtml(deps.text('peerSendMyTalks'))}</span>`;
    sendTalks.setAttribute('title', deps.text('peerSendMyTalks'));
  }
  const sendMessage = document.getElementById('peer-dm-send-btn');
  if (sendMessage) sendMessage.textContent = `💬 ${deps.text('peerSendMessage')}`;
  const dmInput = document.getElementById('peer-dm-input') as HTMLTextAreaElement | null;
  if (dmInput) dmInput.placeholder = deps.text('peerMessagePlaceholder');
}

export function openPeerDetailView(
  peerId: string,
  peerName: string,
  deps: UserDetailViewDeps,
): void {
  currentState = { peerId, peerName, deps, history: [], sort: 'date', filter: 'all', outcomeFilter: 'all' };

  const overlay = document.getElementById('peer-detail-overlay');
  if (!overlay) return;
  renderPeerShellCopy(deps);

  // Set header
  const nameEl = document.getElementById('peer-detail-name');
  if (nameEl) nameEl.textContent = getPrimaryDisplayName(peerName, deps.knownPerson);
  const subtitleEl = document.getElementById('peer-detail-subtitle');
  if (subtitleEl) subtitleEl.textContent = buildLoadingSubtitle(peerName, deps);

  // Self-heal a stale header name: the opener passes the best locally-known name,
  // which can be a placeholder (User<id>) captured before the peer's profile synced.
  // Resolve the live stage name and patch the header in place.
  if (deps.resolvePeerStageName) {
    void deps.resolvePeerStageName(peerId).then((liveName) => {
      if (!liveName || liveName === peerName) return;
      if (!currentState || currentState.peerId !== peerId) return;
      currentState.peerName = liveName;
      const liveNameEl = document.getElementById('peer-detail-name');
      if (liveNameEl) liveNameEl.textContent = getPrimaryDisplayName(liveName, deps.knownPerson);
    });
  }

  // Reset sections
  const statsEl = document.getElementById('peer-stats-section');
  if (statsEl) statsEl.innerHTML = `<div style="padding:12px;color:#999;text-align:center;">${deps.text('peerLoadingStats')}</div>`;
  const historyEl = document.getElementById('peer-talk-history-list');
  if (historyEl) historyEl.innerHTML = `<div style="padding:12px;color:#999;text-align:center;">${deps.text('peerLoadingHistory')}</div>`;
  const historyControls = document.getElementById('peer-history-controls');
  if (historyControls) historyControls.style.display = 'none';
  const contextEl = document.getElementById('peer-context-section');
  if (contextEl) {
    contextEl.innerHTML = '';
    deps.renderPeerContext?.(contextEl, peerId, peerName);
  }

  // TODO §I — verified-link badge, informational only (see UserDetailViewDeps.isLinkedIdentity's
  // own doc comment). Reset first so a stale badge never survives a switch to a different peer;
  // async-checked and guarded against a stale response landing after the overlay moved on,
  // matching resolvePeerStageName's own pattern above.
  const linkedIdentityEl = document.getElementById('peer-linked-identity-section');
  if (linkedIdentityEl) linkedIdentityEl.innerHTML = '';
  if (deps.isLinkedIdentity) {
    void deps.isLinkedIdentity(peerId).then((linked) => {
      if (!linked) return;
      if (!currentState || currentState.peerId !== peerId) return;
      const el = document.getElementById('peer-linked-identity-section');
      if (!el) return;
      el.innerHTML = `
        <div class="peer-linked-identity-badge" data-testid="peer-linked-identity-badge"
             style="margin:8px 16px;padding:10px 12px;border:1px solid var(--border-strong);border-radius:8px;background:var(--bg-subtle);">
          <div style="font-weight:700;">${escapeHtml(deps.text('peerLinkedIdentityBadge'))}</div>
          <div style="font-size:0.85em;color:var(--text-tertiary);margin-top:4px;">${escapeHtml(deps.text('peerLinkedIdentityNote'))}</div>
        </div>
      `;
    }).catch(() => { /* best effort — never block peer detail on this */ });
  }

  overlay.style.display = 'flex';

  // Back button
  const backBtn = document.getElementById('back-from-peer-detail');
  if (backBtn) {
    const fresh = backBtn.cloneNode(true) as HTMLElement;
    backBtn.replaceWith(fresh);
    fresh.addEventListener('click', () => closePeerDetailView());
  }

  // ⋯ overflow menu (destructive actions live here — redesign §5)
  const overflowBtn = document.getElementById('peer-overflow-btn');
  const overflowPanel = document.getElementById('peer-overflow-panel');
  if (overflowBtn && overflowPanel) {
    const fresh = overflowBtn.cloneNode(true) as HTMLElement;
    overflowBtn.replaceWith(fresh);
    overflowPanel.classList.remove('open');
    fresh.addEventListener('click', (event) => {
      event.stopPropagation();
      overflowPanel.classList.toggle('open');
    });
  }

  // Sort/filter controls
  document.querySelectorAll('.peer-sort-btn').forEach((btn) => {
    const fresh = btn.cloneNode(true) as HTMLElement;
    btn.replaceWith(fresh);
    fresh.addEventListener('click', () => {
      document.querySelectorAll('.peer-sort-btn').forEach((b) => b.classList.remove('active'));
      fresh.classList.add('active');
      if (currentState) {
        currentState.sort = (fresh.dataset.sort as SortMode) || 'date';
        renderHistory();
      }
    });
  });

  document.querySelectorAll('.peer-filter-tab').forEach((tab) => {
    const fresh = tab.cloneNode(true) as HTMLElement;
    tab.replaceWith(fresh);
    fresh.addEventListener('click', () => {
      document.querySelectorAll('.peer-filter-tab').forEach((b) => b.classList.remove('active'));
      fresh.classList.add('active');
      if (currentState) {
        currentState.filter = (fresh.dataset.filter as FilterMode) || 'all';
        renderHistory();
      }
    });
  });

  document.querySelectorAll('.peer-outcome-tab').forEach((tab) => {
    const fresh = tab.cloneNode(true) as HTMLElement;
    tab.replaceWith(fresh);
    fresh.addEventListener('click', () => {
      document.querySelectorAll('.peer-outcome-tab').forEach((b) => b.classList.remove('active'));
      fresh.classList.add('active');
      if (currentState) {
        currentState.outcomeFilter = (fresh.dataset.outcome as OutcomeFilterMode) || 'all';
        renderHistory();
      }
    });
  });

  // Send-my-talks button
  const sendBtn = document.getElementById('peer-send-talks-btn');
  if (sendBtn) {
    const fresh = sendBtn.cloneNode(true) as HTMLButtonElement;
    sendBtn.replaceWith(fresh);
    fresh.disabled = deps.isBlockedByMe(peerId);
    fresh.addEventListener('click', () => handleSendMyTalks());
  }

  const blockBtn = document.getElementById('peer-block-user-btn');
  if (blockBtn) {
    const fresh = blockBtn.cloneNode(true) as HTMLElement;
    blockBtn.replaceWith(fresh);
    const supportContact = deps.isSupportContact(peerId);
    const supportMuted = supportContact && deps.isSupportNotificationsMuted();
    const blockLabel = deps.text(
      supportContact
        ? (supportMuted ? 'contactUnmuteSupport' : 'contactMuteSupport')
        : (deps.isBlockedByMe(peerId) ? 'contactUnblockUser' : 'contactBlockUser'),
    );
    fresh.innerHTML = `<span class="app-bar-btn-icon">${supportContact ? '🔕' : '🚫'}</span><span class="app-bar-btn-label">${escapeHtml(blockLabel)}</span>`;
    fresh.addEventListener('click', async () => {
      document.getElementById('peer-overflow-panel')?.classList.remove('open');
      if (supportContact) {
        await deps.setSupportNotificationsMuted(!supportMuted);
      } else {
        await deps.setBlocked(peerId, !deps.isBlockedByMe(peerId));
      }
      closePeerDetailView();
    });
  }

  // DM compose input
  const dmInput = document.getElementById('peer-dm-input') as HTMLTextAreaElement | null;
  if (dmInput) dmInput.value = '';
  const dmSendBtn = document.getElementById('peer-dm-send-btn');
  if (dmSendBtn) {
    const fresh = dmSendBtn.cloneNode(true) as HTMLButtonElement;
    dmSendBtn.replaceWith(fresh);
    fresh.addEventListener('click', async () => {
      const inp = document.getElementById('peer-dm-input') as HTMLTextAreaElement | null;
      const text = inp?.value?.trim() ?? '';
      if (!text) return;
      fresh.disabled = true;
      fresh.textContent = `⏳ ${deps.text('peerSending')}`;
      try {
        await deps.sendDirectMessage(peerId, peerName, text);
        if (inp) inp.value = '';
        fresh.textContent = `✓ ${deps.text('peerSentStatus')}`;
        setTimeout(() => {
          fresh.disabled = false;
          fresh.textContent = `💬 ${deps.text('peerSendMessage')}`;
        }, 2000);
      } catch {
        fresh.disabled = false;
        fresh.textContent = `💬 ${deps.text('peerSendMessage')}`;
      }
    });
  }

  // Load data
  fetchAndRenderStats(peerId, peerName, deps);
  fetchAndRenderHistory(peerId, deps);
}

export function closePeerDetailView(): void {
  const overlay = document.getElementById('peer-detail-overlay');
  if (overlay) overlay.style.display = 'none';
  currentState = null;
}

/** Server-authoritative block edges for disabling Send My Talks (matches register-receivers / delivery). */
type PeerBlockStatus = { eitherBlocked: boolean; blocked: boolean; blockedBy: boolean };

async function readPeerBlockStatus(
  peerId: string,
  deps: UserDetailViewDeps,
): Promise<PeerBlockStatus> {
  if (deps.isSupportContact(peerId)) {
    return { eitherBlocked: false, blocked: false, blockedBy: false };
  }
  try {
    const r = await fetch(
      `${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/block-status/${encodeURIComponent(peerId)}`,
    );
    if (r.ok) {
      const s = (await r.json()) as { eitherBlocked?: boolean; blocked?: boolean; blockedBy?: boolean };
      return {
        eitherBlocked: Boolean(s.eitherBlocked || s.blocked || s.blockedBy),
        blocked: Boolean(s.blocked),
        blockedBy: Boolean(s.blockedBy),
      };
    }
  } catch {
    /* fall through */
  }
  const blocked = deps.isBlockedByMe(peerId);
  return { eitherBlocked: blocked, blocked, blockedBy: false };
}

async function applySendButtonFromBlockStatus(
  peerId: string,
  deps: UserDetailViewDeps,
  status?: PeerBlockStatus,
): Promise<void> {
  const sendBtn = document.getElementById('peer-send-talks-btn') as HTMLButtonElement | null;
  if (!sendBtn) return;
  const resolved = status || await readPeerBlockStatus(peerId, deps);
  sendBtn.disabled = resolved.eitherBlocked;
}

// fetchPeerDetailWithTimeout, renderBlockedPeerDetail, isPeerDetailBlocked, and
// publicUserHasProfileFoundation removed — no longer needed after P0 step 5.

function parsePublicProfileArray<T>(value: string | undefined, fallback: T[]): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

async function readPublicProfileFoundation(peerId: string, deps: UserDetailViewDeps): Promise<any | null> {
  if (!deps.getPublicProfileFoundation) return null;
  const deadline = Date.now() + 8_500;
  let foundation: PublicProfileFoundation | null = null;
  while (!foundation && Date.now() < deadline) {
    foundation = await Promise.race([
      deps.getPublicProfileFoundation(peerId).catch(() => null),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1_500)),
    ]);
    if (!foundation) await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  if (!foundation) return null;
  return {
    headshot: foundation.headshot || '',
    languages: parsePublicProfileArray<string>(foundation.languagesJson, []),
    profile: parsePublicProfileArray<any>(foundation.profileJson, []),
    interests: parsePublicProfileArray<any>(foundation.interestsJson, []),
    reputation: foundation.reputation,
  };
}

/**
 * Compute local PeerRelationshipStats for peerId from localTalkExchanges and
 * myConversations. This mirrors the formula in peer-routes.ts#computeRelationshipStats:
 *   sent.talks  = exchanges where direction='sent'
 *   sent.matches = sent exchanges where outcome='match'
 *   received.talks = conversations (each match conversation = 1 received talk)
 *   received.matches = conversations count
 *   totalTalks = sent.talks + received.talks
 *   matchRate = (sent.matches + received.matches) / max(totalTalks, 1)
 */
function computeLocalStats(peerId: string, deps: UserDetailViewDeps): PeerRelationshipStats {
  const stats: PeerRelationshipStats = {
    sent: { talks: 0, matches: 0 },
    received: { talks: 0, matches: 0 },
    mutualMatchedTalks: 0,
    mutualTagCount: 0,
    totalTalks: 0,
  };
  for (const exchange of readLocalTalkExchanges()) {
    if (String(exchange?.peerId || '').trim() !== peerId) continue;
    stats.sent.talks += 1;
    if (String(exchange?.outcome || '').toLowerCase() === 'match') {
      stats.sent.matches += 1;
      stats.mutualMatchedTalks += 1;
    }
  }
  const conversations = deps.getMyConversations();
  for (const conv of Object.values(conversations || {}) as any[]) {
    if (String(conv?.otherUserId || '').trim() !== peerId || conv?.supportChannel === true) continue;
    stats.received.talks += 1;
    stats.received.matches += 1;
  }
  stats.totalTalks = stats.sent.talks + stats.received.talks;
  return stats;
}

async function fetchAndRenderStats(peerId: string, peerName: string, deps: UserDetailViewDeps): Promise<void> {
  const statsEl = document.getElementById('peer-stats-section');
  try {
    const blockStatus = await readPeerBlockStatus(peerId, deps);
    if (blockStatus.blockedBy) {
      const subtitleEl = document.getElementById('peer-detail-subtitle');
      if (subtitleEl) subtitleEl.textContent = `${peerName} · blocked`;
      if (statsEl) {
        statsEl.innerHTML = `<div style="padding:12px;color:var(--text-tertiary);">${deps.text('contactProfileUnavailable')} ${deps.text('peerBlockedDetail')}</div>`;
      }
      await applySendButtonFromBlockStatus(peerId, deps, blockStatus);
      return;
    }
    // P0 step 5: relationship stats derived locally — no server call.
    const stats = computeLocalStats(peerId, deps);

    // Public profile still fetched from Gun (local Gun cache, not a REST endpoint).
    const publicUser = await readPublicProfileFoundation(peerId, deps);

    const subtitleEl = document.getElementById('peer-detail-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent = buildStatsSubtitle(peerName, stats, deps);
    }

    if (statsEl) {
      statsEl.innerHTML = renderProfileHtml(publicUser, deps) +
        renderTransportHtml(deps) +
        renderStatsHtml(stats, deps);
    }
    await applySendButtonFromBlockStatus(peerId, deps);

    // Render matched conversations below stats
    renderMatchedConversations(peerId, deps);
  } catch {
    if (statsEl) statsEl.innerHTML = `<div style="padding:12px;color:#c00;">${deps.text('peerStatsUnavailable')}</div>`;
    await applySendButtonFromBlockStatus(peerId, deps);
  }
}

// renderStatsUnavailableHtml removed — P0 step 5 uses inline error handling.

function renderProfileHtml(publicUser: any, deps: UserDetailViewDeps): string {
  const headshot = String(publicUser?.headshot || '').trim();
  const languages = Array.isArray(publicUser?.languages) ? publicUser.languages.filter(Boolean) : [];
  const ownLanguages = new Set(
    (deps.getProfileLanguages?.() || []).map((code) => String(code).trim().toLowerCase()).filter(Boolean),
  );
  const languageLabels = languages.map((code: string) => {
    const language = deps.formatLanguage(code);
    return ownLanguages.has(String(code).trim().toLowerCase())
      ? format(deps, 'contactSharedLanguage', { language })
      : language;
  });
  const interests = Array.isArray(publicUser?.interests)
    ? publicUser.interests.map((t: { name?: string }) => String(t?.name || '').trim()).filter(Boolean)
    : [];
  const profile = Array.isArray(publicUser?.profile) ? publicUser.profile.filter((qa: any) => qa?.question && qa?.answer) : [];
  const ownInterests = (deps.getCurrentInterests?.() || []).map((interest) => typeof interest === 'string' ? interest : String(interest?.name || '')).filter(Boolean);
  const ownKeys = new Set(ownInterests.map((interest) => interest.trim().toLowerCase()));
  const sharedInterests = interests.filter((interest: string) => ownKeys.has(interest.trim().toLowerCase()));
  const score = matchScore(ownInterests, interests);
  const compatibility = ownInterests.length || interests.length
    ? Math.min(100, Math.round((score / Math.max(ownInterests.length, interests.length, 1)) * 100))
    : 0;
  const reputation = publicUser?.reputation;
  const reputationHtml = reputation && reputation.isHidden !== true
    ? `<div class="peer-reputation-row" aria-label="Reputation summary">
        <span title="Responses">↳ ${Number(reputation.questionsAnswered || 0)}</span>
        <span title="Matches">✓ ${Number(reputation.matchesFound || 0)}</span>
        <span title="Flags">⚑ ${Number(reputation.blockCount || 0)}</span>
      </div>`
    : '';
  return `
    <div class="peer-stat-card contact-public-profile-summary" style="margin-bottom:12px;">
      <div style="display:flex; gap:12px; align-items:flex-start;">
        <div class="user-avatar" style="width:56px; height:56px; font-size:1.5em; flex-shrink:0;">${avatarInnerHtml(headshot, '?', escapeHtml)}</div>
        <div style="min-width:0; flex:1;">
          <div style="font-weight:700; color:var(--text-primary);">${deps.text('publicProfile')}</div>
          <div class="peer-compatibility" aria-label="Compatibility ${compatibility}%">
            <div class="peer-compatibility-label"><span>Compatibility</span><strong>${compatibility}%</strong></div>
            <div class="peer-compatibility-track"><span style="width:${compatibility}%"></span></div>
          </div>
          <div class="contact-profile-languages" style="font-size:0.85em; color:var(--text-secondary); margin-top:4px;">${deps.text('languagesLabel')}: ${escapeHtml(languageLabels.length > 0 ? languageLabels.join(', ') : deps.text('notListed'))}</div>
          ${interests.length > 0 ? `<div style="font-size:0.85em; color:var(--text-secondary); margin-top:4px;">${deps.text('interestsLabel')}: ${escapeHtml(interests.join(', '))}</div>` : ''}
          ${sharedInterests.length > 0 ? `<div class="peer-shared-tags"><strong>Shared tags</strong><span>${escapeHtml(sharedInterests.join(', '))}</span></div>` : ''}
          ${reputationHtml}
          <div style="display:grid; gap:8px; margin-top:10px;">
            ${
              profile.length > 0
                ? profile
                    .slice(0, 4)
                    .map(
                      (qa: any) => `
                        <div style="padding:8px 10px; border-radius:10px; background:var(--bg-subtle); border:1px solid var(--border);">
                          <div style="font-size:0.78em; color:var(--text-tertiary);">${escapeHtml(String(qa.question))}</div>
                          <div style="font-size:0.92em; font-weight:600; color:var(--text-primary); margin-top:2px;">${escapeHtml(String(qa.answer))}</div>
                        </div>
                      `,
                    )
                    .join('')
                : `<div style="font-size:0.85em; color:var(--text-muted);">${deps.text('noPublicProfile')}</div>`
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

function transportLabel(mode: string, deps: UserDetailViewDeps): string {
  if (mode === 'direct-p2p') return deps.text('transportDirectP2P');
  if (mode === 'server-relay') return deps.text('transportServerRelay');
  return deps.text('transportStarGun');
}

function renderTransportHtml(deps: UserDetailViewDeps): string {
  const status = deps.getTransportStatus();
  const fallbackText = status.fallbackReason
    ? format(deps, 'transportFallbackReason', { reason: status.fallbackReason })
    : status.mode === 'star-gun'
      ? deps.text('transportNoFallbackActive')
      : deps.text('transportNoFallbackReported');
  const lastHealthyText = status.lastHealthyAt
    ? format(deps, 'transportLastHealthyContact', { time: deps.formatRelativeTime(new Date(status.lastHealthyAt)) })
    : deps.text('transportNoHealthyContact');
  return `
    <div class="peer-transport-status" data-transport-mode="${escapeHtml(status.mode)}" style="margin-bottom:12px;padding:10px 12px;border:1px solid var(--accent-soft);border-radius:10px;background:var(--accent-soft);color:var(--accent-text);font-size:0.86em;">
      <span style="font-weight:700;">${deps.text('peerChannelStatus')}:</span>
      ${transportLabel(status.mode, deps)}
      <div class="peer-transport-fallback" style="margin-top:4px;color:var(--text-secondary);">${escapeHtml(fallbackText)}</div>
      <div class="peer-transport-health" style="margin-top:2px;color:var(--text-secondary);">${escapeHtml(lastHealthyText)}</div>
    </div>
  `;
}

function renderStatsHtml(stats: PeerRelationshipStats, deps: UserDetailViewDeps): string {
  const sentIcon = stats.sent.talks === 0 ? '📤' : '📤';
  const receivedIcon = stats.received.talks === 0 ? '📥' : '📥';
  const nickname = String(deps.knownPerson?.nickname || '').trim();
  const relationship = formatRelationshipLabel(deps.knownPerson?.labels, deps);
  return `
    <div class="peer-stats-grid">
      <div class="peer-stat-card">
        <div class="peer-stat-icon">🧾</div>
        <div class="peer-stat-body">
          <div class="peer-stat-label">${deps.text('peerTalksExchanged')}</div>
          <div class="peer-stat-value">${stats.totalTalks}</div>
          <div class="peer-stat-sub">${relationship}</div>
        </div>
      </div>
      <div class="peer-stat-card">
        <div class="peer-stat-icon">${sentIcon}</div>
        <div class="peer-stat-body">
          <div class="peer-stat-label">${deps.text('sent')}</div>
          <div class="peer-stat-value">${format(deps, stats.sent.talks === 1 ? 'contactsTalkCountOne' : 'contactsTalkCount', { count: stats.sent.talks })}</div>
          <div class="peer-stat-sub">${format(deps, 'peerMatchedCount', { count: stats.sent.matches })}</div>
        </div>
      </div>
      <div class="peer-stat-card">
        <div class="peer-stat-icon">${receivedIcon}</div>
        <div class="peer-stat-body">
          <div class="peer-stat-label">${deps.text('received')}</div>
          <div class="peer-stat-value">${format(deps, stats.received.talks === 1 ? 'contactsTalkCountOne' : 'contactsTalkCount', { count: stats.received.talks })}</div>
          <div class="peer-stat-sub">${format(deps, 'peerMatchedCount', { count: stats.received.matches })}</div>
        </div>
      </div>
      ${nickname ? `
      <div class="peer-stat-card peer-stat-mutual">
        <div class="peer-stat-icon">🏷️</div>
        <div class="peer-stat-body">
          <div class="peer-stat-label">${deps.text('peerNickname')}</div>
          <div class="peer-stat-value">${escapeHtml(nickname)}</div>
        </div>
      </div>` : ''}
      ${stats.mutualMatchedTalks > 0 ? `
      <div class="peer-stat-card peer-stat-mutual">
        <div class="peer-stat-icon">🤝</div>
        <div class="peer-stat-body">
          <div class="peer-stat-label">${deps.text('peerMutualMatches')}</div>
          <div class="peer-stat-value">${stats.mutualMatchedTalks}</div>
        </div>
      </div>` : ''}
      ${stats.mutualTagCount > 0 ? `
      <div class="peer-stat-card peer-stat-mutual">
        <div class="peer-stat-icon">🏷️</div>
        <div class="peer-stat-body">
          <div class="peer-stat-label">${deps.text('peerMutualTags')}</div>
          <div class="peer-stat-value">${stats.mutualTagCount}</div>
        </div>
      </div>` : ''}
    </div>
  `;
}

function getPrimaryDisplayName(stageName: string, knownPerson?: KnownPerson): string {
  const nickname = String(knownPerson?.nickname || '').trim();
  const baseStageName = String(stageName || 'Unknown').trim() || 'Unknown';
  if (!nickname) return baseStageName;
  // Same convention as the Contacts list: "nickname (stage name)" when they differ.
  if (nickname.toLowerCase() === baseStageName.toLowerCase()) return nickname;
  return `${nickname} (${baseStageName})`;
}

function formatRelationshipLabel(labels: string[] | undefined, deps: UserDetailViewDeps): string {
  if (!labels || labels.length === 0) return deps.text('contactNoRelationship');
  const keyByLabel: Record<string, UiTranslationKey> = {
    friend: 'friends',
    relative: 'relatives',
    coworker: 'coworkers',
    acquaintance: 'acquaintances',
    partner: 'partners',
    custom: 'custom',
  };
  return labels.map((label) => (keyByLabel[label] ? deps.text(keyByLabel[label]) : label)).join(', ');
}

function buildLoadingSubtitle(stageName: string, deps: UserDetailViewDeps): string {
  const nickname = String(deps.knownPerson?.nickname || '').trim();
  const baseStageName = String(stageName || 'Unknown').trim() || 'Unknown';
  if (nickname && nickname.toLowerCase() !== baseStageName.toLowerCase()) {
    return `${format(deps, 'peerStageName', { name: baseStageName })} · ${deps.text('loading')}`;
  }
  return deps.text('loading');
}

function buildStatsSubtitle(stageName: string, stats: PeerRelationshipStats, deps: UserDetailViewDeps): string {
  const nickname = String(deps.knownPerson?.nickname || '').trim();
  const baseStageName = String(stageName || 'Unknown').trim() || 'Unknown';
  const relationship = deps.knownPerson?.labels?.length ? formatRelationshipLabel(deps.knownPerson.labels, deps) : null;
  const parts: string[] = [];
  if (nickname && nickname.toLowerCase() !== baseStageName.toLowerCase()) {
    parts.push(format(deps, 'peerStageName', { name: baseStageName }));
  }
  if (relationship) parts.push(relationship);
  const stageLine = stats.totalTalks === 0
    ? deps.text('stranger')
    : format(deps, stats.totalTalks === 1 ? 'peerTalkExchangedOne' : 'peerTalksExchangedCount', { count: stats.totalTalks });
  parts.push(stageLine);
  return parts.join(' · ');
}

/** Re-render the messaging area of an open ⟨User⟩ layout (badges/snippets refresh). */
export function refreshPeerThreadList(): void {
  if (!currentState) return;
  renderMatchedConversations(currentState.peerId, currentState.deps);
}

/**
 * The messaging area of the shared ⟨User⟩ layout (redesign §5): an email-style
 * thread list — the pair's DM thread first, then one row per matched talk — each
 * row showing title, latest-reply snippet, timestamp, and an unread badge.
 * Conversations are one-per-pair (`conv_pair_…`); per-talk threads are scoped by
 * `conversationId + talkId` (message `talkId` field). Opening a row pushes the
 * ⟨Thread⟩/⟨Conv⟩ page on top of the User layout (rule N2); the layout stays open
 * underneath so back returns here.
 */
function renderMatchedConversations(peerId: string, deps: UserDetailViewDeps): void {
  const section = document.getElementById('peer-conversations-section');
  if (!section) return;

  const conversations = deps.getMyConversations();
  const pairEntry = Object.entries(conversations).find(
    ([, c]: [string, any]) => c.otherUserId === peerId,
  );
  const convId = pairEntry?.[0] || '';
  const conv: any = pairEntry?.[1] || null;
  const summaries: Record<string, { lastMessage?: string; lastMessageTime?: string; unreadCount?: number }> =
    conv?.threadSummaries && typeof conv.threadSummaries === 'object' ? conv.threadSummaries : {};

  const relatedTalkIds: string[] = Array.isArray(conv?.relatedTalkIds)
    ? conv.relatedTalkIds.filter((id: unknown) => id && id !== 'direct')
    : (conv?.talkId && conv.talkId !== 'direct' ? [String(conv.talkId)] : []);

  const myTalks = deps.getMyTalks();
  const peerName = currentState?.peerName || '';

  const threadRow = (
    talkKey: string,
    title: string,
    testid: string,
    summary: { lastMessage?: string; lastMessageTime?: string; unreadCount?: number },
  ): string => {
    const lastMsg = summary?.lastMessage
      ? escapeHtml(String(summary.lastMessage).slice(0, 60))
      : deps.text('peerStartChatting');
    const timeLabel = summary?.lastMessageTime
      ? deps.formatRelativeTime(new Date(summary.lastMessageTime))
      : '';
    const unread = Number(summary?.unreadCount || 0) || 0;
    const unreadBadge = unread > 0
      ? `<span class="thread-unread-badge" data-unread-count="${unread}">${unread > 99 ? '99+' : unread}</span>`
      : '';
    return `
      <div class="peer-thread-item" data-testid="${testid}" data-conv-id="${escapeHtml(convId)}" data-talk-id="${escapeHtml(talkKey)}" role="button" tabindex="0">
        <div class="peer-thread-main">
          <div class="peer-thread-title">${escapeHtml(title)}</div>
          <div class="peer-thread-snippet">${lastMsg}</div>
        </div>
        <div class="peer-thread-side">
          <span class="peer-thread-time">${escapeHtml(timeLabel)}</span>
          ${unreadBadge}
        </div>
      </div>
    `;
  };

  const dmSummary = summaries['direct'] || {
    lastMessage: conv?.lastMessage || '',
    lastMessageTime: conv?.lastMessageTime || '',
    unreadCount: 0,
  };
  const dmRow = conv
    ? threadRow('direct', deps.text('peerDirectMessages'), 'dm-thread-entry', dmSummary)
    : `
      <div class="peer-thread-item peer-thread-new-dm" data-testid="dm-thread-entry" data-talk-id="direct" role="button" tabindex="0">
        <div class="peer-thread-main">
          <div class="peer-thread-title">${escapeHtml(deps.text('peerDirectMessages'))}</div>
          <div class="peer-thread-snippet">${deps.text('peerStartChatting')}</div>
        </div>
        <div class="peer-thread-side"><span style="color:#999;">›</span></div>
      </div>
    `;

  const sortedTalkIds = [...relatedTalkIds].sort((a, b) => {
    const at = new Date(summaries[a]?.lastMessageTime || 0).getTime();
    const bt = new Date(summaries[b]?.lastMessageTime || 0).getTime();
    return bt - at;
  });
  const threadRows = sortedTalkIds
    .map((talkId) => {
      const talk = myTalks[talkId] as any;
      const talkTitle = talk?.title || talk?.fullTalk?.title
        || `${deps.text('peerTalkFallback')} ${String(talkId).slice(0, 8)}`;
      return threadRow(talkId, String(talkTitle), 'matched-talk-thread', summaries[talkId] || {});
    })
    .join('');

  section.innerHTML = `
    <div class="peer-thread-list" id="peer-conv-list">
      ${dmRow}
      ${sortedTalkIds.length > 0 ? `<div class="peer-thread-group-label">${format(deps, 'peerConversations', { count: sortedTalkIds.length })}</div>` : ''}
      ${threadRows}
    </div>
  `;

  section.querySelectorAll<HTMLElement>('.peer-thread-item').forEach((row) => {
    row.addEventListener('click', () => {
      const rowConvId = row.dataset.convId;
      const talkKey = row.dataset.talkId || 'direct';
      if (rowConvId) {
        // Keep the User layout open underneath — back from the thread lands here (N2).
        deps.showConversationDetail(rowConvId, talkKey === 'direct' ? undefined : talkKey);
      } else {
        deps.openDirectConversation(peerId, peerName);
      }
    });
  });
}

async function fetchAndRenderHistory(peerId: string, deps: UserDetailViewDeps): Promise<void> {
  // P0 step 5: history derived from local stores only — no server call.
  const fallbackTitle = deps.text('peerTalkFallback');
  const localItems = localTalkHistoryForPeer(
    peerId,
    deps.getMyConversations(),
    deps.getMyTalks(),
    fallbackTitle,
  );
  // Convert LocalTalkHistoryItem → TalkHistoryItem (add missing fields with safe defaults)
  const history: TalkHistoryItem[] = localItems.map((item) => ({
    talkId: item.talkId,
    identityKey: item.identityKey || item.talkId,
    title: item.title,
    type: item.type || 'flow',
    direction: item.direction,
    outcome: item.outcome === 'pending' ? 'mismatch' : item.outcome,
    date: item.date,
  }));

  if (currentState && currentState.peerId === peerId) {
    currentState.history = history;
    const controls = document.getElementById('peer-history-controls');
    if (controls) controls.style.display = history.length > 0 ? 'flex' : 'none';
    renderHistory();
  }
}

function renderHistory(): void {
  if (!currentState) return;
  const { peerId, peerName, history, sort, filter, outcomeFilter, deps } = currentState;
  const historyEl = document.getElementById('peer-talk-history-list');
  if (!historyEl) return;

  let items = [...history];

  // Filter
  if (filter !== 'all') {
    items = items.filter((i) => i.direction === filter);
  }
  if (outcomeFilter !== 'all') {
    items = items.filter((i) => i.outcome === outcomeFilter);
  }

  // Sort
  if (sort === 'outcome') {
    const rank = { match: 0, mismatch: 1, pending: 2 } as const;
    items.sort((a, b) => rank[a.outcome] - rank[b.outcome] || new Date(b.date).getTime() - new Date(a.date).getTime());
  } else {
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  if (items.length === 0) {
    historyEl.innerHTML = `<div style="padding:16px;text-align:center;color:#999;">${deps.text('peerNoHistory')}</div>`;
    return;
  }

  historyEl.innerHTML = items
    .map((item) => {
      const dirIcon = item.direction === 'sent' ? '📤' : '📥';
      const dirLabel = deps.text(item.direction === 'sent' ? 'sent' : 'received');
      const outcomeClass = `peer-outcome-${item.outcome}`;
      const outcomeLabel = item.outcome === 'match'
        ? `✓ ${deps.text('peerMatch')}`
        : item.outcome === 'mismatch'
          ? `✗ ${deps.text('peerMismatch')}`
          : `⏳ ${deps.text('peerPending')}`;
      const typeLabel = item.type ? `<span class="peer-talk-type">${escapeHtml(deps.formatType(item.type))}</span>` : '';
      const dateLabel = deps.formatRelativeTime(new Date(item.date));
      // Only a talk *I* authored (direction 'sent') has a full responses list to show —
      // deriveLocalCreatorReplies only has complete responder data for talks I sent, not
      // ones I answered. For those, the title is a separate click target (View Responses);
      // for 'received' items it's plain text and the whole row keeps opening the DM thread.
      const titleContent = escapeHtml(item.title) + ' ' + typeLabel;
      const titleHtml = item.direction === 'sent'
        ? `<button type="button" class="peer-history-title peer-history-title-link" data-talk-id="${escapeHtml(item.talkId)}" data-talk-title="${escapeHtml(item.title)}" style="background:none;border:none;padding:0;font:inherit;text-align:left;color:inherit;cursor:pointer;text-decoration:underline dotted;">${titleContent}</button>`
        : `<div class="peer-history-title">${titleContent}</div>`;
      return `
        <div class="peer-history-item ${outcomeClass}" data-talk-id="${escapeHtml(item.talkId)}" role="button" tabindex="0" style="cursor:pointer;">
          <div class="peer-history-direction" title="${dirLabel}">${dirIcon}</div>
          <div class="peer-history-body">
            ${titleHtml}
            <div class="peer-history-meta">
              <span class="peer-history-outcome">${outcomeLabel}</span>
              <span class="peer-history-date">${dateLabel}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  // TODO §O: every exchanged talk (not only ones already in relatedTalkIds) opens the DM with
  // that talk as the active thread context — a mismatch/pending talk with no conversation yet
  // creates one on demand; an existing conversation just re-scopes to this talk.
  historyEl.querySelectorAll<HTMLElement>('.peer-history-item').forEach((row) => {
    row.addEventListener('click', () => {
      const talkId = row.dataset.talkId || '';
      if (!talkId) return;
      const conversations = deps.getMyConversations();
      const pairEntry = Object.entries(conversations).find(
        ([, c]: [string, any]) => c.otherUserId === peerId,
      );
      if (pairEntry) {
        deps.showConversationDetail(pairEntry[0], talkId);
      } else {
        deps.openDirectConversation(peerId, peerName, talkId);
      }
    });
  });
  historyEl.querySelectorAll<HTMLElement>('.peer-history-title-link').forEach((titleBtn) => {
    titleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const talkId = titleBtn.dataset.talkId || '';
      const talkTitle = titleBtn.dataset.talkTitle || '';
      if (talkId) deps.openTalkResponses?.(talkId, talkTitle);
    });
  });
}

async function handleSendMyTalks(): Promise<void> {
  if (!currentState) return;
  const { peerId, peerName, deps } = currentState;

  const sendBtn = document.getElementById('peer-send-talks-btn') as HTMLButtonElement | null;
  const autoCheckbox = document.getElementById('peer-auto-mode-checkbox') as HTMLInputElement | null;
  const isAuto = autoCheckbox?.checked ?? true;

  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = `⏳ ${deps.text('peerSending')}`;
  }

  try {
    // docs/TODO.md §W Gap 2: "already sent" now reads the unified ledger — no server call,
    // same as before, but no longer scoped to only what this exact button has sent.
    const { eligible, omitted } = classifyPeerSendTalks(deps.getMyTalks(), peerId);
    const candidates = eligible.map((entry) => [entry.talkId, entry.talk] as [string, any]);

    if (candidates.length === 0) {
      if (sendBtn) {
        sendBtn.disabled = false;
        if (omitted.length > 0) {
          sendBtn.textContent = `✓ ${deps.text('peerNoEligibleTalks')}`;
          if (!isAuto) {
            showSendTalksPicker(eligible, omitted, peerId, peerName, deps, sendBtn);
          }
        } else {
          sendBtn.textContent = `✓ ${deps.text('peerAllTalksSent')}`;
        }
      }
      return;
    }

    if (!isAuto) {
      showSendTalksPicker(eligible, omitted, peerId, peerName, deps, sendBtn);
      return;
    }

    let sent = 0;
    for (const [talkId, talk] of candidates) {
      const talkData = talk?.fullTalk || talk;
      try {
        await deps.registerTalkForPeer(talkId, talkData, peerId, peerName);
        sent++;
      } catch {
        // Continue with others on individual failure
      }
    }

    if (sendBtn) {
      sendBtn.disabled = false;
      if (sent > 0 && omitted.length > 0) {
        sendBtn.textContent = `✓ ${format(deps, 'peerSentWithOmitted', { sent, omitted: omitted.length })}`;
      } else {
        sendBtn.textContent = sent > 0
          ? `✓ ${format(deps, sent === 1 ? 'peerSentTalkOne' : 'peerSentTalks', { count: sent })}`
          : `✓ ${deps.text('peerNothingNewToSend')}`;
      }
    }

    // Refresh history
    fetchAndRenderHistory(peerId, deps);
    setTimeout(() => {
      if (sendBtn && !sendBtn.disabled) sendBtn.textContent = `📤 ${deps.text('peerSendMyTalks')}`;
    }, 3000);
  } catch (err) {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = `📤 ${deps.text('peerSendMyTalks')}`;
    }
  }
}

function showSendTalksPicker(
  eligible: ClassifiedPeerTalk[],
  omitted: ClassifiedPeerTalk[],
  peerId: string,
  peerName: string,
  deps: UserDetailViewDeps,
  triggerBtn: HTMLButtonElement | null,
): void {
  const existing = document.getElementById('peer-send-picker-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'peer-send-picker-modal';
  modal.className = 'modal-overlay';
  const eligibleRows = eligible.map((entry) => `
    <label class="peer-send-picker-eligible" style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-muted);border-radius:8px;margin-bottom:6px;cursor:pointer;">
      <input type="checkbox" class="send-picker-cb" data-talk-id="${escapeHtml(entry.talkId)}" checked>
      <span style="font-weight:600;">${escapeHtml(entry.talk?.title || entry.talk?.fullTalk?.title || entry.talkId)}</span>
    </label>
  `).join('');
  const omittedRows = omitted.map((entry) => {
    const reasonText = entry.omitReasons.map((reason) => omitReasonLabel(deps, reason)).join(' · ');
    return `
      <div class="peer-send-picker-omitted" data-talk-id="${escapeHtml(entry.talkId)}" style="display:flex;flex-direction:column;gap:4px;padding:8px;background:var(--danger-soft);border:1px solid var(--danger-border);border-radius:8px;margin-bottom:6px;opacity:0.92;">
        <span style="font-weight:600;color:var(--danger-hover);">${escapeHtml(entry.talk?.title || entry.talk?.fullTalk?.title || entry.talkId)}</span>
        <span style="font-size:0.82em;color:var(--text-tertiary);">${escapeHtml(reasonText)}</span>
      </div>
    `;
  }).join('');
  modal.innerHTML = `
    <div class="modal-content" style="max-width:420px;">
      <div class="modal-header">
        <h2 class="modal-title">${format(deps, 'peerSendTalksTo', { name: escapeHtml(peerName) })}</h2>
        <button class="close-button" id="close-send-picker">&times;</button>
      </div>
      <div style="padding:16px;">
        ${eligible.length > 0 ? `<p style="margin:0 0 12px;font-size:0.9em;color:#666;">${deps.text('peerSelectTalks')}</p>${eligibleRows}` : ''}
        ${omitted.length > 0 ? `
          <p style="margin:${eligible.length > 0 ? '16px' : '0'} 0 12px;font-size:0.9em;color:#666;">${deps.text('peerSendUnavailableTitle')}</p>
          ${omittedRows}
        ` : ''}
        <div style="display:flex;gap:8px;margin-top:16px;">
          <button class="btn primary-btn" id="confirm-send-picker" style="flex:1;" ${eligible.length === 0 ? 'disabled' : ''}>📤 ${deps.text('peerSendSelected')}</button>
          <button class="btn" id="cancel-send-picker">${deps.text('editorCancel')}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => {
    modal.remove();
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = `📤 ${deps.text('peerSendMyTalks')}`;
    }
  };
  document.getElementById('close-send-picker')?.addEventListener('click', close);
  document.getElementById('cancel-send-picker')?.addEventListener('click', close);
  document.getElementById('confirm-send-picker')?.addEventListener('click', async () => {
    const selected = Array.from(modal.querySelectorAll('.send-picker-cb:checked')) as HTMLInputElement[];
    close();
    if (selected.length === 0) return;
    if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = `⏳ ${deps.text('peerSending')}`; }
    let sent = 0;
    for (const cb of selected) {
      const talkId = cb.dataset.talkId;
      const entry = eligible.find((candidate) => candidate.talkId === talkId);
      if (!talkId || !entry) continue;
      const talkData = entry.talk?.fullTalk || entry.talk;
      try {
        await deps.registerTalkForPeer(talkId, talkData, peerId, peerName);
        sent++;
      } catch { /* continue */ }
    }
    if (triggerBtn) {
      triggerBtn.disabled = false;
      const omittedCount = omitted.length;
      if (sent > 0 && omittedCount > 0) {
        triggerBtn.textContent = `✓ ${format(deps, 'peerSentWithOmitted', { sent, omitted: omittedCount })}`;
      } else {
        triggerBtn.textContent = `✓ ${format(deps, sent === 1 ? 'peerSentTalkOne' : 'peerSentTalks', { count: sent })}`;
      }
      setTimeout(() => { triggerBtn.textContent = `📤 ${deps.text('peerSendMyTalks')}`; }, 3000);
    }
    if (currentState?.peerId === peerId) fetchAndRenderHistory(peerId, deps);
  });
}
