/**
 * Answers the GUI's core requests (OPEN-91): one function every host calls — the web worker today,
 * the native Node process later — so the app logic behind it exists once.
 */
import type { GraphStore } from './graph-store';
import { CollectionStore } from './collections';
import { DeliveryStore } from './delivery';
import { PrivateStore } from './private-store';
import { ExchangeStore } from './exchanges';
import { CoreTalkLedger } from './talk-ledger-store';
import type { CoreRequest } from './protocol';
import { createGraphMirror } from './device-graph/mirror';
import type { NodeStore } from './device-graph/node-store';
import { createDeviceGraph } from './device-graph/device-graph';
import { createStorageBudget } from './device-graph/storage-budget';
import { createGraphHost } from './device-graph/sync/graph-host';
import type { GraphCrypto } from './device-graph/sync/graph-sync';

/**
 * OPEN-106 phase 4: the device graph mirror. `nodeStore` is the same Gun as `store`, written by
 * exact soul. It runs when `enabled` is true or the `deviceGraph` setting is "true" (checked at
 * most every 30 s), so it can be turned on on one phone or in one e2e run.
 */
export type DeviceGraphOptions = {
  nodeStore: NodeStore;
  randomBytes: (length: number) => Uint8Array;
  enabled?: boolean;
  log?: (message: string) => void;
  /** The core's Gun and the host's crypto: with both, direct links carry the graph (`graph.*`). */
  gun?: unknown;
  crypto?: GraphCrypto;
  /** Bytes the store uses (1 GB limit, `storage-budget.ts`). */
  storageUsage?: () => Promise<number | undefined>;
};

function deviceGraphGate(store: GraphStore, options: DeviceGraphOptions | undefined) {
  if (!options) return { mirror: undefined, host: undefined, enabled: async () => false, invalidate: () => {} };
  const budget = options.storageUsage ? createStorageBudget({ usage: options.storageUsage }) : undefined;
  const graph = createDeviceGraph(options.nodeStore, { randomBytes: options.randomBytes, ...(budget ? { budget } : {}) });
  const mirror = createGraphMirror(options.nodeStore, { randomBytes: options.randomBytes, graph, ...(options.log ? { log: options.log } : {}) });
  const host = options.gun && options.crypto
    ? createGraphHost({ gun: options.gun, store: options.nodeStore, graph, crypto: options.crypto, ...(options.log ? { log: options.log } : {}) })
    : undefined;
  let checkedAt = 0;
  let setting = false;
  return {
    mirror,
    host,
    enabled: async (): Promise<boolean> => {
      if (options.enabled) return true;
      if (Date.now() - checkedAt > 30_000) {
        checkedAt = Date.now();
        try {
          const node = await store.get('local/collections/settings/deviceGraph');
          setting = typeof node?.json === 'string' && ['"true"', '"1"', 'true'].includes(node.json);
        } catch { setting = false; }
      }
      return setting;
    },
    /** The setting was just written: check it again on the next write. */
    invalidate: () => { checkedAt = 0; },
  };
}

/**
 * `freshDevice`: the host found its storage empty at start (a new device, or one just wiped).
 * Until the first write, snapshots are then empty without asking storage — a read of a node that
 * was never written waits out the not-found grace period, which held every new device's first
 * boot by 1.5 s or more under load (e2e stage2/95, stage2/37).
 */
