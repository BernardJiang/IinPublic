/**
 * The device graph's parts over one store, with one event id source (spec §31, OPEN-106). Every
 * writer on a device must share the id source: two sources over the same saved counter would hand
 * out the same ids.
 */
import { createAnswerGraph } from './answers';
import { createArrivalGraph } from './arrivals';
import type { EventChainSigner } from './chain';
import { createEventIdSource } from './event-id';
import { createExchangeIndex } from './exchanged';
import { createLocationGraph, type Locator } from './location-graph';
import type { NodeStore } from './node-store';
import type { StorageBudget } from './storage-budget';
import { createTalkGraph } from './talk-events';

export function createDeviceGraph(store: NodeStore, options: {
  randomBytes: (length: number) => Uint8Array;
  prefix?: string;
  now?: () => number;
  budget?: StorageBudget;
  /** Where the device is, as the host knows it; events are stamped with its blurred cell (REQ-GRAPH-42). */
  locate?: Locator;
}) {
  const prefix = options.prefix ?? 'local/';
  const idsSoul = `${prefix}device-graph/ids`;
  const ids = createEventIdSource({
    randomBytes: options.randomBytes,
    ...(options.now ? { now: options.now } : {}),
    state: {
      load: async () => {
        const node = await store.get(idsSoul);
        return { deviceId: typeof node?.deviceId === 'string' ? node.deviceId : undefined, counter: Number(node?.counter ?? 0) };
      },
      save: async (state) => { await store.put(idsSoul, state); },
    },
  });
  const graphOptions: { prefix: string; now?: () => number; chain?: EventChainSigner; locate?: Locator } = {
    prefix, ...(options.now ? { now: options.now } : {}), ...(options.locate ? { locate: options.locate } : {}),
  };
  // The arrival graph's options carry the budget too; setChain/setLocator install on both.
  const arrivalOptions: typeof graphOptions & { budget?: StorageBudget } = { ...graphOptions, ...(options.budget ? { budget: options.budget } : {}) };
  return {
    store,
    prefix,
    ids,
    talks: createTalkGraph(store, ids, graphOptions),
    arrivals: createArrivalGraph(store, ids, arrivalOptions),
    answers: createAnswerGraph(store, ids, graphOptions),
    location: createLocationGraph(store, graphOptions),
    /** Who I already exchanged what with (REQ-LEDGER-16). */
    exchange: createExchangeIndex(store, graphOptions),
    budget: options.budget,
    /** Install my event-chain signer (REQ-GRAPH-40); the factories read it at write time. */
    setChain(signer: EventChainSigner): void { graphOptions.chain = signer; arrivalOptions.chain = signer; },
    /** Install the host's locator (REQ-GRAPH-42); my Talk versions and answers get `where` then. */
    setLocator(locate: Locator): void { graphOptions.locate = locate; arrivalOptions.locate = locate; },
  };
}

export type DeviceGraph = ReturnType<typeof createDeviceGraph>;
