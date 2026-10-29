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

/**
 * `freshDevice`: the host found its storage empty at start (a new device, or one just wiped).
 * Until the first write, snapshots are then empty without asking storage — a read of a node that
 * was never written waits out the not-found grace period, which held every new device's first
 * boot by 1.5 s or more under load (e2e stage2/95, stage2/37).
 */
export function createCoreHandler(store: GraphStore, options: { freshDevice?: boolean; allowTestOverrides?: boolean } = {}): (request: CoreRequest) => Promise<unknown> {
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
      case 'collection.upsert':
        return { written: await collections.upsert(request.collection, request.entries) };
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
