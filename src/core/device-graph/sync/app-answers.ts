/**
 * The app's answers in the device graph (OPEN-106 step 1 of the switch-over): every answer the app
 * saves (`answerHistory`) becomes an answer event, whichever way it was given (by hand, by the
 * chatbot, a tag I answered myself), and the Me tab reads them back from the graph.
 *
 *   ix/app-answer/<appTalkId>  { sig, ev, sent? }   the app answers last written for this Talk
 *   ix/graph-app/<graphTalkId> { app }              the app's id for a graph Talk
 *
 * An answer to a Talk that came over a graph link is sent to its author (`answerAndSend`); the
 * same answers saved again are not written twice. Talks the graph does not have (still sent as
 * frames) are left to the app's own history.
 */
import { portableSha256Hex } from '../../../shared/portable-sha256';
import type { DeviceGraph } from '../device-graph';
import { canonicalJson } from '../keys';
import { linkSoul, type NodeStore } from '../node-store';
import { personIdOf } from '../people-graph';
import type { AnswerStep } from '../answers';
import type { Perspective, TalkStructure } from '../talk-structure';
import { appAnswersOf, appTalkOf, type AppAnswer } from './graph-host';
import type { createGraphSync } from './graph-sync';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const appTalkSoul = (prefix: string, appTalkId: string) => `${prefix}ix/app-talk/${encodeURIComponent(appTalkId)}`;
export const graphAppSoul = (prefix: string, talkId: string) => `${prefix}ix/graph-app/${talkId}`;
const appAnswerSoul = (prefix: string, appTalkId: string) => `${prefix}ix/app-answer/${encodeURIComponent(appTalkId)}`;

type AppAnswerInput = { questionId: string; answerId: string; typedValue?: unknown };

/** One answered Talk as the Me tab needs it: the Talk in the app's shape and my latest answers. */
export type AppAnswerRecord = {
  appTalkId: string;
  graphTalkId: string;
  eventId: string;
  when: number;
  mode: string;
  mine: boolean;
  withUser?: string;
  talk: Record<string, unknown>;
  answers: AppAnswer[];
};

function stepsOf(answers: AppAnswerInput[]): AnswerStep[] {
  const steps: Array<{ questionId: string; answerIds: string[] }> = [];
  for (const answer of answers) {
    const step = steps.find((s) => s.questionId === answer.questionId);
    if (step) step.answerIds.push(String(answer.answerId)); else steps.push({ questionId: String(answer.questionId), answerIds: [String(answer.answerId)] });
  }
  return steps;
}

const signatureOf = (steps: AnswerStep[], mode: string) => portableSha256Hex(canonicalJson({ steps, mode }));

