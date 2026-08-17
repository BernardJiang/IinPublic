import { KnownPerson } from './types';

/**
 * docs/TODO.md §U — broadcast to a named contact group. `KnownPerson.labels` can hold more than
 * one `RelationshipLabel` at once (e.g. both `'friend'` and `'coworker'`), plus the literal
 * `customLabel` text when `'custom'` is one of those labels — so a contact can belong to
 * multiple groups simultaneously and shows up under every one of them here.
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

/** Every group this contact belongs to (can be more than one, or none if `custom` has no text). */
function groupIdsForPerson(person: KnownPerson): ContactGroupId[] {
  const ids: ContactGroupId[] = [];
  for (const label of person.labels || []) {
    if (label === 'custom') {
      const text = (person.customLabel || '').trim();
      if (text) ids.push(`${CUSTOM_GROUP_PREFIX}${text}`);
    } else if (label) {
      ids.push(label);
    }
  }
  return ids;
}

/**
 * Every selectable group, `'all'` first, then every built-in `RelationshipLabel` and custom
 * label actually in use — ordered by member count descending (biggest group first, matching
 * this codebase's own "the first row is the thing worth acting on" convention elsewhere, e.g.
 * `graph-size-report.ts`'s categories). A contact in multiple groups is counted in each.
 */
export function listContactGroups(knownPeople: KnownPerson[]): ContactGroupOption[] {
  const counts = new Map<ContactGroupId, number>();
  const displayLabels = new Map<ContactGroupId, string>();
  for (const person of knownPeople) {
    for (const groupId of groupIdsForPerson(person)) {
      counts.set(groupId, (counts.get(groupId) || 0) + 1);
      if (!displayLabels.has(groupId)) {
        displayLabels.set(
          groupId,
          groupId.startsWith(CUSTOM_GROUP_PREFIX) ? groupId.slice(CUSTOM_GROUP_PREFIX.length) : groupId,
        );
      }
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
 * excluded even from `'all'` — blocking should obviously still apply to a group broadcast. A
 * contact in multiple groups (e.g. friend + coworker) is reachable via either group id.
 */
export function resolveContactGroupUserIds(
  knownPeople: KnownPerson[],
  groupId: ContactGroupId,
  blockedUserIds: string[] = [],
): string[] {
  const blocked = new Set(blockedUserIds);
  const members = groupId === 'all' ? knownPeople : knownPeople.filter((person) => groupIdsForPerson(person).includes(groupId));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const person of members) {
    if (!person.userId || blocked.has(person.userId) || seen.has(person.userId)) continue;
    seen.add(person.userId);
    result.push(person.userId);
  }
  return result;
}
