import type { KnownPerson } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID, TECHSUPPORT_STAGE_NAME } from '../../shared/techsupport';
import type { PeerSummary } from '../../server/routes/peer-routes';
import { avatarInnerHtml } from './profile-avatar';
import type { UiTranslationKey } from './ui-translations';

type ContactsViewDeps = {
  apiBase: string;
  currentUserId: string;
  escapeHtml: (text: string) => string;
  getKnownPeople: () => KnownPerson[];
  getKnownPerson: (userId: string) => KnownPerson | undefined;
  isBlockedByMe: (userId: string) => boolean;
  getPeerName: (userId: string, fallbackName?: string) => string;
  openPeerDetail: (userId: string, stageName: string) => void;
  getMyTalks: () => Record<string, any>;
  saveKnownPerson: (
    userId: string,
    details: { label: KnownPerson['label']; nickname?: string; customLabel?: string; rating?: number; notes?: string },
  ) => Promise<void>;
  submitPeerReview: (userId: string, rating: number) => Promise<void>;
  vouchAgeVerified: (userId: string) => Promise<void>;
  setBlocked: (userId: string, blocked: boolean) => Promise<void>;
  hasSupportContact: () => boolean;
  isSupportNotificationsMuted: () => boolean;
  setSupportNotificationsMuted: (muted: boolean) => Promise<void>;
  text: (key: UiTranslationKey) => string;
};

function formatText(deps: ContactsViewDeps, key: UiTranslationKey, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    deps.text(key),
  );
}

function formatCountText(
  deps: ContactsViewDeps,
  count: number,
  singular: UiTranslationKey,
  plural: UiTranslationKey,
): string {
  return formatText(deps, count === 1 ? singular : plural, { count });
}

