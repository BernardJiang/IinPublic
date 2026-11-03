/**
 * Answers in the device graph (spec §31.4, §31.5, §31.8): situations (context hashes), answer
 * sets, answer events, and the indexes the chatbot and the Me tab read with one key each.
 *
 *   s/<hash>                 { v }                                 the answers, content
 *   s/<hash>/<context>       { a: →a/… } | { n, 0: →a/…, … } | { kind, …typed values }
 *   ev/<id>                  { v, when, device, with?, talk, re?, gave: →s/…, mode }
 *   ix/ctx/<context>         { entry: →s/<hash>/<context>, mode, ev: →ev/…, when }   Same context
 *   ix/whenever/<questionKey>{ n, 0: →a/…, … }                     Whenever offered, priority order
 *   ix/q/<questionKey>/mine  { <context>: →ev/… }                  Me tab: my answers to one question
 *   ix/me                    bucketed: questionKey → ix/q/<questionKey>/mine
 *   ix/answered/<talkId>     { ev: →ev/… }                          "already answered"
 *   ev/<deleteId>            { v, when, device, with?, talk, re: →my answer, deleted: true }
 *
 * Someone else's answer to my Talk (received over the pair's link, `sync/graph-sync.ts`):
 *   ev/<theirId>             { v, when, device, by: →person, talk, re?, gave: →s/…, mode }
 *   ix/theirs/<talkId>       { <userId>: →ev/<theirId> }            their latest answer, per person
 *   ix/q/<questionKey>/theirs { <theirId>: →ev/<theirId> }          Me → Contacts
 *   ix/talk/<talkId>/ev, ix/person/<userId>/ev   bucketed event lists
 *
 * Repeating the same answers writes one new answer event and no content (REQ-GRAPH-22).
 */
import { answerQuestionsSoul, putEvent } from './events';
import { personIdOf, personSoul, personWrites } from './people-graph';
import { ageRangeMutuallyAcceptable, intervalsOverlap, quantitySufficient } from '../../shared/built-in-comparisons';
import { pickBuiltInAnswer } from '../../shared/built-in-question-resolution';
import { singleNonIgnoreAnswer } from '../../shared/talk-engine';
import { addToIndex, readIndex } from './index-buckets';
import { answerKey, answerSetKey, contextHash, type AnswerSetEntry, type BuiltInValues } from './keys';
import { link, linkSoul, type GraphNode, type NodeStore } from './node-store';
import {
  GRAPH_SCHEMA_VERSION, builtInValues, graphSouls, questionKeysOf, tagScopeFor,
  type Perspective, type StructureQuestion, type TalkStructure,
} from './talk-structure';
import type { EventIds } from './talk-events';

/** One answered question: the chosen choice ids, or a built-in's typed value. */
export type AnswerStep = { questionId: string; answerIds?: string[]; typed?: BuiltInValues };

export type SituatedAnswer = {
  questionId: string;
  questionKey: string;
  contextHash: string;
  entry: AnswerSetEntry;
  /** The chosen choice texts, for the next question's context. */
  chosenTexts: string[];
};

/**
 * The situation of every answered question, in answering order (REQ-GRAPH-12). A flow question's
 * parent is the question answered just before it; a route question's parent is the last step of
 * its `contextPath` (so siblings of a fan-out are independent of each other); a survey question
 * has no parent.
 */
export function situate(structure: TalkStructure, steps: AnswerStep[], perspective: Perspective): SituatedAnswer[] {
  const byId = new Map(structure.questions.map((q) => [q.id, q]));
  const qKeys = questionKeysOf(structure, perspective);
  const done = new Map<string, SituatedAnswer>();
  const out: SituatedAnswer[] = [];
  let previous: SituatedAnswer | undefined;
  for (const step of steps) {
    const question = byId.get(step.questionId);
    if (!question) throw new Error(`no question ${step.questionId} in this Talk`);
    let parent: SituatedAnswer | undefined;
    if (structure.type === 'route' && question.contextPath) {
      const last = question.contextPath.at(-1);
      parent = last ? done.get(last.questionId) : undefined;
    } else if (structure.type !== 'survey') {
      parent = previous;
    }
    const chosen = (step.answerIds || []).map((id) => {
      const answer = question.answers.find((a) => a.id === id);
      if (!answer) throw new Error(`no choice ${id} in question ${question.id}`);
      return answer;
    });
    const entry: AnswerSetEntry = step.typed ? { typed: step.typed } : { choices: chosen.map((a) => answerKey(a.text)) };
    const situated: SituatedAnswer = {
      questionId: question.id,
      questionKey: qKeys.get(question.id)!,
      contextHash: contextOf(structure, question, parent, perspective),
      entry,
      chosenTexts: chosen.map((a) => a.text),
    };
    done.set(question.id, situated);
    out.push(situated);
    previous = situated;
  }
  return out;
}

