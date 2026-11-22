/** @jest-environment jsdom */
/**
 * Talks redraw cost on a slow phone (C10, 2026-11-22): My Talks and the person↔tag graph were
 * copied and rebuilt once per row. They are now built once per change, and never served stale.
 */
import { getMyTalks, readMyTalks, setMyTalks, getMyTalk } from '../../web/ui/my-talks-storage';
import { resetGraphTabSnapshotForTests, setGraphTabSnapshot } from '../../web/services/graph-tab-projection';
import { configureTagGraphSource, currentTagGraph } from '../../web/ui/graph-focus';

const entry = (talkId: string, title: string) => ({ talkId, title, type: 'tag', timestamp: '2026-11-22T00:00:00.000Z', role: 'copied' as const });

afterEach(() => {
  setMyTalks({});
  resetGraphTabSnapshotForTests();
  localStorage.clear();
});

describe('readMyTalks', () => {
  it('returns the same map until My Talks or the graph snapshot changes', () => {
    setMyTalks({ a: entry('a', 'A') });
    const first = readMyTalks();
    expect(readMyTalks()).toBe(first);
    expect(getMyTalk('a')?.title).toBe('A');

    setMyTalks({ a: entry('a', 'A'), b: entry('b', 'B') });
    expect(readMyTalks()).not.toBe(first);
    expect(Object.keys(readMyTalks()).sort()).toEqual(['a', 'b']);

    const beforeSnapshot = readMyTalks();
    setGraphTabSnapshot({
      generatedAt: 1,
      talks: [{ talkId: 'g', versionId: 'g', versionHistory: ['g'], talk: { title: 'From graph', type: 'tag', active: true, questions: [] } }],
      conversations: [], people: [], nearbyScopes: [],
    } as any);
    expect(readMyTalks()).not.toBe(beforeSnapshot);
    expect(getMyTalk('g')?.title).toBe('From graph');
  });

  it('getMyTalks still hands out a copy the caller may change', () => {
    setMyTalks({ a: entry('a', 'A') });
    const copy = getMyTalks();
    copy.a!.title = 'changed';
    expect(readMyTalks().a!.title).toBe('A');
  });
});

describe('currentTagGraph', () => {
  it('is rebuilt only when its input key changes', () => {
    let builds = 0;
    let version = 1;
    configureTagGraphSource(() => {
      builds++;
      return { currentUserId: 'me', incoming: [], myTalks: {}, exchanges: [] } as any;
    }, () => ['me', version]);
    const first = currentTagGraph();
    expect(currentTagGraph()).toBe(first);
    expect(builds).toBe(1);
    version = 2;
    expect(currentTagGraph()).not.toBe(first);
    expect(builds).toBe(2);
  });

  it('without a key it is built on every call, as before', () => {
    let builds = 0;
    configureTagGraphSource(() => {
      builds++;
      return { currentUserId: 'me', incoming: [], myTalks: {}, exchanges: [] } as any;
    });
    currentTagGraph();
    currentTagGraph();
    expect(builds).toBe(2);
  });
});
