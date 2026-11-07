/**
 * Answers in the device graph (spec §31.4, §31.5, §31.8): situations (context hashes), answer
 * sets, answer events, and the indexes the chatbot and the Me tab read with one key each.
 *
 *   s/<hash>                 { v }                                 the answers, content
 *   s/<hash>/<context>       { a: →a/… } | { n, 0: →a/…, … } | { kind, …typed values }
 *   ev/<id>                  { v, when, device, with?, talk, re?, gave: →s/…, mode }
 *   ix/ctx/<context>         { entry: →s/<hash>/<context>, mode, reuse, ev: →ev/…, when }   Same context
 *   ix/whenever/<questionKey>{ n, 0: →a/…, … }                     Whenever offered, priority order
 *   ix/typed/<typedKey>      { kind, …values, ev, when }           my declared built-in values
 *   ix/passed/<questionKey>  { passed: true, when }                a one-keyword tag I passed
 *   ix/q/<questionKey>/mine  { <context>: →ev/… }                  Me tab: my answers to one question
 *   ix/me                    bucketed: questionKey → ix/q/<questionKey>/mine
 *   ix/answered/<talkId>     { ev: →ev/… }                          "already answered"
 *   ev/<deleteId>            { v, when, device, with?, talk, re: →my answer, deleted: true }
 *
 * Someone else's answer to my Talk (received over the pair's link, `sync/graph-sync.ts`):
 *   ev/<theirId>             { v, when, device, by: →person, talk, re?, gave: →s/…, mode }
 *   ix/theirs/<talkId>       keyed buckets: <userId> → ev/<theirId>   their latest answer, per person
 *   ix/q/<questionKey>/theirs bucketed by month: <theirId> → ev       Me → Contacts
 *   ix/talk/<talkId>/ev, ix/person/<userId>/ev   bucketed event lists
 *
 * Repeating the same answers writes one new answer event and no content (REQ-GRAPH-22).
 */
import { answerExtrasSoul, answerQuestionsSoul, putEvent, type AnswerExtras } from './events';
import type { EventChainSigner } from './chain';
import { personIdOf, personSoul, personWrites } from './people-graph';
import { ageRangeMutuallyAcceptable, intervalsOverlap, quantitySufficient } from '../../shared/built-in-comparisons';
import { pickBuiltInAnswer } from '../../shared/built-in-question-resolution';
import { getRouteRootChildQuestionIds, singleNonIgnoreAnswer } from '../../shared/talk-engine';
import { addToIndex, bucketOf, readIndex } from './index-buckets';
import { keyedBucketSoul, putKeyed, readKeyed } from './keyed-buckets';
import { answerKey, answerSetKey, contextHash, type AnswerSetEntry, type BuiltInValues } from './keys';
import { link, linkSoul, type GraphNode, type NodeStore } from './node-store';
import {
  GRAPH_SCHEMA_VERSION, builtInValues, graphSouls, questionKeysOf, readTalkStructure, tagScopeFor, typedIndexKey,
  type Perspective, type StructureQuestion, type TalkStructure,
} from './talk-structure';
import type { EventIds } from './talk-events';

/**
 * How the chatbot may reuse an answer (the answer dialog's choice): `auto` in this same situation
 * again, `once` never (shown as a suggestion only), `whenever` for this question wherever one of
 * the chosen choices is offered.
 */
export type Reuse = 'auto' | 'once' | 'whenever';

/** One answered question: the chosen choice ids, or a built-in's typed value. */
export type AnswerStep = { questionId: string; answerIds?: string[]; typed?: BuiltInValues; reuse?: Reuse };

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
    // A Pair-tag question is never a parent: its text and answer are the two sides swapped between
    // the buy Talk and the sell Talk (its side is in the tag scope instead), so the questions after
    // it are in the same situation on both (`immediateParentQAPairs` did the same).
    let parent: SituatedAnswer | undefined;
    if (structure.type === 'route' && question.contextPath) {
      for (const step of [...question.contextPath].reverse()) {
        if (byId.get(step.questionId)?.reciprocalTagContext) continue;
        parent = done.get(step.questionId);
        break;
      }
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
    if (!question.reciprocalTagContext) previous = situated;
  }
  return out;
}

/**
 * The situation of a question asked first (no parent answer): an answer given there is my default
 * for the same question asked later in a flow, when nothing was remembered for that exact place.
 */
