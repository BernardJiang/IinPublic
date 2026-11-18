/**
 * The device core hosted by the app's own embedded node (OPEN-91 P5), reached over loopback from
 * the WebView with the shell's per-install secret. Used when the shell provides that secret and the
 * node answers; otherwise the GUI keeps the web worker's core (browsers, iOS for now).
 *
 * The secret comes only from the shell — Android's `IinPublicBackground.localNodeToken()`, the
 * desktop preload's `iinpublicNative.localNodeToken()` — never from the page the node serves,
 * which any app on the device could fetch. `__IINPUBLIC_LOCAL_NODE_TOKEN__` is for e2e harnesses.
 */
import { CORE_COLLECTIONS } from '../../core/collections';
import type { CoreRequest } from '../../core/protocol';
import { DeviceChannel, DeviceChannelUnavailable, coreLane } from './device-channel';

export type CoreRequester = (request: CoreRequest) => Promise<any>;

async function shellToken(): Promise<string | null> {
  const page = (typeof window === 'undefined' ? {} : window) as any;
  const candidates = [
    () => page.__IINPUBLIC_LOCAL_NODE_TOKEN__,
    () => page.IinPublicBackground?.localNodeToken?.(),
    () => page.iinpublicNative?.localNodeToken?.(),
  ];
  for (const read of candidates) {
    try {
      const token = await read();
      if (typeof token === 'string' && token.length >= 32) return token;
    } catch {
      // This shell does not offer it.
    }
  }
  return null;
}

export type NativeNode = { token: string; baseUrl: string; core: CoreRequester; channel: DeviceChannel | null };

/** How long the page waits for the device channel at start-up before using HTTP alone. */
const CHANNEL_CONNECT_MS = 4_000;

function httpCoreRequester(baseUrl: string, token: string): CoreRequester {
  return async (body) => {
    const response = await fetch(`${baseUrl}/api/core`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ request: body }),
    });
    const answer = await response.json().catch(() => null) as { ok?: boolean; value?: unknown; error?: string } | null;
    if (!response.ok || !answer?.ok) throw new Error(answer?.error || `device core answered ${response.status}`);
    return answer.value;
  };
}

/**
 * Core requests over the device channel (one WebSocket, lanes), or over HTTP while it is down.
 * `collection.upsert`s to one collection made in the same moment go as one request.
 */
export function channelCoreRequester(channel: DeviceChannel | null, http: CoreRequester): CoreRequester {
  const send: CoreRequester = (body) => {
    if (!channel?.isReady) return http(body);
    return channel.request('core', body, coreLane(body)).catch((error) => {
      if (error instanceof DeviceChannelUnavailable) return http(body);
      throw error;
    });
  };
  return coalesceCollectionUpserts(send);
}

type UpsertBatch = { entries: Record<string, unknown>; waiters: Array<{ keys: string[]; resolve: (value: any) => void; reject: (error: unknown) => void }> };

/**
 * Merges `collection.upsert` requests to the same collection made before the next macrotask into
 * one request (later entries win, as they would applied in order). Each caller gets `{ written }`
 * for its own keys. Any other request first sends what is waiting, so it never overtakes a write
 * made before it.
 */
export function coalesceCollectionUpserts(send: CoreRequester): CoreRequester {
  const batches = new Map<string, UpsertBatch>();
  const flush = (collection: string) => {
    const batch = batches.get(collection);
    batches.delete(collection);
    if (!batch) return;
    send({ name: 'collection.upsert', collection, entries: batch.entries })
      .then(() => { for (const waiter of batch.waiters) waiter.resolve({ written: waiter.keys.length }); })
      .catch((error) => { for (const waiter of batch.waiters) waiter.reject(error); });
  };
  return (request) => {
    if (request.name !== 'collection.upsert') {
      for (const collection of [...batches.keys()]) flush(collection);
      return send(request);
    }
    const { collection, entries } = request;
    let batch = batches.get(collection);
    if (!batch) {
      batch = { entries: {}, waiters: [] };
      batches.set(collection, batch);
      setTimeout(() => flush(collection), 0);
    }
    Object.assign(batch.entries, entries);
    const keys = Object.keys(entries ?? {});
    return new Promise((resolve, reject) => batch!.waiters.push({ keys, resolve, reject }));
  };
}

