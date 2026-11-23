/**
 * Answers the GUI's core requests (OPEN-91): one function every host calls — the web worker today,
 * the native Node process later — so the app logic behind it exists once.
 */
import type { GraphStore } from './graph-store';
import { CollectionStore } from './collections';
import { DeliveryStore } from './delivery';
import { PrivateStore } from './private-store';
import { ExchangeStore } from './exchanges';
import { commitResponse } from './response-commit';
import { createAnswerOutbox } from './answer-outbox';
import { isSerialCoreRequest, type CoreRequest } from './protocol';
import type { NodeStore } from './device-graph/node-store';
import { createDeviceGraph } from './device-graph/device-graph';
import { createReportedLocation, type Locator } from './device-graph/location-graph';
import { createStorageBudget } from './device-graph/storage-budget';
import { appTalkOf, createGraphHost } from './device-graph/sync/graph-host';
import { createAppAnswers, type AppAnswers } from './device-graph/sync/app-answers';
import { createOwnTalks } from './device-graph/sync/own-talks';
import { createMyTalksBodies } from './device-graph/sync/my-talks-bodies';
import { createIncomingList } from './device-graph/sync/incoming-list';
import { createAppChatbot } from './device-graph/sync/app-chatbot';
import type { GraphCrypto } from './device-graph/sync/graph-sync';
import { exchangeAtoms, planOffer, type OfferPlan } from './device-graph/exchanged';
import { redactEvent } from './device-graph/redact';
import { linkSoul } from './device-graph/node-store';
import { getKeyedMany, readKeyed } from './device-graph/keyed-buckets';
import { graphSouls } from './device-graph/talk-structure';

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
  /**
   * Where the device is, as the host knows it (REQ-GRAPH-42): my Talk versions and answers are
   * stamped with its blurred cell. Hosts without geolocation of their own leave it unset and the
   * page reports its fixes instead (`deviceGraph.setLocation`).
   */
  locate?: Locator;
};