function contextOf(structure: TalkStructure, question: StructureQuestion, parent: SituatedAnswer | undefined, perspective: Perspective): string {
  return contextHash({
    type: structure.type,
    language: structure.language,
    parent: parent ? { contextHash: parent.contextHash, answers: parent.chosenTexts } : undefined,
    question: question.text,
    choices: question.answers.map((a) => a.text),
    builtIn: builtInValues(question.builtIn),
    selection: question.answerSelectionMode || 'single',
    ...tagScopeFor(structure, question, perspective),
  });
}

export type ChatbotAnswer = {
  questionId: string;
  answerIds?: string[];
  typed?: BuiltInValues;
  reason: 'same-context' | 'whenever-offered' | 'built-in' | 'pair-tag';
};

/**
 * Whether the Talk's built-in values and mine are compatible (spec §30.2), or undefined when they
 * cannot be compared (another kind, missing values, a location, or a quantity with no Pair tag to
 * say which side wants). The same comparisons as `resolveBuiltInQuestion`.
 */
export function builtInCompatible(theirs: BuiltInValues | undefined, mine: BuiltInValues | undefined, theirTag?: string): boolean | undefined {
  if (!theirs || !mine || theirs.kind !== mine.kind) return undefined;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  switch (theirs.kind) {
    case 'priceRange':
      return num(theirs.min) && num(theirs.max) && num(mine.min) && num(mine.max)
        ? intervalsOverlap({ min: theirs.min, max: theirs.max }, { min: mine.min, max: mine.max }) : undefined;
    case 'timeFrame':
      return num(theirs.start) && num(theirs.end) && num(mine.start) && num(mine.end)
        ? intervalsOverlap({ min: theirs.start, max: theirs.end }, { min: mine.start, max: mine.end }) : undefined;
    case 'ageRange':
      return num(theirs.age) && num(theirs.rangeMin) && num(theirs.rangeMax) && num(mine.age) && num(mine.rangeMin) && num(mine.rangeMax)
        ? ageRangeMutuallyAcceptable(
          { age: theirs.age, acceptableRange: { min: theirs.rangeMin, max: theirs.rangeMax } },
          { age: mine.age, acceptableRange: { min: mine.rangeMin, max: mine.rangeMax } },
        ) : undefined;
    case 'quantity': {
      if (!num(theirs.quantity) || !num(mine.quantity) || !theirTag) return undefined;
      // As today: a "sell" Talk declares what it has, so mine is what I want; otherwise the reverse.
      const isSell = theirTag.trim().toLowerCase() === 'sell';
      return isSell ? quantitySufficient(mine.quantity, theirs.quantity) : quantitySufficient(theirs.quantity, mine.quantity);
    }
    default:
      return undefined;
  }
}

/**
 * The index writes that forget an answer event and every earlier one it replaced: Same context and
 * Me tab entries still pointing at one of them, and "already answered". Entries a later answer to
 * another Talk overwrote are left alone. Used by `remove` and by the crash rebuild.
 */
export async function answerIndexClears(store: Pick<NodeStore, 'get'>, souls: ReturnType<typeof graphSouls>, latestAnswerId: string): Promise<Array<[string, GraphNode]>> {
  const out: Array<[string, GraphNode]> = [];
  const seen = new Set<string>();
  let current: string | undefined = latestAnswerId;
  let talkSoul: string | undefined;
  while (current && !seen.has(current)) {
    seen.add(current);
    const at = souls.event(current);
    const [event, questions]: [GraphNode | null, GraphNode | null] = await Promise.all([store.get(at), store.get(answerQuestionsSoul(souls, current))]);
    if (!event) break;
    talkSoul ||= linkSoul(event.talk);
    for (const [context, questionKey] of Object.entries(questions || {})) {
      if (typeof questionKey !== 'string') continue;
      const [ctx, mine] = await Promise.all([store.get(souls.index(`ctx/${context}`)), store.get(souls.index(`q/${questionKey}/mine`))]);
      if (linkSoul(ctx?.ev) === at) out.push([souls.index(`ctx/${context}`), { entry: null, mode: null, ev: null, when: null }]);
      if (linkSoul(mine?.[context]) === at) out.push([souls.index(`q/${questionKey}/mine`), { [context]: null }]);
    }
    current = (linkSoul(event.replaces) || '').slice(souls.event('').length) || undefined;
  }
  if (talkSoul) {
    const talkId = talkSoul.slice(souls.event('').length);
    const answered = await store.get(souls.index(`answered/${talkId}`));
    if (seen.has((linkSoul(answered?.ev) || '').slice(souls.event('').length))) out.push([souls.index(`answered/${talkId}`), { ev: null, when: null }]);
  }
  return out;
}

