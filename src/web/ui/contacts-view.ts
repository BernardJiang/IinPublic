import type { KnownPerson } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID, TECHSUPPORT_STAGE_NAME } from '../../shared/techsupport';
import type { PeerSummary } from '../../shared/peer-summary-types';
import { avatarInnerHtml } from './profile-avatar';
import type { UiTranslationKey } from './ui-translations';
import {
  deriveLocalPeers,
  localTalkHistoryForPeer,
} from '../services/local-peer-derivation';
import { renderListProgressively } from './render-list-progressively';

/**
 * TODO §R1: how many contact rows render synchronously, immediately — matches
 * CREATOR_REPLY_PAGE_SIZE's existing precedent (ui-manager.ts) for "above the fold".
 * The rest renders quietly in the background (`renderListProgressively`), never behind
 * a manual "load more" control — the requirement asks for automatic quiet fill.
 */
const CONTACTS_FIRST_CHUNK_SIZE = 25;

export type ContactsViewDeps = {
  apiBase: string;
  currentUserId: string;
  escapeHtml: (text: string) => string;
  getKnownPeople: () => KnownPerson[];
  getKnownPerson: (userId: string) => KnownPerson | undefined;
  isBlockedByMe: (userId: string) => boolean;
  getPeerName: (userId: string, fallbackName?: string) => string;
  /** Optional async lookup of the peer's CURRENT stage name (rename-fresh); used to patch
   *  rendered rows/detail whose recorded names were captured before a rename. */
  resolvePeerStageName?: (userId: string) => Promise<string | null>;
  /** Tapping the contact's name specifically — opens a DM with them directly. */
  openPeerDetail: (userId: string, stageName: string) => void;
  /** Tapping the row anywhere else — opens the person's details popup without also
   *  jumping straight into a DM. */
  openPeerDetailOnly: (userId: string, stageName: string) => void;
  /** Merges the row-count header line into the same "Stats: ..." strip (one line
   *  instead of two) — mirrors the Talks tab's displayContextualStatistics(prefix). */
  updateStatsStrip: (prefix: string) => void;
  getMyConversations: () => Record<string, any>;
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
  /** Liveness, never headcount (K1-2, docs/TODO.md) — see ui-manager.ts `setTechSupportOnlineStatus`. */
  isTechSupportOnline: () => boolean;
  text: (key: UiTranslationKey) => string;
  formatLanguage: (code: string) => string;
  getProfileLanguages: () => string[];
  beforeRender?: () => Promise<void>;
  getPublicProfileFoundation?: (userId: string) => Promise<{
    headshot?: string | null;
    languagesJson?: string;
    profileJson?: string;
    interestsJson?: string;
  } | null>;
  /** Sort strategies (registry from find-similar.ts) */
  sortStrategies?: Record<string, { id: string; label: string }>;
  /** Current active sort strategy id */
  activeSortId?: string;
  /** Handler to change sort strategy */
  onSortChange?: (sortId: string) => void;
  /** Returns distance in miles to a peer; undefined when location is unavailable (peers without distance sort last) */
  distanceMiles?: (userId: string) => number | undefined;
  /** Synchronous cache read for first paint (TODO §M6) — null means not yet resolved. */
  getCachedHeadshot?: (userId: string) => string | null;
  /** Async fetch-and-cache, used by the row self-heal loop to fill in headshots without
   *  blocking first render; resolves from cache on subsequent calls (no re-fetch on re-sort). */
  resolvePeerHeadshot?: (userId: string) => Promise<string | null>;
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

async function runBeforeRender(deps: ContactsViewDeps): Promise<void> {
  if (!deps.beforeRender) return;
  await Promise.race([
    deps.beforeRender(),
    new Promise<void>((resolve) => window.setTimeout(resolve, 1200)),
  ]);
}

// fetchPeerSummariesWithTimeout removed — contacts are derived locally (P0 step 5).
// Use deriveLocalPeers() from local-peer-derivation.ts instead.

function formatRelationshipLabel(
  relationship: KnownPerson | string | undefined,
  deps: ContactsViewDeps,
): string {
  const label = typeof relationship === 'string' ? relationship : relationship?.label;
  if (!label) return deps.text('contactNoRelationship');
  if (label === 'custom' && relationship && typeof relationship !== 'string') {
    const customLabel = String(relationship.customLabel || '').trim();
    if (customLabel) return customLabel;
  }
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

/**
 * A nickname is the user's own, private label for this contact — it defaults to
 * mirroring the contact's live stage name (empty `known.nickname` falls through to
 * `stageName` below) until the user deliberately sets one, at which point it's sticky:
 * shown alone, and no longer follows the contact's future stage-name changes.
 */
function buildDisplayName(stageName: string, known?: KnownPerson): string {
  const nickname = String(known?.nickname || '').trim();
  const baseStageName = String(stageName || 'Unknown').trim() || 'Unknown';
  return nickname || baseStageName;
}

function buildMetaLine(summary: PeerSummary, known: KnownPerson | undefined, deps: ContactsViewDeps): string {
  const matchedTalks = summary.stats.sent.matches + summary.stats.received.matches;
  const parts = [
    formatCountText(deps, summary.stats.totalTalks, 'contactsTalkCountOne', 'contactsTalkCount'),
    formatCountText(deps, matchedTalks, 'contactsMatchCountOne', 'contactsMatchCount'),
    formatCountText(deps, summary.stats.mutualTagCount, 'contactsCommonTagCountOne', 'contactsCommonTagCount'),
    known?.label ? formatRelationshipLabel(known, deps) : deps.text('stranger'),
  ];
  return parts.join(' · ');
}

// Local peer helper functions removed — now using deriveLocalPeers() from
// src/web/services/local-peer-derivation.ts (P0 step 5).

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
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;z-index:6000;padding:20px;';
  modal.innerHTML = `
    <div style="width:min(520px, 96vw); background:white; border-radius:16px; box-shadow:0 20px 60px rgba(15,23,42,0.2);">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid var(--border);">
        <div>
          <div style="font-weight:700; font-size:1.05em;">${deps.text('contactSupportControls')}</div>
          <div style="font-size:0.88em; color:var(--text-tertiary);">${TECHSUPPORT_STAGE_NAME}</div>
        </div>
        <button type="button" id="close-contact-relationship-modal" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-tertiary);">&times;</button>
      </div>
      <div style="padding:18px; display:grid; gap:14px;">
        <div style="padding:12px;border-radius:12px;background:var(--accent-soft);border:1px solid var(--accent-border);color:var(--accent-text);">
          <div style="font-weight:700;">${deps.text('contactsSupportBuiltIn')}</div>
          <div style="font-size:0.9em;margin-top:5px;">${deps.text('contactSupportDescription')}</div>
        </div>
        <div id="contact-support-status-wrap" style="padding:12px;border-radius:12px;background:var(--bg-subtle);border:1px solid var(--border);">
          <div style="font-weight:700;">${deps.text('contactSupportNotificationStatus')}</div>
          <div id="contact-support-status-text" style="font-size:0.9em;color:var(--text-secondary);margin-top:5px;">${deps.text(muted ? 'contactSupportNotificationsMuted' : 'contactSupportNotificationsOn')}</div>
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; padding:16px 18px; border-top:1px solid var(--border);">
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

function parsePublicProfileArray<T>(value: string | undefined, fallback: T[]): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

// publicUserHasProfileFoundation removed — no longer needed after P0 step 5 (no server profile fetch).

async function readPublicProfileFoundation(deps: ContactsViewDeps, userId: string): Promise<any | null> {
  if (!deps.getPublicProfileFoundation) return null;
  const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 2_500));
  const foundation = await Promise.race([
    deps.getPublicProfileFoundation(userId).catch(() => null),
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

function renderPublicProfileSummary(deps: ContactsViewDeps, publicUser: any): string {
  const headshot = String(publicUser?.headshot || '').trim();
  const languages = Array.isArray(publicUser?.languages)
    ? publicUser.languages.map((code: unknown) => String(code).trim().toLowerCase()).filter(Boolean)
    : [];
  const ownLanguages = new Set(
    deps.getProfileLanguages().map((code) => String(code).trim().toLowerCase()).filter(Boolean),
  );
  const sharedLanguages = languages.filter((code: string) => ownLanguages.has(code));
  const languageLabels = languages.map((code: string) => {
    const language = deps.formatLanguage(code);
    return ownLanguages.has(code) ? formatText(deps, 'contactSharedLanguage', { language }) : language;
  });
  const interests = Array.isArray(publicUser?.interests)
    ? publicUser.interests.map((t: { name?: string }) => String(t?.name || '').trim()).filter(Boolean)
    : [];
  const profile = Array.isArray(publicUser?.profile) ? publicUser.profile.filter((qa: any) => qa?.question && qa?.answer) : [];
  return `
    <div style="display:flex; gap:12px; align-items:flex-start; margin-top:10px; padding:12px; border-radius:12px; background:var(--bg-subtle); border:1px solid var(--border);">
      <div class="user-avatar" style="width:52px; height:52px; font-size:1.4em; flex-shrink:0;">${avatarInnerHtml(headshot, '?', deps.escapeHtml)}</div>
      <div style="min-width:0; flex:1;">
        <div style="font-size:0.82em; color:var(--text-tertiary);">${deps.text('publicProfile')}</div>
        <div class="contact-profile-languages" style="font-size:0.88em; color:var(--text-primary); margin-top:4px;">${deps.text('languagesLabel')}: ${deps.escapeHtml(languageLabels.length > 0 ? languageLabels.join(', ') : deps.text('notListed'))}</div>
        ${languages.length > 0 && ownLanguages.size > 0 && sharedLanguages.length === 0 ? `<div class="contact-language-hint" style="font-size:0.82em; color:var(--warning-text); margin-top:4px;">${deps.text('contactNoSharedLanguage')}</div>` : ''}
        ${interests.length > 0 ? `<div style="font-size:0.88em; color:var(--text-primary); margin-top:4px;">${deps.text('interestsLabel')}: ${deps.escapeHtml(interests.join(', '))}</div>` : ''}
        <div style="display:grid; gap:6px; margin-top:8px;">
          ${
            profile.length > 0
              ? profile
                  .slice(0, 3)
                  .map(
                    (qa: any) => `
                      <div style="padding:8px 10px; border-radius:10px; background:white; border:1px solid var(--border);">
                        <div style="font-size:0.75em; color:var(--text-tertiary);">${deps.escapeHtml(String(qa.question))}</div>
                        <div style="font-size:0.9em; font-weight:600; color:var(--text-primary); margin-top:2px;">${deps.escapeHtml(String(qa.answer))}</div>
                      </div>
                    `,
                  )
                  .join('')
              : `<div style="font-size:0.82em; color:var(--text-muted);">${deps.text('noPublicProfile')}</div>`
          }
        </div>
      </div>
    </div>
  `;
}

function relationshipModalCreditInnerHtml(deps: ContactsViewDeps, publicUser: any, blockedBy: boolean): string {
  if (blockedBy) {
    return `<div style="margin-top:6px;color:var(--text-muted);">${deps.text('contactProfileUnavailable')}</div>`;
  }
  if (!publicUser) {
    return `<div style="margin-top:6px;color:var(--text-muted);">${deps.text('contactCreditUnavailable')}</div>`;
  }
  const reputation = publicUser?.reputation || null;
  if (reputation && !reputation.isHidden) {
    return `<div style="margin-top:6px;font-weight:700;">${Number(reputation.starRating || 0).toFixed(1)} ★</div>
            <div style="font-size:0.88em;color:var(--text-secondary);margin-top:4px;">${formatText(deps, 'contactCreditSummary', {
              reviews: reputation.reviewCount || 0,
              friends: reputation.friendsCount || 0,
              liked: reputation.likedCount || 0,
              disliked: reputation.dislikedCount || 0,
            })}</div>`;
  }
  return `<div style="margin-top:6px;color:var(--text-muted);">${deps.text('contactCreditHidden')}</div>`;
}

function renderContactContextSummary(
  deps: ContactsViewDeps,
  known: KnownPerson | undefined,
  publicUser: any,
  blockedByMe: boolean,
  blockedBy: boolean,
): string {
  const blockStatus = blockedBy
    ? deps.text('contactBlockedBy')
    : blockedByMe
      ? deps.text('contactBlockedByMe')
      : deps.text('contactNoBlock');
  return `
    <div class="contact-context-summary" style="display:grid; gap:10px; margin-top:10px; padding:12px; border-radius:12px; background:var(--bg-subtle); border:1px solid var(--border);">
      <div style="font-size:0.82em; color:var(--text-tertiary);">${deps.text('contactRelationshipCredit')}</div>
      <div class="contact-context-relationship" style="font-size:0.88em;color:var(--text-primary);">
        ${deps.text('relationship')}: ${deps.escapeHtml(formatRelationshipLabel(known, deps))}
      </div>
      ${known?.notes ? `<div class="contact-context-notes" style="font-size:0.88em;color:var(--text-primary);">${deps.text('contactNotes')}: ${deps.escapeHtml(known.notes)}</div>` : ''}
      <div class="contact-context-credit" style="padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:white;">
        <div style="font-size:0.8em;color:var(--text-tertiary);">${deps.text('contactPublicCredit')}</div>
        ${relationshipModalCreditInnerHtml(deps, publicUser, blockedBy)}
      </div>
      <div class="contact-context-block-status" style="padding:10px 12px;border:1px solid ${blockedBy || blockedByMe ? 'var(--warning-border)' : 'var(--border)'};border-radius:10px;background:${blockedBy || blockedByMe ? 'var(--warning-soft)' : 'white'};">
        <div style="font-size:0.8em;color:var(--text-tertiary);">${deps.text('contactBlockStatus')}</div>
        <div style="font-size:0.88em;color:var(--text-secondary);margin-top:4px;">${blockStatus}</div>
      </div>
    </div>
  `;
}

export function renderContactContextSummaryInto(
  detailInfo: HTMLElement | null,
  deps: ContactsViewDeps,
  otherUserId: string,
  publicUser: any,
  blockedByMe: boolean,
  blockedBy: boolean,
): void {
  if (!detailInfo || otherUserId === TECHSUPPORT_ROOT_USER_ID) return;
  detailInfo.querySelector('.contact-context-summary')?.remove();
  const contextSummary = document.createElement('div');
  contextSummary.innerHTML = renderContactContextSummary(
    deps,
    deps.getKnownPerson(otherUserId),
    publicUser,
    blockedByMe,
    blockedBy,
  );
  const element = contextSummary.firstElementChild as HTMLElement | null;
  if (element) detailInfo.appendChild(element);
}

function applyRelationshipModalProfileFetch(
  deps: ContactsViewDeps,
  blockedByMe: boolean,
  publicUser: any,
  blockedBy: boolean,
): void {
  const creditPanel = document.getElementById('contact-relationship-credit-panel');
  if (creditPanel) {
    creditPanel.innerHTML = `<div style="font-size:0.8em;color:var(--text-tertiary);">${deps.text('contactPublicCredit')}</div>${relationshipModalCreditInnerHtml(deps, publicUser, blockedBy)}`;
  }
  const wrap = document.getElementById('contact-block-status-wrap');
  const statusText = document.getElementById('contact-block-status-text');
  if (wrap && statusText) {
    if (blockedBy) {
      wrap.style.borderColor = 'var(--danger-border)';
      wrap.style.background = 'var(--danger-soft)';
      statusText.textContent = deps.text('contactBlockedBy');
    } else if (blockedByMe) {
      wrap.style.borderColor = 'var(--warning-border)';
      wrap.style.background = 'var(--warning-soft)';
      statusText.textContent = deps.text('contactBlockedByMe');
    } else {
      wrap.style.borderColor = 'var(--border)';
      wrap.style.background = 'var(--bg-subtle)';
      statusText.textContent = deps.text('contactNoBlock');
    }
  }
  if (blockedBy) {
    document.getElementById('contact-block-toggle-btn')?.style.setProperty('display', 'none');
    document.getElementById('contact-age-vouch-btn')?.style.setProperty('display', 'none');
    return;
  }
  const blockBtn = document.getElementById('contact-block-toggle-btn') as HTMLButtonElement | null;
  if (blockBtn) {
    blockBtn.style.removeProperty('display');
    blockBtn.textContent = deps.text(blockedByMe ? 'contactUnblockUser' : 'contactBlockUser');
  }
  const vouchBtn = document.getElementById('contact-age-vouch-btn') as HTMLButtonElement | null;
  if (vouchBtn) {
    if (blockedByMe) vouchBtn.style.setProperty('display', 'none');
    else vouchBtn.style.removeProperty('display');
  }
}

async function fetchContactBlockStatus(
  deps: ContactsViewDeps,
  userId: string,
): Promise<{ blocked: boolean; blockedBy: boolean }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ac = new AbortController();
    const timeoutId = window.setTimeout(() => ac.abort(), 2_500);
    try {
      const res = await fetch(
        `${deps.apiBase}/api/users/${encodeURIComponent(deps.currentUserId)}/block-status/${encodeURIComponent(userId)}`,
        { cache: 'no-store', signal: ac.signal },
      );
      if (res.ok) {
        const blockStatus = (await res.json()) as { blocked?: boolean; blockedBy?: boolean };
        return { blocked: !!blockStatus.blocked, blockedBy: !!blockStatus.blockedBy };
      }
    } catch {
      // retry below
    } finally {
      window.clearTimeout(timeoutId);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
  }
  return { blocked: deps.isBlockedByMe(userId), blockedBy: false };
}

export async function openRelationshipDialog(
  deps: ContactsViewDeps,
  userId: string,
  stageName: string,
): Promise<void> {
  if (userId === TECHSUPPORT_ROOT_USER_ID) {
    await openSupportControlsDialog(deps);
    return;
  }
  document.getElementById('broadcast-preamble-modal')?.remove();
  closeRelationshipModal();
  const known = deps.getKnownPerson(userId);
  let blockedByMe = deps.isBlockedByMe(userId);
  let blockedBy = false;
  const blockStatus = await Promise.race([
    fetchContactBlockStatus(deps, userId),
    new Promise<{ blocked: boolean; blockedBy: boolean }>((resolve) => {
      window.setTimeout(() => resolve({ blocked: blockedByMe, blockedBy: false }), 1_200);
    }),
  ]);
  blockedByMe = blockedByMe || blockStatus.blocked;
  blockedBy = blockStatus.blockedBy;

  const modal = document.createElement('div');
  modal.id = 'contact-relationship-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;z-index:6000;padding:20px;';
  modal.innerHTML = `
    <div style="width:min(640px, 96vw); max-height:90vh; overflow:auto; background:white; border-radius:16px; box-shadow:0 20px 60px rgba(15,23,42,0.2);">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid var(--border);">
        <div>
          <div style="font-weight:700; font-size:1.05em;">${deps.text('contactRelationshipCredit')}</div>
          <div style="font-size:0.88em; color:var(--text-tertiary);">${deps.escapeHtml(stageName)}</div>
        </div>
        <button type="button" id="close-contact-relationship-modal" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-tertiary);">&times;</button>
      </div>
      <div style="padding:18px; display:grid; gap:16px;">
        <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px;">
          <label style="display:flex; flex-direction:column; gap:6px; font-size:0.9em;">
            <span>${deps.text('relationship')}</span>
            <select id="contact-relationship-label" style="padding:10px;border:1px solid var(--border-strong);border-radius:10px;">
              ${['friend', 'relative', 'coworker', 'acquaintance', 'partner', 'custom']
                .map((label) => `<option value="${label}" ${(known?.label || '') === label ? 'selected' : ''}>${formatRelationshipLabel(label, deps)}</option>`)
                .join('')}
            </select>
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; font-size:0.9em;">
            <span>${deps.text('contactNickname')}</span>
            <input id="contact-relationship-nickname" type="text" value="${deps.escapeHtml(String(known?.nickname || ''))}" style="padding:10px;border:1px solid var(--border-strong);border-radius:10px;">
          </label>
        </div>
        <label style="display:flex; flex-direction:column; gap:6px; font-size:0.9em;">
          <span>${deps.text('contactCustomLabel')}</span>
          <input id="contact-relationship-custom-label" type="text" value="${deps.escapeHtml(String(known?.customLabel || ''))}" placeholder="${deps.text('contactCustomLabelHelp')}" style="padding:10px;border:1px solid var(--border-strong);border-radius:10px;">
        </label>
        <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px;">
          <label style="display:flex; flex-direction:column; gap:6px; font-size:0.9em;">
            <span>${deps.text('contactMyRating')}</span>
            <select id="contact-relationship-rating" style="padding:10px;border:1px solid var(--border-strong);border-radius:10px;">
              <option value="">${deps.text('contactNoRating')}</option>
              ${[1, 2, 3, 4, 5]
                .map((rating) => `<option value="${rating}" ${known?.rating === rating ? 'selected' : ''}>${rating} ${deps.text(rating === 1 ? 'contactStar' : 'contactStars')}</option>`)
                .join('')}
            </select>
          </label>
          <div id="contact-relationship-credit-panel" style="padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-subtle);">
            <div style="font-size:0.8em;color:var(--text-tertiary);">${deps.text('contactPublicCredit')}</div>
            <div style="margin-top:6px;color:var(--text-muted);">${deps.text('loading')}</div>
          </div>
        </div>
        <label style="display:flex; flex-direction:column; gap:6px; font-size:0.9em;">
          <span>${deps.text('contactNotes')}</span>
          <textarea id="contact-relationship-notes" rows="4" style="padding:10px;border:1px solid var(--border-strong);border-radius:10px;">${deps.escapeHtml(String(known?.notes || ''))}</textarea>
        </label>
        <div id="contact-block-status-wrap" style="padding:12px; border-radius:12px; border:1px solid ${blockedByMe ? 'var(--warning-border)' : 'var(--border)'}; background:${blockedByMe ? 'var(--warning-soft)' : 'var(--bg-subtle)'};">
          <div style="font-weight:700; color:var(--text-primary);">${deps.text('contactBlockStatus')}</div>
          <div id="contact-block-status-text" style="font-size:0.88em; color:var(--text-secondary); margin-top:4px;">
            ${deps.text(blockedByMe ? 'contactBlockedByMe' : 'contactNoBlock')}
          </div>
        </div>
      </div>
      <div style="display:flex; justify-content:space-between; gap:10px; padding:16px 18px; border-top:1px solid var(--border);">
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
    const nextBlocked = !deps.isBlockedByMe(userId);
    close();
    await deps.setBlocked(userId, nextBlocked);
    document.getElementById('broadcast-preamble-modal')?.remove();
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
    applyRelationshipModalProfileFetch(deps, blockedByMe, cached, blockedBy);
    return;
  }

  const profileUrl = `${deps.apiBase}/api/users/${encodeURIComponent(userId)}?viewerId=${encodeURIComponent(deps.currentUserId)}`;
  const ac = new AbortController();
  const timeoutId = window.setTimeout(() => ac.abort(), 12_000);
  let publicUser: any = null;
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