/** This app's embedded node, or null when this device has none (no secret, or no answer). */
export async function resolveNativeNode(baseUrl = typeof window === 'undefined' ? '' : window.location.origin): Promise<NativeNode | null> {
  const token = await shellToken();
  if (!token) return null;
  const http = httpCoreRequester(baseUrl, token);
  // One WebSocket for everything the page asks its node (the WebView allows 6 HTTP connections to
  // it, and a busy exchange queued 179 requests behind them). An older node has no channel: HTTP.
  let channel: DeviceChannel | null = typeof WebSocket === 'undefined' ? null : new DeviceChannel({ baseUrl, token });
  if (channel) {
    const opened = await Promise.race([
      channel.connect().then(() => true, () => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CHANNEL_CONNECT_MS)),
    ]);
    if (!opened) {
      channel.close();
      channel = null;
    }
  }
  const core = channelCoreRequester(channel, http);
  try {
    await core({ name: 'delivery.get', objectId: 'probe', recipientId: 'probe' });
    return { token, baseUrl, core, channel };
  } catch {
    channel?.close();
    return null;
  }
}

/** A requester for the node's core, or null when this device has none. */
export async function nodeCoreRequester(baseUrl?: string): Promise<CoreRequester | null> {
  return (await resolveNativeNode(baseUrl))?.core ?? null;
}

/** Copied out of the WebView (collections, then private records): its worker is no longer needed. */
export const MIGRATION_MARKS = { collections: 'core.migratedFromWorker', privates: 'core.privateMigrated' } as const;

const MIGRATED_KEY = 'core.migratedFromWorker';
const BATCH = 100;

/**
 * The first time a device's core moves from its WebView worker to its node, everything the worker
 * held is copied over once (records the node already has are kept: it is the newer host).
 */
export async function migrateWorkerCoreToNode(worker: CoreRequester, node: CoreRequester): Promise<{ migrated: boolean; records: number }> {
  const marks = await node({ name: 'collection.snapshot', collection: 'appData' }) as Record<string, unknown>;
  if (marks[MIGRATED_KEY]) return { migrated: false, records: 0 };
  let records = 0;
  for (const collection of CORE_COLLECTIONS) {
    const [fromWorker, onNode] = await Promise.all([
      worker({ name: 'collection.snapshot', collection }) as Promise<Record<string, unknown>>,
      node({ name: 'collection.snapshot', collection }) as Promise<Record<string, unknown>>,
    ]);
    const missing = Object.entries(fromWorker).filter(([key]) => !(key in onNode));
    for (let i = 0; i < missing.length; i += BATCH) {
      await node({ name: 'collection.upsert', collection, entries: Object.fromEntries(missing.slice(i, i + BATCH)) });
    }
    records += missing.length;
  }
  const [workerExchanges, nodeExchanges] = await Promise.all([
    worker({ name: 'exchanges.snapshot' }) as Promise<Array<{ peerId: string; talkId: string; direction?: string }>>,
    node({ name: 'exchanges.snapshot' }) as Promise<Array<{ peerId: string; talkId: string; direction?: string }>>,
  ]);
  const key = (r: { peerId: string; talkId: string; direction?: string }) => `${r.peerId}::${r.talkId}::${r.direction || 'sent'}`;
  const have = new Set(nodeExchanges.map(key));
  const missingExchanges = workerExchanges.filter((record) => !have.has(key(record)));
  for (let i = 0; i < missingExchanges.length; i += BATCH) {
    await node({ name: 'exchanges.upsert', records: missingExchanges.slice(i, i + BATCH) as never });
  }
  records += missingExchanges.length;
  await node({ name: 'collection.upsert', collection: 'appData', entries: { [MIGRATED_KEY]: new Date().toISOString() } });
  return { migrated: true, records };
}