export function rootContextOf(structure: TalkStructure, questionId: string, perspective: Perspective): string | undefined {
  const question = structure.questions.find((q) => q.id === questionId);
  return question ? contextOf(structure, question, undefined, perspective) : undefined;
}

function contextOf(structure: TalkStructure, question: StructureQuestion, parent: SituatedAnswer | undefined, perspective: Perspective): string {
  return contextHash({
    type: structure.type,
    language: structure.language,
    parent: parent ? { contextHash: parent.contextHash, answers: parent.chosenTexts } : undefined,
    question: question.text,
    choices: question.answers.map((a) => a.text),
    // A built-in question's kind, not its values: those are what is compared, not where it is
    // asked, so the questions after it are in the same situation whatever range a Talk asks.
    builtIn: question.builtIn ? { kind: question.builtIn.kind } : undefined,
    selection: question.answerSelectionMode || 'single',
    ...tagScopeFor(structure, question, perspective),
  });
}

export type ChatbotAnswer = {
  questionId: string;
  answerIds?: string[];
  typed?: BuiltInValues;
  reason: 'same-context' | 'root-context' | 'whenever-offered' | 'built-in' | 'pair-tag';
};

/** One thing the chatbot remembers, as the Preferences dialog lists it (`remembered()`). */
export type RememberedAnswer = {
  key: string;
  questionKey: string;
  questionText: string;
  answerTexts: string[];
  /** The choices offered in that situation (to change the answer to), if known. */
  choices: string[];
  reuse: Reuse;
  when: number;
};

/** A question's answer from the chatbot's lookups: `auto` when it may answer it by itself. */
export type ChatbotSuggestion = ChatbotAnswer & { auto: boolean };

/**
 * Everything the chatbot looks up for one Talk, read once (`chatbotView`), so a question can be
 * resolved without a read: the answer dialog resolves each question as the user goes.
 */
export type ChatbotView = {
  /** Remembered answers by situation: choice keys (or typed values) and how they may be reused. */
  ctx: Record<string, { choices?: string[]; typed?: BuiltInValues; reuse: Reuse }>;
  /** Whenever offered, per question key: choice keys, highest priority first. */
  whenever: Record<string, string[]>;
  /** My declared values per built-in question id of this Talk. */
  typed: Record<string, BuiltInValues>;
  /** Per location question id: whether our places contain each other (only with my consent). */
  location: Record<string, boolean>;
  /** A one-keyword tag I passed before. */
  passed: boolean;
};

export type ChatbotViewOptions = {
  /** The Talk's title: built-in values are kept per title (`typedIndexKey`). */
  title?: string;
  /** Whether the places compare compatible for a location question (undefined: ask me). */
  locationCompatible?: (question: StructureQuestion) => boolean | undefined;
};

/** The chosen choice ids of a remembered entry, when every remembered choice is offered here. */
function choiceIdsOf(entry: { choices?: string[] } | undefined, question: StructureQuestion): string[] | undefined {
  if (!entry?.choices?.length) return undefined;
  const wanted = new Set(entry.choices);
  const answerIds = question.answers.filter((a) => wanted.has(answerKey(a.text))).map((a) => a.id);
  return answerIds.length === wanted.size ? answerIds : undefined;
}

/**
 * One question's answer from a view, after `steps` (the answers so far, in answering order). In
 * order: a Pair-tag question with one real choice; a built-in compared with my values; the answer
 * remembered for this situation; my default from where the question is asked first; Whenever
 * offered; else a Just once answer for this situation as a suggestion only (spec §30.2/§30.8).
 */
