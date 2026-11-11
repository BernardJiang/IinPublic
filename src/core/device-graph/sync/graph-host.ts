/**
 * The device core's side of graph links (OPEN-106 step 3): the GUI hosts the transport (browsers
 * have no WebRTC in workers), so it hands each direct link's Gun messages to the core and sends
 * what the core gives back. One long-poll request (`graph.pull`) returns both the Gun messages to
 * send and the events the GUI shows (a Talk arrived, someone answered, a deletion).
 */
import type { DeviceGraph } from '../device-graph';
import { linkSoul, type GraphNode, type NodeStore } from '../node-store';
import { personIdOf, personSoul } from '../people-graph';
import { allSituations } from '../answers';
import { answerKey, type AnswerSetEntry } from '../keys';
import { answeredAtoms } from '../exchanged';
import { putKeyed, readKeyed } from '../keyed-buckets';
import { verifyChain } from '../chain';
import { readIndex } from '../index-buckets';
import { parseEventId } from '../event-id';
import type { ImportedMessage } from '../message-events';
import { builtInFromValues, graphSouls, type Perspective, type TalkStructure } from '../talk-structure';
import { formatTypedAnswerValue, typedAnswerValueFromBuiltIn, type TypedAnswerValue } from '../../../shared/typed-preference-store';
import { createGraphSync, type GraphCrypto, type GraphLinkStatus, type PeerKeys, type SeaPair } from './graph-sync';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type GraphEvent =
  | { type: 'talk'; talkId: string; from: string; context?: Record<string, unknown>; talk?: Record<string, unknown> }
  | { type: 'talk-deleted'; talkId: string; from: string; when?: number }
  /** `appTalkId`: the app's id for my Talk when it is a copy (`own-talks.ts`), else the graph id. */
  | { type: 'answer'; talkId: string; appTalkId?: string; from: string; eventId: string; when?: number; mode?: string; context?: Record<string, unknown>; answers?: AppAnswer[] }
  /** Someone deleted their answer to my Talk (`appTalkId` as for `answer`). */
  | { type: 'answer-deleted'; talkId: string; appTalkId?: string; from: string }
  /** The people my log has entries for that they have not read yet: the page keeps links wanted. */
  | { type: 'owed'; peers: string[] };

export type GraphHostRequest =
  | { name: 'graph.identity'; userId: string; pair: SeaPair }
  | { name: 'graph.open'; peerUserId: string; pub: string; epub: string }
  | { name: 'graph.close'; peerUserId: string }
  | { name: 'graph.hear'; peerUserId: string; raws: string[] }
  | { name: 'graph.pull'; waitMs?: number }
  | { name: 'graph.status' }
  /** Trim my pair log with this person below their signed acknowledgement (REQ-GRAPH-48). */
  | { name: 'graph.trimLog'; peerUserId: string }
  /** A chat message to this person (OPEN-110): my chained event first, then the pair-log entry. */
  | { name: 'graph.sendMessage'; peerUserId: string; conv: string; text: string; re?: string }
  /** A Nearby encounter as a chained event (OPEN-110 slice 2); `re`: the Talk that brought us together. */
  | { name: 'graph.recordEncounter'; personUserId: string; re?: string }
  /** A Place visit as a chained event (OPEN-110 slice 2); `outingId`: a sample of that outing. */
  | { name: 'graph.recordVisit'; placeId: string; placeName?: string; outingId?: string }
  /** Idempotently mirror already-decrypted transport messages into immutable local events. */
  | { name: 'graph.recordMessages'; conversationId: string; otherUserId: string; messages: Array<Omit<ImportedMessage, 'conversationId' | 'otherUserId'>> }
  /** Newest-first events involving one person, from the rebuildable person-history index. */
  | { name: 'graph.personHistory'; userId: string; limit?: number; beforeEventId?: string }
  /** Newest-first immutable messages in one conversation. */
  | { name: 'graph.conversationMessages'; conversationId: string; limit?: number; beforeEventId?: string }
  /** People linked to a Talk by arrivals, answers, or offers, newest relationship first. */
  | { name: 'graph.talkPeople'; talkId: string; limit?: number; beforeWhen?: number; beforeUserId?: string }
  /** `answers[].mode`: the dialog's choice for each answer (`auto`, `manual` = Just once, `whenever`). */
  | { name: 'graph.answer'; talkId: string; authorId: string; answers: Array<{ questionId: string; answerId: string; mode?: string }>; mode: 'manual' | 'chatbot'; context?: Record<string, unknown> };

