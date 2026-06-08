import { escapeHtml } from './ui-formatters';
import type { PeerRelationshipStats, TalkHistoryItem } from '../../server/routes/peer-routes';
import type { KnownPerson } from '../../shared/types';
import { avatarInnerHtml } from './profile-avatar';
import type { UiTranslationKey } from './ui-translations';

type PublicProfileFoundation = {
  headshot?: string | null;
  languagesJson?: string;
  profileJson?: string;
  interestsJson?: string;
};

export type UserDetailViewDeps = {
  currentUserId: string;
  apiBase: string;
  getMyConversations: () => Record<string, any>;
  getMyTalks: () => Record<string, any>;
  showConversationDetail: (conversationId: string) => void;
  registerTalkForPeer: (talkId: string, talkData: any, peerId: string, peerName: string) => Promise<void>;
  isBlockedByMe: (userId: string) => boolean;
  setBlocked: (userId: string, blocked: boolean) => Promise<void>;
  isSupportContact: (userId: string) => boolean;
  isSupportNotificationsMuted: () => boolean;
  setSupportNotificationsMuted: (muted: boolean) => Promise<void>;
  sendDirectMessage: (peerId: string, peerName: string, text: string) => Promise<void>;
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
  knownPerson?: KnownPerson;
};

type SortMode = 'date' | 'outcome';
type FilterMode = 'all' | 'sent' | 'received';
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