export function resolveChatbotQuestion(structure: TalkStructure, perspective: Perspective, view: ChatbotView, steps: AnswerStep[], questionId: string): ChatbotSuggestion | undefined {
  const question = structure.questions.find((q) => q.id === questionId);
  if (!question) return undefined;
  const pairOnly = question.reciprocalTagContext ? singleNonIgnoreAnswer(question) : undefined;
  // A Pair-tag question with one real choice declares the pair; it has nothing to decide.
  if (pairOnly) return { questionId, answerIds: [pairOnly.id], reason: 'pair-tag', auto: true };
  if (question.builtIn) {
    // Computed from my declared values each time (they may have changed), never remembered.
    const mine = view.typed[questionId];
    const compatible = question.builtIn.kind === 'location'
      ? view.location[questionId]
      : builtInCompatible(builtInValues(question.builtIn), mine, tagScopeFor(structure, question, perspective).counterpartTag);
    const chosen = compatible === undefined ? undefined : pickBuiltInAnswer(question.answers, questionId, { action: 'ANSWER', compatible });
    if (!chosen) return undefined;
    return { questionId, answerIds: [chosen.id], ...(mine ? { typed: mine } : {}), reason: 'built-in', auto: true };
  }
  const known = steps.filter((step) => step.questionId !== questionId && structure.questions.some((q) => q.id === step.questionId));
  let context: string;
  try {
    context = situate(structure, [...known, { questionId }], perspective).at(-1)!.contextHash;
  } catch {
    return undefined; // an answer so far is not a choice of this Talk (the dialog's Ignore)
  }
  const exact = view.ctx[context];
  const exactIds = choiceIdsOf(exact, question);
  if (exactIds && exact!.reuse === 'auto') return { questionId, answerIds: exactIds, reason: 'same-context', auto: true };
  const root = rootContextOf(structure, questionId, perspective);
  if (root && root !== context) {
    const rootEntry = view.ctx[root];
    const rootIds = choiceIdsOf(rootEntry, question);
    if (rootIds && rootEntry!.reuse === 'auto') return { questionId, answerIds: rootIds, reason: 'root-context', auto: true };
  }
  const questionKeyOfIt = questionKeysOf(structure, perspective).get(questionId)!;
  const offered: string[] = [];
  for (const key of view.whenever[questionKeyOfIt] || []) {
    const answer = question.answers.find((a) => !a.isIgnore && answerKey(a.text) === key);
    if (answer && !offered.includes(answer.id)) offered.push(answer.id);
  }
  if (offered.length) {
    return { questionId, answerIds: question.answerSelectionMode === 'multiple' ? offered : [offered[0]!], reason: 'whenever-offered', auto: true };
  }
  if (exactIds) return { questionId, answerIds: exactIds, reason: 'same-context', auto: false };
  return undefined;
}

/**
 * What the chatbot answers for a Talk from a view: walk it from its first question (a
 * matchThreshold route: each of the root's specs, independently); the walk stops at the first
 * question it cannot answer by itself (`pending`). A fan-out's specs it cannot answer are left
 * out, as an unanswered spec counts as not passed.
 */
export function walkChatbot(structure: TalkStructure, perspective: Perspective, view: ChatbotView): { answers: ChatbotAnswer[]; pending?: string; complete: boolean } {
  const byId = new Map(structure.questions.map((q) => [q.id, q]));
  const answers: ChatbotAnswer[] = [];
  const steps: AnswerStep[] = [];
  const toAnswer = (suggestion: ChatbotSuggestion): ChatbotAnswer => {
    const { auto: _auto, ...answer } = suggestion;
    return answer;
  };
  const routeSpecs = getRouteRootChildQuestionIds(structure as any);
  if (routeSpecs) {
    for (const qid of routeSpecs) {
      const found = resolveChatbotQuestion(structure, perspective, view, [], qid);
      if (!found?.auto) return { answers, pending: qid, complete: false };
      answers.push(toAnswer(found));
    }
    return { answers, complete: true };
  }
  const queue: string[] = structure.type === 'survey' ? structure.questions.map((q) => q.id) : (structure.questions[0] ? [structure.questions[0].id] : []);
  const optional = new Set<string>();
  const seen = new Set<string>();
  while (queue.length) {
    const qid = queue.shift()!;
    if (seen.has(qid)) continue;
    seen.add(qid);
    const question = byId.get(qid);
    if (!question) continue;
    const found = resolveChatbotQuestion(structure, perspective, view, steps, qid);
    if (!found?.auto) {
      if (optional.has(qid)) continue;
      return { answers, pending: qid, complete: false };
    }
    const answer = toAnswer(found);
    answers.push(answer);
    steps.push({ questionId: qid, ...(answer.answerIds ? { answerIds: answer.answerIds } : {}), ...(answer.typed ? { typed: answer.typed } : {}) });
    if (structure.type === 'survey') continue;
    const chosen = question.answers.filter((a) => answer.answerIds?.includes(a.id));
    // A terminal answer ends the walk, or only its own spec inside a fan-out.
    if (chosen.some((a) => a.isTerminal || a.isIgnore)) {
      if (optional.has(qid)) continue;
      break;
    }
    const fanOut = chosen.flatMap((a) => a.nextQuestionIds || []);
    for (const id of fanOut) optional.add(id);
    const next = [...fanOut, ...chosen.flatMap((a) => (a.nextQuestionId ? [a.nextQuestionId] : []))];
    for (const branch of question.branchingLogic || []) if (answer.answerIds?.includes(branch.answerId)) next.push(branch.nextQuestionId);
    if (!next.length && question.nextQuestionId) next.push(question.nextQuestionId);
    // Everything after a fan-out spec is part of that spec: one it cannot finish is left out.
    if (optional.has(qid)) for (const id of next) optional.add(id);
    queue.push(...next);
  }
  return { answers, complete: true };
}

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
      if (linkSoul(ctx?.ev) === at) out.push([souls.index(`ctx/${context}`), { entry: null, mode: null, reuse: null, ev: null, when: null }]);
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
      // A matchThreshold route's specs are answered without the root (each on its own), so each
      // question is also answerable with no parent.
      if (path.length) {
        const [alone] = situate(structure, [{ questionId: q.id, answerIds: [] }], perspective);
        out.set(alone!.contextHash, { contextHash: alone!.contextHash, questionId: q.id, questionKey: alone!.questionKey, choices: new Set(q.answers.map((a) => answerKey(a.text))) });
      }
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
    const when = Number(event?.when ?? 0);
    for (const questionKey of new Set(Object.values(questions || {}).filter((k): k is string => typeof k === 'string'))) {
      if (when) out.push([`${souls.index(`q/${questionKey}/theirs`)}/${bucketOf(when, 'month')}`, { [current]: null }]);
    }
    if (when) out.push([`${souls.index(`talk/${talkId}/ev`)}/${bucketOf(when, 'month')}`, { [current]: null }]);
    current = (linkSoul(event?.replaces) || '').slice(souls.event('').length) || undefined;
  }
  const bucket = keyedBucketSoul(souls.index(`theirs/${talkId}`), byUser);
  const theirs = await store.get(bucket);
  if (seen.has((linkSoul(theirs?.[byUser]) || '').slice(souls.event('').length))) out.push([bucket, { [byUser]: null }]);
  return out;
}