export function createCoreHandler(store: GraphStore, options: { freshDevice?: boolean; allowTestOverrides?: boolean; deviceGraph?: DeviceGraphOptions } = {}): (request: CoreRequest) => Promise<unknown> {
  const graph = deviceGraphGate(store, options.deviceGraph);
  let fresh = options.freshDevice === true;
  const exchanges = new ExchangeStore(store);
  const delivery = new DeliveryStore(store);
  const collections = new CollectionStore(store);
  const privates = new PrivateStore(store);
  const ledger = new CoreTalkLedger(store, options.allowTestOverrides);
  const execute = async (request: CoreRequest): Promise<unknown> => {
    if (fresh) {
      if (request.name === 'exchanges.snapshot') return [];
      if (request.name === 'collection.snapshot') return {};
      if (request.name === 'private.get' || request.name === 'device.get') return null;
      if (request.name === 'private.keys') return [];
      if (request.name !== 'delivery.get') fresh = false; // any write: storage holds something now
    }
    switch (request.name) {
      case 'response.commit':
      case 'ledger.apply':
      case 'ledger.gate':
      case 'ledger.responder':
      case 'ledger.author':
      case 'ledger.authorAnswer':
        return ledger.execute(request);
      case 'exchanges.snapshot':
        return exchanges.all();
      case 'exchanges.upsert':
        return { written: await exchanges.upsert(request.records) };
      case 'exchanges.removePeers':
        return { removed: await exchanges.removePeers(request.peerIds) };
      case 'delivery.putSentResponse':
        await delivery.putSentResponse(request.payload);
        return { ok: true };
      case 'delivery.record':
        await delivery.record(request.input);
        return { ok: true };
      case 'delivery.get':
        return delivery.get(request.objectId, request.recipientId);
      case 'collection.snapshot':
        return collections.all(request.collection);
      case 'collection.upsert': {
        const written = await collections.upsert(request.collection, request.entries);
        if (request.collection === 'settings' && 'deviceGraph' in request.entries) graph.invalidate();
        // After the app's write, never before or instead of it; not awaited, so it adds no latency.
        if (graph.mirror && request.collection === 'myTalks' && await graph.enabled()) void graph.mirror.onCollectionUpsert(request.collection, request.entries);
        return { written };
      }
      case 'deviceGraph.backfill': {
        // Turn the mirror on and mirror every Talk already in `myTalks` (a test of phase 4 on a
        // device's real data; phase 7's migration will do this for everyone). Repeat-safe.
        if (!graph.mirror) return { queued: 0 };
        await collections.upsert('settings', { deviceGraph: 'true' });
        graph.invalidate();
        const all = await collections.all('myTalks');
        void graph.mirror.onCollectionUpsert('myTalks', all);
        return { queued: Object.keys(all).length };
      }
      case 'deviceGraph.status':
        return graph.mirror ? { enabled: await graph.enabled(), ...(await graph.mirror.status()) } : null;
      case 'graph.offer': {
        // My Talk as the app keys it (`myTalks`): the mirror wrote it into the graph first.
        const sync = graph.host?.sync();
        if (!sync || !graph.mirror) return { offered: 0 };
        await graph.mirror.idle();
        const talkId = await graph.mirror.graphTalkId(request.talkId);
        if (!talkId) return { offered: 0 };
        return { offered: await sync.offerTalk(talkId, request.recipients) };
      }
      case 'graph.identity':
      case 'graph.open':
      case 'graph.close':
      case 'graph.hear':
      case 'graph.pull':
      case 'graph.status':
        if (!graph.host) throw new Error('this core has no graph links');
        return graph.host.handle(request);
      case 'collection.remove':
        return { removed: await collections.remove(request.collection, request.keys) };
      case 'private.get':
        return privates.getPrivate(request.key);
      case 'private.put':
        await privates.putPrivate(request.key, request.value);
        return { ok: true };
      case 'private.keys':
        return privates.privateKeys();
      case 'device.get':
        return privates.getDevice(request.path);
      case 'device.put':
        await privates.putDevice(request.path, request.value);
        return { ok: true };
      default:
        throw new Error(`Unknown core request: ${(request as { name?: string }).name}`);
    }
  };
  // Ledger commands and legacy collection migration share this queue. Other independent
  // collections keep their existing concurrency; no network/transport work holds this lock.
  let ledgerQueue: Promise<unknown> = Promise.resolve();
  return (request) => {
    const touchesLedger = request.name === 'response.commit' || request.name.startsWith('ledger.') || ('collection' in request && request.collection === 'talkLedger')
      || (request.name === 'delivery.record' && request.input.objectKind === 'talk-response');
    if (!touchesLedger) return execute(request);
    const result = ledgerQueue.then(() => execute(request));
    ledgerQueue = result.catch(() => undefined);
    return result;
  };
}