/** Which question each situation of someone else's answer belongs to (private, like mine). */
export const theirQuestionsSoul = (souls: ReturnType<typeof graphSouls>, eventId: string) => `${souls.event(eventId)}/tq`;

/**
 * Every situation my Talk can be answered in, from the author's side, with the choice keys offered
 * there. A route or flow is walked along every choice, so each reachable parent answer is covered;
 * a multiple-choice question is entered with each single choice and with every subset seen in
 * answers up to 2^6, beyond which only singles and the full set are covered.
 */
export function allSituations(structure: TalkStructure, perspective: Perspective): Array<{ contextHash: string; questionId: string; questionKey: string; choices: Set<string> }> {
  const byId = new Map(structure.questions.map((q) => [q.id, q]));
  const out = new Map<string, { contextHash: string; questionId: string; questionKey: string; choices: Set<string> }>();
  const subsets = (ids: string[]): string[][] => {
    if (ids.length > 6) return [...ids.map((id) => [id]), ids];
    const all: string[][] = [];
    for (let mask = 1; mask < 1 << ids.length; mask += 1) all.push(ids.filter((_, i) => mask & (1 << i)));
    return all;
  };
  const visit = (steps: AnswerStep[], qid: string, depth: number) => {
    const question = byId.get(qid);
    if (!question || depth > structure.questions.length + 1 || steps.some((s) => s.questionId === qid)) return;
    const [here] = situate(structure, [...steps, { questionId: qid, answerIds: [] }], perspective).slice(-1);
    out.set(here!.contextHash, { contextHash: here!.contextHash, questionId: qid, questionKey: here!.questionKey, choices: new Set(question.answers.map((a) => answerKey(a.text))) });
    if (structure.type === 'survey') return;
    const ids = question.answers.map((a) => a.id);
    for (const chosen of question.answerSelectionMode === 'multiple' ? subsets(ids) : ids.map((id) => [id])) {
      const answers = question.answers.filter((a) => chosen.includes(a.id));
      if (answers.some((a) => a.isTerminal || a.isIgnore)) continue;
      const step = { questionId: qid, answerIds: chosen };
      const next = answers.flatMap((a) => a.nextQuestionIds || (a.nextQuestionId ? [a.nextQuestionId] : []));
      for (const branch of question.branchingLogic || []) if (chosen.includes(branch.answerId)) next.push(branch.nextQuestionId);
      if (!next.length && question.nextQuestionId) next.push(question.nextQuestionId);
      for (const nextId of new Set(next)) visit([...steps, step], nextId, depth + 1);
    }
  };
  if (structure.type === 'survey') for (const q of structure.questions) visit([], q.id, 0);
  else if (structure.type === 'route') {
    // A route question's situation follows its context path, not the walk order.
    for (const q of structure.questions) {
      const path = q.contextPath || [];
      const steps: AnswerStep[] = path.map((s) => ({ questionId: s.questionId, answerIds: [s.answerId] }));
      try {
        const [here] = situate(structure, [...steps, { questionId: q.id, answerIds: [] }], perspective).slice(-1);
        out.set(here!.contextHash, { contextHash: here!.contextHash, questionId: q.id, questionKey: here!.questionKey, choices: new Set(q.answers.map((a) => answerKey(a.text))) });
      } catch { /* a path through a missing step cannot be answered */ }
    }
    if (structure.questions[0]) visit([], structure.questions[0].id, 0);
  } else if (structure.questions[0]) visit([], structure.questions[0].id, 0);
  return [...out.values()];
}

