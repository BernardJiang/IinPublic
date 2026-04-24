import { escapeHtml, formatTimeAgo } from './ui-formatters';
import type { PeerRelationshipStats, TalkHistoryItem } from '../../server/routes/peer-routes';

export type UserDetailViewDeps = {
  currentUserId: string;
  apiBase: string;
  getMyConversations: () => Record<string, any>;
  getMyTalks: () => Record<string, any>;
  showConversationDetail: (conversationId: string) => void;
  registerTalkForPeer: (talkId: string, talkData: any, peerId: string, peerName: string) => Promise<void>;
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
  if (nameEl) nameEl.textContent = peerName;
  const subtitleEl = document.getElementById('peer-detail-subtitle');
  if (subtitleEl) subtitleEl.textContent = 'Loading...';

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
    const fresh = sendBtn.cloneNode(true) as HTMLElement;
    sendBtn.replaceWith(fresh);
    fresh.addEventListener('click', () => handleSendMyTalks());
  }

  // Load data
  fetchAndRenderStats(peerId, deps);
  fetchAndRenderHistory(peerId, deps);
}

export function closePeerDetailView(): void {
  const overlay = document.getElementById('peer-detail-overlay');
  if (overlay) overlay.style.display = 'none';
  currentState = null;
}

async function fetchAndRenderStats(peerId: string, deps: UserDetailViewDeps): Promise<void> {
  const statsEl = document.getElementById('peer-stats-section');
  try {
    const res = await fetch(
      `${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/peers/${encodeURIComponent(peerId)}/relationship`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stats: PeerRelationshipStats = await res.json();

    const subtitleEl = document.getElementById('peer-detail-subtitle');
    if (subtitleEl) {
      const total = stats.sent.talks + stats.received.talks;
      subtitleEl.textContent = total === 0 ? 'Stranger' : `${total} talk${total !== 1 ? 's' : ''} exchanged`;
    }

    if (statsEl) {
      statsEl.innerHTML = renderStatsHtml(stats);
    }

    // Render matched conversations below stats
    renderMatchedConversations(peerId, deps);
  } catch (err) {
    if (statsEl) statsEl.innerHTML = '<div style="padding:12px;color:#c00;">Could not load stats.</div>';
  }
}

function renderStatsHtml(stats: PeerRelationshipStats): string {
  const sentIcon = stats.sent.talks === 0 ? '📤' : '📤';
  const receivedIcon = stats.received.talks === 0 ? '📥' : '📥';
  return `
    <div class="peer-stats-grid">
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
