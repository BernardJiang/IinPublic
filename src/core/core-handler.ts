/**
 * Answers the GUI's core requests (OPEN-91): one function every host calls — the web worker today,
 * the native Node process later — so the app logic behind it exists once.
 */
import type { GraphStore } from './graph-store';
import { CollectionStore } from './collections';
import { DeliveryStore } from './delivery';
import { ExchangeStore } from './exchanges';
import type { CoreRequest } from './protocol';

export function createCoreHandler(store: GraphStore): (request: CoreRequest) => Promise<unknown> {
  const exchanges = new ExchangeStore(store);
  const delivery = new DeliveryStore(store);
  const collections = new CollectionStore(store);
  return async (request) => {
    switch (request.name) {
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
      default:
        throw new Error(`Unknown core request: ${(request as { name?: string }).name}`);
    }
  };
}
