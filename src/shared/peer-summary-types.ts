/**
 * Shared peer relationship types used by the web UI and local derivation.
 * Moved here from src/server/routes/peer-routes.ts in P0 step 7 when the
 * server-side peer routes were deleted.
 */

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