function deviceGraphGate(options: DeviceGraphOptions | undefined, localTalk?: (appTalkId: string) => Promise<Record<string, any> | undefined>, reportedLocate?: Locator) {
  if (!options) return { graph: undefined, ownTalks: undefined, host: undefined, appAnswers: undefined };
  const budget = options.storageUsage ? createStorageBudget({ usage: options.storageUsage }) : undefined;
  const locate = options.locate ?? reportedLocate;
  const graph = createDeviceGraph(options.nodeStore, { randomBytes: options.randomBytes, ...(budget ? { budget } : {}), ...(locate ? { locate } : {}) });
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
/** The record a serial request writes: requests for the same one run in order (`isSerialCoreRequest`). */
function serialLaneOf(request: CoreRequest): string {
  if (request.name === 'response.commit') return `answer:${request.input.talkId}|${request.input.authorId}`;
  if (request.name === 'graph.recordOutcome') return `outcome:${request.talkId}|${request.responderId}`;
  if (request.name === 'delivery.record') return `delivery:${request.input.objectId}|${request.input.recipientId}`;
  return request.name;
}

/** How many offers of one `graph.offerMany` run side by side. */
const OFFER_MANY_CONCURRENCY = 3;

export function createCoreHandler(store: GraphStore, options: { freshDevice?: boolean; allowTestOverrides?: boolean; logTimings?: boolean; deviceGraph?: DeviceGraphOptions } = {}): (request: CoreRequest) => Promise<unknown> {
  // A Talk only the app has is answered from the body its `myTalks` entry keeps (`app-answers.ts`).
  // Through My Talks' bodies: once such a Talk is also my graph Talk (a copy I sent), its stored
  // entry keeps only what the graph does not give back, and the body comes from the graph.
  // Where the device is, as the page reports it (REQ-GRAPH-42), unless the host has its own locator.
  const reportedLocation = createReportedLocation();
  const graph = deviceGraphGate(options.deviceGraph, async (appTalkId) => {
    const entry = await (myTalks ? myTalks.get(appTalkId) : collections.get('myTalks', appTalkId)) as { fullTalk?: Record<string, any> } | undefined;
    return entry?.fullTalk;
  }, reportedLocation.locate);
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
  const nodeStore = options.deviceGraph?.nodeStore;
  const souls = graphSouls(graph.graph?.prefix);
  const sentSoul = (talkId: string) => `${graph.graph?.prefix ?? 'local/'}sync/sent/${talkId}`;
  /** My graph Talk for an app id, or the id itself (a graph id the app already knows it by). */
  const ownGraphId = async (appId: string) => (graph.ownTalks ? await graph.ownTalks.graphTalkId(appId) : undefined) ?? appId;
  /** When a Talk was deleted: mine (by its deletion event) or one I received (the author's). */
  async function deletedAt(talkId: string): Promise<number | null> {
    if (!nodeStore || !graph.graph) return null;
    const mine = await nodeStore.get(souls.mine(`talk/${await ownGraphId(talkId)}`));
    const own = mine?.deleted === true ? linkSoul(mine.deletedBy) : undefined;
    const theirs = own ? undefined : linkSoul((await nodeStore.get(souls.index(`deleted/${talkId}`)))?.ev);
    const soul = own ?? theirs;
    if (!soul) return null;
    return Number((await nodeStore.get(soul))?.when ?? 0) || Date.now();
  }
  // `graph.answer` goes through the answer outbox (`answer-outbox.ts`, OPEN-96 a).
  const answerOutbox = createAnswerOutbox({
    delivery,
    send: async (request) => {
      if (!graph.host) throw new Error('this core has no graph links');
      return graph.host.handle(request) as Promise<{ sent: boolean; eventId?: string; reason?: string }>;
    },
    ...(options.deviceGraph?.log ? { log: options.deviceGraph.log } : {}),
  });
  /** Send counts per person for the `graph.offerMany` in progress (read once per batch). */
  let offerSendCounts: Map<string, Promise<{ today: Set<string>; week: number }>> | undefined;
  /** `graph.offerMany` requests running (they overlap): inside one, offers return once queued (their
   * log entries wait for the batch). A flag saved and restored per request was turned off by the
   * first to finish while another still held its entries: that one then waited for itself. */
  let offerManyRunning = 0;
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
        if (!graph.graph) throw new Error('this core has no device graph');
        return commitResponse(request.input, { delivery, exchange: graph.graph.exchange, retracted: async (talkId) => (await deletedAt(talkId)) !== null });
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
        return { written };
      }
      case 'deviceGraph.status':
        return graph.ownTalks ? { enabled: true, ...(await graph.ownTalks.status()), bodies: myTalks?.status() } : null;
      case 'deviceGraph.setLocation':
        reportedLocation.set(request.point);
        return { ok: true };
      case 'deviceGraph.redact':
        // Erase the record's content (spec §31.13); the event and its hash stay.
        return graph.graph && nodeStore ? redactEvent(nodeStore, souls, request.eventId) : null;
      case 'graph.offerMany': {
        // Many Talks, each to its own recipients, in one request: the page says what to offer once
        // and this core fans it out (a newcomer's catch-up, a batch of likes). One at a time,
        // giving the event loop back between them, so a request someone waits on is not held up.
        // A few at a time (each is a chain of storage reads that mostly waits), and each person's
        // send counts are read once for the whole batch (five-phone starter tags, 2026-11-21: 30
        // likes to 4 people took over 2 minutes on a C10, one offer after another).
        const results: unknown[] = new Array(request.offers.length);
        const counts = new Map<string, Promise<{ today: Set<string>; week: number }>>();
        const previous = offerSendCounts;
        offerSendCounts = counts;
        offerManyRunning += 1;
        try {
          let next = 0;
          const worker = async () => {
            while (next < request.offers.length) {
              const index = next++;
              results[index] = await execute({ ...request.offers[index]!, name: 'graph.offer' })
                .catch((error: unknown) => ({ error: String((error as Error)?.message || error) }));
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          };
          // My log entries wait until all are offered: each person gets them in as few entries as fit
          // (graph-sync `holdOut`), not one entry, frame and acknowledgement per Talk.
          const all = () => Promise.all(Array.from({ length: Math.min(OFFER_MANY_CONCURRENCY, request.offers.length) }, worker));
          const sync = graph.host?.sync();
          await (sync ? sync.holdOut(all) : all());
        } finally {
          offerSendCounts = previous;
          offerManyRunning -= 1;
        }
        return { results };
      }
      case 'graph.offer': {
        // My Talk as the app keys it (`myTalks`), written into the graph first if it is not yet.
        const sync = graph.host?.sync();
        const none = { offered: 0, known: false, sent: [], skipped: {}, omitted: {}, waiting: [] };
        if (!sync || !graph.ownTalks) return none;
        // Whatever I send is my Talk: one I wrote, a copy I keep, or a body the app holds only in
        // memory. Each is written (or versioned) as my own graph Talk before it is offered.
        const stored = await (myTalks ? myTalks.get(request.talkId) : collections.get('myTalks', request.talkId)) as Record<string, any> | undefined;
        const body = stored?.fullTalk ?? request.talk;
        const entry = body && Array.isArray(body.questions)
          ? { ...(stored ?? {}), talkId: request.talkId, title: stored?.title ?? body.title, type: stored?.type ?? body.type, timestamp: stored?.timestamp ?? body.createdAt, fullTalk: body, role: 'created' }
          : undefined;
        const talkId = entry ? await graph.ownTalks.ensure(entry) : await graph.ownTalks.graphTalkId(request.talkId);
        const current = talkId && graph.graph ? await graph.graph.talks.read(talkId) : undefined;
        if (!talkId || !current || !nodeStore || !graph.graph) return none;
        // Who already has it (REQ-LEDGER-16): this version, or every part of it. A tag Talk leaves
        // out the tags they have; the send limit counts distinct Talks per person.
        const exchange = graph.graph.exchange;
        const atoms = exchangeAtoms(appTalkOf(current as Record<string, any>));
        const sentTo = await getKeyedMany(nodeStore, sentSoul(talkId), request.recipients);
        const suppress = !(options.allowTestOverrides === true && request.suppress === false);
        const unlimited = options.allowTestOverrides === true && request.unlimitedForTesting === true;
        const skipped: Record<string, string> = {};
        const groups = new Map<string, { omit: string[]; recipients: string[] }>();
        const waiting: string[] = [];
        // Each recipient's checks are independent reads: all at once, then grouped in order.
        const sendCounts = offerSendCounts;
        const plans = await Promise.all([...new Set(request.recipients)].map(async (recipient) => {
          const had = suppress ? await exchange.has(recipient, atoms.map((a) => a.atom)) : new Set<string>();
          const sentVersion = typeof sentTo[recipient] === 'string' ? sentTo[recipient] as string : undefined;
          let plan: OfferPlan = planOffer({ versionId: current.versionId, sentVersion, atoms, has: (atom) => had.has(atom) });
          if (plan.send) {
            let counts: { today: Set<string>; week: number } | undefined;
            if (sendCounts && !unlimited) {
              let pending = sendCounts.get(recipient);
              if (!pending) { pending = exchange.sendCounts(recipient); sendCounts.set(recipient, pending); }
              counts = await pending;
            }
            const limit = await exchange.withinLimit(recipient, talkId, unlimited, counts);
            if (!limit.send) plan = limit;
            // Counted now, so the next Talk in this batch sees it (the limit counts distinct Talks).
            else if (counts && !counts.today.has(talkId)) { counts.today.add(talkId); counts.week += 1; }
          }
          // No keys yet (never linked): nothing can go in our pair log. The app asks for a link and
          // offers again once it opens (its room catch-up).
          const knows = plan.send ? await sync.knows(recipient) : false;
          return { recipient, plan, knows };
        }));
        for (const { recipient, plan, knows } of plans) {
          if (!plan.send) { skipped[recipient] = plan.reason; continue; }
          if (!knows) { waiting.push(recipient); continue; }
          const omit = plan.omit ?? [];
          const group = groups.get(omit.join(',')) ?? { omit, recipients: [] };
          group.recipients.push(recipient);
          groups.set(omit.join(','), group);
        }
        let offered = 0;
        const sent: string[] = [];
        const omitted: Record<string, string[]> = {};
        for (const { omit, recipients } of groups.values()) {
          // Recorded once the offers are in the log; inside a `graph.offerMany` that is after the
          // whole batch is queued (`offerManyRunning`), so this request does not wait for it.
          offered += await sync.offerTalk(talkId, recipients, { ...(request.context ?? {}), ...(omit.length ? { omit } : {}) }, {
            detach: offerManyRunning > 0,
            afterWritten: () => Promise.all(recipients.map((recipient) => exchange.recordOffer(recipient, talkId, current.versionId, atoms, omit))),
          });
          for (const recipient of recipients) {
            sent.push(recipient);
            if (omit.length) omitted[recipient] = omit;
          }
        }
        return { offered, known: true, sent, skipped, omitted, waiting };
      }
      case 'graph.exchangeState': {
        if (!graph.graph || !nodeStore) return { peers: {}, talks: {} };
        const talks: Record<string, { versionId: string; sent: Record<string, string> }> = {};
        await Promise.all((await graph.graph.talks.list()).map(async (talkId) => {
          const [mine, sentTo] = await Promise.all([nodeStore.get(souls.mine(`talk/${talkId}`)), readKeyed(nodeStore, sentSoul(talkId))]);
          const latest = linkSoul(mine?.latest);
          if (!latest || mine?.deleted === true) return;
          const appId = graph.ownTalks ? await graph.ownTalks.appTalkId(talkId) : talkId;
          talks[appId] = {
            versionId: latest.slice(souls.event('').length),
            sent: Object.fromEntries(Object.entries(sentTo).filter((pair): pair is [string, string] => typeof pair[1] === 'string')),
          };
        }));
        return { peers: await graph.graph.exchange.state(), talks };
      }
      case 'graph.recordOutcome':
        if (!graph.graph) return { ok: false };
        await graph.graph.exchange.setOutcome(request.talkId, request.responderId, request.record);
        return { ok: true };
      case 'graph.outcome':
        return graph.graph ? (await graph.graph.exchange.outcome(request.talkId, request.responderId)) ?? null : null;
      case 'graph.outcomes': {
        if (!graph.graph) return {};
        const exchange = graph.graph.exchange;
        return Object.fromEntries(await Promise.all(request.talkIds.map(async (talkId) => [talkId, await exchange.outcomes(talkId)] as const)));
      }
      case 'graph.respondedTo':
        return graph.graph ? graph.graph.exchange.respondedTo(request.talkId) : {};
      case 'graph.deletedAt':
        return deletedAt(request.talkId);
      case 'graph.newTalkId':
        // Only where Talks travel over graph links: elsewhere the app keeps content-hash ids.
        return graph.ownTalks && graph.graph ? graph.graph.ids.next(Date.now()) : null;
      case 'graph.retract': {
        // I retracted (deleted or turned off) my Talk: a deletion event to everyone who has it.
        const sync = graph.host?.sync();
        if (!graph.ownTalks || !graph.graph) return { sent: 0 };
        const talkId = await graph.ownTalks.graphTalkId(request.talkId);
        const deletionId = talkId ? await graph.graph.talks.remove(talkId) : undefined;
        if (!talkId || !deletionId) return { sent: 0 };
        // What it passed to people leaves the exchange index: it may be sent again (as a new Talk).
        const sentTo = nodeStore ? await readKeyed(nodeStore, sentSoul(talkId)) : {};
        await graph.graph.exchange.forgetTalk(talkId, Object.keys(sentTo).filter((peer) => typeof sentTo[peer] === 'string'));
        if (!sync) return { sent: 0 };
        return { sent: await sync.sendTalkDeletion(talkId, deletionId) };
      }
      // Graph-host requests, the encounter/visit/message/trim ones included (declared, but not
      // forwarded until 2026-11-08: only graph-host's own tests could reach them).
      case 'graph.identity':
      case 'graph.open': {
        if (!graph.host) throw new Error('this core has no graph links');
        const result = await graph.host.handle(request);
        // An identity or a link can be what a waiting answer lacked (OPEN-96 a).
        void answerOutbox.resend();
        return result;
      }
      case 'graph.answer':
        if (!graph.host) throw new Error('this core has no graph links');
        return answerOutbox.send(request);
      case 'graph.close':
      case 'graph.hear':
      case 'graph.pull':
      case 'graph.status':
      case 'graph.recordEncounter':
      case 'graph.recordVisit':
      case 'graph.recordNearbyScope':
      case 'graph.recordConversation':
      case 'graph.recordMessages':
      case 'graph.personHistory':
      case 'graph.conversationMessages':
      case 'graph.talkPeople':
      case 'graph.tabSnapshot':
      case 'graph.sendMessage':
      case 'graph.trimLog':
        if (!graph.host) throw new Error('this core has no graph links');
        return graph.host.handle(request);
      case 'collection.remove': {
        const removed = myTalks && request.collection === 'myTalks'
          ? await myTalks.remove(request.keys)
          : await collections.remove(request.collection, request.keys);
        return { removed };
      }
      case 'graph.recordAnswers':
        // My answers the app saved (the Me tab's records): each into the graph (`app-answers.ts`).
        if (graph.appAnswers) await graph.appAnswers.recordHistory(request.records);
        return { ok: !!graph.appAnswers };
      case 'graph.forgetAnswers':
        // My answers to a Talk are removed: a deletion event, sent to its author when it was sent.
        // An answer still waiting to be sent is not sent any more.
        await answerOutbox.forget(request.talkId);
        return graph.appAnswers ? graph.appAnswers.forget(request.talkId, request.senders ?? []) : { deleted: 0, sent: 0 };
      case 'collection.eraseRetired':
        return { erased: await collections.eraseRetired() };
      case 'graph.acceptArrival':
        if (!incoming) return { ok: false };
        await incoming.accept(request.talkId, request.from, request.senderName, request.omit);
        {
          // What passed between us: I have their Talk now (less the tags left out).
          const arrived = await graph.graph!.arrivals.read(request.talkId);
          if (arrived) await graph.graph!.exchange.recordArrival(request.from, arrived.versionId, exchangeAtoms(appTalkOf(arrived as Record<string, any>)));
        }
        // An answer waiting for this Talk to read as received can go now.
        void answerOutbox.resend();
        return { ok: true };
      case 'graph.declineArrival': {
        const sync = graph.host?.sync();
        if (!sync || !graph.graph) return { ok: false };
        const arrived = await graph.graph.arrivals.read(request.talkId);
        await sync.sendDecline(request.from, request.talkId, arrived?.versionId);
        return { ok: true };
      }
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
      case 'graph.importRemembered':
        return { imported: graph.graph ? await graph.graph.answers.importRemembered(request.rows) : 0 };
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
  // Answer commits and outcome records go one at a time: a stale tab cannot overwrite a newer one.
  // Other requests keep their concurrency; no network/transport work holds this lock.
  const serialLanes = new Map<string, Promise<unknown>>();
  let serialDelayMs = 0;
  // Debug builds (`logTimings`): how long each kind of request takes, summed every 30 s into the log, so a slow
  // exchange on a phone shows which requests the core spends its time on.
  const timings = options.logTimings === true ? new Map<string, { count: number; total: number; max: number }>() : undefined;
  let timingsTimer: ReturnType<typeof setTimeout> | undefined;
  const timed = (request: CoreRequest, run: () => Promise<unknown>): Promise<unknown> => {
    if (!timings) return run();
    const started = Date.now();
    const done = () => {
      const ms = Date.now() - started;
      const row = timings.get(request.name) ?? { count: 0, total: 0, max: 0 };
      row.count += 1; row.total += ms; row.max = Math.max(row.max, ms);
      timings.set(request.name, row);
      timingsTimer ??= setTimeout(() => {
        timingsTimer = undefined;
        const rows = [...timings].sort((a, b) => b[1].total - a[1].total).slice(0, 12)
          .map(([name, r]) => `${name} ${r.count}× avg ${Math.round(r.total / r.count)} max ${r.max} ms`);
        timings.clear();
        console.log(`[core-timing] last 30 s: ${rows.join(' · ')}`);
      }, 30_000);
    };
    const result = run();
    result.then(done, done);
    return result;
  };
  return (request) => {
    if (request.name === 'test.slowSerialQueue') {
      if (options.allowTestOverrides !== true) return Promise.reject(new Error('test.slowSerialQueue: test builds only'));
      serialDelayMs = Math.max(0, Number(request.ms) || 0);
      return Promise.resolve({ ok: true });
    }
    if (!isSerialCoreRequest(request)) return timed(request, () => execute(request));
    // One lane per Talk and person (or per response and recipient): what must not overtake is a
    // newer write to the same record. One lane for everything held every answer behind every other
    // (five-phone starter tags, 2026-11-21: 2–3 s each, a dozen a minute on a C10).
    const lane = serialLaneOf(request);
    const previous = serialLanes.get(lane) ?? Promise.resolve();
    const result = previous
      .then(() => (serialDelayMs ? new Promise((resolve) => setTimeout(resolve, serialDelayMs)) : undefined))
      .then(() => timed(request, () => execute(request)));
    const settled = result.catch(() => undefined);
    serialLanes.set(lane, settled);
    void settled.then(() => { if (serialLanes.get(lane) === settled) serialLanes.delete(lane); });
    return result;
  };
}
