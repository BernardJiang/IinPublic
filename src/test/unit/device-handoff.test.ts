import {
  buildHandoffArchive,
  mergeHandoffArchive,
  HANDOFF_ARCHIVE_VERSION,
  HANDOFF_CATEGORIES,
} from '../../shared/device-handoff';

describe('buildHandoffArchive', () => {
  it('packages only the provided categories', () => {
    const a = buildHandoffArchive({
      fromPub: 'pubX',
      now: 123,
      profile: { stageName: 'Pat' },
      contacts: [{ id: 'c1', name: 'A' }],
    });
    expect(a.version).toBe(HANDOFF_ARCHIVE_VERSION);
    expect(a.fromPub).toBe('pubX');
    expect(a.createdAt).toBe(123);
    expect(a.profile).toEqual({ stageName: 'Pat' });
    expect(a.contacts).toHaveLength(1);
    expect(a.myTalks).toBeUndefined();
    expect(a.conversations).toBeUndefined();
  });

  it('exposes the six sync categories', () => {
    expect(HANDOFF_CATEGORIES).toEqual([
      'profile',
      'contacts',
      'talkFilters',
      'answerPreferences',
      'myTalks',
      'conversations',
    ]);
  });
});

describe('mergeHandoffArchive', () => {
  it('unions contacts by id with local winning on conflict', () => {
    const archive = buildHandoffArchive({
      fromPub: 'p',
      contacts: [
        { id: 'c1', name: 'FromArchive' },
        { id: 'c2', name: 'OnlyArchive' },
      ],
    });
    const merged = mergeHandoffArchive(archive, {
      contacts: [{ id: 'c1', name: 'LocalWins' }, { id: 'c3', name: 'OnlyLocal' }],
    });
    const byId = Object.fromEntries(merged.contacts.map((c) => [c.id, c.name]));
    expect(byId).toEqual({ c1: 'LocalWins', c2: 'OnlyArchive', c3: 'OnlyLocal' });
  });

  it('unions dirtyWords lists across talkFilters, local scalars win', () => {
    const archive = buildHandoffArchive({
      fromPub: 'p',
      talkFilters: { blockDirtyWords: false, dirtyWords: ['fuck', 'archiveword'] },
    });
    const merged = mergeHandoffArchive(archive, {
      talkFilters: { blockDirtyWords: true, dirtyWords: ['fuck', 'localword'] },
    });
    expect(merged.talkFilters?.blockDirtyWords).toBe(true); // local wins
    expect([...(merged.talkFilters?.dirtyWords ?? [])].sort()).toEqual(['archiveword', 'fuck', 'localword']);
  });

  it('merges myTalks and answerPreferences by key (local wins)', () => {
    const archive = buildHandoffArchive({
      fromPub: 'p',
      myTalks: { t1: { role: 'created' }, t2: { role: 'known' } },
      answerPreferences: { q1: 'archive' },
    });
    const merged = mergeHandoffArchive(archive, {
      myTalks: { t1: { role: 'local' } },
      answerPreferences: { q1: 'local', q2: 'localonly' },
    });
    expect((merged.myTalks.t1 as any).role).toBe('local');
    expect((merged.myTalks.t2 as any).role).toBe('known');
    expect(merged.answerPreferences).toEqual({ q1: 'local', q2: 'localonly' });
  });

  it('imports conversations as a read-only archive, never merged live', () => {
    const archive = buildHandoffArchive({
      fromPub: 'p',
      conversations: { conv1: { messages: [] } },
    });
    const merged = mergeHandoffArchive(archive, {});
    expect(merged.readOnlyConversations).toEqual({ conv1: { messages: [] } });
  });

  it('handles an empty local target', () => {
    const archive = buildHandoffArchive({ fromPub: 'p', contacts: [{ id: 'c1' }] });
    const merged = mergeHandoffArchive(archive);
    expect(merged.contacts).toHaveLength(1);
    expect(merged.readOnlyConversations).toEqual({});
  });
});
