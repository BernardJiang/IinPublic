import { listContactGroups, resolveContactGroupUserIds } from '../../shared/contact-groups';
import type { KnownPerson } from '../../shared/types';

/** docs/TODO.md §U — broadcast to a contact group, v1-simplest (bucket by label/customLabel). */

function person(overrides: Partial<KnownPerson> & { userId: string }): KnownPerson {
  return {
    label: 'friend',
    addedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('listContactGroups', () => {
  it('always includes "all" first, with the full contact count', () => {
    const groups = listContactGroups([person({ userId: 'u1' }), person({ userId: 'u2', label: 'coworker' })]);
    expect(groups[0]).toEqual({ id: 'all', displayLabel: 'all', memberCount: 2 });
  });

  it('lists each built-in RelationshipLabel actually in use', () => {
    const groups = listContactGroups([
      person({ userId: 'u1', label: 'friend' }),
      person({ userId: 'u2', label: 'friend' }),
      person({ userId: 'u3', label: 'coworker' }),
    ]);
    const friend = groups.find((g) => g.id === 'friend');
    const coworker = groups.find((g) => g.id === 'coworker');
    expect(friend).toEqual({ id: 'friend', displayLabel: 'friend', memberCount: 2 });
    expect(coworker).toEqual({ id: 'coworker', displayLabel: 'coworker', memberCount: 1 });
  });

  it('treats each distinct customLabel text as its own group — "Tennis Buddy" needs no schema change', () => {
    const groups = listContactGroups([
      person({ userId: 'u1', label: 'custom', customLabel: 'Tennis Buddy' }),
      person({ userId: 'u2', label: 'custom', customLabel: 'Tennis Buddy' }),
      person({ userId: 'u3', label: 'custom', customLabel: 'Book Club' }),
    ]);
    expect(groups.find((g) => g.id === 'custom:Tennis Buddy')).toEqual({
      id: 'custom:Tennis Buddy',
      displayLabel: 'Tennis Buddy',
      memberCount: 2,
    });
    expect(groups.find((g) => g.id === 'custom:Book Club')?.memberCount).toBe(1);
  });

  it('excludes a custom label with no text — nothing to group by', () => {
    const groups = listContactGroups([person({ userId: 'u1', label: 'custom', customLabel: '  ' })]);
    expect(groups.filter((g) => g.id !== 'all')).toHaveLength(0);
    // Still counted under "all" though.
    expect(groups[0].memberCount).toBe(1);
  });

  it('sorts non-"all" groups by member count descending', () => {
    const groups = listContactGroups([
      person({ userId: 'u1', label: 'coworker' }),
      person({ userId: 'u2', label: 'friend' }),
      person({ userId: 'u3', label: 'friend' }),
      person({ userId: 'u4', label: 'friend' }),
    ]);
    const nonAll = groups.filter((g) => g.id !== 'all');
    expect(nonAll[0].id).toBe('friend');
    expect(nonAll[0].memberCount).toBe(3);
  });

  it('returns just "all" with zero members for an empty contact list', () => {
    expect(listContactGroups([])).toEqual([{ id: 'all', displayLabel: 'all', memberCount: 0 }]);
  });
});

describe('resolveContactGroupUserIds', () => {
  it('"all" resolves to every known contact', () => {
    const ids = resolveContactGroupUserIds(
      [person({ userId: 'u1' }), person({ userId: 'u2', label: 'coworker' })],
      'all',
    );
    expect(ids.sort()).toEqual(['u1', 'u2']);
  });

  it('a built-in label resolves only to contacts with that exact label', () => {
    const ids = resolveContactGroupUserIds(
      [person({ userId: 'u1', label: 'friend' }), person({ userId: 'u2', label: 'coworker' })],
      'friend',
    );
    expect(ids).toEqual(['u1']);
  });

  it('a custom group resolves only to contacts with that exact customLabel text', () => {
    const ids = resolveContactGroupUserIds(
      [
        person({ userId: 'u1', label: 'custom', customLabel: 'Tennis Buddy' }),
        person({ userId: 'u2', label: 'custom', customLabel: 'Book Club' }),
      ],
      'custom:Tennis Buddy',
    );
    expect(ids).toEqual(['u1']);
  });

  it('excludes blocked users, even from "all"', () => {
    const ids = resolveContactGroupUserIds(
      [person({ userId: 'u1' }), person({ userId: 'u2' })],
      'all',
      ['u2'],
    );
    expect(ids).toEqual(['u1']);
  });

  it('de-duplicates userIds (defensive, in case of a malformed duplicate entry)', () => {
    const ids = resolveContactGroupUserIds(
      [person({ userId: 'u1' }), person({ userId: 'u1' })],
      'all',
    );
    expect(ids).toEqual(['u1']);
  });

  it('skips entries with a missing userId', () => {
    const ids = resolveContactGroupUserIds([person({ userId: '' })], 'all');
    expect(ids).toEqual([]);
  });

  it('returns an empty list for a group with no members', () => {
    expect(resolveContactGroupUserIds([person({ userId: 'u1', label: 'friend' })], 'coworker')).toEqual([]);
  });
});