/** The index writes that forget one person's answers to my Talk (their latest and those it replaced). */
export async function theirAnswerClears(store: Pick<NodeStore, 'get'>, souls: ReturnType<typeof graphSouls>, talkId: string, byUser: string, answerEventId: string): Promise<Array<[string, GraphNode]>> {
  const out: Array<[string, GraphNode]> = [];
  const seen = new Set<string>();
  let current: string | undefined = answerEventId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const [event, questions]: [GraphNode | null, GraphNode | null] = await Promise.all([store.get(souls.event(current)), store.get(theirQuestionsSoul(souls, current))]);
    for (const questionKey of new Set(Object.values(questions || {}).filter((k): k is string => typeof k === 'string'))) {
      out.push([souls.index(`q/${questionKey}/theirs`), { [current]: null }]);
    }
    const when = Number(event?.when ?? 0);
    if (when) out.push([`${souls.index(`talk/${talkId}/ev`)}/${new Date(when).toISOString().slice(0, 7)}`, { [current]: null }]);
    current = (linkSoul(event?.replaces) || '').slice(souls.event('').length) || undefined;
  }
  const theirs = await store.get(souls.index(`theirs/${talkId}`));
  if (seen.has((linkSoul(theirs?.[byUser]) || '').slice(souls.event('').length))) out.push([souls.index(`theirs/${talkId}`), { [byUser]: null }]);
  return out;
}

