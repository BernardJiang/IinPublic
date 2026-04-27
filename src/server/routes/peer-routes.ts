import type express from 'express';
import type { TalkResponse } from '../../shared/talk-stats';

export type PeerRelationshipStats = {
  sent: { talks: number; matches: number };
  received: { talks: number; matches: number };
  mutualMatchedTalks: number;
  mutualTagCount: number;
  totalTalks: number;
};

export type PeerSummary = {
  peerId: string;
  stageName: string;
  lastInteractionAt: string | null;
  stats: PeerRelationshipStats;
};

export type TalkHistoryItem = {
  talkId: string;
  identityKey: string;
  title: string;
  type: string;
  direction: 'sent' | 'received';
  outcome: 'match' | 'mismatch' | 'pending';
  date: string;
};

type PeerRouteDeps = {
  incomingTalksMap: Map<string, Map<string, any>>;
  talkResponsesMap: Map<string, TalkResponse[]>;
  getUserStageName: (userId: string, fallbackName?: string) => Promise<string>;
};

/** Deduplicate clusters — the map may alias the same object under multiple keys. */
function uniqueClusters(userMap: Map<string, any>): any[] {
  const seen = new Set<any>();
  const result: any[] = [];
  for (const cluster of userMap.values()) {
    if (!seen.has(cluster)) {
      seen.add(cluster);
      result.push(cluster);
    }
  }
  return result;
}

function hasSender(cluster: any, senderId: string): boolean {
  if (!cluster?.senders || typeof cluster.senders !== 'object') return false;
  return senderId in cluster.senders;
}

