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

export const CORE_PROTOCOL_VERSION = 1;

export type CoreRequest =
  | { name: 'exchanges.snapshot' }
  | { name: 'exchanges.upsert'; records: ExchangeRecord[] }
  | { name: 'exchanges.removePeers'; peerIds: string[] }
  | { name: 'delivery.putSentResponse'; payload: P2PMeshTalkResponsePayload }
  | { name: 'delivery.record'; input: DeliveryInput }
  | { name: 'delivery.get'; objectId: string; recipientId: string };

export type CoreResponse<R extends CoreRequest> =
  R extends { name: 'exchanges.snapshot' } ? ExchangeRecord[]
    : R extends { name: 'exchanges.upsert' } ? { written: number }
      : R extends { name: 'exchanges.removePeers' } ? { removed: number }
        : R extends { name: 'delivery.get' } ? DeliveryJournalRecord | null
          : R extends { name: 'delivery.putSentResponse' | 'delivery.record' } ? { ok: true }
            : never;