/**
 * One answer as the app's response carries it. A built-in value I declared on my own Talk is
 * `typed:<kind>` with its `typedValue` (spec §EE), as the app's own Me-tab record keeps it.
 */
export type AppAnswer = { questionId: string; answerId: string; answerText: string; isMatch?: boolean; isIgnore?: boolean; mode?: string; typedValue?: TypedAnswerValue };

export type GraphPull = { out: Array<{ to: string; raw: string }>; events: GraphEvent[] };
export type GraphPersonHistoryItem = {
  eventId: string;
  when: number;
  kind: 'message' | 'answer' | 'arrival' | 'encounter' | 'event';
  byUserId?: string;
  withUserId?: string;
  talkId?: string;
  conversationId?: string;
  placeId?: string;
  cellId?: string;
  reEventId?: string;
  text?: string;
};
export type GraphConversationMessage = {
  eventId: string;
  when: number;
  direction: 'sent' | 'received';
  otherUserId: string;
  text: string;
  reEventId?: string;
  sourceMessageId?: string;
  talkId?: string;
  channel?: 'public' | 'known' | 'mutual';
  isFromChatbot?: boolean;
};
export type GraphTalkPerson = {
  userId: string;
  lastWhen: number;
  lastEventId?: string;
  roles: Array<'sender' | 'author' | 'responder' | 'recipient'>;
};
export type GraphHostStatus = { userId?: string; links: GraphLinkStatus[]; storage?: unknown;
  /** My event chain as verified on this call (REQ-GRAPH-41); absent until an identity is set. */
  chain?: { ok: boolean; checked: number; chainBreaks: number; firstBadSeq?: number; reason?: 'gap' | 'prev' | 'sig' | 'head' | 'cp';
    /** The first seq the verification walk covered: cp.seq + 1 with a checkpoint, else 0 (REQ-GRAPH-46). */
    fromSeq?: number } };

const MAX_PULL_WAIT_MS = 25_000;

