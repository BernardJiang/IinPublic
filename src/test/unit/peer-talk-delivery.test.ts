import {
  DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS,
  planIncomingTalkClusterPrune,
  type IncomingTalkClusterWire,
} from '../../shared/peer-talk-delivery';

/**
 * docs/TODO.md §Y2 — incoming-talk-cluster retention, mirroring §L2's
 * `planVisitCounterPrune` for a different unbounded-growth Gun path
 * (`ownerIncomingTalkIndex/<userId>/<identityKey>`).
 */

function clusterOf(identityKey: string, updatedAt: string): IncomingTalkClusterWire {
  return {
    identityKey,
    title: `Talk ${identityKey}`,
    type: 'flow',
    language: 'en',
    senders: {},
    talkIds: {},
    questionCount: 0,
    latestTalkId: `talk_${identityKey}`,
    updatedAt,
    identityAliases: { [identityKey]: true },
  };
}

describe('planIncomingTalkClusterPrune', () => {
  function clustersOf(n: number, startHour = 0): IncomingTalkClusterWire[] {
    const clusters: IncomingTalkClusterWire[] = [];
    for (let i = 0; i < n; i++) {
      const ts = `2026-07-25T${String(startHour + i).padStart(2, '0')}:00:00.000Z`;
      clusters.push(clusterOf(`ik_${i}`, ts));
    }
    return clusters;
  }

  it('prunes nothing while at or under the threshold', () => {
    expect(planIncomingTalkClusterPrune(clustersOf(3), 3).clustersToPrune).toEqual([]);
    expect(planIncomingTalkClusterPrune(clustersOf(2), 3).clustersToPrune).toEqual([]);
    expect(planIncomingTalkClusterPrune([], 3).clustersToPrune).toEqual([]);
  });

  it('prunes exactly the excess, oldest updatedAt first', () => {
    // ik_0..ik_4 have updatedAt hours 0..4 respectively (oldest = ik_0).
    const clusters = clustersOf(5);
    const plan = planIncomingTalkClusterPrune(clusters, 3);
    expect(plan.clustersToPrune.map((c) => c.identityKey)).toEqual(['ik_0', 'ik_1']);
  });

  it('defaults to DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS when maxSlots is omitted', () => {
    expect(planIncomingTalkClusterPrune(clustersOf(DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS)).clustersToPrune).toEqual([]);
    const overLimit = clustersOf(DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS + 1);
    const plan = planIncomingTalkClusterPrune(overLimit);
    expect(plan.clustersToPrune).toHaveLength(1);
    expect(plan.clustersToPrune[0].identityKey).toBe('ik_0');
  });

  it('is stable when several clusters share the same updatedAt', () => {
    const clusters = [
      clusterOf('a', '2026-07-25T10:00:00.000Z'),
      clusterOf('b', '2026-07-25T10:00:00.000Z'),
      clusterOf('c', '2026-07-25T10:00:00.000Z'),
    ];
    const plan = planIncomingTalkClusterPrune(clusters, 2);
    expect(plan.clustersToPrune).toHaveLength(1);
    expect(['a', 'b', 'c']).toContain(plan.clustersToPrune[0].identityKey);
  });
});
