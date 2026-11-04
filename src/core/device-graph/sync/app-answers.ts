/**
 * The app's answers in the device graph (OPEN-106 step 1 of the switch-over): every answer the app
 * saves (`answerHistory`) becomes an answer event, whichever way it was given (by hand, by the
 * chatbot, a tag I answered myself), and the Me tab reads them back from the graph.
 *
 *   ix/app-answer/<graphTalkId> { sig, ev, sent? }  the app answers last written for this Talk
 *
 * The app knows a received Talk by its graph id (step 2e), and my own Talks through `own-talks.ts`
 * (a copy I sent is my graph Talk with the copied id as its `source`).
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
import { talkStructureKey, talkStructureOf, type Perspective, type TalkStructure } from '../talk-structure';
import { appAnswersOf, appTalkOf, type AppAnswer } from './graph-host';
import type { createGraphSync } from './graph-sync';

/* eslint-disable @typescript-eslint/no-explicit-any */

const appAnswerSoul = (prefix: string, talkId: string) => `${prefix}ix/app-answer/${talkId}`;

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
  /** My own Talks: the graph id of an app id, and back. */
  ownTalks: { graphTalkId(appId: string): Promise<string | undefined>; appTalkId(talkId: string): Promise<string> };
  sync: () => ReturnType<typeof createGraphSync> | undefined;
  log?: (message: string) => void;
}) {
  const { store, graph } = options;
  const prefix = graph.prefix;
  const event = (id: string) => `${prefix}ev/${id}`;

  type Target = { talkId: string; talk: TalkStructure & Record<string, any>; perspective: Perspective; author?: string };

  /** A received Talk, from this author (any sender when none is given). */
  async function received(talkId: string, author?: string): Promise<Target | undefined> {
    const talk = await graph.arrivals.read(talkId);
    if (!talk) return undefined;
    const from = author ?? talk.senders[0];
    if (!from || !talk.senders.includes(from)) return undefined;
    return { talkId, talk: talk as any, perspective: 'responder', author: from };
  }

  async function ownTalk(appTalkId: string): Promise<Target | undefined> {
    const own = await options.ownTalks.graphTalkId(appTalkId);
    if (!own) return undefined;
    const state = await store.get(`${prefix}mine/talk/${own}`);
    if (!state || state.deleted === true) return undefined;
    const talk = await graph.talks.read(own);
    return talk ? { talkId: own, talk: talk as any, perspective: 'author' } : undefined;
  }

  /**
   * The graph Talks this app id stands for: the one I received, and the same Talk (same structure)
   * received from the other senders named — the app shows a Talk several people sent me as one row,
   * answered once (starter tags have the same content on every device). Else my own Talk.
   */
  async function targets(appTalkId: string, authors: string[] = []): Promise<Target[]> {
    const base = await received(appTalkId);
    if (!base) {
      const own = await ownTalk(appTalkId);
      return own ? [own] : [];
    }
    const out = [base];
    const others = new Set(authors.filter((author) => author !== base.author));
    if (!others.size) return out;
    const key = talkStructureKey(talkStructureOf(base.talk));
    for (const talkId of await graph.arrivals.incoming()) {
      if (!others.size) break;
      if (talkId === base.talkId) continue;
      const talk = await graph.arrivals.read(talkId);
      const author = talk?.senders.find((sender) => others.has(sender));
      if (!talk || !author || talkStructureKey(talkStructureOf(talk)) !== key) continue;
      others.delete(author);
      out.push({ talkId, talk: talk as any, perspective: 'responder', author });
    }
    return out;
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
  async function write(target: Target, answers: AppAnswerInput[], mode: 'manual' | 'chatbot'): Promise<{ eventId: string; sent: boolean }> {
    const steps = stepsOf(answers);
    const sig = signatureOf(steps, mode);
    const known = await store.get(appAnswerSoul(prefix, target.talkId));
    const latest = await graph.answers.answered(target.talkId);
    if (known?.sig === sig && typeof known.ev === 'string' && known.ev === latest) return { eventId: known.ev, sent: known.sent === true };
    const eventId = await graph.answers.answer({
      talkId: target.talkId, structure: target.talk, steps, mode, perspective: target.perspective,
      ...(target.author ? { withUser: target.author } : {}),
      ...(latest ? { replaces: latest } : {}),
    });
    await store.put(appAnswerSoul(prefix, target.talkId), { sig, ev: eventId, sent: false });
    return { eventId, sent: false };
  }

  // A built-in (typed) answer stays in the app's history until typed values are mapped.
  const writable = (answers: AppAnswerInput[]) => answers.length > 0 && !answers.some((a) => a.typedValue !== undefined || String(a.answerId).startsWith('typed:'));

  return {
    /** The app saved its answer history (`answerHistory` records): each answer into the graph. */
    async recordHistory(records: Record<string, unknown>): Promise<void> {
      for (const record of Object.values(records) as any[]) {
        if (!record || typeof record.talkId !== 'string' || !Array.isArray(record.items)) continue;
        if (record.supportMessage === true || record.supportChannel === true) continue;
        const mode = record.answeredBy === 'chatbot' ? 'chatbot' : 'manual';
        if (!writable(record.items)) continue;
        const senders = Array.isArray(record.senderIds) ? record.senderIds.map(String) : [];
        try {
          await locked(record.talkId, async () => {
            for (const target of await targets(record.talkId, senders)) await write(target, record.items, mode);
          });
        } catch (error) {
          options.log?.(`[app-answers] ${record.talkId}: ${(error as Error).message}`);
        }
      }
    },

    /** I answered a Talk that came over a graph link: write it once and send it to its author. */
    answerAndSend(talkId: string, authorId: string, answers: AppAnswerInput[], mode: 'manual' | 'chatbot', context?: Record<string, unknown>): Promise<{ sent: boolean; eventId?: string }> {
      return locked(talkId, async () => {
        const sync = options.sync();
        const target = sync && writable(answers) ? await received(talkId, authorId) : undefined;
        if (!sync || !target) return { sent: false };
        const written = await write(target, answers, mode);
        await sync.sendAnswer(written.eventId, context ?? {});
        await store.put(appAnswerSoul(prefix, target.talkId), { sent: true });
        return { sent: true, eventId: written.eventId };
      });
    },

    /**
     * The app removed my answers to a Talk (I removed it, or passed after a like): a deletion
     * event, sent to the author when the Talk came over a graph link (owner decision 7).
     */
    forget(appTalkId: string, senders: string[] = []): Promise<{ deleted: number; sent: number }> {
      return locked(appTalkId, async () => {
        let deleted = 0;
        let sent = 0;
        for (const target of await targets(appTalkId, senders)) {
          if (!(await graph.answers.answered(target.talkId))) continue;
          const known = await store.get(appAnswerSoul(prefix, target.talkId));
          const deletionId = await graph.answers.remove(target.talkId);
          await store.put(appAnswerSoul(prefix, target.talkId), { sig: null, ev: null, sent: null });
          if (!deletionId) continue;
          deleted += 1;
          const sync = options.sync();
          if (!target.author || !sync || known?.sent !== true) continue;
          await sync.sendAnswerDeletion(target.talkId, deletionId);
          sent += 1;
        }
        return { deleted, sent };
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
        const [node, mineState] = await Promise.all([store.get(event(eventId)), store.get(`${prefix}mine/talk/${talkId}`)]);
        if (!node) continue;
        const mine = !!mineState;
        const appTalkId = mine ? await options.ownTalks.appTalkId(talkId) : talkId;
        const talk = mine ? await graph.talks.read(talkId) : await graph.arrivals.read(talkId);
        const set = await graph.answers.answerSet(eventId);
        if (!talk || !set) continue;
        const mode = typeof node.mode === 'string' ? node.mode : 'manual';
        const withUser = personIdOf(prefix, linkSoul(node.with));
        out.push({
          appTalkId, graphTalkId: talkId, eventId, when: Number(node.when) || 0, mode, mine,
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