/** A storage event as a stable GUI traversal row; storage remains typeless, this projection isn't. */
export function graphPersonHistoryItem(prefix: string, eventId: string, event: GraphNode): GraphPersonHistoryItem {
  const souls = graphSouls(prefix);
  const eventHead = souls.event('');
  const convHead = souls.mine('conv/');
  const placeHead = `${prefix}place/`;
  const cellHead = `${prefix}cell/`;
  const idOf = (value: unknown, head: string): string | undefined => {
    const soul = linkSoul(value);
    return soul?.startsWith(head) ? decodeURIComponent(soul.slice(head.length)) : undefined;
  };
  const talkId = idOf(event.talk, eventHead);
  const conversationId = idOf(event.conv, convHead);
  const placeId = idOf(event.place, placeHead);
  const withUserId = personIdOf(prefix, linkSoul(event.with));
  const byUserId = personIdOf(prefix, linkSoul(event.by));
  const reEventId = idOf(event.re, eventHead);
  const kind: GraphPersonHistoryItem['kind'] = conversationId && typeof event.text === 'string'
    ? 'message'
    : linkSoul(event.gave) && talkId
      ? 'answer'
      : talkId && reEventId
        ? 'arrival'
        : withUserId && !talkId && !conversationId
          ? 'encounter'
          : 'event';
  return {
    eventId,
    when: Number(event.when) || parseEventId(eventId)?.when || 0,
    kind,
    ...(byUserId ? { byUserId } : {}),
    ...(withUserId ? { withUserId } : {}),
    ...(talkId ? { talkId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(placeId ? { placeId } : {}),
    ...(idOf(event.where, cellHead) ? { cellId: idOf(event.where, cellHead)! } : {}),
    ...(reEventId ? { reEventId } : {}),
    ...(typeof event.text === 'string' ? { text: event.text } : {}),
  };
}

/** An answer set on my Talk as the app's answers: each situation's question, each chosen choice. */
export function appAnswersOf(talk: TalkStructure, set: Record<string, AnswerSetEntry>, mode: string, perspective: Perspective = 'responder'): AppAnswer[] {
  const situations = new Map(allSituations(talk, perspective).map((s) => [s.contextHash, s.questionId]));
  const out: AppAnswer[] = [];
  for (const [context, entry] of Object.entries(set)) {
    const question = talk.questions.find((q) => q.id === situations.get(context));
    if (!question) continue;
    if ('typed' in entry) {
      // My built-in values on my own Talk (`app-answers.ts` `stepsOf`): the Me tab's declaration.
      const typedValue = perspective === 'author' ? typedAnswerValueFromBuiltIn(builtInFromValues(entry.typed as unknown as GraphNode)) : undefined;
      if (typedValue) out.push({ questionId: question.id, answerId: `typed:${typedValue.kind}`, answerText: formatTypedAnswerValue(typedValue), mode: 'typed', typedValue });
      continue;
    }
    for (const answer of question.answers) {
      if (!entry.choices.includes(answerKey(answer.text))) continue;
      out.push({ questionId: question.id, answerId: answer.id, answerText: answer.text, ...(answer.isMatch ? { isMatch: true } : {}), ...(answer.isIgnore ? { isIgnore: true } : {}), mode });
    }
  }
  // The set is keyed by context hash, so its order is not the answering order; a flow's outcome
  // is its last answer's, so put the answers back in the Talk's question order.
  const order = new Map(talk.questions.map((q, i) => [q.id, i]));
  return out.sort((a, b) => (order.get(a.questionId) ?? 0) - (order.get(b.questionId) ?? 0));
}

/** A graph Talk as the app's `Talk` object: structure, delivery fields and meta. */
export function appTalkOf(talk: Record<string, any>): Record<string, unknown> {
  const { meta, senders: _senders, latestArrival: _latest, versionId, active: _active, isTemplate: _template, grammar: _grammar, updatedAt, createdAt, ...rest } = talk;
  return { ...rest, ...(meta && typeof meta === 'object' ? meta : {}), graphTalkId: talk.id, graphVersionId: versionId, createdAt: new Date(Number(createdAt) || Date.now()).toISOString(), updatedAt };
}

export function createGraphHost(options: { gun: any; store: NodeStore; graph: DeviceGraph; crypto: GraphCrypto; log?: (message: string) => void;
  /** Where answers are written and sent (`app-answers.ts`, which needs this host's sync). */
  appAnswers?: () => import('./app-answers').AppAnswers;
  /** The app's id for my graph Talk (`own-talks.ts`). */
  appTalkId?: (talkId: string) => Promise<string>;
}) {
  const { store, graph } = options;
  let sync: ReturnType<typeof createGraphSync> | undefined;
  let userId: string | undefined;
  // The installed identity as the chain is verified with (set at `graph.identity`).
  let chainMe: { pub: string; deviceId: string } | undefined;
  const events: GraphEvent[] = [];
  const keys = new Map<string, PeerKeys>();
  const push = (event: GraphEvent) => { events.push(event); sync?.wakePull(); };

  async function peerKeys(peerUserId: string): Promise<PeerKeys | undefined> {
    const known = keys.get(peerUserId);
    if (known) return known;
    const node = await store.get(personSoul(graph.prefix, peerUserId));
    if (typeof node?.pub === 'string' && typeof node.epub === 'string') {
      const found = { pub: node.pub, epub: node.epub };
      keys.set(peerUserId, found);
      return found;
    }
    return undefined;
  }

  const need = () => {
    if (!sync) throw new Error('graph identity not set');
    return sync;
  };

  /** A bounded event-index page, newest first. All indexed event ids on this device share its clock. */
  async function eventPage(listSoul: string, limit: number | undefined, beforeEventId: string | undefined): Promise<Array<{ key: string; event: GraphNode }>> {
    const take = Math.max(1, Math.min(200, Math.floor(limit ?? 50)));
    const beforeWhen = beforeEventId ? parseEventId(beforeEventId)?.when : undefined;
    if (beforeEventId && beforeWhen === undefined) throw new Error('invalid event cursor');
    const to = beforeWhen === undefined ? undefined : new Date(beforeWhen).toISOString().slice(0, 7);
    const entries = await readIndex(store, listSoul, { ...(to ? { to } : {}), limitBuckets: 12 });
    const rows: Array<{ key: string; event: GraphNode }> = [];
    for (const entry of entries) {
      if (beforeEventId && entry.key >= beforeEventId) continue;
      const event = await store.get(entry.target);
      if (event) rows.push({ key: entry.key, event });
      if (rows.length >= take) break;
    }
    return rows;
  }

  return {
    async handle(request: GraphHostRequest): Promise<unknown> {
      switch (request.name) {
        case 'graph.identity': {
          if (sync && userId === request.userId) return { ok: true };
          if (sync) for (const peer of sync.openLinks()) sync.close(peer);
          userId = request.userId;
          // My event chain (REQ-GRAPH-40) is signed with the same identity as the sync log.
          const signer = { sign: (message: string) => options.crypto.sign(message, request.pair.priv), pub: request.pair.pub };
          sync = createGraphSync({
            gun: options.gun, store, me: { userId: request.userId, pair: request.pair }, crypto: options.crypto,
            peerKeys, graph, ids: graph.ids, chain: signer, ...(options.log ? { log: options.log } : {}),
            events: {
              onTalk: (talkId, from, context) => {
                // The page gets the Talk in the app's shape with the event: one read here, none there.
                void graph.arrivals.read(talkId).then((talk) => {
                  push({ type: 'talk', talkId, from, ...(context ? { context } : {}), ...(talk ? { talk: appTalkOf(talk) } : {}) });
                }).catch(() => push({ type: 'talk', talkId, from, ...(context ? { context } : {}) }));
              },
              onTalkDeleted: (talkId, from) => {
                // What it passed between us leaves the exchange index: it may be exchanged again.
                void graph.exchange.forgetTalk(talkId, [from]).catch(() => undefined);
                push({ type: 'talk-deleted', talkId, from, when: Date.now() });
              },
              onAnswer: (talkId, from, eventId, context) => {
                void (async () => {
                  const event = await store.get(`${graph.prefix}ev/${eventId}`);
                  const talk = await graph.talks.read(talkId);
                  const set = await graph.answers.answerSet(eventId);
                  const mode = typeof event?.mode === 'string' ? event.mode : 'manual';
                  const answers = talk && set ? appAnswersOf(talk, set, mode) : undefined;
                  if (talk && answers) await graph.exchange.recordAnswer(from, eventId, answeredAtoms(appTalkOf(talk), answers.map((a) => a.answerId))).catch(() => undefined);
                  const appTalkId = options.appTalkId ? await options.appTalkId(talkId) : talkId;
                  push({ type: 'answer', talkId, ...(appTalkId !== talkId ? { appTalkId } : {}), from, eventId, mode, ...(typeof event?.when === 'number' ? { when: event.when } : {}), ...(context ? { context } : {}), ...(answers ? { answers } : {}) });
                })().catch(() => push({ type: 'answer', talkId, from, eventId }));
              },
              onDeclined: (talkId, from) => {
                // Not passed to them after all: forget it, and offer it again when asked to.
                void Promise.all([
                  graph.exchange.forgetTalk(talkId, [from]),
                  putKeyed(store, `${graph.prefix}sync/sent/${talkId}`, { [from]: null }),
                ]).catch(() => undefined);
              },
              onAnswerDeleted: (talkId, from) => {
                // Their answer no longer counts: how I decided it and what it passed go.
                void (async () => {
                  const appTalkId = options.appTalkId ? await options.appTalkId(talkId) : talkId;
                  await graph.exchange.clearOutcome(appTalkId, from);
                  await graph.exchange.forgetAnswer(from, talkId);
                  push({ type: 'answer-deleted', talkId, ...(appTalkId !== talkId ? { appTalkId } : {}), from });
                })().catch(() => push({ type: 'answer-deleted', talkId, from }));
              },
              onOwedChange: (peers) => push({ type: 'owed', peers }),
            },
          });
          // The same signer chains my graph events (installed on the graph; the sync holds it too).
          graph.setChain(signer);
          chainMe = { pub: request.pair.pub, deviceId: await graph.ids.deviceId() };
          await sync.start();
          push({ type: 'owed', peers: sync.owed() });
          return { ok: true };
        }
        case 'graph.open': {
          if (!request.pub || !request.epub) throw new Error(`no keys for ${request.peerUserId}`);
          keys.set(request.peerUserId, { pub: request.pub, epub: request.epub });
          // The person's keys are kept, so their log can be read and written while apart too.
          await store.put(personSoul(graph.prefix, request.peerUserId), { userId: request.peerUserId, pub: request.pub, epub: request.epub });
          // Not awaited past the link setup: catching up reads over the link, which needs `pull`.
          void need().open(request.peerUserId).catch((error) => options.log?.(`[graph-host] open ${request.peerUserId}: ${(error as Error).message}`));
          return { ok: true };
        }
        case 'graph.close':
          need().close(request.peerUserId);
          return { ok: true };
        case 'graph.trimLog':
          return need().trimLog(request.peerUserId);
        case 'graph.sendMessage':
          return need().sendMessage(request.peerUserId, request.conv, request.text, request.re);
        case 'graph.recordEncounter':
          // A local record of who I crossed paths with: no link needed, only my graph.
          return { eventId: await graph.nearby.recordEncounter({ personUserId: request.personUserId, ...(request.re ? { re: request.re } : {}) }) };
        case 'graph.recordVisit':
          return { eventId: await graph.nearby.recordVisit({ placeId: request.placeId, ...(request.placeName !== undefined ? { name: request.placeName } : {}), ...(request.outingId ? { outingId: request.outingId } : {}) }) };
        case 'graph.recordMessages': {
          if (!userId) throw new Error('graph identity not set');
          let recorded = 0;
          const eventIds: Record<string, string> = {};
          for (const message of request.messages.slice(0, 200)) {
            const result = await graph.messages.importMessage(userId, {
              ...message,
              conversationId: request.conversationId,
              otherUserId: request.otherUserId,
            });
            eventIds[message.sourceMessageId] = result.eventId;
            if (result.created) recorded += 1;
          }
          return { recorded, eventIds };
        }
        case 'graph.personHistory': {
          return (await eventPage(
            graphSouls(graph.prefix).index(`person/${encodeURIComponent(request.userId)}/ev`),
            request.limit,
            request.beforeEventId,
          )).map(({ key, event }) => graphPersonHistoryItem(graph.prefix, key, event));
        }
        case 'graph.conversationMessages': {
          const rows = await eventPage(
            graphSouls(graph.prefix).index(`conv/${encodeURIComponent(request.conversationId)}`),
            request.limit,
            request.beforeEventId,
          );
          return rows.flatMap(({ key, event }): GraphConversationMessage[] => {
            if (typeof event.text !== 'string') return [];
            const otherUserId = personIdOf(graph.prefix, linkSoul(event.with));
            if (!otherUserId) return [];
            const reSoul = linkSoul(event.re);
            const eventHead = graphSouls(graph.prefix).event('');
            const reEventId = reSoul?.startsWith(eventHead) ? reSoul.slice(eventHead.length) : undefined;
            return [{
              eventId: key,
              when: Number(event.when) || parseEventId(key)?.when || 0,
              direction: event.by ? 'sent' : 'received',
              otherUserId,
              text: event.text,
              ...(reEventId ? { reEventId } : {}),
              ...(typeof event.sourceId === 'string' ? { sourceMessageId: event.sourceId } : {}),
              ...(typeof event.scopeTalk === 'string' ? { talkId: event.scopeTalk } : {}),
              ...(event.channel === 'public' || event.channel === 'known' || event.channel === 'mutual'
                ? { channel: event.channel }
                : {}),
              ...(event.bot === true ? { isFromChatbot: true } : {}),
            }];
          });
        }
        case 'graph.talkPeople': {
          const take = Math.max(1, Math.min(200, Math.floor(request.limit ?? 50)));
          const souls = graphSouls(graph.prefix);
          const byUser = new Map<string, GraphTalkPerson>();
          const add = (person: string, role: GraphTalkPerson['roles'][number], when: number, eventId?: string) => {
            if (!person || person === userId) return;
            const current = byUser.get(person) ?? { userId: person, lastWhen: 0, roles: [] };
            if (!current.roles.includes(role)) current.roles.push(role);
            if (when >= current.lastWhen) {
              current.lastWhen = when;
              if (eventId) current.lastEventId = eventId;
            }
            byUser.set(person, current);
          };
          const beforeWhen = Number.isFinite(request.beforeWhen) ? Number(request.beforeWhen) : undefined;
          const to = beforeWhen === undefined ? undefined : new Date(beforeWhen).toISOString().slice(0, 7);
          const entries = await readIndex(store, souls.index(`talk/${request.talkId}/ev`), { ...(to ? { to } : {}), limitBuckets: 12 });
          for (const entry of entries) {
            const event = await store.get(entry.target);
            if (!event) continue;
            const when = Number(event.when) || parseEventId(entry.key)?.when || 0;
            const by = personIdOf(graph.prefix, linkSoul(event.by));
            const withPerson = personIdOf(graph.prefix, linkSoul(event.with));
            if (linkSoul(event.gave)) {
              if (by) add(by, 'responder', when, entry.key);
              if (withPerson) add(withPerson, 'author', when, entry.key);
            } else if (withPerson) add(withPerson, 'sender', when, entry.key);
          }
          // Offers are currently represented by their rebuildable sent-version index. Until offer
          // events land, this preserves Talk → recipients without reading the legacy app ledger.
          for (const [recipient, version] of Object.entries(await readKeyed(store, `${graph.prefix}sync/sent/${request.talkId}`))) {
            if (typeof version !== 'string') continue;
            add(recipient, 'recipient', parseEventId(version)?.when ?? 0);
          }
          return [...byUser.values()]
            .sort((a, b) => b.lastWhen - a.lastWhen || a.userId.localeCompare(b.userId))
            .filter((row) => beforeWhen === undefined
              || row.lastWhen < beforeWhen
              || (row.lastWhen === beforeWhen && row.userId > String(request.beforeUserId ?? '')))
            .slice(0, take);
        }
        case 'graph.hear':
          for (const raw of request.raws) need().hear(request.peerUserId, raw);
          return { ok: true };
        case 'graph.pull': {
          if (!sync) return { out: [], events: [] } satisfies GraphPull;
          const wait = events.length ? 0 : Math.max(0, Math.min(MAX_PULL_WAIT_MS, request.waitMs ?? 0));
          const out = await sync.pull(wait);
          return { out, events: events.splice(0, events.length) } satisfies GraphPull;
        }
        case 'graph.answer':
          // I answered a Talk that came over a graph link: one answer event, sent to its author.
          if (!options.appAnswers) return { sent: false };
          {
            const result = await options.appAnswers().answerAndSend(request.talkId, request.authorId, request.answers, request.mode, request.context);
            const talk = result.eventId ? await graph.arrivals.read(request.talkId) : undefined;
            if (talk && result.eventId) await graph.exchange.recordAnswer(request.authorId, result.eventId, answeredAtoms(appTalkOf(talk), request.answers.map((a) => a.answerId))).catch(() => undefined);
            return result;
          }
        case 'graph.status': {
          const status: GraphHostStatus = { links: sync ? await Promise.all(sync.openLinks().map((peer) => sync!.status(peer))) : [] };
          if (userId) status.userId = userId;
          if (graph.budget) status.storage = await graph.budget.status();
          if (chainMe) {
            // Verify my event chain over the day index, as rebuildIndexes loads it (REQ-GRAPH-41).
            // A failure is reported in the status, never thrown out of it — and never repaired.
            // The walk deliberately re-reads the events on every call: tampering with a stored
            // event does not move ix/head, so a head-keyed cache would hide exactly what this
            // check exists to catch. The designed cost bound is checkpoint-scoped verification
            // (REQ-GRAPH-46, OPEN-109), which starts from the newest checkpoint instead.
            try {
              const souls = graphSouls(graph.prefix);
              const readEvents = async () => {
                const loaded: Array<{ id: string; event: GraphNode }> = [];
                for (const entry of await readIndex(store, souls.index('day'))) {
                  const event = await store.get(entry.target);
                  if (event) loaded.push({ id: entry.key, event });
                }
                return loaded;
              };
              const result = await verifyChain(store, souls, { verify: options.crypto.verify }, chainMe, readEvents);
              status.chain = { ...result, chainBreaks: result.ok ? 0 : 1 };
            } catch { /* a verification error leaves `chain` unset, not a broken status */ }
          }
          return status;
        }
        default:
          throw new Error(`Unknown graph request: ${(request as { name?: string }).name}`);
      }
    },
    sync: () => sync,
    userId: () => userId,
  };
}