export function createAnswerGraph(store: NodeStore, ids: EventIds, options: { prefix?: string; now?: () => number; chain?: EventChainSigner } = {}) {
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
  /**
   * A change made in the Preferences dialog, kept as a private event (spec §31.8: indexes are
   * rebuildable): the Whenever list as it now is, or a situation's remembered answer as it now is.
   * The crash rebuild replays these in time order with the answer events.
   */
  async function recordPreference(fields: GraphNode): Promise<void> {
    const when = now();
    await putEvent(store, souls, await ids.next(when), { v, when, device: await ids.deviceId(), ...fields }, options.chain);
  }

  /** Write a question's Whenever list (answer souls, first preference first), and record it. */
  async function putWheneverList(questionKey: string, list: string[], old: GraphNode | null, record: boolean): Promise<void> {
    const node: GraphNode = { n: list.length };
    for (const field of Object.keys(old || {})) if (/^\d+$/.test(field) && Number(field) >= list.length) node[field] = null;
    list.forEach((soul, j) => { node[String(j)] = link(soul); });
    await store.put(souls.index(`whenever/${questionKey}`), node);
    if (record) await recordPreference({ pref: 'whenever', q: questionKey, n: list.length, ...Object.fromEntries(list.map((soul, j) => [String(j), link(soul)])) });
  }

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
      /** The Talk's title: a built-in value I give is my declaration for that title. */
      title?: string;
    }): Promise<string> {
      const when = now();
      const perspective = params.perspective ?? 'responder';
      const situated = situate(params.structure, params.steps, perspective);
      const byId = new Map(params.structure.questions.map((q) => [q.id, q]));
      const extras = situated.map((s, i): AnswerExtras => {
        const reuse = params.steps[i]?.reuse;
        const question = byId.get(s.questionId)!;
        return {
          ...(reuse === 'once' || (reuse === 'whenever' && 'choices' in s.entry) ? { reuse } : {}),
          ...('typed' in s.entry ? { typed: typedIndexKey(params.structure, question, s.questionKey, params.title ?? (params.structure as { title?: string }).title) } : {}),
        };
      });
      const eventId = await ids.next(when);
      // The sidecars go with the set, before the event: an answer event that exists always has
      // them, so the chatbot and Me tab indexes can be rebuilt (REQ-GRAPH-02).
      const extrasNode = Object.fromEntries(situated.flatMap((s, i) => (Object.keys(extras[i]!).length ? [[s.contextHash, JSON.stringify(extras[i])]] : [])));
      const setKey = await writeAnswerSet(situated, [
        [answerQuestionsSoul(souls, eventId), Object.fromEntries(situated.map((s) => [s.contextHash, s.questionKey]))],
        ...(Object.keys(extrasNode).length ? [[answerExtrasSoul(souls, eventId), extrasNode] as [string, GraphNode]] : []),
      ]);
      // The question and choice texts, for a Talk whose structure the graph does not hold (one
      // only the app has): the Me tab and the Preferences dialog show them.
      await Promise.all(situated.flatMap((s) => {
        const question = byId.get(s.questionId)!;
        const scope = tagScopeFor(params.structure, question, perspective);
        return [
          putIfAbsent(souls.question(s.questionKey), {
            v, text: question.text, language: params.structure.language, selection: question.answerSelectionMode || 'single',
            ...(scope.selfTag ? { selfTag: scope.selfTag } : {}), ...(scope.counterpartTag ? { counterpartTag: scope.counterpartTag } : {}), firstSeen: when,
          }),
          ...s.chosenTexts.map((text) => putIfAbsent(souls.answer(answerKey(text)), { v, text, firstSeen: when })),
        ];
      }));
      // Whenever offered: the chosen choices go first in the question's list (choosing again
      // makes an answer my first preference; the others stay behind it).
      const whenever = await Promise.all(situated.map(async (s, i) => {
        if (extras[i]!.reuse !== 'whenever' || !('choices' in s.entry)) return [];
        const texts = s.chosenTexts;
        await Promise.all(texts.map((text) => putIfAbsent(souls.answer(answerKey(text)), { v, text, firstSeen: when })));
        const old = await store.get(souls.index(`whenever/${s.questionKey}`));
        const chosen = texts.map((text) => souls.answer(answerKey(text)));
        const kept = Array.from({ length: Number(old?.n || 0) }, (_, j) => linkSoul(old?.[String(j)])).filter((soul): soul is string => !!soul && !chosen.includes(soul));
        const list = [...new Set([...chosen, ...kept])];
        const node: GraphNode = { n: list.length };
        for (const field of Object.keys(old || {})) if (/^\d+$/.test(field) && Number(field) >= list.length) node[field] = null;
        list.forEach((soul, j) => { node[String(j)] = link(soul); });
        return [store.put(souls.index(`whenever/${s.questionKey}`), node)];
      }));
      const event: GraphNode = {
        v, when, device: await ids.deviceId(), talk: link(souls.event(params.talkId)), gave: link(souls.answerSet(setKey)), mode: params.mode,
      };
      if (params.withUser) event.with = link(personSoul(options.prefix ?? 'local/', params.withUser));
      if (params.re) event.re = link(souls.event(params.re));
      if (params.replaces) event.replaces = link(souls.event(params.replaces));
      const at = link(souls.event(eventId));
      // The event and every index it implies, in one batch (all rebuildable from the event).
      await Promise.all([
        putEvent(store, souls, eventId, event, options.chain),
        ...whenever.flat(),
        ...situated.flatMap((s, i) => [
          // A Whenever offered answer replaces what was remembered for this exact situation.
          extras[i]!.reuse === 'whenever'
            ? store.put(souls.index(`ctx/${s.contextHash}`), { entry: null, mode: null, reuse: null, ev: null, when: null })
            : store.put(souls.index(`ctx/${s.contextHash}`), { entry: link(souls.answerSetEntry(setKey, s.contextHash)), mode: params.mode, reuse: extras[i]!.reuse ?? 'auto', ev: at, when }),
          store.put(souls.index(`q/${s.questionKey}/mine`), { [s.contextHash]: at }),
          // My own declared values for a built-in question, read by the chatbot (any Talk asking it).
          ...(extras[i]!.typed && 'typed' in s.entry ? [store.put(souls.index(`typed/${extras[i]!.typed}`), { ...s.entry.typed, ev: at, when } as GraphNode)] : []),
          addToIndex(store, souls.index('me'), { key: s.questionKey, target: souls.index(`q/${s.questionKey}/mine`), when }),
        ]),
        // Answering a tag again takes back an earlier pass of it.
        ...(params.structure.type === 'tag' ? situated.map((s) => store.put(souls.index(`passed/${s.questionKey}`), { passed: null, when: null })) : []),
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
      await Promise.all([putEvent(store, souls, eventId, event, options.chain), ...clears.map(([soul, node]) => store.put(soul, node))]);
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
        putEvent(store, souls, params.eventId, event, options.chain),
        putKeyed(store, souls.index(`theirs/${params.talkId}`), { [params.byUser]: at }),
        ...[...new Set(entries.map(([context]) => known.get(context)!.questionKey))].map((questionKey) =>
          addToIndex(store, souls.index(`q/${questionKey}/theirs`), { key: params.eventId, target: souls.event(params.eventId), when: params.when })),
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
      await Promise.all([putEvent(store, souls, params.eventId, event, options.chain), ...clears.map(([soul, node]) => store.put(soul, node))]);
      return true;
    },

    /** Everyone's latest answer to my Talk: user ID → their answer event id. */
    async theirs(talkId: string): Promise<Record<string, string>> {
      const node = await readKeyed(store, souls.index(`theirs/${talkId}`));
      const out: Record<string, string> = {};
      for (const [userId, value] of Object.entries(node)) {
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
      // Old positions past the new length are cleared, so a shorter list keeps no stale entries.
      const old = await store.get(souls.index(`whenever/${questionKey}`));
      await putWheneverList(questionKey, keys.map((text) => souls.answer(answerKey(text))), old, true);
    },

    /**
     * What the chatbot answers for this Talk, by key lookups only (D4): `walkChatbot` over this
     * Talk's `chatbotView`. The walk stops at the first question it cannot answer (`pending`),
     * which the user then answers.
     */
    async chatbot(structure: TalkStructure, perspective: Perspective = 'responder', viewOptions: ChatbotViewOptions = {}): Promise<{ answers: ChatbotAnswer[]; pending?: string; complete: boolean }> {
      return walkChatbot(structure, perspective, await this.chatbotView(structure, perspective, viewOptions));
    },

    /**
     * Every lookup the chatbot makes for this Talk: each situation it can be answered in and each
     * question's first-asked situation, Whenever offered per question, my built-in values, and
     * whether it is a tag I passed.
     */
    async chatbotView(structure: TalkStructure, perspective: Perspective = 'responder', viewOptions: ChatbotViewOptions = {}): Promise<ChatbotView> {
      const qKeys = questionKeysOf(structure, perspective);
      const contexts = new Set(allSituations(structure, perspective).map((s) => s.contextHash));
      for (const question of structure.questions) contexts.add(rootContextOf(structure, question.id, perspective)!);
      const view: ChatbotView = { ctx: {}, whenever: {}, typed: {}, location: {}, passed: false };
      await Promise.all([...contexts].map(async (context) => {
        const index = await store.get(souls.index(`ctx/${context}`));
        const entrySoul = linkSoul(index?.entry);
        const entry = entrySoul ? await store.get(entrySoul) : null;
        if (!entry) return;
        const reuse: Reuse = index?.reuse === 'once' ? 'once' : 'auto';
        if (typeof entry.kind === 'string') { view.ctx[context] = { typed: { ...entry } as unknown as BuiltInValues, reuse }; return; }
        const choices = [linkSoul(entry.a), ...Array.from({ length: Number(entry.n || 0) }, (_, i) => linkSoul(entry[String(i)]))]
          .filter((soul): soul is string => !!soul).map((soul) => soul.slice(souls.answer('').length));
        if (choices.length) view.ctx[context] = { choices, reuse };
      }));
      await Promise.all(structure.questions.map(async (question) => {
        const key = qKeys.get(question.id)!;
        if (question.builtIn) {
          if (question.builtIn.kind === 'location') {
            const compatible = viewOptions.locationCompatible?.(question);
            if (compatible !== undefined) view.location[question.id] = compatible;
            return;
          }
          const mine = await this.typed(typedIndexKey(structure, question, key, viewOptions.title ?? (structure as { title?: string }).title));
          if (mine) view.typed[question.id] = mine;
          return;
        }
        const node = await store.get(souls.index(`whenever/${key}`));
        const keys = Array.from({ length: Number(node?.n || 0) }, (_, i) => linkSoul(node?.[String(i)]))
          .filter((soul): soul is string => !!soul).map((soul) => soul.slice(souls.answer('').length));
        if (keys.length) view.whenever[key] = keys;
      }));
      const passKey = this.passKey(structure, perspective);
      if (passKey) view.passed = (await store.get(souls.index(`passed/${passKey}`)))?.passed === true;
      return view;
    },

    /** The question key a pass of this Talk is kept under: a tag with one keyword question only. */
    passKey(structure: TalkStructure, perspective: Perspective = 'responder'): string | undefined {
      if (structure.type !== 'tag' || structure.questions.length !== 1 || !structure.questions[0]!.text) return undefined;
      return questionKeysOf(structure, perspective).get(structure.questions[0]!.id);
    },

    /** I passed this tag (the chatbot passes it again when it comes back), or take that back. */
    async pass(structure: TalkStructure, passed = true, perspective: Perspective = 'responder'): Promise<boolean> {
      const key = this.passKey(structure, perspective);
      if (!key) return false;
      await store.put(souls.index(`passed/${key}`), passed ? { passed: true, when: now() } : { passed: null, when: null });
      return true;
    },

    /** My declared values for a built-in question (`typedIndexKey`), if any. */
    async typed(typedKey: string): Promise<BuiltInValues | undefined> {
      const node = await store.get(souls.index(`typed/${typedKey}`));
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
     * What the chatbot remembers (the Preferences dialog): each situation whose answer it reuses or
     * shows, with my answer, the choices offered there and how it is reused; and each question's
     * Whenever offered answers. Newest first.
     */
    async remembered(): Promise<RememberedAnswer[]> {
      const out: RememberedAnswer[] = [];
      const structures = new Map<string, Promise<TalkStructure | undefined>>();
      const structureOf = (talkSoul: string): Promise<TalkStructure | undefined> => {
        let found = structures.get(talkSoul);
        if (!found) {
          found = (async () => {
            const talkId = talkSoul.slice(souls.event('').length);
            const latest = linkSoul((await store.get(souls.mine(`talk/${talkId}`)))?.latest);
            for (const soul of [latest, talkSoul]) {
              const revSoul = soul ? linkSoul((await store.get(soul))?.rev) : undefined;
              const structure = revSoul ? await readTalkStructure(store, revSoul.slice(souls.rev('').length), options.prefix) : undefined;
              if (structure) return structure;
            }
            return undefined;
          })();
          structures.set(talkSoul, found);
        }
        return found;
      };
      const textOf = async (key: string) => String((await store.get(souls.answer(key)))?.text ?? '');
      for (const row of await this.me()) {
        for (const { contextHash, eventId } of row.contexts) {
          const index = await store.get(souls.index(`ctx/${contextHash}`));
          if (linkSoul(index?.ev) !== souls.event(eventId)) continue;
          // The remembered answer (it may have been changed here since the answer event).
          const entry = linkSoul(index?.entry) ? await store.get(linkSoul(index!.entry)!) : null;
          if (!entry || typeof entry.kind === 'string') continue;
          const answerSouls = [linkSoul(entry.a), ...Array.from({ length: Number(entry.n || 0) }, (_, i) => linkSoul(entry[String(i)]))].filter((soul): soul is string => !!soul);
          const answer = await Promise.all(answerSouls.map((soul) => textOf(soul.slice(souls.answer('').length))));
          if (!answer.length) continue;
          const talkSoul = linkSoul((await store.get(souls.event(eventId)))?.talk);
          const structure = talkSoul ? await structureOf(talkSoul) : undefined;
          let choices: string[] = [];
          if (structure) {
            for (const perspective of ['responder', 'author'] as const) {
              const here = allSituations(structure, perspective).find((s) => s.contextHash === contextHash);
              if (here) { choices = await Promise.all([...here.choices].map(textOf)); break; }
            }
          }
          out.push({
            key: `ctx|${contextHash}`, questionKey: row.questionKey, questionText: row.text, answerTexts: answer, choices,
            reuse: index?.reuse === 'once' ? 'once' : 'auto', when: Number(index?.when) || 0,
          });
        }
        const whenever = await store.get(souls.index(`whenever/${row.questionKey}`));
        for (let i = 0; i < Number(whenever?.n || 0); i += 1) {
          const soul = linkSoul(whenever?.[String(i)]);
          if (!soul) continue;
          const key = soul.slice(souls.answer('').length);
          out.push({ key: `whenever|${row.questionKey}|${key}`, questionKey: row.questionKey, questionText: row.text, answerTexts: [await textOf(key)], choices: [], reuse: 'whenever', when: 0 });
        }
      }
      return out.sort((a, b) => b.when - a.when);
    },

    /**
     * Change what the chatbot remembers (`remembered()` keys): how a situation's answer is reused,
     * the answer itself (one of the choices offered there), or forget it.
     */
    async changeRemembered(key: string, change: { reuse?: 'auto' | 'once' } | { answerText: string } | { forget: true }): Promise<boolean> {
      const [kind, first, second] = key.split('|');
      if (kind === 'whenever' && first && second) {
        if (!('forget' in change) && !('reuse' in change && change.reuse === 'once')) return false;
        const node = await store.get(souls.index(`whenever/${first}`));
        const list = Array.from({ length: Number(node?.n || 0) }, (_, i) => linkSoul(node?.[String(i)])).filter((soul): soul is string => !!soul && soul !== souls.answer(second));
        await putWheneverList(first, list, node, true);
        return true;
      }
      if (kind !== 'ctx' || !first) return false;
      const at = souls.index(`ctx/${first}`);
      const index = await store.get(at);
      if (!linkSoul(index?.entry)) return false;
      if ('forget' in change) {
        await store.put(at, { entry: null, mode: null, reuse: null, ev: null, when: null });
        await recordPreference({ pref: 'ctx', context: first, forget: true });
      } else if ('reuse' in change && change.reuse) {
        await store.put(at, { reuse: change.reuse });
        await recordPreference({ pref: 'ctx', context: first, reuse: change.reuse });
      } else if ('answerText' in change) {
        const text = change.answerText;
        await putIfAbsent(souls.answer(answerKey(text)), { v, text, firstSeen: now() });
        const setKey = answerSetKey({ [first]: { choices: [answerKey(text)] } });
        await Promise.all([
          putIfAbsent(souls.answerSet(setKey), { v }),
          putIfAbsent(souls.answerSetEntry(setKey, first), { a: link(souls.answer(answerKey(text))) }),
        ]);
        const when = now();
        await store.put(at, { entry: link(souls.answerSetEntry(setKey, first)), when });
        await recordPreference({ pref: 'ctx', context: first, entry: link(souls.answerSetEntry(setKey, first)), at: when });
      }
      return true;
    },

    /**
     * What the chatbot remembered on another device of mine (a device handoff, spec §11.2): each
     * situation's answer not already remembered here, and Whenever offered answers after my own.
     * Recorded as Preferences events, so the crash rebuild keeps them. Returns how many were taken.
     */
    async importRemembered(rows: RememberedAnswer[]): Promise<number> {
      let imported = 0;
      for (const row of rows) {
        const texts = [...new Set((row.answerTexts ?? []).map(String).filter(Boolean))];
        if (!texts.length || typeof row.questionKey !== 'string') continue;
        for (const text of texts) await putIfAbsent(souls.answer(answerKey(text)), { v, text, firstSeen: now() });
        const answers = texts.map((text) => souls.answer(answerKey(text)));
        if (row.reuse === 'whenever') {
          const old = await store.get(souls.index(`whenever/${row.questionKey}`));
          const list = Array.from({ length: Number(old?.n || 0) }, (_, j) => linkSoul(old?.[String(j)])).filter((soul): soul is string => !!soul);
          const added = answers.filter((soul) => !list.includes(soul));
          if (!added.length) continue;
          await putWheneverList(row.questionKey, [...list, ...added], old, true);
          imported += 1;
          continue;
        }
        const [kind, context] = String(row.key).split('|');
        if (kind !== 'ctx' || !context) continue;
        const at = souls.index(`ctx/${context}`);
        if (linkSoul((await store.get(at))?.entry)) continue; // this device's own answer wins
        const keys = texts.map(answerKey).sort();
        const setKey = answerSetKey({ [context]: { choices: keys } });
        const entry: GraphNode = keys.length === 1
          ? { a: link(souls.answer(keys[0]!)) }
          : { n: keys.length, ...Object.fromEntries(keys.map((key, j) => [String(j), link(souls.answer(key))])) };
        await Promise.all([putIfAbsent(souls.answerSet(setKey), { v }), putIfAbsent(souls.answerSetEntry(setKey, context), entry)]);
        const when = Number(row.when) || now();
        const reuse = row.reuse === 'once' ? 'once' : 'auto';
        await store.put(at, { entry: link(souls.answerSetEntry(setKey, context)), mode: 'import', reuse, when });
        await recordPreference({ pref: 'ctx', context, entry: link(souls.answerSetEntry(setKey, context)), at: when });
        if (reuse === 'once') await recordPreference({ pref: 'ctx', context, reuse });
        imported += 1;
      }
      return imported;
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
