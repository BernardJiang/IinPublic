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
import type { NodeStore } from './device-graph/node-store';
import { createDeviceGraph } from './device-graph/device-graph';
import { createStorageBudget } from './device-graph/storage-budget';
import { appTalkOf, createGraphHost } from './device-graph/sync/graph-host';
import { createAppAnswers, type AppAnswers } from './device-graph/sync/app-answers';
import { createOwnTalks } from './device-graph/sync/own-talks';
import { createMyTalksBodies } from './device-graph/sync/my-talks-bodies';
import { createIncomingList } from './device-graph/sync/incoming-list';
import { createAppChatbot } from './device-graph/sync/app-chatbot';
import type { GraphCrypto } from './device-graph/sync/graph-sync';

/**
 * OPEN-106: the device graph. `nodeStore` is the same Gun as `store`, written by exact soul. With
 * the core's Gun and crypto, direct links carry it (`graph.*`), my Talks are written into it as the
 * app saves them (`own-talks.ts`), and so are my answers (`app-answers.ts`).
 */
export type DeviceGraphOptions = {
  nodeStore: NodeStore;
  randomBytes: (length: number) => Uint8Array;
  log?: (message: string) => void;
  /** The core's Gun and the host's crypto: with both, direct links carry the graph (`graph.*`). */
  gun?: unknown;
  crypto?: GraphCrypto;
  /** Bytes the store uses (1 GB limit, `storage-budget.ts`). */
  storageUsage?: () => Promise<number | undefined>;
};

