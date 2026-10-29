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
  | { name: 'private.get'; key: string }
  | { name: 'private.put'; key: string; value: string | null }
  | { name: 'private.keys' }
  | { name: 'device.get'; path: string }
  | { name: 'device.put'; path: string; value: unknown };

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
                          : never;