function classifyPeerSendTalks(
  myTalks: Record<string, any>,
  alreadySentIds: Set<string>,
): { eligible: ClassifiedPeerTalk[]; omitted: ClassifiedPeerTalk[] } {
  const eligible: ClassifiedPeerTalk[] = [];
  const omitted: ClassifiedPeerTalk[] = [];
  const now = Date.now();
  for (const [talkId, talk] of Object.entries(myTalks)) {
    if (talk?.role !== 'created') continue;
    const contentId = talk?.fullTalk?.id || talkId;
    const omitReasons: PeerSendOmitReason[] = [];
    if (talk?.disabled) omitReasons.push('broadcast_disabled');
    const expiresAt = talk?.expiresAt ?? talk?.fullTalk?.expiresAt;
    const expiresAtMs = resolveExpiresAtMs(expiresAt);
    if (Number.isFinite(expiresAtMs) && now > expiresAtMs) omitReasons.push('talk_expired');
    if (alreadySentIds.has(talkId) || alreadySentIds.has(contentId)) omitReasons.push('peer_already_sent');
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
    ['#peer-auto-mode-text', 'peerAutoMode'],
    ['#peer-dm-label', 'peerSendDirectMessage'],
  ];
  for (const [selector, key] of textBySelector) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.textContent = deps.text(key);
  }
  const back = document.getElementById('back-from-peer-detail');
  if (back) back.textContent = `‹ ${deps.text('back')}`;
  const sendTalks = document.getElementById('peer-send-talks-btn');
  if (sendTalks) sendTalks.textContent = `📤 ${deps.text('peerSendMyTalks')}`;
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
  currentState = { peerId, peerName, deps, history: [], sort: 'date', filter: 'all' };

  const overlay = document.getElementById('peer-detail-overlay');
  if (!overlay) return;
  renderPeerShellCopy(deps);

  // Set header
  const nameEl = document.getElementById('peer-detail-name');
  if (nameEl) nameEl.textContent = getPrimaryDisplayName(peerName, deps.knownPerson);
  const subtitleEl = document.getElementById('peer-detail-subtitle');
  if (subtitleEl) subtitleEl.textContent = buildLoadingSubtitle(peerName, deps);

  // Reset sections
  const statsEl = document.getElementById('peer-stats-section');
  if (statsEl) statsEl.innerHTML = `<div style="padding:12px;color:#999;text-align:center;">${deps.text('peerLoadingStats')}</div>`;
  const historyEl = document.getElementById('peer-talk-history-list');
  if (historyEl) historyEl.innerHTML = `<div style="padding:12px;color:#999;text-align:center;">${deps.text('peerLoadingHistory')}</div>`;
  const historyControls = document.getElementById('peer-history-controls');
  if (historyControls) historyControls.style.display = 'none';

  overlay.style.display = 'flex';

  // Back button
  const backBtn = document.getElementById('back-from-peer-detail');
  if (backBtn) {
    const fresh = backBtn.cloneNode(true) as HTMLElement;
    backBtn.replaceWith(fresh);
    fresh.addEventListener('click', () => closePeerDetailView());
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
    fresh.textContent = deps.text(
      supportContact
        ? (supportMuted ? 'contactUnmuteSupport' : 'contactMuteSupport')
        : (deps.isBlockedByMe(peerId) ? 'contactUnblockUser' : 'contactBlockUser'),
    );
    fresh.addEventListener('click', async () => {
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
async function applySendButtonFromBlockStatus(
  peerId: string,
  deps: UserDetailViewDeps,
): Promise<void> {
  const sendBtn = document.getElementById('peer-send-talks-btn') as HTMLButtonElement | null;
  if (!sendBtn) return;
  if (deps.isSupportContact(peerId)) {
    sendBtn.disabled = false;
    return;
  }
  try {
    const r = await fetch(
      `${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/block-status/${encodeURIComponent(peerId)}`,
    );
    if (r.ok) {
      const s = (await r.json()) as { eitherBlocked?: boolean; blocked?: boolean; blockedBy?: boolean };
      sendBtn.disabled = Boolean(s.eitherBlocked || s.blocked || s.blockedBy);
      return;
    }
  } catch {
    /* fall through */
  }
  sendBtn.disabled = deps.isBlockedByMe(peerId);
}

async function fetchPeerDetailWithTimeout(
  deps: UserDetailViewDeps,
  path: string,
  opts: { attempts?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 2;
  const timeoutMs = opts.timeoutMs ?? 3_500;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ac = new AbortController();
    const timeoutId = window.setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await fetch(`${deps.apiBase}${path}`, { signal: ac.signal, cache: 'no-store' });
    } catch {
      if (attempt === attempts - 1) throw new Error(`fetch failed: ${path}`);
    } finally {
      window.clearTimeout(timeoutId);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error(`fetch failed: ${path}`);
}

function renderBlockedPeerDetail(deps: UserDetailViewDeps): void {
  const subtitleEl = document.getElementById('peer-detail-subtitle');
  if (subtitleEl) subtitleEl.textContent = deps.text('peerProfileBlocked');
  const statsEl = document.getElementById('peer-stats-section');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="peer-stat-card">
        <div style="font-weight:700;color:#b91c1c;">${deps.text('contactProfileUnavailable')}</div>
        <div style="font-size:0.9em;color:#7f1d1d;margin-top:6px;">${deps.text('peerBlockedDetail')}</div>
      </div>
    `;
  }
  const sendBtn = document.getElementById('peer-send-talks-btn') as HTMLButtonElement | null;
  if (sendBtn) sendBtn.disabled = true;
}

async function isPeerDetailBlocked(peerId: string, deps: UserDetailViewDeps): Promise<boolean> {
  try {
    const r = await fetch(
      `${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/block-status/${encodeURIComponent(peerId)}`,
      { cache: 'no-store' },
    );
    if (!r.ok) return false;
    const status = (await r.json()) as { eitherBlocked?: boolean; blocked?: boolean; blockedBy?: boolean };
    return Boolean(status.eitherBlocked || status.blocked || status.blockedBy);
  } catch {
    return false;
  }
}

function parsePublicProfileArray<T>(value: string | undefined, fallback: T[]): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

function publicUserHasProfileFoundation(publicUser: any): boolean {
  const languages = Array.isArray(publicUser?.languages) ? publicUser.languages.filter(Boolean) : [];
  const profile = Array.isArray(publicUser?.profile) ? publicUser.profile.filter((qa: any) => qa?.question && qa?.answer) : [];
  const interests = Array.isArray(publicUser?.interests) ? publicUser.interests.filter((tag: any) => tag?.name) : [];
  return Boolean(String(publicUser?.headshot || '').trim() || languages.length || profile.length || interests.length);
}

async function readPublicProfileFoundation(peerId: string, deps: UserDetailViewDeps): Promise<any | null> {
  if (!deps.getPublicProfileFoundation) return null;
  const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 2_500));
  const foundation = await Promise.race([
    deps.getPublicProfileFoundation(peerId).catch(() => null),
    timeout,
  ]);
  if (!foundation) return null;
  return {
    headshot: foundation.headshot || '',
    languages: parsePublicProfileArray<string>(foundation.languagesJson, []),
    profile: parsePublicProfileArray<any>(foundation.profileJson, []),
    interests: parsePublicProfileArray<any>(foundation.interestsJson, []),
  };
}

async function fetchAndRenderStats(peerId: string, peerName: string, deps: UserDetailViewDeps): Promise<void> {
  const statsEl = document.getElementById('peer-stats-section');
  try {
    const peerBase = `/api/users/${encodeURIComponent(deps.currentUserId)}/peers/${encodeURIComponent(peerId)}`;
    const [statsResult, userResult] = await Promise.allSettled([
      fetchPeerDetailWithTimeout(deps, `${peerBase}/relationship`),
      fetchPeerDetailWithTimeout(
        deps,
        `/api/users/${encodeURIComponent(peerId)}?viewerId=${encodeURIComponent(deps.currentUserId)}`,
        { attempts: 1, timeoutMs: 8_500 },
      ),
    ]);
    const statsRes = statsResult.status === 'fulfilled' ? statsResult.value : null;
    const userRes = userResult.status === 'fulfilled' ? userResult.value : null;
    if (statsRes?.status === 403 || userRes?.status === 403) {
      renderBlockedPeerDetail(deps);
      return;
    }
    const stats: PeerRelationshipStats | null = statsRes?.ok ? await statsRes.json() : null;
    let publicUser = userRes?.ok ? await userRes.json() : null;
    if (!publicUserHasProfileFoundation(publicUser)) {
      publicUser = await readPublicProfileFoundation(peerId, deps) ?? publicUser;
    }

    const subtitleEl = document.getElementById('peer-detail-subtitle');
    if (subtitleEl && stats) {
      subtitleEl.textContent = buildStatsSubtitle(peerName, stats, deps);
    }

    if (statsEl) {
      statsEl.innerHTML = renderProfileHtml(publicUser, deps) +
        renderTransportHtml(deps) +
        (stats ? renderStatsHtml(stats, deps) : renderStatsUnavailableHtml(deps));
    }
    await applySendButtonFromBlockStatus(peerId, deps);

    // Render matched conversations below stats
    renderMatchedConversations(peerId, deps);
  } catch (err) {
    if (await isPeerDetailBlocked(peerId, deps)) {
      renderBlockedPeerDetail(deps);
      return;
    }
    if (statsEl) statsEl.innerHTML = `<div style="padding:12px;color:#c00;">${deps.text('peerStatsUnavailable')}</div>`;
    await applySendButtonFromBlockStatus(peerId, deps);
  }
}

function renderStatsUnavailableHtml(deps: UserDetailViewDeps): string {
  return `
    <div class="peer-stat-card">
      <div style="padding:12px;color:#c00;">${deps.text('peerStatsUnavailable')}</div>
    </div>
  `;
}

function renderProfileHtml(publicUser: any, deps: UserDetailViewDeps): string {
  const headshot = String(publicUser?.headshot || '').trim();
  const languages = Array.isArray(publicUser?.languages) ? publicUser.languages.filter(Boolean) : [];
  const interests = Array.isArray(publicUser?.interests)
    ? publicUser.interests.map((t: { name?: string }) => String(t?.name || '').trim()).filter(Boolean)
    : [];
  const profile = Array.isArray(publicUser?.profile) ? publicUser.profile.filter((qa: any) => qa?.question && qa?.answer) : [];
  return `
    <div class="peer-stat-card" style="margin-bottom:12px;">
      <div style="display:flex; gap:12px; align-items:flex-start;">
        <div class="user-avatar" style="width:56px; height:56px; font-size:1.5em; flex-shrink:0;">${avatarInnerHtml(headshot, '?', escapeHtml)}</div>
        <div style="min-width:0; flex:1;">
          <div style="font-weight:700; color:#111827;">${deps.text('publicProfile')}</div>
          <div style="font-size:0.85em; color:#475569; margin-top:4px;">${deps.text('languagesLabel')}: ${escapeHtml(languages.length > 0 ? languages.map((code: string) => deps.formatLanguage(code)).join(', ') : deps.text('notListed'))}</div>
          ${interests.length > 0 ? `<div style="font-size:0.85em; color:#475569; margin-top:4px;">${deps.text('interestsLabel')}: ${escapeHtml(interests.join(', '))}</div>` : ''}
          <div style="display:grid; gap:8px; margin-top:10px;">
            ${
              profile.length > 0
                ? profile
                    .slice(0, 4)
                    .map(
                      (qa: any) => `
                        <div style="padding:8px 10px; border-radius:10px; background:#f8fafc; border:1px solid #e2e8f0;">
                          <div style="font-size:0.78em; color:#64748b;">${escapeHtml(String(qa.question))}</div>
                          <div style="font-size:0.92em; font-weight:600; color:#111827; margin-top:2px;">${escapeHtml(String(qa.answer))}</div>
                        </div>
                      `,
                    )
                    .join('')
                : `<div style="font-size:0.85em; color:#94a3b8;">${deps.text('noPublicProfile')}</div>`
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
    <div class="peer-transport-status" data-transport-mode="${escapeHtml(status.mode)}" style="margin-bottom:12px;padding:10px 12px;border:1px solid #dbeafe;border-radius:10px;background:#eff6ff;color:#1e3a8a;font-size:0.86em;">
      <span style="font-weight:700;">${deps.text('peerChannelStatus')}:</span>
      ${transportLabel(status.mode, deps)}
      <div class="peer-transport-fallback" style="margin-top:4px;color:#475569;">${escapeHtml(fallbackText)}</div>
      <div class="peer-transport-health" style="margin-top:2px;color:#475569;">${escapeHtml(lastHealthyText)}</div>
    </div>
  `;
}

function renderStatsHtml(stats: PeerRelationshipStats, deps: UserDetailViewDeps): string {
  const sentIcon = stats.sent.talks === 0 ? '📤' : '📤';
  const receivedIcon = stats.received.talks === 0 ? '📥' : '📥';
  const nickname = String(deps.knownPerson?.nickname || '').trim();
  const relationship = formatRelationshipLabel(deps.knownPerson?.label, deps);
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
  return nickname;
}

function formatRelationshipLabel(label: string | undefined, deps: UserDetailViewDeps): string {
  if (!label) return deps.text('contactNoRelationship');
  const keyByLabel: Record<string, UiTranslationKey> = {
    friend: 'friends',
    relative: 'relatives',
    coworker: 'coworkers',
    acquaintance: 'acquaintances',
    partner: 'partners',
    custom: 'custom',
  };
  return keyByLabel[label] ? deps.text(keyByLabel[label]) : label;
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
  const relationship = deps.knownPerson?.label ? formatRelationshipLabel(deps.knownPerson.label, deps) : null;
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

function renderMatchedConversations(peerId: string, deps: UserDetailViewDeps): void {
  const conversations = deps.getMyConversations();
  const matched = Object.entries(conversations).filter(
    ([, c]: [string, any]) => c.otherUserId === peerId,
  );

  const section = document.getElementById('peer-conversations-section');
  if (!section) return;

  if (matched.length === 0) {
    section.innerHTML = '';
    return;
  }

  const myTalks = deps.getMyTalks();
  section.innerHTML = `
    <div class="peer-section-title">💬 ${format(deps, 'peerConversations', { count: matched.length })}</div>
    <div class="peer-conv-list" id="peer-conv-list">
      ${matched
        .map(([convId, c]: [string, any]) => {
          const talk = c.talkId ? myTalks[c.talkId] : null;
          const talkTitle = talk?.title || talk?.fullTalk?.title || (c.talkId ? `${deps.text('peerTalkFallback')} ${c.talkId.slice(0, 8)}` : deps.text('peerTalkFallback'));
          const lastMsg = c.lastMessage ? escapeHtml(String(c.lastMessage).slice(0, 60)) : deps.text('peerStartChatting');
          const botBadge = c.respondedByBot ? `<span class="conversation-bot-badge" title="${deps.text('peerAutoReplied')}">🤖</span>` : '';
          return `
            <div class="peer-conv-item" data-conv-id="${escapeHtml(convId)}" data-talk-id="${escapeHtml(c.talkId || '')}">
              <div class="peer-conv-talk-title">${escapeHtml(talkTitle)} ${botBadge}</div>
              <div class="peer-conv-preview">${lastMsg}</div>
              <button class="btn peer-open-chat-btn" data-conv-id="${escapeHtml(convId)}">${deps.text('peerOpenChat')} ›</button>
            </div>
          `;
        })
        .join('')}
    </div>
  `;

  section.querySelectorAll('.peer-open-chat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const convId = (btn as HTMLElement).dataset.convId;
      if (convId) {
        closePeerDetailView();
        deps.showConversationDetail(convId);
      }
    });
  });
}

async function fetchAndRenderHistory(peerId: string, deps: UserDetailViewDeps): Promise<void> {
  try {
    const peerBase = `/api/users/${encodeURIComponent(deps.currentUserId)}/peers/${encodeURIComponent(peerId)}`;
    const res = await fetchPeerDetailWithTimeout(deps, `${peerBase}/talk-history`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const history: TalkHistoryItem[] = await res.json();

    if (currentState && currentState.peerId === peerId) {
      currentState.history = history;
      const controls = document.getElementById('peer-history-controls');
      if (controls) controls.style.display = history.length > 0 ? 'flex' : 'none';
      renderHistory();
    }
  } catch (err) {
    const historyEl = document.getElementById('peer-talk-history-list');
    if (historyEl) historyEl.innerHTML = `<div style="padding:12px;color:#c00;">${deps.text('peerHistoryUnavailable')}</div>`;
  }
}

function renderHistory(): void {
  if (!currentState) return;
  const { history, sort, filter, deps } = currentState;
  const historyEl = document.getElementById('peer-talk-history-list');
  if (!historyEl) return;

  let items = [...history];

  // Filter
  if (filter !== 'all') {
    items = items.filter((i) => i.direction === filter);
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
      return `
        <div class="peer-history-item ${outcomeClass}">
          <div class="peer-history-direction" title="${dirLabel}">${dirIcon}</div>
          <div class="peer-history-body">
            <div class="peer-history-title">${escapeHtml(item.title)} ${typeLabel}</div>
            <div class="peer-history-meta">
              <span class="peer-history-outcome">${outcomeLabel}</span>
              <span class="peer-history-date">${dateLabel}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
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
    // Fetch current history to skip already-exchanged talks
    const histRes = await fetch(
      `${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/peers/${encodeURIComponent(peerId)}/talk-history`,
    );
    const history: TalkHistoryItem[] = histRes.ok ? await histRes.json() : [];
    const alreadySentIds = new Set<string>(
      history.filter((h) => h.direction === 'sent').flatMap((h) => [h.talkId, h.identityKey]),
    );

    const { eligible, omitted } = classifyPeerSendTalks(deps.getMyTalks(), alreadySentIds);
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
    <label class="peer-send-picker-eligible" style="display:flex;align-items:center;gap:8px;padding:8px;background:#f5f5f5;border-radius:8px;margin-bottom:6px;cursor:pointer;">
      <input type="checkbox" class="send-picker-cb" data-talk-id="${escapeHtml(entry.talkId)}" checked>
      <span style="font-weight:600;">${escapeHtml(entry.talk?.title || entry.talk?.fullTalk?.title || entry.talkId)}</span>
    </label>
  `).join('');
  const omittedRows = omitted.map((entry) => {
    const reasonText = entry.omitReasons.map((reason) => omitReasonLabel(deps, reason)).join(' · ');
    return `
      <div class="peer-send-picker-omitted" data-talk-id="${escapeHtml(entry.talkId)}" style="display:flex;flex-direction:column;gap:4px;padding:8px;background:#fff7f7;border:1px solid #fecaca;border-radius:8px;margin-bottom:6px;opacity:0.92;">
        <span style="font-weight:600;color:#7f1d1d;">${escapeHtml(entry.talk?.title || entry.talk?.fullTalk?.title || entry.talkId)}</span>
        <span style="font-size:0.82em;color:#64748b;">${escapeHtml(reasonText)}</span>
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
