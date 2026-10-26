/** Storage-independent view contract for the GUI. Counts are distinct matched Talks per peer. */
export type MapMatchUpdate = {
  type: 'snapshot' | 'patch';
  /** A snapshot replaces the view. In patches, zero/null removes that peer's badge. */
  counts: Readonly<Record<string, number | null>>;
};

/** The device core supplies the initial Gun-backed snapshot, then committed view patches. */
export type MapMatchSource = {
  subscribe: (onUpdate: (update: MapMatchUpdate) => void) => () => void;
};

/** Accepted domain outcome, independent of any on-disk exchange record representation. */
export type MapMatchExchange = {
  peerId: string;
  talkId: string;
  direction: 'sent' | 'received';
  outcome: 'match' | 'mismatch' | 'ignore';
  revision?: number;
};

/** Pure projection usable in the core; neither the map nor this reducer reads browser storage. */
export function mapMatchCounts(exchanges: Iterable<MapMatchExchange>): Map<string, number> {
  const talks = new Map<string, Set<string>>();
  for (const exchange of exchanges) {
    if (!exchange.peerId || !exchange.talkId || exchange.outcome !== 'match') continue;
    const ids = talks.get(exchange.peerId) ?? new Set<string>();
    ids.add(exchange.talkId);
    talks.set(exchange.peerId, ids);
  }
  return new Map([...talks].map(([peer, ids]) => [peer, ids.size]));
}
