/**
 * The device core's side of graph links (OPEN-106 step 3): the GUI hosts the transport (browsers
 * have no WebRTC in workers), so it hands each direct link's Gun messages to the core and sends
 * what the core gives back. One long-poll request (`graph.pull`) returns both the Gun messages to
 * send and the events the GUI shows (a Talk arrived, someone answered, a deletion).
 */
import type { DeviceGraph } from '../device-graph';
import type { NodeStore } from '../node-store';
import { personSoul } from '../people-graph';
import { allSituations } from '../answers';
import { answerKey, type AnswerSetEntry } from '../keys';
import { answeredAtoms } from '../exchanged';
import { builtInFromValues, type Perspective, type TalkStructure } from '../talk-structure';
import type { GraphNode } from '../node-store';
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
  /** `answers[].mode`: the dialog's choice for each answer (`auto`, `manual` = Just once, `whenever`). */
  | { name: 'graph.answer'; talkId: string; authorId: string; answers: Array<{ questionId: string; answerId: string; mode?: string }>; mode: 'manual' | 'chatbot'; context?: Record<string, unknown> };

/**
 * One answer as the app's response carries it. A built-in value I declared on my own Talk is
 * `typed:<kind>` with its `typedValue` (spec §EE), as the app's own Me-tab record keeps it.
 */
export type AppAnswer = { questionId: string; answerId: string; answerText: string; isMatch?: boolean; isIgnore?: boolean; mode?: string; typedValue?: TypedAnswerValue };

export type GraphPull = { out: Array<{ to: string; raw: string }>; events: GraphEvent[] };
export type GraphHostStatus = { userId?: string; links: GraphLinkStatus[]; storage?: unknown };

const MAX_PULL_WAIT_MS = 25_000;

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
  return out;
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

  return {
    async handle(request: GraphHostRequest): Promise<unknown> {
      switch (request.name) {
        case 'graph.identity': {
          if (sync && userId === request.userId) return { ok: true };
          if (sync) for (const peer of sync.openLinks()) sync.close(peer);
          userId = request.userId;
          sync = createGraphSync({
            gun: options.gun, store, me: { userId: request.userId, pair: request.pair }, crypto: options.crypto,
            peerKeys, graph, ...(options.log ? { log: options.log } : {}),
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
