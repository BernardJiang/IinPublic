import type { KnownPerson } from '../../shared/types';
import { avatarInnerHtml } from './profile-avatar';
import type { UiTranslationKey } from './ui-translations';

/**
 * One person row, the same on Contacts and in the Nearby list: avatar, name with the online dot,
 * then at most two lines — the meta line (relationship · matches · talks · ↑sent ↓received) and the
 * tags-in-common chip. Each tab keeps its own classes and data attributes (its click handlers,
 * tests and effects use them); the look comes from `.person-row` in main.css.
 */
export type PersonRowStats = {
  totalTalks: number;
  matches: number;
  sent: number;
  received: number;
};

export type PersonRowText = {
  stranger: string;
  sent: string;
  received: string;
  /** '{count} talk' / '{count} talks' and the same for matches. */
  talkOne: string;
  talkMany: string;
  matchOne: string;
  matchMany: string;
  online: string;
  away: string;
};

export type PersonRowInput = {
  kind: 'contact' | 'nearby';
  userId: string;
  displayName: string;
  headshot?: string | null;
  online: boolean;
  /** Relationship label text ("Friend"); a stranger when absent. */
  relationship?: string;
  stats?: PersonRowStats | null;
  /** Already-escaped HTML appended to the meta line (a sort's own figure). */
  metaExtraHtml?: string;
  /** Already-escaped HTML for the second line (the tags-in-common chip), or ''. */
  chipHtml?: string;
  /** Already-escaped HTML after the name (Blocked badge). */
  nameBadgesHtml?: string;
  /** Already-escaped HTML over the avatar's corner (Traveler ✈). */
  avatarBadgeHtml?: string;
  /** Already-escaped HTML before the › (pin badge). */
  trailingHtml?: string;
  /** Extra classes and attributes for the row element. */
  rowClass: string;
  rowAttrs: string;
  /** Contacts: the name is its own tap target (opens the DM). */
  nameTitle?: string;
  text: PersonRowText;
  escapeHtml: (value: string) => string;
};

const count = (value: number, one: string, many: string): string =>
  (value === 1 ? one : many).replace('{count}', String(value));

/** "Friend · 16 matches · 16 talks · ↑14 ↓16": most important first; the arrows are spelled out in the title. */
export function personMetaLineHtml(input: Pick<PersonRowInput, 'relationship' | 'stats' | 'text' | 'escapeHtml'>): string {
  const { text, escapeHtml } = input;
  const parts = [escapeHtml(input.relationship || text.stranger)];
  const stats = input.stats;
  if (stats && stats.totalTalks + stats.sent + stats.received > 0) {
    parts.push(escapeHtml(count(stats.matches, text.matchOne, text.matchMany)));
    parts.push(escapeHtml(count(stats.totalTalks, text.talkOne, text.talkMany)));
    const traffic = `${text.sent} ${stats.sent} · ${text.received} ${stats.received}`;
    parts.push(`<span class="person-row-traffic contact-item-traffic" data-sent="${stats.sent}" data-received="${stats.received}" title="${escapeHtml(traffic)}" aria-label="${escapeHtml(traffic)}">↑${stats.sent} ↓${stats.received}</span>`);
  }
  return parts.join(' · ');
}

export function personRowHtml(input: PersonRowInput): string {
  const { escapeHtml, text } = input;
  const contact = input.kind === 'contact';
  const initial = (input.displayName.trim().charAt(0) || '?').toUpperCase();
  const presence = `<span class="presence-indicator ${input.online ? 'online' : 'away'}" data-user-id="${escapeHtml(input.userId)}" aria-label="${input.online ? text.online : text.away}"></span>`;
  const nameClass = contact ? 'person-row-name person-row-name-dm contact-item-name' : 'person-row-name chatroom-member-name';
  const metaClass = contact ? 'person-row-meta contact-item-meta' : 'person-row-meta chatroom-member-status';
  const avatarClass = contact ? 'person-row-avatar contact-item-avatar' : 'person-row-avatar chatroom-member-avatar';
  return `
    <div class="person-row ${input.rowClass}" ${input.rowAttrs}>
      <div class="person-row-avatar-wrap">
        <span class="${avatarClass}">${avatarInnerHtml(input.headshot ?? undefined, initial, escapeHtml)}</span>${input.avatarBadgeHtml ?? ''}
      </div>
      <div class="person-row-info">
        <div class="person-row-title"><span class="${nameClass}"${input.nameTitle ? ` title="${escapeHtml(input.nameTitle)}"` : ''}>${escapeHtml(input.displayName)}</span>${presence}${input.nameBadgesHtml ?? ''}</div>
        <div class="${metaClass}">${personMetaLineHtml(input)}${input.metaExtraHtml ?? ''}</div>
        ${input.chipHtml ?? ''}
      </div>
      ${input.trailingHtml ?? ''}
      <span class="person-row-arrow" aria-hidden="true">›</span>
    </div>`;
}

/** The relationship label for a person row: "Friend", "Friend, Coworker"; undefined for a stranger. */
export function relationshipLabelOf(known: KnownPerson | undefined, format: (known: KnownPerson) => string): string | undefined {
  return known?.labels?.length ? format(known) : undefined;
}

/** The row's words from the UI translations (Contacts and Nearby pass their own `text`). */
export function personRowText(t: (key: UiTranslationKey) => string): PersonRowText {
  return {
    stranger: t('stranger'),
    sent: t('sent'),
    received: t('received'),
    talkOne: t('contactsTalkCountOne'),
    talkMany: t('contactsTalkCount'),
    matchOne: t('contactsMatchCountOne'),
    matchMany: t('contactsMatchCount'),
    online: t('presenceOnline'),
    away: t('presenceAway'),
  };
}