function talkIdsFromCluster(cluster: any): string[] {
  const ids: string[] = [];
  if (cluster?.latestTalkId) ids.push(cluster.latestTalkId);
  if (cluster?.talkIds && typeof cluster.talkIds === 'object') {
    for (const id of Object.keys(cluster.talkIds)) {
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function outcomeForCluster(
  cluster: any,
  responderId: string,
  talkResponsesMap: Map<string, TalkResponse[]>,
): 'match' | 'mismatch' | 'pending' {
  for (const talkId of talkIdsFromCluster(cluster)) {
    const responses = talkResponsesMap.get(talkId) ?? [];
    const resp = responses.find((r) => r.responderId === responderId);
    if (resp) return resp.outcome === 'match' ? 'match' : 'mismatch';
  }
  return 'pending';
}

function getSentClusters(
  incomingTalksMap: Map<string, Map<string, any>>,
  userId: string,
  peerId: string,
): any[] {
  const peerIncoming = incomingTalksMap.get(peerId);
  return peerIncoming ? uniqueClusters(peerIncoming).filter((c) => hasSender(c, userId)) : [];
}

function getReceivedClusters(
  incomingTalksMap: Map<string, Map<string, any>>,
  userId: string,
  peerId: string,
): any[] {
  const myIncoming = incomingTalksMap.get(userId);
  return myIncoming ? uniqueClusters(myIncoming).filter((c) => hasSender(c, peerId)) : [];
}

function countMatchesForResponder(
  clusters: any[],
  responderId: string,
  talkResponsesMap: Map<string, TalkResponse[]>,
): number {
  let matches = 0;
  for (const cluster of clusters) {
    for (const talkId of talkIdsFromCluster(cluster)) {
      const responses = talkResponsesMap.get(talkId) ?? [];
      if (responses.some((r) => r.responderId === responderId && r.outcome === 'match')) {
        matches++;
        break;
      }
    }
  }
  return matches;
}

function computeRelationshipStats(
  incomingTalksMap: Map<string, Map<string, any>>,
  talkResponsesMap: Map<string, TalkResponse[]>,
  userId: string,
  peerId: string,
): PeerRelationshipStats {
  const sentClusters = getSentClusters(incomingTalksMap, userId, peerId);
  const receivedClusters = getReceivedClusters(incomingTalksMap, userId, peerId);

  const sentMatches = countMatchesForResponder(sentClusters, peerId, talkResponsesMap);
  const receivedMatches = countMatchesForResponder(receivedClusters, userId, talkResponsesMap);

  const userMatchSet = new Set<string>();
  for (const [talkId, responses] of talkResponsesMap) {
    if (responses.some((r) => r.responderId === userId && r.outcome === 'match')) {
      userMatchSet.add(talkId);
    }
  }

  let mutualMatchedTalks = 0;
  for (const [talkId, responses] of talkResponsesMap) {
    if (
      userMatchSet.has(talkId) &&
      responses.some((r) => r.responderId === peerId && r.outcome === 'match')
    ) {
      mutualMatchedTalks++;
    }
  }

  let mutualTagCount = 0;
  for (const [, responses] of talkResponsesMap) {
    const hasUserMatch = responses.some(
      (r) => r.responderId === userId && r.outcome === 'match' && r.talkType === 'tag',
    );
    const hasPeerMatch = responses.some(
      (r) => r.responderId === peerId && r.outcome === 'match' && r.talkType === 'tag',
    );
    if (hasUserMatch && hasPeerMatch) mutualTagCount++;
  }

  return {
    sent: { talks: sentClusters.length, matches: sentMatches },
    received: { talks: receivedClusters.length, matches: receivedMatches },
    mutualMatchedTalks,
    mutualTagCount,
    totalTalks: sentClusters.length + receivedClusters.length,
  };
}

function computeLastInteractionAt(
  incomingTalksMap: Map<string, Map<string, any>>,
  userId: string,
  peerId: string,
): string | null {
  const clusters = [
    ...getSentClusters(incomingTalksMap, userId, peerId),
    ...getReceivedClusters(incomingTalksMap, userId, peerId),
  ];
  let latest = 0;
  for (const cluster of clusters) {
    const ts = new Date(cluster?.updatedAt || 0).getTime();
    if (ts > latest) latest = ts;
  }
  return latest > 0 ? new Date(latest).toISOString() : null;
}

export function registerPeerRoutes(app: express.Application, deps: PeerRouteDeps): void {
  const { incomingTalksMap, talkResponsesMap, getUserStageName } = deps;

  app.get('/api/users/:userId/peers', async (req, res) => {
    const { userId } = req.params;
    if (!userId) {
      res.status(400).json({ error: 'userId required' });
      return;
    }

    const peerIds = new Set<string>();

    const myIncoming = incomingTalksMap.get(userId);
    if (myIncoming) {
      for (const cluster of uniqueClusters(myIncoming)) {
        const senders = cluster?.senders && typeof cluster.senders === 'object' ? cluster.senders : {};
        for (const senderId of Object.keys(senders)) {
          if (senderId && senderId !== userId) peerIds.add(senderId);
        }
      }
    }

    for (const [receiverId, userMap] of incomingTalksMap.entries()) {
      if (!receiverId || receiverId === userId) continue;
      for (const cluster of uniqueClusters(userMap)) {
        if (hasSender(cluster, userId)) {
          peerIds.add(receiverId);
          break;
        }
      }
    }

    const summaries: PeerSummary[] = await Promise.all(
      Array.from(peerIds).map(async (peerId) => ({
        peerId,
        stageName: await getUserStageName(peerId, 'Unknown'),
        lastInteractionAt: computeLastInteractionAt(incomingTalksMap, userId, peerId),
        stats: computeRelationshipStats(incomingTalksMap, talkResponsesMap, userId, peerId),
      })),
    );

    summaries.sort((a, b) => {
      const timeDiff =
        new Date(b.lastInteractionAt || 0).getTime() - new Date(a.lastInteractionAt || 0).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.stats.totalTalks - a.stats.totalTalks;
    });

    res.json(summaries);
  });

  /**
   * GET /api/users/:userId/peers/:peerId/relationship
   * Returns interaction stats between two users derived from server-side in-memory state.
   */
  app.get('/api/users/:userId/peers/:peerId/relationship', (req, res) => {
    const { userId, peerId } = req.params;
    if (!userId || !peerId) {
      res.status(400).json({ error: 'userId and peerId required' });
      return;
    }

    res.json(computeRelationshipStats(incomingTalksMap, talkResponsesMap, userId, peerId));
  });

  /**
   * GET /api/users/:userId/peers/:peerId/talk-history
   * Returns talks exchanged between two users with direction and outcome, sorted newest first.
   */
  app.get('/api/users/:userId/peers/:peerId/talk-history', (req, res) => {
    const { userId, peerId } = req.params;
    if (!userId || !peerId) {
      res.status(400).json({ error: 'userId and peerId required' });
      return;
    }

    const items: TalkHistoryItem[] = [];

    // Talks I sent to peer
    for (const cluster of getSentClusters(incomingTalksMap, userId, peerId)) {
        items.push({
          talkId: cluster.latestTalkId || cluster.identityKey || '',
          identityKey: cluster.identityKey || cluster.latestTalkId || '',
          title: cluster.title || 'Untitled Talk',
          type: cluster.type || 'flow',
          direction: 'sent',
          outcome: outcomeForCluster(cluster, peerId, talkResponsesMap),
          date: cluster.updatedAt || new Date().toISOString(),
        });
    }

    // Talks peer sent to me
    for (const cluster of getReceivedClusters(incomingTalksMap, userId, peerId)) {
        items.push({
          talkId: cluster.latestTalkId || cluster.identityKey || '',
          identityKey: cluster.identityKey || cluster.latestTalkId || '',
          title: cluster.title || 'Untitled Talk',
          type: cluster.type || 'flow',
          direction: 'received',
          outcome: outcomeForCluster(cluster, userId, talkResponsesMap),
          date: cluster.updatedAt || new Date().toISOString(),
        });
    }

    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    res.json(items);
  });
}
