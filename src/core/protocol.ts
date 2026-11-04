/**
 * The device core's protocol (docs/design/device-core-architecture.md, OPEN-91): one schema the GUI
 * and the core speak, over `postMessage` to the web worker today and over a loopback WebSocket to
 * the native host later. The GUI never touches Gun; it sends commands and keeps an in-memory view.
 *
 * Framing on the worker link reuses `GunBridge`'s `{ id, type, payload }` envelope: a core command
 * is `type: 'core'` with a `CoreRequest` payload, answered by `{ id, err, data }`.
 */
import type { P2PMeshTalkResponsePayload } from '../shared/p2p-mesh-protocol';
import type { DeliveryInput, DeliveryJournalRecord } from './delivery';
import type { ExchangeRecord } from './exchanges';

import type { LedgerCommand, LedgerCommandResult } from './talk-ledger-store';

import type { OwnTalksStatus } from './device-graph/sync/own-talks';
import type { IncomingTalkClusterWire } from '../shared/peer-talk-delivery';
import type { MyTalksBodiesStatus } from './device-graph/sync/my-talks-bodies';
import type { GraphHostRequest, GraphHostStatus, GraphPull } from './device-graph/sync/graph-host';
import type { AppAnswerRecord } from './device-graph/sync/app-answers';
import type { AppChatbotAnswer } from './device-graph/sync/app-chatbot';
import type { ChatbotView, RememberedAnswer } from './device-graph/answers';

export const CORE_PROTOCOL_VERSION = 1;

export type CoreRequest =
  | LedgerCommand
  | { name: 'exchanges.snapshot' }
  | { name: 'exchanges.upsert'; records: ExchangeRecord[] }
  | { name: 'exchanges.removePeers'; peerIds: string[] }
  | { name: 'delivery.putSentResponse'; payload: P2PMeshTalkResponsePayload }
  | { name: 'delivery.record'; input: DeliveryInput }
  | { name: 'delivery.get'; objectId: string; recipientId: string }
  | { name: 'collection.snapshot'; collection: string }
  | { name: 'collection.upsert'; collection: string; entries: Record<string, unknown> }
  | { name: 'collection.remove'; collection: string; keys: string[] }
  /** Erase the retired collections (the old chatbot's copies, OPEN-106 step 2e v). */
  | { name: 'collection.eraseRetired' }
  | { name: 'private.get'; key: string }
  | { name: 'private.put'; key: string; value: string | null }
  | { name: 'private.keys' }
  | { name: 'device.get'; path: string }
  | { name: 'device.put'; path: string; value: unknown }
  | { name: 'deviceGraph.status' }
  | GraphHostRequest
  /** `talk`: the body the app is sending, written as my Talk when the core has no record of it. */
  | { name: 'graph.offer'; talkId: string; recipients: string[]; context?: Record<string, unknown>; talk?: Record<string, unknown> }
  | { name: 'graph.retract'; talkId: string }
  | { name: 'graph.answerHistory'; months?: number }
  /** The app accepted a Talk that arrived over a graph link: it goes on the incoming list. */
  | { name: 'graph.acceptArrival'; talkId: string; from: string; senderName: string; omit?: string[] }
  /** The incoming list, built from graph arrivals. */
  | { name: 'graph.incoming' }
  /** A Talk's body from the graph: mine (by the app's id) or one I received. */
  | { name: 'graph.talkBody'; talkId: string }
  /** A new Talk id from the graph (an event id of this device), for a Talk about to be saved. */
  | { name: 'graph.newTalkId' }
  /** The chatbot's lookups for a Talk (the answer dialog resolves its questions from them). */
  | { name: 'graph.chatbotView'; talk: Record<string, unknown>; mine?: boolean; locationConsent?: boolean }
  /** What the chatbot answers for a Talk by itself; whether it is a tag I passed; answered already. */
  | { name: 'graph.chatbot'; talk: Record<string, unknown>; talkId?: string; mine?: boolean; locationConsent?: boolean }
  /** I passed a one-keyword tag (the chatbot passes it again), or take that back. */
  | { name: 'graph.pass'; talk: Record<string, unknown>; passed: boolean }
  /** My Pair-tag side and source Talk for my latest answer to a question with this text. */
  | { name: 'graph.questionMemory'; text: string; language?: string }
  /** What the chatbot remembers (the Preferences dialog). */
  | { name: 'graph.remembered' }
  /** Change one remembered answer, or forget it; `key: '*'` with `forget` forgets everything. */
  | { name: 'graph.changeRemembered'; key: string; change: { reuse?: 'auto' | 'once' } | { answerText: string } | { forget: true } };

export type CoreResponse<R extends CoreRequest> =
  R extends LedgerCommand ? LedgerCommandResult
    : R extends { name: 'exchanges.snapshot' } ? ExchangeRecord[]
    : R extends { name: 'exchanges.upsert' } ? { written: number }
      : R extends { name: 'exchanges.removePeers' } ? { removed: number }
        : R extends { name: 'delivery.get' } ? DeliveryJournalRecord | null
          : R extends { name: 'delivery.putSentResponse' | 'delivery.record' } ? { ok: true }
            : R extends { name: 'collection.snapshot' } ? Record<string, unknown>
              : R extends { name: 'collection.upsert' } ? { written: number }
                : R extends { name: 'collection.remove' } ? { removed: number }
                  : R extends { name: 'private.get' } ? string | null
                    : R extends { name: 'private.keys' } ? string[]
                      : R extends { name: 'device.get' } ? unknown
                        : R extends { name: 'private.put' | 'device.put' } ? { ok: true }
                          : R extends { name: 'deviceGraph.status' } ? (OwnTalksStatus & { enabled: boolean; bodies?: MyTalksBodiesStatus }) | null
                          : R extends { name: 'graph.pull' } ? GraphPull
                          : R extends { name: 'graph.status' } ? GraphHostStatus
                          : R extends { name: 'graph.identity' | 'graph.open' | 'graph.close' | 'graph.hear' } ? { ok: true }
                          : R extends { name: 'graph.offer' } ? { offered: number; known: boolean }
                          : R extends { name: 'graph.answer' } ? { sent: boolean; eventId?: string }
                          : R extends { name: 'graph.retract' } ? { sent: number }
                          : R extends { name: 'graph.answerHistory' } ? AppAnswerRecord[]
                          : R extends { name: 'graph.newTalkId' } ? string | null
                          : R extends { name: 'graph.acceptArrival' } ? { ok: boolean }
                          : R extends { name: 'graph.incoming' } ? IncomingTalkClusterWire[]
                          : R extends { name: 'graph.talkBody' } ? Record<string, unknown> | null
                          : R extends { name: 'graph.chatbotView' } ? ChatbotView | null
                          : R extends { name: 'graph.chatbot' } ? { answers: AppChatbotAnswer[] | null; passed: boolean; answered: boolean }
                          : R extends { name: 'graph.pass' } ? { ok: boolean }
                          : R extends { name: 'collection.eraseRetired' } ? { erased: number }
                          : R extends { name: 'graph.questionMemory' } ? { selfTag?: string; sourceTalkId?: string }
                          : R extends { name: 'graph.remembered' } ? RememberedAnswer[]
                          : R extends { name: 'graph.changeRemembered' } ? { ok: boolean }
                            : never;