function deviceGraphGate(options: DeviceGraphOptions | undefined, localTalk?: (appTalkId: string) => Promise<Record<string, any> | undefined>) {
  if (!options) return { graph: undefined, ownTalks: undefined, host: undefined, appAnswers: undefined };
  const budget = options.storageUsage ? createStorageBudget({ usage: options.storageUsage }) : undefined;
  const graph = createDeviceGraph(options.nodeStore, { randomBytes: options.randomBytes, ...(budget ? { budget } : {}) });
  // Exact GPS points older than 30 days are erased at start and once a day (spec §31.7).
  if (options.gun) {
    const sweep = () => { void graph.location.sweep().catch((error) => options.log?.(`[device-graph] GPS sweep failed: ${(error as Error).message}`)); };
    setTimeout(sweep, 60_000);
    const daily = setInterval(sweep, 86_400_000);
    (daily as { unref?: () => void }).unref?.();
  }
  if (!options.gun || !options.crypto) return { graph, ownTalks: undefined, host: undefined, appAnswers: undefined };
  const ownTalks = createOwnTalks({ store: options.nodeStore, graph, ...(options.log ? { log: options.log } : {}) });
  let appAnswers: AppAnswers | undefined;
  const host = createGraphHost({
    gun: options.gun, store: options.nodeStore, graph, crypto: options.crypto, ...(options.log ? { log: options.log } : {}),
    appAnswers: () => appAnswers!, appTalkId: (talkId) => ownTalks.appTalkId(talkId),
  });
  appAnswers = createAppAnswers({
    store: options.nodeStore, graph, sync: () => host.sync(), ownTalks,
    ...(localTalk ? { localTalk } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
  return { graph, ownTalks, host, appAnswers };
}

/**
 * `freshDevice`: the host found its storage empty at start (a new device, or one just wiped).
 * Until the first write, snapshots are then empty without asking storage — a read of a node that
 * was never written waits out the not-found grace period, which held every new device's first
 * boot by 1.5 s or more under load (e2e stage2/95, stage2/37).
 */
export function createCoreHandler(store: GraphStore, options: { freshDevice?: boolean; allowTestOverrides?: boolean; deviceGraph?: DeviceGraphOptions } = {}): (request: CoreRequest) => Promise<unknown> {
  // A Talk only the app has is answered from the body its `myTalks` entry keeps (`app-answers.ts`).
  const graph = deviceGraphGate(options.deviceGraph, async (appTalkId) => {
    const entry = await collections.get('myTalks', appTalkId) as { fullTalk?: Record<string, any> } | undefined;
    return entry?.fullTalk;
  });
  let fresh = options.freshDevice === true;
  const exchanges = new ExchangeStore(store);
  const delivery = new DeliveryStore(store);
  const collections = new CollectionStore(store);
  // My created Talks' bodies are read from the graph, not kept twice (`my-talks-bodies.ts`).
  const myTalks = graph.ownTalks && graph.graph
    ? createMyTalksBodies({ collections, graph: graph.graph, ownTalks: graph.ownTalks, ...(options.deviceGraph?.log ? { log: options.deviceGraph.log } : {}) })
    : undefined;
  // The incoming list is built from graph arrivals (`incoming-list.ts`).
  const incoming = graph.graph && options.deviceGraph ? createIncomingList({ store: options.deviceGraph.nodeStore, graph: graph.graph }) : undefined;
  // The chatbot answers from the graph (`app-chatbot.ts`).
  const chatbot = graph.graph
    ? createAppChatbot({
      graph: graph.graph,
      myTalks: () => (myTalks ? myTalks.all() : collections.all('myTalks')),
      userId: () => graph.host?.userId(),
    })
    : undefined;
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
        return myTalks && request.collection === 'myTalks' ? myTalks.all() : collections.all(request.collection);
      case 'collection.upsert': {
        // My Talks go into the graph after the app's write, never before or instead of it; not
        // awaited, so it adds no latency.
        const written = myTalks && request.collection === 'myTalks'
          ? await myTalks.upsert(request.entries)
          : await collections.upsert(request.collection, request.entries);
        if (graph.appAnswers && request.collection === 'myAnswerHistory') void graph.appAnswers.recordHistory(request.entries);
        return { written };
      }
      case 'deviceGraph.status':
        return graph.ownTalks ? { enabled: true, ...(await graph.ownTalks.status()), bodies: myTalks?.status() } : null;
      case 'graph.offer': {
        // My Talk as the app keys it (`myTalks`), written into the graph first if it is not yet.
        const sync = graph.host?.sync();
        if (!sync || !graph.ownTalks) return { offered: 0, known: false };
        // Whatever I send is my Talk: one I wrote, a copy I keep, or a body the app holds only in
        // memory. Each is written (or versioned) as my own graph Talk before it is offered.
        const stored = await (myTalks ? myTalks.get(request.talkId) : collections.get('myTalks', request.talkId)) as Record<string, any> | undefined;
        const body = stored?.fullTalk ?? request.talk;
        const entry = body && Array.isArray(body.questions)
          ? { ...(stored ?? {}), talkId: request.talkId, title: stored?.title ?? body.title, type: stored?.type ?? body.type, timestamp: stored?.timestamp ?? body.createdAt, fullTalk: body, role: 'created' }
          : undefined;
        const talkId = entry ? await graph.ownTalks.ensure(entry) : await graph.ownTalks.graphTalkId(request.talkId);
        if (!talkId) return { offered: 0, known: false };
        return { offered: await sync.offerTalk(talkId, request.recipients, request.context), known: true };
      }
      case 'graph.newTalkId':
        // Only where Talks travel over graph links: elsewhere the app keeps content-hash ids.
        return graph.ownTalks && graph.graph ? graph.graph.ids.next(Date.now()) : null;
      case 'graph.retract': {
        // I retracted (deleted or turned off) my Talk: a deletion event to everyone who has it.
        const sync = graph.host?.sync();
        if (!graph.ownTalks || !graph.graph) return { sent: 0 };
        const talkId = await graph.ownTalks.graphTalkId(request.talkId);
        const deletionId = talkId ? await graph.graph.talks.remove(talkId) : undefined;
        if (!talkId || !deletionId || !sync) return { sent: 0 };
        return { sent: await sync.sendTalkDeletion(talkId, deletionId) };
      }
      case 'graph.identity':
      case 'graph.open':
      case 'graph.close':
      case 'graph.hear':
      case 'graph.pull':
      case 'graph.status':
      case 'graph.answer':
        if (!graph.host) throw new Error('this core has no graph links');
        return graph.host.handle(request);
      case 'collection.remove': {
        // My answers to a Talk left the app's history: they leave the graph too (and its author's).
        const forgotten = new Map<string, string[]>();
        if (graph.appAnswers && request.collection === 'myAnswerHistory') {
          for (const record of await Promise.all(request.keys.map((key) => collections.get('myAnswerHistory', key))) as Array<{ talkId?: unknown; senderIds?: unknown } | undefined>) {
            if (typeof record?.talkId !== 'string') continue;
            const senders = Array.isArray(record.senderIds) ? record.senderIds.map(String) : [];
            forgotten.set(record.talkId, [...new Set([...(forgotten.get(record.talkId) ?? []), ...senders])]);
          }
        }
        const removed = myTalks && request.collection === 'myTalks'
          ? await myTalks.remove(request.keys)
          : await collections.remove(request.collection, request.keys);
        for (const [talkId, senders] of forgotten) void graph.appAnswers!.forget(talkId, senders).catch(() => undefined);
        return { removed };
      }
      case 'collection.eraseRetired':
        return { erased: await collections.eraseRetired() };
      case 'graph.acceptArrival':
        if (!incoming) return { ok: false };
        await incoming.accept(request.talkId, request.from, request.senderName, request.omit);
        return { ok: true };
      case 'graph.incoming':
        return incoming ? incoming.rows() : [];
      case 'graph.talkBody': {
        if (!graph.graph) return null;
        const own = graph.ownTalks ? await graph.ownTalks.graphTalkId(request.talkId) : undefined;
        const talk = own ? await graph.graph.talks.read(own) : await graph.graph.arrivals.read(request.talkId);
        return talk ? { ...appTalkOf(talk), id: request.talkId } : null;
      }
      case 'graph.chatbotView':
        return chatbot ? chatbot.view(request.talk, { mine: request.mine === true, locationConsent: request.locationConsent === true }) : null;
      case 'graph.chatbot':
        return chatbot
          ? chatbot.answer(request.talk, { mine: request.mine === true, locationConsent: request.locationConsent === true, ...(request.talkId ? { talkId: request.talkId } : {}) })
          : { answers: null, passed: false, answered: false };
      case 'graph.questionMemory':
        return graph.appAnswers ? graph.appAnswers.questionMemory(request.text, request.language) : {};
      case 'graph.remembered':
        return graph.graph ? graph.graph.answers.remembered() : [];
      case 'graph.changeRemembered': {
        if (!graph.graph) return { ok: false };
        const answers = graph.graph.answers;
        if (request.key === '*' && 'forget' in request.change) {
          for (const item of await answers.remembered()) await answers.changeRemembered(item.key, { forget: true });
          return { ok: true };
        }
        return { ok: await answers.changeRemembered(request.key, request.change) };
      }
      case 'graph.pass':
        return { ok: chatbot ? await chatbot.pass(request.talk, request.passed) : false };
      case 'graph.answerHistory':
        return graph.appAnswers ? graph.appAnswers.history(request.months ? { months: request.months } : {}) : [];
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
