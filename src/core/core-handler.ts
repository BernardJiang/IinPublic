/**
 * Answers the GUI's core requests (OPEN-91): one function every host calls — the web worker today,
 * the native Node process later — so the app logic behind it exists once.
 */
import type { GraphStore } from './graph-store';
import { DeliveryStore } from './delivery';
import { ExchangeStore } from './exchanges';
import type { CoreRequest } from './protocol';

export function createCoreHandler(store: GraphStore): (request: CoreRequest) => Promise<unknown> {
  const exchanges = new ExchangeStore(store);
  const delivery = new DeliveryStore(store);
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
      default:
        throw new Error(`Unknown core request: ${(request as { name?: string }).name}`);
    }
  };
}