/** Monotonic render token: a re-render started later always wins over an older in-flight one. */
let contactsRenderSeq = 0;

/**
 * TODO §R1: separate, finer-grained token than `contactsRenderSeq` — `renderContactsListCore`
 * now runs twice per `displayContactsList` call (immediate + post-enrichment), so each call's
 * own deferred `renderListProgressively` remainder must only apply if THAT call is still the
 * latest one, not just the latest `displayContactsList` invocation. Without this, the first
 * call's remainder would still fire after the second call's synchronous re-render already
 * replaced the list, duplicating every row past the first chunk.
 */
let contactsCoreRenderSeq = 0;

/**
 * TODO §R1: renders whatever's already available locally, without waiting on
 * `beforeRender`'s enrichment chain. Called twice per `displayContactsList` invocation —
 * once immediately (so first paint never blocks on the prefetch chain), once again after
 * that chain resolves in the background (so newly-discovered contacts and
 * enriched badges/distance appear). Purely synchronous itself; row-level async patches
 * (rename self-heal, headshot fill) remain fire-and-forget, as before.
 */
function renderContactsListCore(deps: ContactsViewDeps, listEl: HTMLElement): void {
    const coreSeq = ++contactsCoreRenderSeq;
    // P0 step 5: peers derived from local stores only — no server call.
    const rawPeers = deriveLocalPeers({
      currentUserId: deps.currentUserId,
      conversations: deps.getMyConversations() || {},
      knownPeople: deps.getKnownPeople(),
    });
    // Apply getPeerName for resolved stage names (may read from Gun public profiles)
    const peers: PeerSummary[] = rawPeers.map((p) => ({
      ...p,
      stageName: deps.getPeerName(p.peerId, p.stageName),
    }));
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
    // Restore saved tab state only while a control still shows its markup default —
    // never clobber a live user selection (a slow in-flight render racing a fresh
    // change used to revert the select).
    if (controls.name && controls.name.value === '' && savedState.name) controls.name.value = savedState.name;
    if (controls.relation && controls.relation.value === 'all' && savedState.relation) controls.relation.value = savedState.relation;
    if (controls.sort && controls.sort.value === 'recent' && savedState.sort) controls.sort.value = savedState.sort;
    const persistControls = () => {
      localStorage.setItem('iinpublic_contacts_tab_state', JSON.stringify({
        name: controls.name?.value || '',
        relation: controls.relation?.value || 'all',
        sort: controls.sort?.value || 'recent',
        scrollTop: listEl.scrollTop || 0,
      }));
    };
    // Bind persistent listeners exactly once per control element ({ once: true }
    // re-arming dropped change events that fired while a render was in flight).
    for (const control of [controls.name, controls.relation, controls.sort]) {
      if (!control || control.dataset.contactsControlBound === '1') continue;
      control.dataset.contactsControlBound = '1';
      for (const eventName of ['input', 'change']) {
        control.addEventListener(eventName, () => {
          persistControls();
          void displayContactsList(deps);
        });
      }
    }

    const nameFilter = (controls.name?.value || '').trim().toLowerCase();
    const relationFilter = controls.relation?.value || 'all';
    const sortOrder = controls.sort?.value || 'recent';
    const supportNameMatches = !nameFilter || TECHSUPPORT_STAGE_NAME.toLowerCase().includes(nameFilter);
    const showSupportContact = deps.hasSupportContact() && relationFilter === 'all' && supportNameMatches;
    const tieBreak = (a: PeerSummary, b: PeerSummary): number =>
      deps.getPeerName(a.peerId, a.stageName).localeCompare(deps.getPeerName(b.peerId, b.stageName));
    const visiblePeers = peers
      .filter((peer) => {
        // Never show the current user as their own contact.
        if (!peer.peerId || peer.peerId === deps.currentUserId) return false;
        const known = knownMap.get(peer.peerId);
        const resolvedStageName = deps.getPeerName(peer.peerId, peer.stageName);
        const displayName = buildDisplayName(resolvedStageName, known).toLowerCase();
        const relationshipLabel = known?.label ? formatRelationshipLabel(known, deps).toLowerCase() : '';
        if (nameFilter && !`${displayName} ${relationshipLabel}`.includes(nameFilter)) return false;
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
        if (sortOrder === 'relationship') {
          const aRelationship = aKnown?.label ? formatRelationshipLabel(aKnown, deps) : deps.text('stranger');
          const bRelationship = bKnown?.label ? formatRelationshipLabel(bKnown, deps) : deps.text('stranger');
          const relationshipDiff = aRelationship.localeCompare(bRelationship);
          return relationshipDiff !== 0 ? relationshipDiff : tieBreak(a, b);
        }
        if (sortOrder === 'matches' && bMetrics.matchedTalks !== aMetrics.matchedTalks) return bMetrics.matchedTalks - aMetrics.matchedTalks;
        if (sortOrder === 'match-rate' && bMetrics.matchRate !== aMetrics.matchRate) return bMetrics.matchRate - aMetrics.matchRate;
        if (sortOrder === 'weighted' && bMetrics.relevance !== aMetrics.relevance) return bMetrics.relevance - aMetrics.relevance;
        if (sortOrder === 'talks' && b.stats.totalTalks !== a.stats.totalTalks) return b.stats.totalTalks - a.stats.totalTalks;
        if (sortOrder === 'distance') {
          const aDist = deps.distanceMiles?.(a.peerId);
          const bDist = deps.distanceMiles?.(b.peerId);
          if (aDist !== undefined && bDist !== undefined && aDist !== bDist) return aDist - bDist;
          if (aDist !== undefined && bDist === undefined) return -1;
          if (aDist === undefined && bDist !== undefined) return 1;
        }
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

    // One combined summary line instead of two (header count + a separate "Stats: ..."
    // row below) — same "merge the redundant top lines" move the Talks tab redesign made.
    deps.updateStatsStrip(formatCountText(deps, visiblePeers.length, 'contactsCountOne', 'contactsCount') + ' · ');

    const supportOnline = deps.isTechSupportOnline();
    // TODO §M5: compact to a single line — the "Built-in" badge already conveys what the old
    // dedicated "Built-in support contact" line said, so that line is dropped entirely rather
    // than merged; mute state becomes a small inline icon (full explanation still reachable via
    // openSupportControlsDialog, not lost) instead of its own full-sentence line.
    const supportMuted = deps.isSupportNotificationsMuted();
    const supportRow = showSupportContact
      ? `
          <div class="contact-item contact-support-item" data-support-contact="true" data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}" data-contact-name="${TECHSUPPORT_STAGE_NAME}" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; margin-bottom: 8px; background: var(--accent-soft); border-radius: 12px; border: 1px solid var(--accent-border); cursor: pointer;">
            <div style="min-width:0;">
              <div class="contact-item-name" style="font-weight:700;">${TECHSUPPORT_STAGE_NAME}<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent-hover);font-size:0.72em;font-weight:700;margin-left:8px;">${deps.text('contactsSupportPinned')}</span><span class="techsupport-presence-indicator ${supportOnline ? 'online' : 'away'}" data-techsupport-online="${supportOnline}" aria-label="${deps.text(supportOnline ? 'contactsSupportOnline' : 'contactsSupportAway')}"></span><span class="techsupport-mute-indicator" data-support-muted="${supportMuted}" aria-label="${deps.text(supportMuted ? 'contactSupportNotificationsMuted' : 'contactSupportNotificationsOn')}" style="margin-left:6px;font-size:0.85em;">${supportMuted ? '🔕' : '🔔'}</span></div>
            </div>
            <span style="color:var(--accent); flex-shrink:0;">›</span>
          </div>
        `
      : '';
    const renderContactRow = (peer: PeerSummary): string => {
      const known = knownMap.get(peer.peerId);
      const resolvedStageName = deps.getPeerName(peer.peerId, peer.stageName);
      const displayName = buildDisplayName(resolvedStageName, known);
      const metrics = rankingMetrics(peer, known, deps);
      const matchPercent = Math.round(metrics.matchRate * 100);
      const blockedBadge = deps.isBlockedByMe(peer.peerId)
        ? `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:var(--warning-soft);color:var(--warning-text);font-size:0.72em;font-weight:700;margin-left:8px;">${deps.text('contactsBlocked')}</span>`
        : '';
      const matchRateChip = `<div class="contact-item-match-rate" data-match-percent="${matchPercent}" data-matched-talks="${metrics.matchedTalks}" data-total-talks="${peer.stats.totalTalks}" style="font-size:0.8em;color:var(--accent);font-weight:700;margin-top:4px;">${deps.text('matchRate')}: ${matchPercent}% · ${formatText(deps, 'contactsMatchRateDetail', { matched: metrics.matchedTalks, total: peer.stats.totalTalks })}</div>`;
      const headshotHtml = avatarInnerHtml(deps.getCachedHeadshot?.(peer.peerId) ?? undefined, '?', deps.escapeHtml);
      // Relationship is stated once — buildMetaLine's own trailing segment — not repeated
      // on the second meta line, which now only carries the sent/received counts.
      return `
          <div class="contact-item" data-contact-user-id="${deps.escapeHtml(peer.peerId)}" data-contact-name="${deps.escapeHtml(resolvedStageName)}" data-match-percent="${matchPercent}" data-matched-talks="${metrics.matchedTalks}" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; margin-bottom: 8px; background: white; border-radius: 12px; border: 1px solid var(--border); cursor: pointer;">
            <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1;">
              <span class="contact-item-avatar" style="width:40px;height:40px;border-radius:50%;background:var(--bg-muted);display:flex;align-items:center;justify-content:center;font-size:1.2em;flex-shrink:0;overflow:hidden;">${headshotHtml}</span>
              <div style="min-width: 0;">
                <div class="contact-item-name" style="font-weight: 700; text-decoration: underline; text-decoration-color: var(--border-strong); text-underline-offset: 3px; display: inline-block; cursor: pointer;" title="${deps.escapeHtml(deps.text('contactsOpenDm'))}">${deps.escapeHtml(displayName)}</div>${blockedBadge}
                <div class="contact-item-meta" style="font-size: 0.85em; color: #666; margin-top: 4px;">${deps.escapeHtml(buildMetaLine(peer, known, deps))}</div>
                <div class="contact-item-meta" style="font-size: 0.8em; color: var(--text-muted); margin-top: 4px;">${deps.text('sent')} ${peer.stats.sent.talks} · ${deps.text('received')} ${peer.stats.received.talks}</div>
                ${sortOrder === 'match-rate' ? matchRateChip : ''}
                ${sortOrder === 'weighted' ? `<div class="contact-item-rank" title="${deps.escapeHtml(metrics.explanation)}" style="font-size:0.8em;color:var(--text-secondary);margin-top:4px;">${deps.text('relevanceScore')}: ${metrics.relevance} · ${deps.escapeHtml(metrics.explanation)}</div>` : ''}
              </div>
            </div>
            <span style="color: #999; flex-shrink: 0;">›</span>
          </div>
        `;
    };

    // TODO §R1: first CONTACTS_FIRST_CHUNK_SIZE rows render synchronously (right now,
    // whatever this call's data already is); the rest — which, on the very first call of
    // a tab visit, is most of a 500-contact list — renders quietly a moment later, off the
    // blocking render path. Never touches the support row or already-rendered first-chunk
    // nodes when it does.
    renderListProgressively(listEl, visiblePeers, {
      firstChunkSize: CONTACTS_FIRST_CHUNK_SIZE,
      prefixHtml: supportRow,
      renderRow: renderContactRow,
      isStale: () => coreSeq !== contactsCoreRenderSeq,
    });

    // Delegated click handling (bound once, survives every re-render/re-chunk): a row
    // rendered into the deferred remainder is clickable the instant it lands in the DOM,
    // with no per-row listener to (re-)attach. `deps` is stashed on the element and read
    // at click time rather than closed over at bind time — `renderContactsListCore` runs
    // twice per `displayContactsList` call (and again on every subsequent re-render), each
    // with its own freshly-built `deps`, and the bind-once guard means only the FIRST
    // call's listener closure would ever fire without this indirection.
    (listEl as unknown as { __contactsDeps?: ContactsViewDeps }).__contactsDeps = deps;
    if (listEl.dataset.contactsClickBound !== '1') {
      listEl.dataset.contactsClickBound = '1';
      listEl.addEventListener('click', (event) => {
        const currentDeps = (listEl as unknown as { __contactsDeps?: ContactsViewDeps }).__contactsDeps;
        if (!currentDeps) return;
        const target = event.target as HTMLElement;
        const row = target.closest('.contact-item') as HTMLElement | null;
        const userId = row?.dataset.contactUserId;
        const stageName = row?.dataset.contactName;
        if (!userId || !stageName) return;
        // Tapping the name specifically (Rule N2a) jumps straight to the DM Conversation
        // with the shared User layout underneath — same destination as a chatroom member
        // click. Tapping the row anywhere else opens that same User-layout detail view
        // without also opening the conversation, so browsing contacts doesn't force a DM
        // open on every tap.
        if (target.closest('.contact-item-name')) {
          currentDeps.openPeerDetail(userId, stageName);
        } else {
          currentDeps.openPeerDetailOnly(userId, stageName);
        }
      });
    }

    // Render-time self-heal: rows carry the best locally-known name, which can be stale if
    // it was captured (exchange/conversation record) before the peer renamed. Look up each
    // peer's CURRENT stage name and patch the row in place — the resolver also refreshes the
    // peer-name cache and stored conversation records, so the next render starts correct.
    if (deps.resolvePeerStageName) {
      for (const peer of peers) {
        if (peer.peerId === TECHSUPPORT_ROOT_USER_ID) continue;
        void deps.resolvePeerStageName(peer.peerId).then((liveName) => {
          if (!liveName || liveName === peer.stageName) return;
          const row = listEl.querySelector(
            `.contact-item[data-contact-user-id="${(window.CSS?.escape ?? ((v: string) => v))(peer.peerId)}"]`,
          ) as HTMLElement | null;
          if (!row) return;
          row.dataset.contactName = liveName;
          const nameEl = row.querySelector('.contact-item-name');
          if (nameEl) {
            const known = deps.getKnownPerson(peer.peerId);
            const display = buildDisplayName(liveName, known);
            for (const child of Array.from(nameEl.childNodes)) {
              if (child.nodeType === Node.TEXT_NODE) {
                child.nodeValue = display;
                return;
              }
            }
            nameEl.insertBefore(document.createTextNode(display), nameEl.firstChild);
          }
        });
      }
    }

    // TODO §M6: non-blocking headshot fill-in — cache lives in ui-manager.ts (peerHeadshotCache),
    // so this only re-fetches peers not already cached from a prior render (no re-fetch on
    // re-sort/filter). Patches the row's avatar in place rather than re-rendering the list.
    if (deps.resolvePeerHeadshot) {
      for (const peer of peers) {
        if (peer.peerId === TECHSUPPORT_ROOT_USER_ID) continue;
        if (deps.getCachedHeadshot?.(peer.peerId)) continue;
        void deps.resolvePeerHeadshot(peer.peerId).then((headshot) => {
          if (!headshot) return;
          const row = listEl.querySelector(
            `.contact-item[data-contact-user-id="${(window.CSS?.escape ?? ((v: string) => v))(peer.peerId)}"]`,
          ) as HTMLElement | null;
          const avatarEl = row?.querySelector('.contact-item-avatar');
          if (avatarEl) avatarEl.innerHTML = avatarInnerHtml(headshot, '?', deps.escapeHtml);
        });
      }
    }
    window.setTimeout(() => {
      if (typeof savedState.scrollTop === 'number') listEl.scrollTop = savedState.scrollTop;
    }, 0);
    if (listEl.dataset.contactsScrollBound !== '1') {
      listEl.dataset.contactsScrollBound = '1';
      listEl.addEventListener('scroll', persistControls, { passive: true });
    }
}

/**
 * TODO §R1: renders immediately from whatever's already available locally — never
 * blocks first paint on `beforeRender`'s enrichment chain (mesh exchange sync + location
 * prefetch, up to ~3.2s worst case) — then re-renders in the background once that chain
 * resolves, so newly-discovered contacts and enriched badges/distance appear without a
 * second blocking wait. `contactsRenderSeq` lets a newer render (e.g. a fast sort change
 * right after the tab opens) win over a stale enrichment re-render, same guard the
 * function already relied on before this split.
 */
export async function displayContactsList(deps: ContactsViewDeps): Promise<void> {
  const renderSeq = ++contactsRenderSeq;
  const listEl = document.getElementById('contacts-list');
  if (!listEl) return;

  if (!deps.apiBase || !deps.currentUserId) {
    listEl.innerHTML = `<p style="text-align: center; padding: 40px 20px; color: #999;">${deps.text('contactsUnavailable')}</p>`;
    return;
  }

  try {
    renderContactsListCore(deps, listEl);
  } catch {
    listEl.innerHTML = `<p style="text-align: center; padding: 40px 20px; color: #c00;">${deps.text('contactsUnavailable')}</p>`;
    return;
  }

  try {
    await runBeforeRender(deps);
  } catch {
    return;
  }
  // A newer render started while we awaited — let it win (its control values are fresher).
  if (renderSeq !== contactsRenderSeq) return;
  try {
    renderContactsListCore(deps, listEl);
  } catch {
    // The first-chunk render above already succeeded; leave it up rather than replacing
    // working content with an error from the enrichment-driven re-render.
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
  // Roster-first sync resolve (getPeerName) so a live room member's current name wins
  // immediately. Then keep polling the public record for a few seconds: under parallel-worker
  // load every individual lookup (API overlay, gun replication, roster heartbeat) can be
  // transiently stale, and a single-shot refresh froze whichever stale answer it happened to
  // get. The poll stops as soon as a lookup returns something different from the initially
  // recorded name (a rename that propagated), or after the budget expires.
  const syncResolved = deps.getPeerName(otherUserId, otherUserName);
  detailName.textContent = syncResolved;
  if (deps.resolvePeerStageName) {
    const resolveLive = deps.resolvePeerStageName;
    void (async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const liveName = await resolveLive(otherUserId).catch(() => null);
        // Re-query each pass: roster updates re-render the contacts pane, replacing the
        // node captured above — a stale reference would silently end the poll early.
        const nameEl = document.getElementById('contact-detail-name');
        if (!nameEl) return;
        if (liveName && nameEl.textContent !== liveName) {
          nameEl.textContent = liveName;
        }
        if (liveName && liveName !== syncResolved) return; // rename observed — done
        await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 1_000));
      }
    })();
  }
  detailMatches.textContent = deps.text('loading');
  talksList.innerHTML = `<p style="text-align: center; padding: 20px; color: #999;">${deps.text('loading')}</p>`;
  const detailInfo = document.getElementById('contact-detail-info');
  document.getElementById('contact-edit-relationship-btn')?.remove();
  if (detailInfo) {
    detailInfo.querySelector('.contact-public-profile-summary')?.remove();
    detailInfo.querySelector('.contact-context-summary')?.remove();
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
  renderContactContextSummaryInto(detailInfo, deps, otherUserId, null, deps.isBlockedByMe(otherUserId), false);

  // P0 step 5: history and stats rendered entirely from local stores — no server calls.
  const renderLocalTalkHistory = (history: ReturnType<typeof localTalkHistoryForPeer>, publicUser: unknown): void => {
    const totalTalks = history.length;
    detailMatches.textContent = formatCountText(deps, totalTalks, 'contactsTalkCountOne', 'contactsTalkCount');
    if (detailInfo) {
      detailInfo.querySelector('.contact-public-profile-summary')?.remove();
      const summary = document.createElement('div');
      summary.className = 'contact-public-profile-summary';
      summary.innerHTML = renderPublicProfileSummary(deps, publicUser);
      detailInfo.appendChild(summary);
    }
    if (history.length === 0) {
      talksList.innerHTML = `<p style="text-align: center; padding: 20px; color: #999;">${deps.text('contactNoTalks')}</p>`;
      return;
    }
    const myTalks = deps.getMyTalks();
    talksList.innerHTML = history
      .map((item) => {
        const localTalk = item.talkId ? myTalks[item.talkId] : null;
        const title = String(localTalk?.title || localTalk?.fullTalk?.title || item.title || deps.text('contactTalkFallback')).trim();
        return `
          <div class="contact-talk-item" data-talk-id="${deps.escapeHtml(String(item.talkId || ''))}" style="padding: 14px 16px; margin-bottom: 8px; background: var(--bg-subtle); border-radius: 10px; border: 1px solid var(--border);">
            <div style="font-weight: 600;">${deps.escapeHtml(title)}</div>
            <div style="font-size: 0.85em; color: #666; margin-top: 4px;">${deps.escapeHtml(String(item.direction || ''))} · ${deps.escapeHtml(String(item.outcome || 'pending'))}</div>
          </div>
        `;
      })
      .join('');
  };

  // Derive history from local stores only
  const history = localTalkHistoryForPeer(
    otherUserId,
    deps.getMyConversations() || {},
    deps.getMyTalks(),
    deps.text('contactTalkFallback'),
  );

  // Fetch public profile from Gun (local Gun cache — no REST endpoint)
  const publicUser = await readPublicProfileFoundation(deps, otherUserId);
  contactDetailUserProfileCache = { userId: otherUserId, publicUser };

  renderLocalTalkHistory(history, publicUser);
  renderContactContextSummaryInto(
    detailInfo,
    deps,
    otherUserId,
    publicUser,
    deps.isBlockedByMe(otherUserId),
    false,
  );
}
