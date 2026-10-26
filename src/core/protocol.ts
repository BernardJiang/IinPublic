/**
 * The device core's protocol (docs/design/device-core-architecture.md, OPEN-91): one schema the GUI
 * and the core speak, over `postMessage` to the web worker today and over a loopback WebSocket to
 * the native host later. The GUI never touches Gun; it sends commands and keeps an in-memory view.
 *
 * Framing on the worker link reuses `GunBridge`'s `{ id, type, payload }` envelope: a core command
 * is `type: 'core'` with a `CoreRequest` payload, answered by `{ id, err, data }`.
 */
import type { ExchangeRecord } from './exchanges';

export const CORE_PROTOCOL_VERSION = 1;

export type CoreRequest =
  | { name: 'exchanges.snapshot' }
  | { name: 'exchanges.upsert'; records: ExchangeRecord[] }
  | { name: 'exchanges.removePeers'; peerIds: string[] };

export type CoreResponse<R extends CoreRequest> =
  R extends { name: 'exchanges.snapshot' } ? ExchangeRecord[]
    : R extends { name: 'exchanges.upsert' } ? { written: number }
      : R extends { name: 'exchanges.removePeers' } ? { removed: number }
        : never;
