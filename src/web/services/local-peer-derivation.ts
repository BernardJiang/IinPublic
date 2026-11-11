/**
 * The GUI's entry to peer derivation (OPEN-91 P4): the pure functions live in the device core
 * (`src/core/peer-derivation.ts`) and take the exchange log as an argument; these pass the GUI's
 * view of it (`exchange-view.ts`) when the caller does not.
 */
import type { KnownPerson } from '../../shared/types';
import type { PeerRelationshipStats, PeerSummary } from '../../shared/peer-summary-types';
import * as core from '../../core/peer-derivation';
import type { LocalCreatorReplyRow, LocalTalkExchange, LocalTalkHistoryItem } from '../../core/peer-derivation';
import { readExchanges } from './exchange-view';
import { graphContactPeers, graphPersonHistory } from './graph-tab-projection';

export {
  buildAllLocalTalkResponses,
  buildTalkResponsesFromExchanges,
  computeMatchPercent,
  mergePeerSummaryLists,
  peersFromKnownPeople,
  peersFromLocalConversations,
} from '../../core/peer-derivation';
export type { LocalCreatorReplyRow, LocalTalkExchange, LocalTalkHistoryItem } from '../../core/peer-derivation';

/** Every exchange record: the GUI's in-memory view of the device core's exchange log. */
export function readLocalTalkExchanges(): LocalTalkExchange[] {
  return readExchanges();
}

export function exchangeStatsFor(peerId: string, exchanges: LocalTalkExchange[] = readExchanges()): PeerRelationshipStats {
  return core.exchangeStatsFor(peerId, exchanges);
}

export function peersFromLocalTalkExchanges(currentUserId: string): PeerSummary[] {
  return core.peersFromLocalTalkExchanges(currentUserId, readExchanges());
}

export function deriveLocalPeers(opts: { currentUserId: string; conversations: Record<string, any>; knownPeople: KnownPerson[] }): PeerSummary[] {
  const graphPeers = graphContactPeers().filter((peer) => peer.peerId !== opts.currentUserId);
  const transitional = core.deriveLocalPeers({ ...opts, exchanges: readExchanges() });
  return core.mergePeerSummaryLists(graphPeers, transitional);
}

export function localTalkHistoryForPeer(
  peerId: string,
  conversations: Record<string, any>,
  myTalks: Record<string, any>,
  fallbackTalkTitle: string,
): LocalTalkHistoryItem[] {
  const transitional = core.localTalkHistoryForPeer(peerId, conversations, myTalks, fallbackTalkTitle, readExchanges());
  const byTalk = new Map(transitional.map((row) => [row.talkId, row]));
  for (const event of graphPersonHistory(peerId)) {
    if (!event.talkId || byTalk.has(event.talkId)) continue;
    const local = myTalks[event.talkId];
    byTalk.set(event.talkId, {
      talkId: event.talkId,
      title: String(local?.title || local?.fullTalk?.title || fallbackTalkTitle),
      direction: event.kind === 'arrival' || event.withUserId === peerId ? 'received' : 'sent',
      outcome: event.kind === 'answer' ? 'match' : 'pending',
      date: new Date(event.when || 0).toISOString(),
    });
  }
  return [...byTalk.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export function deriveLocalCreatorReplies(currentUserId: string): LocalCreatorReplyRow[] {
  return core.deriveLocalCreatorReplies(currentUserId, readExchanges());
}