export function createAnswerGraph(store: NodeStore, ids: EventIds, options: { prefix?: string; now?: () => number } = {}) {
  const souls = graphSouls(options.prefix);
  const now = options.now ?? Date.now;
  const v = GRAPH_SCHEMA_VERSION;

  async function putIfAbsent(soul: string, node: GraphNode): Promise<boolean> {
    if (await store.get(soul)) return false;
    await store.put(soul, node);
    return true;
  }

  /**
   * Store an answer set, with `alongside` writes in the same batch. One read of every node, then
   * one write of what is missing (nothing when the set exists), as for structures.
   */
  async function writeAnswerSet(situated: SituatedAnswer[], alongside: Array<[string, GraphNode]>): Promise<string> {
    const entries = Object.fromEntries(situated.map((s) => [s.contextHash, s.entry]));
    const key = answerSetKey(entries);
    const nodes: Array<[string, GraphNode]> = situated.map((s) => {
      let node: GraphNode;
      if ('typed' in s.entry) node = { ...s.entry.typed } as GraphNode;
      else if (s.entry.choices.length === 1) node = { a: link(souls.answer(s.entry.choices[0]!)) };
      else {
        const sorted = [...new Set(s.entry.choices)].sort();
        node = { n: sorted.length, ...Object.fromEntries(sorted.map((c, i) => [String(i), link(souls.answer(c))])) };
      }
      return [souls.answerSetEntry(key, s.contextHash), node];
    });
    nodes.push([souls.answerSet(key), { v }]);
    const exists = await Promise.all(nodes.map(([soul]) => store.get(soul)));
    await Promise.all([...nodes.filter((_, i) => !exists[i]), ...alongside].map(([soul, node]) => store.put(soul, node)));
    return key;
  }

  return {
    /**
     * I answered a Talk (REQ-GRAPH-21: this event is shared with the author; the arrival is a
     * separate private event). Updates the chatbot and Me tab indexes. Returns the event id.
     */
    async answer(params: {
      talkId: string;
      structure: TalkStructure;
      steps: AnswerStep[];
      mode: 'manual' | 'chatbot' | 'import';
      /** The author's user ID (`person/<userId>`), when answering someone else's Talk. */
      withUser?: string;
      /** The event this answers: the offer or the arrival of the version answered. */
      re?: string;
      /** My previous answer event to this Talk, when I change my answer. */
      replaces?: string;
      perspective?: Perspective;
    }): Promise<string> {
      const when = now();
      const situated = situate(params.structure, params.steps, params.perspective ?? 'responder');
      const eventId = await ids.next(when);
      // The sidecar goes with the set, before the event: an answer event that exists always has
      // it, so the Me tab index can be rebuilt (REQ-GRAPH-02).
      const setKey = await writeAnswerSet(situated, [
        [answerQuestionsSoul(souls, eventId), Object.fromEntries(situated.map((s) => [s.contextHash, s.questionKey]))],
      ]);
      const event: GraphNode = {
        v, when, device: await ids.deviceId(), talk: link(souls.event(params.talkId)), gave: link(souls.answerSet(setKey)), mode: params.mode,
      };
      if (params.withUser) event.with = link(personSoul(options.prefix ?? 'local/', params.withUser));
      if (params.re) event.re = link(souls.event(params.re));
      if (params.replaces) event.replaces = link(souls.event(params.replaces));
      const at = link(souls.event(eventId));
      // The event and every index it implies, in one batch (all rebuildable from the event).
      await Promise.all([
        putEvent(store, souls, eventId, event),
        ...situated.flatMap((s) => [
          store.put(souls.index(`ctx/${s.contextHash}`), { entry: link(souls.answerSetEntry(setKey, s.contextHash)), mode: params.mode, ev: at, when }),
          store.put(souls.index(`q/${s.questionKey}/mine`), { [s.contextHash]: at }),
          // My own declared values for a built-in question, read by the chatbot (any Talk asking it).
          ...('typed' in s.entry ? [store.put(souls.index(`typed/${s.questionKey}`), { ...s.entry.typed, ev: at, when } as GraphNode)] : []),
          addToIndex(store, souls.index('me'), { key: s.questionKey, target: souls.index(`q/${s.questionKey}/mine`), when }),
        ]),
        store.put(souls.index(`answered/${params.talkId}`), { ev: at, when }),
        addToIndex(store, souls.index(`talk/${params.talkId}/ev`), { key: eventId, target: souls.event(eventId), when }),
        ...(params.withUser ? [addToIndex(store, souls.index(`person/${encodeURIComponent(params.withUser)}/ev`), { key: eventId, target: souls.event(eventId), when })] : []),
      ]);
      return eventId;
    },

    /**
     * I deleted my answer to a Talk (owner decision 2026-11-03): a new event, shared with the author
     * so their copy goes too. Every index entry my answers to this Talk put there is cleared (earlier
     * answers I replaced included). Returns the deletion event id, or undefined with no answer.
     */
    async remove(talkId: string): Promise<string | undefined> {
      const latest = await this.answered(talkId);
      if (!latest) return undefined;
      const answerEvent = await store.get(souls.event(latest));
      const when = now();
      const eventId = await ids.next(when);
      const event: GraphNode = {
        v, when, device: await ids.deviceId(), talk: link(souls.event(talkId)), re: link(souls.event(latest)), deleted: true,
      };
      if (answerEvent?.with) event.with = answerEvent.with;
      const clears = await answerIndexClears(store, souls, latest);
      await Promise.all([putEvent(store, souls, eventId, event), ...clears.map(([soul, node]) => store.put(soul, node))]);
      return eventId;
    },

    /**
     * Someone answered my Talk. Their answer set is stored from keys only (every choice is one of
     * my Talk's, whose text I hold), with their event, and indexed for the Talk, the person and the
     * questions. A repeat of the same event writes nothing new. Returns false when an answer names
     * a situation or choice my Talk does not have.
     */
    async receiveAnswer(params: {
      talkId: string;
      structure: TalkStructure;
      eventId: string;
      byUser: string;
      when: number;
      device: string;
      mode: string;
      set: Record<string, AnswerSetEntry>;
      replaces?: string;
    }): Promise<boolean> {
      // My Talk's situations as the responder computed them (a Pair tag reads from their side), by
      // walking every answer path it allows; indexed under my own key for each question.
      const authorKeys = questionKeysOf(params.structure, 'author');
      const known = new Map<string, { questionKey: string; choices: Set<string> }>();
      for (const situated of allSituations(params.structure, 'responder')) {
        known.set(situated.contextHash, { questionKey: authorKeys.get(situated.questionId)!, choices: situated.choices });
      }
      const entries = Object.entries(params.set);
      if (!entries.length || entries.some(([context, entry]) => {
        const at = known.get(context);
        return !at || ('choices' in entry && entry.choices.some((c) => !at.choices.has(c)));
      })) return false;
      if (await store.get(souls.event(params.eventId))) return true;
      const key = answerSetKey(params.set);
      const nodes: Array<[string, GraphNode]> = entries.map(([context, entry]) => {
        let node: GraphNode;
        if ('typed' in entry) node = { ...entry.typed } as GraphNode;
        else if (entry.choices.length === 1) node = { a: link(souls.answer(entry.choices[0]!)) };
        else {
          const sorted = [...new Set(entry.choices)].sort();
          node = { n: sorted.length, ...Object.fromEntries(sorted.map((c, i) => [String(i), link(souls.answer(c))])) };
        }
        return [souls.answerSetEntry(key, context), node];
      });
      nodes.push([souls.answerSet(key), { v }]);
      const exists = await Promise.all(nodes.map(([soul]) => store.get(soul)));
      const prefix = options.prefix ?? 'local/';
      const people = await personWrites(store, prefix, [{ userId: params.byUser }], now());
      const event: GraphNode = {
        v, when: params.when, device: params.device, by: link(personSoul(prefix, params.byUser)),
        talk: link(souls.event(params.talkId)), gave: link(souls.answerSet(key)), mode: params.mode,
      };
      if (params.replaces) event.replaces = link(souls.event(params.replaces));
      const at = link(souls.event(params.eventId));
      const userKey = encodeURIComponent(params.byUser);
      await Promise.all([
        ...nodes.filter((_, i) => !exists[i]).map(([soul, node]) => store.put(soul, node)),
        ...people.map(([soul, node]) => store.put(soul, node)),
        store.put(theirQuestionsSoul(souls, params.eventId), Object.fromEntries(entries.map(([context]) => [context, known.get(context)!.questionKey]))),
        putEvent(store, souls, params.eventId, event),
        store.put(souls.index(`theirs/${params.talkId}`), { [params.byUser]: at }),
        ...entries.map(([context]) => store.put(souls.index(`q/${known.get(context)!.questionKey}/theirs`), { [params.eventId]: at })),
        addToIndex(store, souls.index(`talk/${params.talkId}/ev`), { key: params.eventId, target: souls.event(params.eventId), when: params.when }),
        addToIndex(store, souls.index(`person/${userKey}/ev`), { key: params.eventId, target: souls.event(params.eventId), when: params.when }),
      ]);
      return true;
    },

    /**
     * Someone deleted their answer to my Talk: their deletion event is kept, and their answers to
     * it leave my indexes. Only the person who answered may delete it.
     */
    async receiveAnswerDeletion(params: { talkId: string; eventId: string; byUser: string; when: number; device: string; answerEventId: string }): Promise<boolean> {
      const answer = await store.get(souls.event(params.answerEventId));
      const prefix = options.prefix ?? 'local/';
      if (!answer || personIdOf(prefix, linkSoul(answer.by)) !== params.byUser) return false;
      const event: GraphNode = {
        v, when: params.when, device: params.device, by: link(personSoul(prefix, params.byUser)),
        talk: link(souls.event(params.talkId)), re: link(souls.event(params.answerEventId)), deleted: true,
      };
      const clears = await theirAnswerClears(store, souls, params.talkId, params.byUser, params.answerEventId);
      await Promise.all([putEvent(store, souls, params.eventId, event), ...clears.map(([soul, node]) => store.put(soul, node))]);
      return true;
    },

    /** Everyone's latest answer to my Talk: user ID → their answer event id. */
    async theirs(talkId: string): Promise<Record<string, string>> {
      const node = await store.get(souls.index(`theirs/${talkId}`));
      const out: Record<string, string> = {};
      for (const [userId, value] of Object.entries(node || {})) {
        const soul = linkSoul(value);
        if (soul) out[userId] = soul.slice(souls.event('').length);
      }
      return out;
    },

    /** The answer set of any answer event, as context hash → entry (keys only). */
    async answerSet(eventId: string): Promise<Record<string, AnswerSetEntry> | undefined> {
      const event = await store.get(souls.event(eventId));
      const setSoul = linkSoul(event?.gave);
      if (!setSoul) return undefined;
      const sidecar = await store.get(event?.by ? theirQuestionsSoul(souls, eventId) : answerQuestionsSoul(souls, eventId));
      const out: Record<string, AnswerSetEntry> = {};
      for (const context of Object.keys(sidecar || {})) {
        const entry = await store.get(`${setSoul}/${context}`);
        if (!entry) continue;
        if (typeof entry.kind === 'string') { out[context] = { typed: { ...entry } as unknown as BuiltInValues }; continue; }
        const choices = [linkSoul(entry.a), ...Array.from({ length: Number(entry.n || 0) }, (_, i) => linkSoul(entry[String(i)]))]
          .filter((soul): soul is string => !!soul).map((soul) => soul.slice(souls.answer('').length));
        out[context] = { choices };
      }
      return out;
    },

    /** My latest answer event to a Talk, if any ("already answered", replaces `answeredTalkByContent`). */
    async answered(talkId: string): Promise<string | undefined> {
      const node = await store.get(souls.index(`answered/${talkId}`));
      const soul = linkSoul(node?.ev);
      return soul ? soul.slice(souls.event('').length) : undefined;
    },

    /** Set the Whenever offered list for a question, highest priority first (choice texts). */
    async setWhenever(questionKey: string, answerTexts: string[]): Promise<void> {
      const keys = [...new Set(answerTexts)];
      for (const text of keys) await putIfAbsent(souls.answer(answerKey(text)), { v, text, firstSeen: now() });
      const node: GraphNode = { n: keys.length };
      // Clear old positions past the new length, so a shorter list does not keep stale entries.
      const old = await store.get(souls.index(`whenever/${questionKey}`));
      for (const field of Object.keys(old || {})) if (/^\d+$/.test(field) && Number(field) >= keys.length) node[field] = null;
      keys.forEach((text, i) => { node[String(i)] = link(souls.answer(answerKey(text))); });
      await store.put(souls.index(`whenever/${questionKey}`), node);
    },

    /**
     * What the chatbot answers for this Talk, by key lookups only (D4): walk the Talk from its
     * first question; each question is answered from Same context (`ix/ctx`), else from Whenever
     * offered (`ix/whenever`) when one of its choices is offered. The walk stops at the first
     * question it cannot answer (`pending`), which the user then answers.
     */
    async chatbot(structure: TalkStructure, perspective: Perspective = 'responder'): Promise<{ answers: ChatbotAnswer[]; pending?: string; complete: boolean }> {
      const byId = new Map(structure.questions.map((q) => [q.id, q]));
      const qKeys = questionKeysOf(structure, perspective);
      const answers: ChatbotAnswer[] = [];
      const steps: AnswerStep[] = [];
      const queue: string[] = structure.type === 'survey' ? structure.questions.map((q) => q.id) : (structure.questions[0] ? [structure.questions[0].id] : []);
      const seen = new Set<string>();
      while (queue.length) {
        const qid = queue.shift()!;
        if (seen.has(qid)) continue;
        seen.add(qid);
        const question = byId.get(qid);
        if (!question) continue;
        let answer: ChatbotAnswer | undefined;
        const pairOnly = question.reciprocalTagContext ? singleNonIgnoreAnswer(question) : undefined;
        if (pairOnly) {
          // A Pair-tag question with one real choice declares the pair; it has nothing to decide.
          answer = { questionId: qid, answerIds: [pairOnly.id], reason: 'pair-tag' };
        } else if (question.builtIn) {
          // Computed from my declared values each time (they may have changed), never remembered.
          const mine = await this.typed(qKeys.get(qid)!);
          const compatible = builtInCompatible(builtInValues(question.builtIn), mine, tagScopeFor(structure, question, perspective).counterpartTag);
          const chosen = compatible === undefined ? undefined : pickBuiltInAnswer(question.answers, qid, { action: 'ANSWER', compatible });
          if (chosen && mine) answer = { questionId: qid, answerIds: [chosen.id], typed: mine, reason: 'built-in' };
        } else {
          const [situated] = situate(structure, [...steps, { questionId: qid }], perspective).slice(-1);
          const found = await this.lookupContext(situated!.contextHash, question);
          if (found) answer = { questionId: qid, ...found, reason: 'same-context' };
        }
        if (!answer && !question.builtIn && !pairOnly) {
          const offered = await this.lookupWhenever(qKeys.get(qid)!, question);
          if (offered.length) answer = { questionId: qid, answerIds: question.answerSelectionMode === 'multiple' ? offered : [offered[0]!], reason: 'whenever-offered' };
        }
        if (!answer) return { answers, pending: qid, complete: false };
        answers.push(answer);
        steps.push({ questionId: qid, ...(answer.answerIds ? { answerIds: answer.answerIds } : {}), ...(answer.typed ? { typed: answer.typed } : {}) });
        if (structure.type === 'survey') continue;
        const chosen = question.answers.filter((a) => answer!.answerIds?.includes(a.id));
        if (chosen.some((a) => a.isTerminal || a.isIgnore)) break;
        const next = chosen.flatMap((a) => a.nextQuestionIds || (a.nextQuestionId ? [a.nextQuestionId] : []));
        for (const branch of question.branchingLogic || []) if (answer.answerIds?.includes(branch.answerId)) next.push(branch.nextQuestionId);
        if (next.length) queue.push(...next);
        else if (question.nextQuestionId) queue.push(question.nextQuestionId);
      }
      return { answers, complete: true };
    },

    /** My declared values for a built-in question, if any. */
    async typed(questionKey: string): Promise<BuiltInValues | undefined> {
      const node = await store.get(souls.index(`typed/${questionKey}`));
      if (!node || typeof node.kind !== 'string') return undefined;
      const values: BuiltInValues = { kind: node.kind };
      for (const field of ['quantity', 'min', 'max', 'start', 'end', 'age', 'rangeMin', 'rangeMax'] as const) {
        if (typeof node[field] === 'number') values[field] = node[field] as number;
      }
      return values;
    },

    /** Same context: the remembered answer for this situation, as choice ids of this question. */
    async lookupContext(context: string, question: StructureQuestion): Promise<{ answerIds?: string[]; typed?: BuiltInValues } | undefined> {
      const index = await store.get(souls.index(`ctx/${context}`));
      const entrySoul = linkSoul(index?.entry);
      const entry = entrySoul ? await store.get(entrySoul) : null;
      if (!entry) return undefined;
      if (typeof entry.kind === 'string') {
        const { ...typed } = entry;
        return { typed: typed as unknown as BuiltInValues };
      }
      const chosen = new Set<string>();
      const single = linkSoul(entry.a);
      if (single) chosen.add(single);
      for (let i = 0; i < Number(entry.n || 0); i += 1) { const soul = linkSoul(entry[String(i)]); if (soul) chosen.add(soul); }
      // The context hash commits to the choice set, so every remembered choice is offered here.
      const answerIds = question.answers.filter((a) => chosen.has(souls.answer(answerKey(a.text)))).map((a) => a.id);
      return answerIds.length === chosen.size && answerIds.length ? { answerIds } : undefined;
    },

    /** Whenever offered: the question's offered choices in my priority order (choice ids). */
    async lookupWhenever(questionKey: string, question: StructureQuestion): Promise<string[]> {
      const node = await store.get(souls.index(`whenever/${questionKey}`));
      if (!node) return [];
      const out: string[] = [];
      for (let i = 0; i < Number(node.n || 0); i += 1) {
        const soul = linkSoul(node[String(i)]);
        const offered = question.answers.find((a) => !a.isIgnore && soul === souls.answer(answerKey(a.text)));
        if (offered) out.push(offered.id);
      }
      return out;
    },

    /**
     * The Me tab: each question I answered, newest first, with my latest answer event in each of
     * its situations. Reads one bucket per month, so `months` bounds the cost.
     */
    async me(options: { months?: number } = {}): Promise<Array<{ questionKey: string; text: string; contexts: Array<{ contextHash: string; eventId: string }> }>> {
      const entries = await readIndex(store, souls.index('me'), options.months ? { limitBuckets: options.months } : {});
      const seen = new Set<string>();
      const out: Array<{ questionKey: string; text: string; contexts: Array<{ contextHash: string; eventId: string }> }> = [];
      for (const entry of entries) {
        if (seen.has(entry.key)) continue;
        seen.add(entry.key);
        const [question, mine] = await Promise.all([store.get(souls.question(entry.key)), store.get(entry.target)]);
        const contexts = Object.entries(mine || {})
          .map(([contextHash, value]) => ({ contextHash, eventId: (linkSoul(value) || '').slice(souls.event('').length) }))
          .filter((c) => c.eventId)
          .sort((a, b) => (a.eventId < b.eventId ? 1 : -1));
        out.push({ questionKey: entry.key, text: String(question?.text ?? ''), contexts });
      }
      return out;
    },

    /** The choice texts an answer event gave in one situation. */
    async gaveTexts(eventId: string, context: string): Promise<string[]> {
      const event = await store.get(souls.event(eventId));
      const setSoul = linkSoul(event?.gave);
      const entry = setSoul ? await store.get(`${setSoul}/${context}`) : null;
      if (!entry) return [];
      const choiceSouls = [linkSoul(entry.a), ...Array.from({ length: Number(entry.n || 0) }, (_, i) => linkSoul(entry[String(i)]))].filter(Boolean) as string[];
      const texts = await Promise.all(choiceSouls.map(async (soul) => String((await store.get(soul))?.text ?? '')));
      return texts;
    },
  };
}