function formatRelationshipLabel(label: string | undefined, deps: ContactsViewDeps): string {
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

function buildDisplayName(stageName: string, known?: KnownPerson): string {
  const nickname = String(known?.nickname || '').trim();
  const baseStageName = String(stageName || 'Unknown').trim() || 'Unknown';
  if (!nickname) return baseStageName;
  if (nickname.toLowerCase() === baseStageName.toLowerCase()) return nickname;
  return `${nickname} (${baseStageName})`;
}

function buildMetaLine(summary: PeerSummary, known: KnownPerson | undefined, deps: ContactsViewDeps): string {
  const matchedTalks = summary.stats.sent.matches + summary.stats.received.matches;
  const parts = [
    formatCountText(deps, summary.stats.totalTalks, 'contactsTalkCountOne', 'contactsTalkCount'),
    formatCountText(deps, matchedTalks, 'contactsMatchCountOne', 'contactsMatchCount'),
    formatCountText(deps, summary.stats.mutualTagCount, 'contactsCommonTagCountOne', 'contactsCommonTagCount'),
    known?.label ? formatRelationshipLabel(known.label, deps) : deps.text('stranger'),
  ];
  return parts.join(' · ');
}

function rankingMetrics(peer: PeerSummary, known: KnownPerson | undefined, deps: ContactsViewDeps): {
  matchedTalks: number;
  matchRate: number;
  relevance: number;
  explanation: string;
} {
  const matchedTalks = peer.stats.sent.matches + peer.stats.received.matches;
  const matchRate = peer.stats.totalTalks > 0 ? matchedTalks / peer.stats.totalTalks : 0;
  const relationshipBoost = known?.label ? 10 : 0;
  const lastAt = new Date(peer.lastInteractionAt || 0).getTime();
  const daysOld = lastAt > 0 ? Math.max(0, Math.floor((Date.now() - lastAt) / (24 * 60 * 60 * 1000))) : 30;
  const recencyBoost = Math.max(0, 30 - Math.min(30, daysOld));
  const relevance = matchedTalks * 100 + Math.round(matchRate * 25) + relationshipBoost + recencyBoost;
  return {
    matchedTalks,
    matchRate,
    relevance,
    explanation: formatText(deps, 'contactsRankingExplanation', {
      matches: matchedTalks,
      rate: Math.round(matchRate * 25),
      relationship: relationshipBoost,
      recency: recencyBoost,
    }),
  };
}

function closeRelationshipModal(): void {
  document.getElementById('contact-relationship-modal')?.remove();
}

async function openSupportControlsDialog(deps: ContactsViewDeps): Promise<void> {
  closeRelationshipModal();
  const muted = deps.isSupportNotificationsMuted();
  const modal = document.createElement('div');
  modal.id = 'contact-relationship-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;z-index:4000;padding:20px;';
  modal.innerHTML = `
    <div style="width:min(520px, 96vw); background:white; border-radius:16px; box-shadow:0 20px 60px rgba(15,23,42,0.2);">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid #e5e7eb;">
        <div>
          <div style="font-weight:700; font-size:1.05em;">${deps.text('contactSupportControls')}</div>
          <div style="font-size:0.88em; color:#64748b;">${TECHSUPPORT_STAGE_NAME}</div>
        </div>
        <button type="button" id="close-contact-relationship-modal" style="background:none;border:none;font-size:24px;cursor:pointer;color:#64748b;">&times;</button>
      </div>
      <div style="padding:18px; display:grid; gap:14px;">
        <div style="padding:12px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;">
          <div style="font-weight:700;">${deps.text('contactsSupportBuiltIn')}</div>
          <div style="font-size:0.9em;margin-top:5px;">${deps.text('contactSupportDescription')}</div>
        </div>
        <div id="contact-support-status-wrap" style="padding:12px;border-radius:12px;background:#f8fafc;border:1px solid #e5e7eb;">
          <div style="font-weight:700;">${deps.text('contactSupportNotificationStatus')}</div>
          <div id="contact-support-status-text" style="font-size:0.9em;color:#475569;margin-top:5px;">${deps.text(muted ? 'contactSupportNotificationsMuted' : 'contactSupportNotificationsOn')}</div>
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; padding:16px 18px; border-top:1px solid #e5e7eb;">
        <button type="button" class="btn" id="contact-relationship-close-btn">${deps.text('contactClose')}</button>
        <button type="button" class="btn primary-btn" id="contact-support-mute-btn">${deps.text(muted ? 'contactUnmuteSupport' : 'contactMuteSupport')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => closeRelationshipModal();
  (document.getElementById('close-contact-relationship-modal') as HTMLButtonElement | null)?.addEventListener('click', close);
  (document.getElementById('contact-relationship-close-btn') as HTMLButtonElement | null)?.addEventListener('click', close);
  (document.getElementById('contact-support-mute-btn') as HTMLButtonElement | null)?.addEventListener('click', async () => {
    await deps.setSupportNotificationsMuted(!muted);
    close();
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
}

/** Set in showContactDetail after a successful profile fetch; cleared when opening another contact. Avoids a duplicate GET /api/users/:id when opening Relationship & Credit. */
let contactDetailUserProfileCache: { userId: string; publicUser: any } | null = null;

function renderPublicProfileSummary(deps: ContactsViewDeps, publicUser: any): string {
  const headshot = String(publicUser?.headshot || '').trim();
  const languages = Array.isArray(publicUser?.languages) ? publicUser.languages.filter(Boolean) : [];
  const interests = Array.isArray(publicUser?.interests)
    ? publicUser.interests.map((t: { name?: string }) => String(t?.name || '').trim()).filter(Boolean)
    : [];
  const profile = Array.isArray(publicUser?.profile) ? publicUser.profile.filter((qa: any) => qa?.question && qa?.answer) : [];
  return `
    <div style="display:flex; gap:12px; align-items:flex-start; margin-top:10px; padding:12px; border-radius:12px; background:#f8fafc; border:1px solid #e2e8f0;">
      <div class="user-avatar" style="width:52px; height:52px; font-size:1.4em; flex-shrink:0;">${avatarInnerHtml(headshot, '?', deps.escapeHtml)}</div>
      <div style="min-width:0; flex:1;">
        <div style="font-size:0.82em; color:#64748b;">${deps.text('publicProfile')}</div>
        <div style="font-size:0.88em; color:#334155; margin-top:4px;">${deps.text('languagesLabel')}: ${deps.escapeHtml(languages.length > 0 ? languages.join(', ') : deps.text('notListed'))}</div>
        ${interests.length > 0 ? `<div style="font-size:0.88em; color:#334155; margin-top:4px;">${deps.text('interestsLabel')}: ${deps.escapeHtml(interests.join(', '))}</div>` : ''}
        <div style="display:grid; gap:6px; margin-top:8px;">
          ${
            profile.length > 0
              ? profile
                  .slice(0, 3)
                  .map(
                    (qa: any) => `
                      <div style="padding:8px 10px; border-radius:10px; background:white; border:1px solid #e5e7eb;">
                        <div style="font-size:0.75em; color:#64748b;">${deps.escapeHtml(String(qa.question))}</div>
                        <div style="font-size:0.9em; font-weight:600; color:#111827; margin-top:2px;">${deps.escapeHtml(String(qa.answer))}</div>
                      </div>
                    `,
                  )
                  .join('')
              : `<div style="font-size:0.82em; color:#94a3b8;">${deps.text('noPublicProfile')}</div>`
          }
        </div>
      </div>
    </div>
  `;
}

function relationshipModalCreditInnerHtml(deps: ContactsViewDeps, publicUser: any, blockedBy: boolean): string {
  if (blockedBy) {
    return `<div style="margin-top:6px;color:#94a3b8;">${deps.text('contactProfileUnavailable')}</div>`;
  }
  if (!publicUser) {
    return `<div style="margin-top:6px;color:#94a3b8;">${deps.text('contactCreditUnavailable')}</div>`;
  }
  const reputation = publicUser?.reputation || null;
  if (reputation && !reputation.isHidden) {
    return `<div style="margin-top:6px;font-weight:700;">${Number(reputation.starRating || 0).toFixed(1)} ★</div>
            <div style="font-size:0.88em;color:#475569;margin-top:4px;">${formatText(deps, 'contactCreditSummary', {
              reviews: reputation.reviewCount || 0,
              friends: reputation.friendsCount || 0,
              liked: reputation.likedCount || 0,
              disliked: reputation.dislikedCount || 0,
            })}</div>`;
  }
  return `<div style="margin-top:6px;color:#94a3b8;">${deps.text('contactCreditHidden')}</div>`;
}

function applyRelationshipModalProfileFetch(
  deps: ContactsViewDeps,
  blockedByMe: boolean,
  publicUser: any,
  blockedBy: boolean,
): void {
  const creditPanel = document.getElementById('contact-relationship-credit-panel');
  if (creditPanel) {
    creditPanel.innerHTML = `<div style="font-size:0.8em;color:#64748b;">${deps.text('contactPublicCredit')}</div>${relationshipModalCreditInnerHtml(deps, publicUser, blockedBy)}`;
  }
  const wrap = document.getElementById('contact-block-status-wrap');
  const statusText = document.getElementById('contact-block-status-text');
  if (wrap && statusText) {
    if (blockedBy) {
      wrap.style.borderColor = '#fecaca';
      wrap.style.background = '#fef2f2';
      statusText.textContent = deps.text('contactBlockedBy');
    } else if (blockedByMe) {
      wrap.style.borderColor = '#fde68a';
      wrap.style.background = '#fffbeb';
      statusText.textContent = deps.text('contactBlockedByMe');
    } else {
      wrap.style.borderColor = '#e5e7eb';
      wrap.style.background = '#f8fafc';
      statusText.textContent = deps.text('contactNoBlock');
    }
  }
  if (blockedBy) {
    document.getElementById('contact-block-toggle-btn')?.style.setProperty('display', 'none');
    document.getElementById('contact-age-vouch-btn')?.style.setProperty('display', 'none');
  }
}

async function openRelationshipDialog(
  deps: ContactsViewDeps,
  userId: string,
  stageName: string,
): Promise<void> {
  if (userId === TECHSUPPORT_ROOT_USER_ID) {
    await openSupportControlsDialog(deps);
    return;
  }
  closeRelationshipModal();
  const known = deps.getKnownPerson(userId);
  const blockedByMe = deps.isBlockedByMe(userId);

  const modal = document.createElement('div');
  modal.id = 'contact-relationship-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;z-index:4000;padding:20px;';
  modal.innerHTML = `
    <div style="width:min(640px, 96vw); max-height:90vh; overflow:auto; background:white; border-radius:16px; box-shadow:0 20px 60px rgba(15,23,42,0.2);">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid #e5e7eb;">
        <div>
          <div style="font-weight:700; font-size:1.05em;">${deps.text('contactRelationshipCredit')}</div>
          <div style="font-size:0.88em; color:#64748b;">${deps.escapeHtml(stageName)}</div>
        </div>
        <button type="button" id="close-contact-relationship-modal" style="background:none;border:none;font-size:24px;cursor:pointer;color:#64748b;">&times;</button>
      </div>
      <div style="padding:18px; display:grid; gap:16px;">
        <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px;">
          <label style="display:flex; flex-direction:column; gap:6px; font-size:0.9em;">
            <span>${deps.text('relationship')}</span>
            <select id="contact-relationship-label" style="padding:10px;border:1px solid #d1d5db;border-radius:10px;">
              ${['friend', 'relative', 'coworker', 'acquaintance', 'partner', 'custom']
                .map((label) => `<option value="${label}" ${(known?.label || '') === label ? 'selected' : ''}>${formatRelationshipLabel(label, deps)}</option>`)
                .join('')}
            </select>
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; font-size:0.9em;">
            <span>${deps.text('contactNickname')}</span>
            <input id="contact-relationship-nickname" type="text" value="${deps.escapeHtml(String(known?.nickname || ''))}" style="padding:10px;border:1px solid #d1d5db;border-radius:10px;">
          </label>
        </div>
        <label style="display:flex; flex-direction:column; gap:6px; font-size:0.9em;">
          <span>${deps.text('contactCustomLabel')}</span>
          <input id="contact-relationship-custom-label" type="text" value="${deps.escapeHtml(String(known?.customLabel || ''))}" placeholder="${deps.text('contactCustomLabelHelp')}" style="padding:10px;border:1px solid #d1d5db;border-radius:10px;">
        </label>
        <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px;">
          <label style="display:flex; flex-direction:column; gap:6px; font-size:0.9em;">
            <span>${deps.text('contactMyRating')}</span>
            <select id="contact-relationship-rating" style="padding:10px;border:1px solid #d1d5db;border-radius:10px;">
              <option value="">${deps.text('contactNoRating')}</option>
              ${[1, 2, 3, 4, 5]
                .map((rating) => `<option value="${rating}" ${known?.rating === rating ? 'selected' : ''}>${rating} ${deps.text(rating === 1 ? 'contactStar' : 'contactStars')}</option>`)
                .join('')}
            </select>
          </label>
          <div id="contact-relationship-credit-panel" style="padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#f8fafc;">
            <div style="font-size:0.8em;color:#64748b;">${deps.text('contactPublicCredit')}</div>
            <div style="margin-top:6px;color:#94a3b8;">${deps.text('loading')}</div>
          </div>
        </div>
        <label style="display:flex; flex-direction:column; gap:6px; font-size:0.9em;">
          <span>${deps.text('contactNotes')}</span>
          <textarea id="contact-relationship-notes" rows="4" style="padding:10px;border:1px solid #d1d5db;border-radius:10px;">${deps.escapeHtml(String(known?.notes || ''))}</textarea>
        </label>
        <div id="contact-block-status-wrap" style="padding:12px; border-radius:12px; border:1px solid ${blockedByMe ? '#fde68a' : '#e5e7eb'}; background:${blockedByMe ? '#fffbeb' : '#f8fafc'};">
          <div style="font-weight:700; color:#111827;">${deps.text('contactBlockStatus')}</div>
          <div id="contact-block-status-text" style="font-size:0.88em; color:#475569; margin-top:4px;">
            ${deps.text(blockedByMe ? 'contactBlockedByMe' : 'contactNoBlock')}
          </div>
        </div>
      </div>
      <div style="display:flex; justify-content:space-between; gap:10px; padding:16px 18px; border-top:1px solid #e5e7eb;">
        <button type="button" class="btn" id="contact-age-vouch-btn" title="${deps.text('contactVouchAdult')}" style="${blockedByMe ? 'display:none;' : ''}">${deps.text('contactVouchAdult')}</button>
        <button type="button" class="btn" id="contact-block-toggle-btn">${deps.text(blockedByMe ? 'contactUnblockUser' : 'contactBlockUser')}</button>
        <div style="display:flex; gap:10px;">
          <button type="button" class="btn" id="contact-relationship-close-btn">${deps.text('contactClose')}</button>
          <button type="button" class="btn primary-btn" id="contact-relationship-save-btn">${deps.text('contactSave')}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => closeRelationshipModal();
  (document.getElementById('close-contact-relationship-modal') as HTMLButtonElement | null)?.addEventListener('click', close);
  (document.getElementById('contact-relationship-close-btn') as HTMLButtonElement | null)?.addEventListener('click', close);
  (document.getElementById('contact-age-vouch-btn') as HTMLButtonElement | null)?.addEventListener('click', async () => {
    await deps.vouchAgeVerified(userId);
    close();
  });
  (document.getElementById('contact-block-toggle-btn') as HTMLButtonElement | null)?.addEventListener('click', async () => {
    await deps.setBlocked(userId, !blockedByMe);
    close();
  });
  (document.getElementById('contact-relationship-save-btn') as HTMLButtonElement | null)?.addEventListener('click', async () => {
    const label = (document.getElementById('contact-relationship-label') as HTMLSelectElement).value as KnownPerson['label'];
    const nickname = (document.getElementById('contact-relationship-nickname') as HTMLInputElement).value.trim();
    const customLabel = (document.getElementById('contact-relationship-custom-label') as HTMLInputElement).value.trim();
    const ratingRaw = (document.getElementById('contact-relationship-rating') as HTMLSelectElement).value;
    const notes = (document.getElementById('contact-relationship-notes') as HTMLTextAreaElement).value.trim();
    const rating = ratingRaw ? Number(ratingRaw) : undefined;
    await deps.saveKnownPerson(userId, {
      label,
      ...(nickname ? { nickname } : {}),
      ...(customLabel ? { customLabel } : {}),
      ...(typeof rating === 'number' ? { rating } : {}),
      ...(notes ? { notes } : {}),
    });
    if (typeof rating === 'number' && rating !== known?.rating) {
      await deps.submitPeerReview(userId, rating);
    }
    close();
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });

  const cached = contactDetailUserProfileCache?.userId === userId ? contactDetailUserProfileCache.publicUser : undefined;
  if (cached !== undefined) {
    applyRelationshipModalProfileFetch(deps, blockedByMe, cached, false);
    return;
  }

  const profileUrl = `${deps.apiBase}/api/users/${encodeURIComponent(userId)}?viewerId=${encodeURIComponent(deps.currentUserId)}`;
  const ac = new AbortController();
  const timeoutId = window.setTimeout(() => ac.abort(), 12_000);
  let publicUser: any = null;
  let blockedBy = false;
  try {
    const res = await fetch(profileUrl, { signal: ac.signal });
    if (res.ok) {
      try {
        publicUser = await res.json();
      } catch {
        publicUser = null;
      }
    } else if (res.status === 403) {
      blockedBy = true;
    }
  } catch {
    publicUser = null;
  } finally {
    window.clearTimeout(timeoutId);
  }
  applyRelationshipModalProfileFetch(deps, blockedByMe, publicUser, blockedBy);
}

export function showContactsList(deps: ContactsViewDeps): void {
  const listContainer = document.getElementById('contacts-list-container');
  const detailContainer = document.getElementById('contact-detail-container');
  if (listContainer) listContainer.style.display = 'block';
  if (detailContainer) detailContainer.style.display = 'none';
  const backBtn = document.getElementById('back-to-contacts-list') as HTMLElement | null;
  if (backBtn) backBtn.style.display = 'none';
  void displayContactsList(deps);
}

export async function displayContactsList(deps: ContactsViewDeps): Promise<void> {
  const listEl = document.getElementById('contacts-list');
  if (!listEl) return;

  if (!deps.apiBase || !deps.currentUserId) {
    listEl.innerHTML = `<p style="text-align: center; padding: 40px 20px; color: #999;">${deps.text('contactsUnavailable')}</p>`;
    return;
  }

  listEl.innerHTML = `<p style="text-align: center; padding: 40px 20px; color: #999;">${deps.text('contactsLoading')}</p>`;

  try {
    const response = await fetch(
      `${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/peers`,
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const peers = (await response.json()) as PeerSummary[];
    const knownMap = new Map(
      deps.getKnownPeople().map((entry) => [entry.userId, entry] as const),
    );
    const controls = {
      name: document.getElementById('contacts-filter-name') as HTMLInputElement | null,
      relation: document.getElementById('contacts-filter-relation') as HTMLSelectElement | null,
      sort: document.getElementById('contacts-sort-order') as HTMLSelectElement | null,
    };
    const savedState = (() => {
      try {
        return JSON.parse(localStorage.getItem('iinpublic_contacts_tab_state') || '{}') as {
          name?: string;
          relation?: string;
          sort?: string;
          scrollTop?: number;
        };
      } catch {
        return {};
      }
    })();
    if (controls.name && controls.name.value === '' && savedState.name) controls.name.value = savedState.name;
    if (controls.relation && savedState.relation) controls.relation.value = savedState.relation;
    if (controls.sort && savedState.sort) controls.sort.value = savedState.sort;
    const persistControls = () => {
      localStorage.setItem('iinpublic_contacts_tab_state', JSON.stringify({
        name: controls.name?.value || '',
        relation: controls.relation?.value || 'all',
        sort: controls.sort?.value || 'recent',
        scrollTop: listEl.scrollTop || 0,
      }));
    };
    ['input', 'change'].forEach((eventName) => {
      controls.name?.addEventListener(eventName, () => {
        persistControls();
        void displayContactsList(deps);
      }, { once: true });
      controls.relation?.addEventListener(eventName, () => {
        persistControls();
        void displayContactsList(deps);
      }, { once: true });
      controls.sort?.addEventListener(eventName, () => {
        persistControls();
        void displayContactsList(deps);
      }, { once: true });
    });

    const nameFilter = (controls.name?.value || '').trim().toLowerCase();
    const relationFilter = controls.relation?.value || 'all';
    const sortOrder = controls.sort?.value || 'recent';
    const supportNameMatches = !nameFilter || TECHSUPPORT_STAGE_NAME.toLowerCase().includes(nameFilter);
    const showSupportContact = deps.hasSupportContact() && relationFilter === 'all' && supportNameMatches;
    const tieBreak = (a: PeerSummary, b: PeerSummary): number =>
      deps.getPeerName(a.peerId, a.stageName).localeCompare(deps.getPeerName(b.peerId, b.stageName));
    const visiblePeers = peers
      .filter((peer) => {
        const known = knownMap.get(peer.peerId);
        const resolvedStageName = deps.getPeerName(peer.peerId, peer.stageName);
        const displayName = buildDisplayName(resolvedStageName, known).toLowerCase();
        if (nameFilter && !displayName.includes(nameFilter)) return false;
        if (relationFilter !== 'all' && known?.label !== relationFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const aKnown = knownMap.get(a.peerId);
        const bKnown = knownMap.get(b.peerId);
        const aMetrics = rankingMetrics(a, aKnown, deps);
        const bMetrics = rankingMetrics(b, bKnown, deps);
        if (sortOrder === 'name') {
          return tieBreak(a, b);
        }
        if (sortOrder === 'matches' && bMetrics.matchedTalks !== aMetrics.matchedTalks) return bMetrics.matchedTalks - aMetrics.matchedTalks;
        if (sortOrder === 'match-rate' && bMetrics.matchRate !== aMetrics.matchRate) return bMetrics.matchRate - aMetrics.matchRate;
        if (sortOrder === 'weighted' && bMetrics.relevance !== aMetrics.relevance) return bMetrics.relevance - aMetrics.relevance;
        if (sortOrder === 'talks' && b.stats.totalTalks !== a.stats.totalTalks) return b.stats.totalTalks - a.stats.totalTalks;
        const timeDiff = new Date(b.lastInteractionAt || 0).getTime() - new Date(a.lastInteractionAt || 0).getTime();
        return timeDiff !== 0 ? timeDiff : tieBreak(a, b);
      });

    if (peers.length === 0 && !showSupportContact) {
      listEl.innerHTML = `
        <p style="text-align: center; padding: 40px 20px; color: #999;">${deps.text('contactsEmpty')}</p>
      `;
      return;
    }
    if (visiblePeers.length === 0 && !showSupportContact) {
      listEl.innerHTML = `
        <p style="text-align: center; padding: 40px 20px; color: #999;">${deps.text('contactsNoMatch')}</p>
      `;
      return;
    }

    const status = document.getElementById('contacts-status-text');
    if (status) status.textContent = formatCountText(deps, visiblePeers.length, 'contactsCountOne', 'contactsCount');

    const supportRow = showSupportContact
      ? `
          <div class="contact-item contact-support-item" data-support-contact="true" data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}" data-contact-name="${TECHSUPPORT_STAGE_NAME}" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; margin-bottom: 8px; background: #eff6ff; border-radius: 12px; border: 1px solid #bfdbfe; cursor: pointer;">
            <div style="min-width:0;">
              <div class="contact-item-name" style="font-weight:700;">${TECHSUPPORT_STAGE_NAME}<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:0.72em;font-weight:700;margin-left:8px;">${deps.text('contactsSupportPinned')}</span></div>
              <div class="contact-item-meta" style="font-size:0.85em;color:#1e40af;margin-top:4px;">${deps.text('contactsSupportBuiltIn')}</div>
              <div class="contact-item-meta" style="font-size:0.8em;color:#64748b;margin-top:4px;">${deps.text(deps.isSupportNotificationsMuted() ? 'contactSupportNotificationsMuted' : 'contactSupportNotificationsOn')}</div>
            </div>
            <span style="color:#3b82f6; flex-shrink:0;">›</span>
          </div>
        `
      : '';
    listEl.innerHTML = supportRow + visiblePeers
      .map((peer) => {
        const known = knownMap.get(peer.peerId);
        const resolvedStageName = deps.getPeerName(peer.peerId, peer.stageName);
        const displayName = buildDisplayName(resolvedStageName, known);
        const relationship = formatRelationshipLabel(known?.label, deps);
        const metrics = rankingMetrics(peer, known, deps);
        const blockedBadge = deps.isBlockedByMe(peer.peerId)
          ? `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:0.72em;font-weight:700;margin-left:8px;">${deps.text('contactsBlocked')}</span>`
          : '';
        return `
          <div class="contact-item" data-contact-user-id="${deps.escapeHtml(peer.peerId)}" data-contact-name="${deps.escapeHtml(resolvedStageName)}" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; margin-bottom: 8px; background: white; border-radius: 12px; border: 1px solid #e0e0e0; cursor: pointer;">
            <div style="min-width: 0;">
              <div class="contact-item-name" style="font-weight: 700;">${deps.escapeHtml(displayName)}${blockedBadge}</div>
              <div class="contact-item-meta" style="font-size: 0.85em; color: #666; margin-top: 4px;">${deps.escapeHtml(buildMetaLine(peer, known, deps))}</div>
              <div class="contact-item-meta" style="font-size: 0.8em; color: #94a3b8; margin-top: 4px;">${deps.text('sent')} ${peer.stats.sent.talks} · ${deps.text('received')} ${peer.stats.received.talks} · ${deps.text('relationship')}: ${deps.escapeHtml(relationship)}</div>
              ${sortOrder === 'weighted' ? `<div class="contact-item-rank" title="${deps.escapeHtml(metrics.explanation)}" style="font-size:0.8em;color:#475569;margin-top:4px;">${deps.text('relevanceScore')}: ${metrics.relevance} · ${deps.escapeHtml(metrics.explanation)}</div>` : ''}
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
    window.setTimeout(() => {
      if (typeof savedState.scrollTop === 'number') listEl.scrollTop = savedState.scrollTop;
    }, 0);
    listEl.addEventListener('scroll', persistControls, { passive: true });
  } catch {
    listEl.innerHTML = `<p style="text-align: center; padding: 40px 20px; color: #c00;">${deps.text('contactsUnavailable')}</p>`;
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

  contactDetailUserProfileCache = null;
  listContainer.style.display = 'none';
  detailContainer.style.display = 'block';
  const backBtn = document.getElementById('back-to-contacts-list') as HTMLElement | null;
  if (backBtn) backBtn.style.display = 'inline-flex';
  detailName.textContent = otherUserName;
  detailMatches.textContent = deps.text('loading');
  talksList.innerHTML = `<p style="text-align: center; padding: 20px; color: #999;">${deps.text('loading')}</p>`;
  const detailInfo = document.getElementById('contact-detail-info');
  document.getElementById('contact-edit-relationship-btn')?.remove();
  if (detailInfo) {
    detailInfo.querySelector('.contact-public-profile-summary')?.remove();
    const button = document.createElement('button');
    button.id = 'contact-edit-relationship-btn';
    button.className = 'btn';
    button.type = 'button';
    button.textContent = deps.text(otherUserId === TECHSUPPORT_ROOT_USER_ID ? 'contactSupportControls' : 'contactRelationshipCredit');
    button.style.cssText = 'margin-top:8px;padding:6px 12px;font-size:0.85em;';
    button.addEventListener('click', () => {
      void openRelationshipDialog(deps, otherUserId, otherUserName);
    });
    detailInfo.appendChild(button);
  }

  try {
    const [relationshipRes, historyRes, userRes] = await Promise.all([
      fetch(`${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/peers/${encodeURIComponent(otherUserId)}/relationship`),
      fetch(`${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/peers/${encodeURIComponent(otherUserId)}/talk-history`),
      fetch(`${deps.apiBase}/api/users/${encodeURIComponent(otherUserId)}?viewerId=${encodeURIComponent(deps.currentUserId)}`),
    ]);
    if (relationshipRes.status === 403 || historyRes.status === 403 || userRes.status === 403) {
      detailMatches.textContent = deps.text('unavailable');
      talksList.innerHTML = `<p style="text-align: center; padding: 20px; color: #c2410c;">${deps.text('contactDetailsUnavailable')}</p>`;
      return;
    }

    const relationship = relationshipRes.ok ? await relationshipRes.json() : null;
    const history = historyRes.ok ? await historyRes.json() : [];
    const publicUser = userRes.ok ? await userRes.json() : null;
    contactDetailUserProfileCache = { userId: otherUserId, publicUser };
    const totalTalks = relationship?.totalTalks ?? (Array.isArray(history) ? history.length : 0);
    detailMatches.textContent = formatCountText(deps, totalTalks, 'contactsTalkCountOne', 'contactsTalkCount');
    if (detailInfo) {
      const summary = document.createElement('div');
      summary.className = 'contact-public-profile-summary';
      summary.innerHTML = renderPublicProfileSummary(deps, publicUser);
      detailInfo.appendChild(summary);
    }

    if (!Array.isArray(history) || history.length === 0) {
      talksList.innerHTML = `<p style="text-align: center; padding: 20px; color: #999;">${deps.text('contactNoTalks')}</p>`;
      return;
    }

    const myTalks = deps.getMyTalks();
    talksList.innerHTML = history
      .map((item: any) => {
        const localTalk = item?.talkId ? myTalks[item.talkId] : null;
        const title = String(localTalk?.title || item?.title || deps.text('contactTalkFallback')).trim();
        return `
          <div class="contact-talk-item" data-talk-id="${deps.escapeHtml(String(item?.talkId || ''))}" style="padding: 14px 16px; margin-bottom: 8px; background: #f9f9f9; border-radius: 10px; border: 1px solid #e0e0e0;">
            <div style="font-weight: 600;">${deps.escapeHtml(title)}</div>
            <div style="font-size: 0.85em; color: #666; margin-top: 4px;">${deps.escapeHtml(String(item?.direction || ''))} · ${deps.escapeHtml(String(item?.outcome || 'pending'))}</div>
          </div>
        `;
      })
      .join('');
  } catch {
    detailMatches.textContent = deps.text('contactCouldNotLoad');
    talksList.innerHTML = `<p style="text-align: center; padding: 20px; color: #c00;">${deps.text('contactCouldNotLoadTalks')}</p>`;
  }
}
