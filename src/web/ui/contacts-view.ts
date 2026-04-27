import type { KnownPerson } from '../../shared/types';
import type { PeerSummary } from '../../server/routes/peer-routes';

type ContactsViewDeps = {
  apiBase: string;
  currentUserId: string;
  escapeHtml: (text: string) => string;
  getKnownPeople: () => KnownPerson[];
  getPeerName: (userId: string, fallbackName?: string) => string;
  openPeerDetail: (userId: string, stageName: string) => void;
  getMyTalks: () => Record<string, any>;
};

function formatRelationshipLabel(label?: string): string {
  if (!label) return 'No relationship set';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function buildDisplayName(stageName: string, known?: KnownPerson): string {
  const nickname = String(known?.nickname || '').trim();
  const baseStageName = String(stageName || 'Unknown').trim() || 'Unknown';
  if (!nickname) return baseStageName;
  if (nickname.toLowerCase() === baseStageName.toLowerCase()) return nickname;
  return `${nickname} (${baseStageName})`;
}

function buildMetaLine(summary: PeerSummary, known?: KnownPerson): string {
  const parts = [
    `${summary.stats.totalTalks} talk${summary.stats.totalTalks !== 1 ? 's' : ''}`,
    `${summary.stats.mutualTagCount} common tag${summary.stats.mutualTagCount !== 1 ? 's' : ''}`,
    formatRelationshipLabel(known?.label),
  ];
  return parts.join(' · ');
}

export function showContactsList(deps: ContactsViewDeps): void {
  const listContainer = document.getElementById('contacts-list-container');
  const detailContainer = document.getElementById('contact-detail-container');
  if (listContainer) listContainer.style.display = 'block';
  if (detailContainer) detailContainer.style.display = 'none';
  void displayContactsList(deps);
}

export async function displayContactsList(deps: ContactsViewDeps): Promise<void> {
  const listEl = document.getElementById('contacts-list');
  if (!listEl) return;

  if (!deps.apiBase || !deps.currentUserId) {
    listEl.innerHTML = '<p style="text-align: center; padding: 40px 20px; color: #999;">Contacts are not ready yet.</p>';
    return;
  }

  listEl.innerHTML = '<p style="text-align: center; padding: 40px 20px; color: #999;">Loading contacts…</p>';

  try {
    const response = await fetch(
      `${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/peers`,
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const peers = (await response.json()) as PeerSummary[];
    const knownMap = new Map(
      deps.getKnownPeople().map((entry) => [entry.userId, entry] as const),
    );

    if (peers.length === 0) {
      listEl.innerHTML = `
        <p style="text-align: center; padding: 40px 20px; color: #999;">No contacts yet. Exchange talks with others to see them here.</p>
      `;
      return;
    }

    listEl.innerHTML = peers
      .map((peer) => {
        const known = knownMap.get(peer.peerId);
        const resolvedStageName = deps.getPeerName(peer.peerId, peer.stageName);
        const displayName = buildDisplayName(resolvedStageName, known);
        const relationship = formatRelationshipLabel(known?.label);
        return `
          <div class="contact-item" data-contact-user-id="${deps.escapeHtml(peer.peerId)}" data-contact-name="${deps.escapeHtml(resolvedStageName)}" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; margin-bottom: 8px; background: white; border-radius: 12px; border: 1px solid #e0e0e0; cursor: pointer;">
            <div style="min-width: 0;">
              <div class="contact-item-name" style="font-weight: 700;">${deps.escapeHtml(displayName)}</div>
              <div class="contact-item-meta" style="font-size: 0.85em; color: #666; margin-top: 4px;">${deps.escapeHtml(buildMetaLine(peer, known))}</div>
              <div class="contact-item-meta" style="font-size: 0.8em; color: #94a3b8; margin-top: 4px;">Sent ${peer.stats.sent.talks} · Received ${peer.stats.received.talks} · Relationship: ${deps.escapeHtml(relationship)}</div>
            </div>
            <span style="color: #999; flex-shrink: 0;">›</span>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('.contact-item').forEach((el) => {
      el.addEventListener('click', () => {
        const userId = (el as HTMLElement).dataset.contactUserId;
        const stageName = (el as HTMLElement).dataset.contactName;
        if (userId && stageName) {
          void showContactDetail(deps, userId, stageName);
        }
      });
    });
  } catch {
    listEl.innerHTML = '<p style="text-align: center; padding: 40px 20px; color: #c00;">Could not load contacts.</p>';
  }
}

export async function showContactDetail(
  deps: ContactsViewDeps,
  otherUserId: string,
  otherUserName: string,
): Promise<void> {
  const listContainer = document.getElementById('contacts-list-container');
  const detailContainer = document.getElementById('contact-detail-container');
  const detailName = document.getElementById('contact-detail-name');
  const detailMatches = document.getElementById('contact-detail-matches');
  const talksList = document.getElementById('contact-talks-list');
  if (!listContainer || !detailContainer || !detailName || !detailMatches || !talksList) return;

  listContainer.style.display = 'none';
  detailContainer.style.display = 'block';
  detailName.textContent = otherUserName;
  detailMatches.textContent = 'Loading…';
  talksList.innerHTML = '<p style="text-align: center; padding: 20px; color: #999;">Loading…</p>';

  try {
    const [relationshipRes, historyRes] = await Promise.all([
      fetch(`${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/peers/${encodeURIComponent(otherUserId)}/relationship`),
      fetch(`${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/peers/${encodeURIComponent(otherUserId)}/talk-history`),
    ]);

    const relationship = relationshipRes.ok ? await relationshipRes.json() : null;
    const history = historyRes.ok ? await historyRes.json() : [];
    const totalTalks = relationship?.totalTalks ?? (Array.isArray(history) ? history.length : 0);
    detailMatches.textContent = `${totalTalks} talk${totalTalks !== 1 ? 's' : ''}`;

    if (!Array.isArray(history) || history.length === 0) {
      talksList.innerHTML = '<p style="text-align: center; padding: 20px; color: #999;">No talks exchanged yet.</p>';
      return;
    }

    const myTalks = deps.getMyTalks();
    talksList.innerHTML = history
      .map((item: any) => {
        const localTalk = item?.talkId ? myTalks[item.talkId] : null;
        const title = String(localTalk?.title || item?.title || 'Talk').trim();
        return `
          <div class="contact-talk-item" data-talk-id="${deps.escapeHtml(String(item?.talkId || ''))}" style="padding: 14px 16px; margin-bottom: 8px; background: #f9f9f9; border-radius: 10px; border: 1px solid #e0e0e0;">
            <div style="font-weight: 600;">${deps.escapeHtml(title)}</div>
            <div style="font-size: 0.85em; color: #666; margin-top: 4px;">${deps.escapeHtml(String(item?.direction || ''))} · ${deps.escapeHtml(String(item?.outcome || 'pending'))}</div>
          </div>
        `;
      })
      .join('');
  } catch {
    detailMatches.textContent = 'Could not load';
    talksList.innerHTML = '<p style="text-align: center; padding: 20px; color: #c00;">Could not load talks.</p>';
  }
}
