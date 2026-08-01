import { KnownPerson } from './types';

/**
 * docs/TODO.md §U — broadcast to a named contact group. v1-simplest (Bernard, 2026-08-01,
 * deferred pending confirmation of overlap need): each `KnownPerson` already carries exactly
 * one group — its `RelationshipLabel`, or the literal `customLabel` text when the label is
 * `'custom'`. No new data model, no group-membership editor — "Tennis Buddy" falls out of the
 * existing `customLabel` field for free by treating each distinct value in use as its own
 * selectable group. A contact belongs to exactly one group this way (matching `KnownPerson`'s
 * single-valued `label` field); a person can't yet be in two named groups at once — if that's
 * ever needed, it's a real data-model change, not a v1 concern.
 */

const CUSTOM_GROUP_PREFIX = 'custom:';

/** `'all'`, a `RelationshipLabel` value, or `custom:<the literal customLabel text>`. */
export type ContactGroupId = string;

export type ContactGroupOption = {
  id: ContactGroupId;
  /** For built-in labels this is the raw label id (translate at render time); for a custom group it's the literal `customLabel` text the user typed. */
  displayLabel: string;
  memberCount: number;
};

/** The group a contact belongs to, or null if it's a `custom` label with no text (nothing to group by). */
function groupIdForPerson(person: KnownPerson): ContactGroupId | null {
  if (person.label === 'custom') {
    const text = (person.customLabel || '').trim();
    return text ? `${CUSTOM_GROUP_PREFIX}${text}` : null;
  }
  return person.label || null;
}

/**
 * Every selectable group, `'all'` first, then every built-in `RelationshipLabel` and custom
 * label actually in use — ordered by member count descending (biggest group first, matching
 * this codebase's own "the first row is the thing worth acting on" convention elsewhere, e.g.
 * `graph-size-report.ts`'s categories).
 */
export function listContactGroups(knownPeople: KnownPerson[]): ContactGroupOption[] {
  const counts = new Map<ContactGroupId, number>();
  const displayLabels = new Map<ContactGroupId, string>();
  for (const person of knownPeople) {
    const groupId = groupIdForPerson(person);
    if (!groupId) continue;
    counts.set(groupId, (counts.get(groupId) || 0) + 1);
    if (!displayLabels.has(groupId)) {
      displayLabels.set(
        groupId,
        groupId.startsWith(CUSTOM_GROUP_PREFIX) ? groupId.slice(CUSTOM_GROUP_PREFIX.length) : groupId,
      );
    }
  }
  const groups: ContactGroupOption[] = [{ id: 'all', displayLabel: 'all', memberCount: knownPeople.length }];
  const rest = Array.from(counts.entries())
    .map(([id, memberCount]) => ({ id, displayLabel: displayLabels.get(id)!, memberCount }))
    .sort((a, b) => b.memberCount - a.memberCount);
  return [...groups, ...rest];
}

/**
 * Resolve a group to a de-duplicated userId list, client-side only — group membership is
 * private (`KnownPerson` lives under `putPrivateUserData`, per CLAUDE.md's invariant), so the
 * server and other users never see it, same as today's contact labels. Blocked users are
 * excluded even from `'all'` — blocking should obviously still apply to a group broadcast.
 */
export function resolveContactGroupUserIds(
  knownPeople: KnownPerson[],
  groupId: ContactGroupId,
  blockedUserIds: string[] = [],
): string[] {
  const blocked = new Set(blockedUserIds);
  const members = groupId === 'all' ? knownPeople : knownPeople.filter((person) => groupIdForPerson(person) === groupId);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const person of members) {
    if (!person.userId || blocked.has(person.userId) || seen.has(person.userId)) continue;
    seen.add(person.userId);
    result.push(person.userId);
  }
  return result;
}
