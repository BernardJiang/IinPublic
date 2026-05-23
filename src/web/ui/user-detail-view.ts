import { escapeHtml, formatTimeAgo } from './ui-formatters';
import type { PeerRelationshipStats, TalkHistoryItem } from '../../server/routes/peer-routes';
import type { KnownPerson } from '../../shared/types';
import { avatarInnerHtml } from './profile-avatar';

export type UserDetailViewDeps = {
  currentUserId: string;
  apiBase: string;
  getMyConversations: () => Record<string, any>;
  getMyTalks: () => Record<string, any>;
  showConversationDetail: (conversationId: string) => void;
  registerTalkForPeer: (talkId: string, talkData: any, peerId: string, peerName: string) => Promise<void>;
  isBlockedByMe: (userId: string) => boolean;
  setBlocked: (userId: string, blocked: boolean) => Promise<void>;
  sendDirectMessage: (peerId: string, peerName: string, text: string) => Promise<void>;
  knownPerson?: KnownPerson;
};

type SortMode = 'date' | 'outcome';
type FilterMode = 'all' | 'sent' | 'received';

/** Module-level state for the currently-open peer detail view. */
let currentState: {
  peerId: string;
  peerName: string;
  deps: UserDetailViewDeps;
  history: TalkHistoryItem[];
  sort: SortMode;
  filter: FilterMode;
} | null = null;

