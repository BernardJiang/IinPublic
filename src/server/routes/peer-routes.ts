import type express from 'express';
import type { TalkResponse } from '../../shared/talk-stats';

export type PeerRelationshipStats = {
  sent: { talks: number; matches: number };
  received: { talks: number; matches: number };
  mutualMatchedTalks: number;
  mutualTagCount: number;
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

export function registerPeerRoutes(app: express.Application, deps: PeerRouteDeps): void {
  const { incomingTalksMap, talkResponsesMap } = deps;

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

    const peerIncoming = incomingTalksMap.get(peerId);
    const sentClusters = peerIncoming
      ? uniqueClusters(peerIncoming).filter((c) => hasSender(c, userId))
      : [];

    const myIncoming = incomingTalksMap.get(userId);
    const receivedClusters = myIncoming
      ? uniqueClusters(myIncoming).filter((c) => hasSender(c, peerId))
      : [];

    let sentMatches = 0;
    for (const cluster of sentClusters) {
      for (const talkId of talkIdsFromCluster(cluster)) {
        const responses = talkResponsesMap.get(talkId) ?? [];
        if (responses.some((r) => r.responderId === peerId && r.outcome === 'match')) {
          sentMatches++;
          break;
        }
      }
    }

    let receivedMatches = 0;
    for (const cluster of receivedClusters) {
      for (const talkId of talkIdsFromCluster(cluster)) {
        const responses = talkResponsesMap.get(talkId) ?? [];
        if (responses.some((r) => r.responderId === userId && r.outcome === 'match')) {
          receivedMatches++;
          break;
        }
      }
    }

    // Mutual matched talks: talkIds where both users appear as respondents with outcome=match
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
      const hasUserMatch = responses.some((r) => r.responderId === userId && r.outcome === 'match' && r.talkType === 'tag');
      const hasPeerMatch = responses.some((r) => r.responderId === peerId && r.outcome === 'match' && r.talkType === 'tag');
      if (hasUserMatch && hasPeerMatch) mutualTagCount++;
    }

    const result: PeerRelationshipStats = {
      sent: { talks: sentClusters.length, matches: sentMatches },
      received: { talks: receivedClusters.length, matches: receivedMatches },
      mutualMatchedTalks,
      mutualTagCount,
    };
    res.json(result);
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
    const peerIncoming = incomingTalksMap.get(peerId);
    if (peerIncoming) {
      for (const cluster of uniqueClusters(peerIncoming)) {
        if (!hasSender(cluster, userId)) continue;
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
    }

    // Talks peer sent to me
    const myIncoming = incomingTalksMap.get(userId);
    if (myIncoming) {
      for (const cluster of uniqueClusters(myIncoming)) {
        if (!hasSender(cluster, peerId)) continue;
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
    }

    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    res.json(items);
  });
}