export function createAppAnswers(options: {
  store: NodeStore;
  graph: DeviceGraph;
  /** The graph id of my own Talk, by its app id (the mirror's map). */
  ownTalkId: (appTalkId: string) => Promise<string | undefined>;
  sync: () => ReturnType<typeof createGraphSync> | undefined;
  log?: (message: string) => void;
}) {
  const { store, graph } = options;
  const prefix = graph.prefix;
  const event = (id: string) => `${prefix}ev/${id}`;

  /** The graph Talk an app Talk is: one that came over a link, or one of mine. */
  async function resolve(appTalkId: string): Promise<{ talkId: string; talk: TalkStructure & Record<string, any>; perspective: Perspective; author?: string } | undefined> {
    const mapped = await store.get(appTalkSoul(prefix, appTalkId));
    if (typeof mapped?.talk === 'string' && mapped.talk) {
      const talk = await graph.arrivals.read(mapped.talk);
      return talk ? { talkId: mapped.talk, talk: talk as any, perspective: 'responder', author: String(mapped.author) } : undefined;
    }
    const own = await options.ownTalkId(appTalkId);
    if (!own) return undefined;
    const state = await store.get(`${prefix}mine/talk/${own}`);
    if (!state || state.deleted === true) return undefined;
    const talk = await graph.talks.read(own);
    return talk ? { talkId: own, talk: talk as any, perspective: 'author' } : undefined;
  }

  // One write at a time per app Talk: the history save and the send can arrive together.
  const locks = new Map<string, Promise<unknown>>();
  function locked<T>(appTalkId: string, run: () => Promise<T>): Promise<T> {
    const previous = locks.get(appTalkId) ?? Promise.resolve();
    const next = previous.then(run, run);
    const settled = next.catch(() => undefined);
    locks.set(appTalkId, settled);
    void settled.then(() => { if (locks.get(appTalkId) === settled) locks.delete(appTalkId); });
    return next;
  }

  /** Write these answers unless they are already my latest answer event; returns its id. */
  async function write(appTalkId: string, answers: AppAnswerInput[], mode: 'manual' | 'chatbot'): Promise<{ eventId: string; talkId: string; author?: string; sent: boolean } | undefined> {
    // A built-in (typed) answer stays in the app's history until typed values are mapped.
    if (!answers.length || answers.some((a) => a.typedValue !== undefined || String(a.answerId).startsWith('typed:'))) return undefined;
    const target = await resolve(appTalkId);
    if (!target) return undefined;
    const steps = stepsOf(answers);
    const sig = signatureOf(steps, mode);
    const known = await store.get(appAnswerSoul(prefix, appTalkId));
    const latest = await graph.answers.answered(target.talkId);
    if (known?.sig === sig && typeof known.ev === 'string' && known.ev === latest) {
      return { eventId: known.ev, talkId: target.talkId, ...(target.author ? { author: target.author } : {}), sent: known.sent === true };
    }
    const eventId = await graph.answers.answer({
      talkId: target.talkId, structure: target.talk, steps, mode, perspective: target.perspective,
      ...(target.author ? { withUser: target.author } : {}),
      ...(latest ? { replaces: latest } : {}),
    });
    await Promise.all([
      store.put(appAnswerSoul(prefix, appTalkId), { sig, ev: eventId, sent: false }),
      store.put(graphAppSoul(prefix, target.talkId), { app: appTalkId }),
    ]);
    return { eventId, talkId: target.talkId, ...(target.author ? { author: target.author } : {}), sent: false };
  }

  return {
    /** The app saved its answer history (`answerHistory` records): each answer into the graph. */
    async recordHistory(records: Record<string, unknown>): Promise<void> {
      for (const record of Object.values(records) as any[]) {
        if (!record || typeof record.talkId !== 'string' || !Array.isArray(record.items)) continue;
        if (record.supportMessage === true || record.supportChannel === true) continue;
        const mode = record.answeredBy === 'chatbot' ? 'chatbot' : 'manual';
        try {
          await locked(record.talkId, () => write(record.talkId, record.items, mode));
        } catch (error) {
          options.log?.(`[app-answers] ${record.talkId}: ${(error as Error).message}`);
        }
      }
    },

    /** I answered a Talk that came over a graph link: write it once and send it to its author. */
    answerAndSend(appTalkId: string, answers: AppAnswerInput[], mode: 'manual' | 'chatbot', context?: Record<string, unknown>): Promise<{ sent: boolean; eventId?: string }> {
      return locked(appTalkId, async () => {
        const sync = options.sync();
        const mapped = await store.get(appTalkSoul(prefix, appTalkId));
        if (!sync || typeof mapped?.talk !== 'string') return { sent: false };
        const written = await write(appTalkId, answers, mode);
        if (!written) return { sent: false };
        await sync.sendAnswer(written.eventId, { ...(context ?? {}), appTalkId });
        await store.put(appAnswerSoul(prefix, appTalkId), { sent: true });
        return { sent: true, eventId: written.eventId };
      });
    },

    /**
     * The app removed my answers to a Talk (I removed it, or passed after a like): a deletion
     * event, sent to the author when the Talk came over a graph link (owner decision 7).
     */
    forget(appTalkId: string): Promise<{ deleted: boolean; sent: boolean }> {
      return locked(appTalkId, async () => {
        const target = await resolve(appTalkId);
        if (!target || !(await graph.answers.answered(target.talkId))) return { deleted: false, sent: false };
        const known = await store.get(appAnswerSoul(prefix, appTalkId));
        const deletionId = await graph.answers.remove(target.talkId);
        await store.put(appAnswerSoul(prefix, appTalkId), { sig: null, ev: null, sent: null });
        const sync = options.sync();
        if (!deletionId || !target.author || !sync || known?.sent !== true) return { deleted: !!deletionId, sent: false };
        await sync.sendAnswerDeletion(target.talkId, deletionId);
        return { deleted: true, sent: true };
      });
    },

    /** Every Talk I answered, with my latest answers, newest first (the Me tab). */
    async history(options_: { months?: number } = {}): Promise<AppAnswerRecord[]> {
      const rows = await graph.answers.me(options_);
      const talkOfEvent = new Map<string, string>();
      for (const row of rows) for (const { eventId } of row.contexts) {
        if (talkOfEvent.has(eventId)) continue;
        const node = await store.get(event(eventId));
        const talkSoul = linkSoul(node?.talk);
        if (talkSoul) talkOfEvent.set(eventId, talkSoul.slice(event('').length));
      }
      const out: AppAnswerRecord[] = [];
      for (const talkId of new Set(talkOfEvent.values())) {
        const eventId = await graph.answers.answered(talkId);
        if (!eventId) continue;
        const [node, appNode, mineState] = await Promise.all([store.get(event(eventId)), store.get(graphAppSoul(prefix, talkId)), store.get(`${prefix}mine/talk/${talkId}`)]);
        if (typeof appNode?.app !== 'string' || !node) continue;
        const mine = !!mineState;
        const talk = mine ? await graph.talks.read(talkId) : await graph.arrivals.read(talkId);
        const set = await graph.answers.answerSet(eventId);
        if (!talk || !set) continue;
        const mode = typeof node.mode === 'string' ? node.mode : 'manual';
        const withUser = personIdOf(prefix, linkSoul(node.with));
        out.push({
          appTalkId: appNode.app, graphTalkId: talkId, eventId, when: Number(node.when) || 0, mode, mine,
          ...(withUser ? { withUser } : {}),
          talk: appTalkOf(talk as any),
          answers: appAnswersOf(talk as any, set, mode, mine ? 'author' : 'responder'),
        });
      }
      return out.sort((a, b) => b.when - a.when);
    },
  };
}

export type AppAnswers = ReturnType<typeof createAppAnswers>;
