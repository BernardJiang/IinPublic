/**
 * The device graph's parts over one store, with one event id source (spec §31, OPEN-106). Every
 * writer on a device must share the id source: two sources over the same saved counter would hand
 * out the same ids.
 */
import { createAnswerGraph } from './answers';
import { createArrivalGraph } from './arrivals';
import { createEventIdSource } from './event-id';
import { createLocationGraph } from './location-graph';
import type { NodeStore } from './node-store';
import type { StorageBudget } from './storage-budget';
import { createTalkGraph } from './talk-events';

export function createDeviceGraph(store: NodeStore, options: {
  randomBytes: (length: number) => Uint8Array;
  prefix?: string;
  now?: () => number;
  budget?: StorageBudget;
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
  const graphOptions = { prefix, ...(options.now ? { now: options.now } : {}) };
  return {
    store,
    prefix,
    ids,
    talks: createTalkGraph(store, ids, graphOptions),
    arrivals: createArrivalGraph(store, ids, { ...graphOptions, ...(options.budget ? { budget: options.budget } : {}) }),
    answers: createAnswerGraph(store, ids, graphOptions),
    location: createLocationGraph(store, graphOptions),
    budget: options.budget,
  };
}

export type DeviceGraph = ReturnType<typeof createDeviceGraph>;