export function openPeerDetailView(
  peerId: string,
  peerName: string,
  deps: UserDetailViewDeps,
): void {
  currentState = { peerId, peerName, deps, history: [], sort: 'date', filter: 'all' };

  const overlay = document.getElementById('peer-detail-overlay');
  if (!overlay) return;

  // Set header
  const nameEl = document.getElementById('peer-detail-name');
  if (nameEl) nameEl.textContent = getPrimaryDisplayName(peerName, deps.knownPerson);
  const subtitleEl = document.getElementById('peer-detail-subtitle');
  if (subtitleEl) subtitleEl.textContent = buildLoadingSubtitle(peerName, deps.knownPerson);

  // Reset sections
  const statsEl = document.getElementById('peer-stats-section');
  if (statsEl) statsEl.innerHTML = '<div style="padding:12px;color:#999;text-align:center;">Loading relationship stats…</div>';
  const historyEl = document.getElementById('peer-talk-history-list');
  if (historyEl) historyEl.innerHTML = '<div style="padding:12px;color:#999;text-align:center;">Loading talk history…</div>';
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
    fresh.textContent = deps.isBlockedByMe(peerId) ? 'Unblock User' : 'Block User';
    fresh.addEventListener('click', async () => {
      await deps.setBlocked(peerId, !deps.isBlockedByMe(peerId));
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
      fresh.textContent = '⏳ Sending…';
      try {
        await deps.sendDirectMessage(peerId, peerName, text);
        if (inp) inp.value = '';
        fresh.textContent = '✓ Sent';
        setTimeout(() => {
          fresh.disabled = false;
          fresh.textContent = '💬 Send Message';
        }, 2000);
      } catch {
        fresh.disabled = false;
        fresh.textContent = '💬 Send Message';
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

async function fetchAndRenderStats(peerId: string, peerName: string, deps: UserDetailViewDeps): Promise<void> {
  const statsEl = document.getElementById('peer-stats-section');
  try {
    const [statsRes, userRes] = await Promise.all([
      fetch(
        `${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/peers/${encodeURIComponent(peerId)}/relationship`,
      ),
      fetch(`${deps.apiBase}/api/users/${encodeURIComponent(peerId)}?viewerId=${encodeURIComponent(deps.currentUserId)}`),
    ]);
    if (statsRes.status === 403 || userRes.status === 403) {
      const subtitleEl = document.getElementById('peer-detail-subtitle');
      if (subtitleEl) subtitleEl.textContent = 'This user blocked you. Detail view is unavailable.';
      if (statsEl) {
        statsEl.innerHTML = `
          <div class="peer-stat-card">
            <div style="font-weight:700;color:#b91c1c;">Profile unavailable</div>
            <div style="font-size:0.9em;color:#7f1d1d;margin-top:6px;">Blocked users cannot view this detail surface.</div>
          </div>
        `;
      }
      const sendBtn = document.getElementById('peer-send-talks-btn') as HTMLButtonElement | null;
      if (sendBtn) sendBtn.disabled = true;
      return;
    }
    if (!statsRes.ok) throw new Error(`HTTP ${statsRes.status}`);
    const stats: PeerRelationshipStats = await statsRes.json();
    const publicUser = userRes.ok ? await userRes.json() : null;

    const subtitleEl = document.getElementById('peer-detail-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent = buildStatsSubtitle(peerName, stats, deps.knownPerson);
    }

    if (statsEl) {
      statsEl.innerHTML = renderProfileHtml(publicUser) + renderStatsHtml(stats, deps.knownPerson);
    }
    await applySendButtonFromBlockStatus(peerId, deps);

    // Render matched conversations below stats
    renderMatchedConversations(peerId, deps);
  } catch (err) {
    if (statsEl) statsEl.innerHTML = '<div style="padding:12px;color:#c00;">Could not load stats.</div>';
    await applySendButtonFromBlockStatus(peerId, deps);
  }
}

function renderProfileHtml(publicUser: any): string {
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
          <div style="font-weight:700; color:#111827;">Public Profile</div>
          <div style="font-size:0.85em; color:#475569; margin-top:4px;">Languages: ${escapeHtml(languages.length > 0 ? languages.join(', ') : 'Not listed')}</div>
          ${interests.length > 0 ? `<div style="font-size:0.85em; color:#475569; margin-top:4px;">Interests: ${escapeHtml(interests.join(', '))}</div>` : ''}
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
                : '<div style="font-size:0.85em; color:#94a3b8;">No public profile attributes listed.</div>'
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderStatsHtml(stats: PeerRelationshipStats, knownPerson?: KnownPerson): string {
  const sentIcon = stats.sent.talks === 0 ? '📤' : '📤';
  const receivedIcon = stats.received.talks === 0 ? '📥' : '📥';
  const nickname = String(knownPerson?.nickname || '').trim();
  const relationship = knownPerson?.label
    ? knownPerson.label.charAt(0).toUpperCase() + knownPerson.label.slice(1)
    : 'No relationship set';
  return `
    <div class="peer-stats-grid">
      <div class="peer-stat-card">
        <div class="peer-stat-icon">🧾</div>
        <div class="peer-stat-body">
          <div class="peer-stat-label">Talks Exchanged</div>
          <div class="peer-stat-value">${stats.totalTalks}</div>
          <div class="peer-stat-sub">${relationship}</div>
        </div>
      </div>
      <div class="peer-stat-card">
        <div class="peer-stat-icon">${sentIcon}</div>
        <div class="peer-stat-body">
          <div class="peer-stat-label">Sent</div>
          <div class="peer-stat-value">${stats.sent.talks} talk${stats.sent.talks !== 1 ? 's' : ''}</div>
          <div class="peer-stat-sub">${stats.sent.matches} matched</div>
        </div>
      </div>
      <div class="peer-stat-card">
        <div class="peer-stat-icon">${receivedIcon}</div>
        <div class="peer-stat-body">
          <div class="peer-stat-label">Received</div>
          <div class="peer-stat-value">${stats.received.talks} talk${stats.received.talks !== 1 ? 's' : ''}</div>
          <div class="peer-stat-sub">${stats.received.matches} matched</div>
        </div>
      </div>
      ${nickname ? `
      <div class="peer-stat-card peer-stat-mutual">
        <div class="peer-stat-icon">🏷️</div>
        <div class="peer-stat-body">
          <div class="peer-stat-label">Nickname</div>
          <div class="peer-stat-value">${escapeHtml(nickname)}</div>
        </div>
      </div>` : ''}
      ${stats.mutualMatchedTalks > 0 ? `
      <div class="peer-stat-card peer-stat-mutual">
        <div class="peer-stat-icon">🤝</div>
        <div class="peer-stat-body">
          <div class="peer-stat-label">Mutual Matches</div>
          <div class="peer-stat-value">${stats.mutualMatchedTalks}</div>
        </div>
      </div>` : ''}
      ${stats.mutualTagCount > 0 ? `
      <div class="peer-stat-card peer-stat-mutual">
        <div class="peer-stat-icon">🏷️</div>
        <div class="peer-stat-body">
          <div class="peer-stat-label">Mutual Tags</div>
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

function buildLoadingSubtitle(stageName: string, knownPerson?: KnownPerson): string {
  const nickname = String(knownPerson?.nickname || '').trim();
  const baseStageName = String(stageName || 'Unknown').trim() || 'Unknown';
  if (nickname && nickname.toLowerCase() !== baseStageName.toLowerCase()) {
    return `Stage name: ${baseStageName} · Loading...`;
  }
  return 'Loading...';
}

function buildStatsSubtitle(stageName: string, stats: PeerRelationshipStats, knownPerson?: KnownPerson): string {
  const nickname = String(knownPerson?.nickname || '').trim();
  const baseStageName = String(stageName || 'Unknown').trim() || 'Unknown';
  const relationship = knownPerson?.label
    ? knownPerson.label.charAt(0).toUpperCase() + knownPerson.label.slice(1)
    : null;
  const parts: string[] = [];
  if (nickname && nickname.toLowerCase() !== baseStageName.toLowerCase()) {
    parts.push(`Stage name: ${baseStageName}`);
  }
  if (relationship) parts.push(relationship);
  const stageLine = stats.totalTalks === 0 ? 'Stranger' : `${stats.totalTalks} talk${stats.totalTalks !== 1 ? 's' : ''} exchanged`;
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
    <div class="peer-section-title">💬 Conversations (${matched.length})</div>
    <div class="peer-conv-list" id="peer-conv-list">
      ${matched
        .map(([convId, c]: [string, any]) => {
          const talk = c.talkId ? myTalks[c.talkId] : null;
          const talkTitle = talk?.title || talk?.fullTalk?.title || (c.talkId ? `Talk ${c.talkId.slice(0, 8)}` : 'Talk');
          const lastMsg = c.lastMessage ? escapeHtml(String(c.lastMessage).slice(0, 60)) : 'Start chatting…';
          const botBadge = c.respondedByBot ? '<span class="conversation-bot-badge" title="Auto-replied">🤖</span>' : '';
          return `
            <div class="peer-conv-item" data-conv-id="${escapeHtml(convId)}" data-talk-id="${escapeHtml(c.talkId || '')}">
              <div class="peer-conv-talk-title">${escapeHtml(talkTitle)} ${botBadge}</div>
              <div class="peer-conv-preview">${lastMsg}</div>
              <button class="btn peer-open-chat-btn" data-conv-id="${escapeHtml(convId)}">Open Chat ›</button>
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
    const res = await fetch(
      `${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/peers/${encodeURIComponent(peerId)}/talk-history`,
    );
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
    if (historyEl) historyEl.innerHTML = '<div style="padding:12px;color:#c00;">Could not load history.</div>';
  }
}

function renderHistory(): void {
  if (!currentState) return;
  const { history, sort, filter } = currentState;
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
    historyEl.innerHTML = '<div style="padding:16px;text-align:center;color:#999;">No talks exchanged yet.</div>';
    return;
  }

  historyEl.innerHTML = items
    .map((item) => {
      const dirIcon = item.direction === 'sent' ? '📤' : '📥';
      const dirLabel = item.direction === 'sent' ? 'Sent' : 'Received';
      const outcomeClass = `peer-outcome-${item.outcome}`;
      const outcomeLabel = item.outcome === 'match' ? '✓ Match' : item.outcome === 'mismatch' ? '✗ Mismatch' : '⏳ Pending';
      const typeLabel = item.type ? `<span class="peer-talk-type">${escapeHtml(item.type)}</span>` : '';
      const dateLabel = formatTimeAgo(new Date(item.date));
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
    sendBtn.textContent = '⏳ Sending…';
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

    // Get my active talks
    const myTalks = deps.getMyTalks();
    const candidates = Object.entries(myTalks).filter(([talkId, t]: [string, any]) => {
      if (t?.role !== 'created') return false;
      if (t?.disabled) return false;
      if (alreadySentIds.has(talkId)) return false;
      const contentId = t?.fullTalk?.id || talkId;
      if (alreadySentIds.has(contentId)) return false;
      return true;
    });

    if (candidates.length === 0) {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = '✓ All talks already sent';
      }
      return;
    }

    if (!isAuto) {
      // Manual mode: show a picker
      showSendTalksPicker(candidates, peerId, peerName, deps, sendBtn);
      return;
    }

    // Auto mode: send all
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
      sendBtn.textContent = sent > 0 ? `✓ Sent ${sent} talk${sent !== 1 ? 's' : ''}` : '✓ Nothing new to send';
    }

    // Refresh history
    fetchAndRenderHistory(peerId, deps);
    setTimeout(() => {
      if (sendBtn && !sendBtn.disabled) sendBtn.textContent = '📤 Send My Talks';
    }, 3000);
  } catch (err) {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = '📤 Send My Talks';
    }
  }
}

function showSendTalksPicker(
  candidates: [string, any][],
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
  modal.innerHTML = `
    <div class="modal-content" style="max-width:420px;">
      <div class="modal-header">
        <h2 class="modal-title">Send Talks to ${escapeHtml(peerName)}</h2>
        <button class="close-button" id="close-send-picker">&times;</button>
      </div>
      <div style="padding:16px;">
        <p style="margin:0 0 12px;font-size:0.9em;color:#666;">Select talks to send:</p>
        ${candidates.map(([talkId, t]) => `
          <label style="display:flex;align-items:center;gap:8px;padding:8px;background:#f5f5f5;border-radius:8px;margin-bottom:6px;cursor:pointer;">
            <input type="checkbox" class="send-picker-cb" data-talk-id="${escapeHtml(talkId)}" checked>
            <span style="font-weight:600;">${escapeHtml(t?.title || t?.fullTalk?.title || talkId)}</span>
          </label>
        `).join('')}
        <div style="display:flex;gap:8px;margin-top:16px;">
          <button class="btn primary-btn" id="confirm-send-picker" style="flex:1;">📤 Send Selected</button>
          <button class="btn" id="cancel-send-picker">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('close-send-picker')?.addEventListener('click', close);
  document.getElementById('cancel-send-picker')?.addEventListener('click', close);
  document.getElementById('confirm-send-picker')?.addEventListener('click', async () => {
    const selected = Array.from(modal.querySelectorAll('.send-picker-cb:checked')) as HTMLInputElement[];
    close();
    if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = '⏳ Sending…'; }
    let sent = 0;
    for (const cb of selected) {
      const talkId = cb.dataset.talkId;
      const entry = candidates.find(([id]) => id === talkId);
      if (!talkId || !entry) continue;
      const talkData = entry[1]?.fullTalk || entry[1];
      try {
        await deps.registerTalkForPeer(talkId, talkData, peerId, peerName);
        sent++;
      } catch { /* continue */ }
    }
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = `✓ Sent ${sent}`;
      setTimeout(() => { triggerBtn.textContent = '📤 Send My Talks'; }, 3000);
    }
    if (currentState?.peerId === peerId) fetchAndRenderHistory(peerId, deps);
  });
}
