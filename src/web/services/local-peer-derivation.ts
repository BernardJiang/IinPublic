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
  return core.deriveLocalPeers({ ...opts, exchanges: readExchanges() });
}

export function localTalkHistoryForPeer(
  peerId: string,
  conversations: Record<string, any>,
  myTalks: Record<string, any>,
  fallbackTalkTitle: string,
): LocalTalkHistoryItem[] {
  return core.localTalkHistoryForPeer(peerId, conversations, myTalks, fallbackTalkTitle, readExchanges());
}

export function deriveLocalCreatorReplies(currentUserId: string): LocalCreatorReplyRow[] {
  return core.deriveLocalCreatorReplies(currentUserId, readExchanges());
}
