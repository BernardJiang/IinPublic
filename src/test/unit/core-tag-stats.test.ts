import { buildTagGraph } from '../../core/tag-graph';
import { personSimilarity, tagPopularity } from '../../core/tag-stats';

const tag = (id: string, title: string) => ({ id, type: 'tag', title, questions: [{ id: 'q_0', text: title, answers: [{ id: 'q_0_match', text: title, isMatch: true }] }] });
const exchange = (peerId: string, talkId: string, title: string, outcome: 'match' | 'mismatch') =>
  ({ peerId, peerName: peerId, talkId, type: 'tag', title, outcome });

// I like Hiking and Coffee. Ann likes Hiking and Coffee; Ben likes Hiking, passes Coffee, likes Chess;
// Cy likes Chess only.
const graph = buildTagGraph({
  currentUserId: 'me',
  myTalks: {
    hike: { role: 'created', likesTag: true, fullTalk: tag('hike', 'Hiking') },
    coffee: { role: 'created', likesTag: true, disabled: true, fullTalk: tag('coffee', 'Coffee') },
  },
  incoming: [],
  exchanges: {
    a1: exchange('ann', 'hike', 'Hiking', 'match'),
    a2: exchange('ann', 'coffee', 'Coffee', 'match'),
    b1: exchange('ben', 'hike', 'Hiking', 'match'),
    b2: exchange('ben', 'coffee', 'Coffee', 'mismatch'),
    b3: exchange('ben', 'chess', 'Chess', 'match'),
    c1: exchange('cy', 'chess', 'Chess', 'match'),
  },
});

describe('live tag statistics (OPEN-113)', () => {
  it('ranks tags by likes and counts passes', () => {
    const byLabel = new Map([...tagPopularity(graph)].map(([node, stats]) => [node.label, stats]));
    expect(byLabel.get('Hiking')).toEqual({ likes: 2, passes: 0, rank: 1 });
    expect(byLabel.get('Chess')).toEqual({ likes: 2, passes: 0, rank: 1 });
    expect(byLabel.get('Coffee')).toEqual({ likes: 1, passes: 1, rank: 3 });
  });

  it('a private tag I like still counts as mine', () => {
    expect([...graph.tags.values()].find((node) => node.label === 'Coffee')?.mine).toBe(true);
  });

  it('ranks people by how alike we are; someone sharing no tag has no rank', () => {
    const similarity = personSimilarity(graph);
    expect(similarity.get('ann')).toEqual({ shared: 2, score: 1, rank: 1 });
    expect(similarity.get('ben')).toMatchObject({ shared: 1, rank: 2 });
    expect(similarity.get('ben')!.score).toBeCloseTo(1 / 3);
    expect(similarity.get('cy')).toEqual({ shared: 0, score: 0, rank: 0 });
  });

  it('a later like replaces an earlier pass from the same person', () => {
    const again = buildTagGraph({
      currentUserId: 'me', myTalks: {}, incoming: [],
      exchanges: { x: exchange('ben', 'tea', 'Tea', 'mismatch'), y: exchange('ben', 'tea', 'Tea', 'match') },
    });
    const node = [...again.tags.values()][0]!;
    expect([node.likers.size, node.passers.size]).toEqual([1, 0]);
  });
});
