/**
 * A Talk's structure as content nodes (spec §31.4): questions, choices, built-in values, routing,
 * match and ignore rules, thresholds. Everything else about a Talk (title, author, times, place,
 * delivery fields) lives on its events (`talk-events.ts`).
 *
 * Text is stored once per device, in `q/<key>` and `a/<hash>`; structure nodes hold only links.
 * Writing a structure that already exists writes nothing (REQ-GRAPH-22).
 */
import { findTagPairAncestor } from '../../shared/talk-engine';
import { grammarVersionFor } from '../../shared/grammar-filter';
import type { BuiltInQuestionSpec } from '../../shared/types';
import { answerKey, languageCode, questionKey, structureKey, type BuiltInValues, type TagScope } from './keys';
import { link, linkSoul, type GraphNode, type NodeStore } from './node-store';

export const GRAPH_SCHEMA_VERSION = 1;

export type StructureAnswer = {
  id: string;
  text: string;
  nextQuestionId?: string;
  nextQuestionIds?: string[];
  parallelMatchThreshold?: number;
  isMatch?: true;
  isIgnore?: true;
  isTerminal?: true;
};

export type StructureQuestion = {
  id: string;
  text: string;
  answers: StructureAnswer[];
  answerSelectionMode?: 'multiple';
  nextQuestionId?: string;
  branchingLogic?: Array<{ answerId: string; nextQuestionId: string }>;
  contextPath?: Array<{ questionId: string; answerId: string }>;
  isAgeGate?: true;
  isAggregatable?: true;
  reciprocalTagContext?: true;
  tagKind?: 'simple';
  collectionImportance?: 'important' | 'must-have';
  builtIn?: BuiltInQuestionSpec;
};

export type TalkStructure = {
  type: 'flow' | 'survey' | 'tag' | 'route';
  language: string;
  /** The grammar rule set the text passed (`en-v1`), or '' for a language with no filter. */
  grammar: string;
  questions: StructureQuestion[];
  matchThreshold?: number;
  collectionImportance?: 'important' | 'must-have';
};

/* eslint-disable @typescript-eslint/no-explicit-any */

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const nonEmpty = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const IMPORTANCE = new Set(['important', 'must-have']);

function builtInOf(spec: any): BuiltInQuestionSpec | undefined {
  if (!spec || typeof spec !== 'object' || typeof spec.kind !== 'string') return undefined;
  const out: BuiltInQuestionSpec = { kind: spec.kind };
  if (finite(spec.quantity) !== undefined) out.quantity = spec.quantity;
  if (spec.priceRange && finite(spec.priceRange.min) !== undefined && finite(spec.priceRange.max) !== undefined) out.priceRange = { min: spec.priceRange.min, max: spec.priceRange.max };
  if (spec.timeFrame && finite(spec.timeFrame.start) !== undefined && finite(spec.timeFrame.end) !== undefined) out.timeFrame = { start: spec.timeFrame.start, end: spec.timeFrame.end };
  const range = spec.ageRange?.acceptableRange;
  if (spec.ageRange && finite(spec.ageRange.age) !== undefined && range && finite(range.min) !== undefined && finite(range.max) !== undefined) {
    out.ageRange = { age: spec.ageRange.age, acceptableRange: { min: range.min, max: range.max } };
  }
  return out;
}

/** The flat built-in values the graph stores and hashes (D13). */
export function builtInValues(spec: BuiltInQuestionSpec | undefined): BuiltInValues | undefined {
  if (!spec) return undefined;
  const out: BuiltInValues = { kind: spec.kind };
  if (spec.quantity !== undefined) out.quantity = spec.quantity;
  if (spec.priceRange) { out.min = spec.priceRange.min; out.max = spec.priceRange.max; }
  if (spec.timeFrame) { out.start = spec.timeFrame.start; out.end = spec.timeFrame.end; }
  if (spec.ageRange) { out.age = spec.ageRange.age; out.rangeMin = spec.ageRange.acceptableRange.min; out.rangeMax = spec.ageRange.acceptableRange.max; }
  return out;
}

function builtInFromValues(values: GraphNode): BuiltInQuestionSpec {
  const num = (key: string) => finite(values[key]);
  const out: BuiltInQuestionSpec = { kind: String(values.kind) as BuiltInQuestionSpec['kind'] };
  if (num('quantity') !== undefined) out.quantity = num('quantity')!;
  if (num('min') !== undefined && num('max') !== undefined) out.priceRange = { min: num('min')!, max: num('max')! };
  if (num('start') !== undefined && num('end') !== undefined) out.timeFrame = { start: num('start')!, end: num('end')! };
  if (num('age') !== undefined && num('rangeMin') !== undefined && num('rangeMax') !== undefined) {
    out.ageRange = { age: num('age')!, acceptableRange: { min: num('rangeMin')!, max: num('rangeMax')! } };
  }
  return out;
}

/**
 * The part of a Talk that is its structure, in a canonical form: only true flags, no defaults,
 * no retired or derived fields (`cidId`, `contextHashId`, survey counters). Equal structures hash
 * equally, and a structure read back from the graph equals this.
 */
export function talkStructureOf(talk: any): TalkStructure {
  const type = (['flow', 'survey', 'tag', 'route'].includes(talk?.type) ? talk.type : 'flow') as TalkStructure['type'];
  const language = languageCode(talk?.language);
  const structure: TalkStructure = {
    type,
    language,
    grammar: grammarVersionFor(language) || '',
    questions: (Array.isArray(talk?.questions) ? talk.questions : []).map((q: any): StructureQuestion => {
      const question: StructureQuestion = {
        id: String(q?.id ?? ''),
        text: String(q?.text ?? ''),
        answers: (Array.isArray(q?.answers) ? q.answers : []).map((a: any): StructureAnswer => {
          const answer: StructureAnswer = { id: String(a?.id ?? ''), text: String(a?.text ?? '') };
          if (nonEmpty(a?.nextQuestionId)) answer.nextQuestionId = a.nextQuestionId;
          if (Array.isArray(a?.nextQuestionIds) && a.nextQuestionIds.length) answer.nextQuestionIds = a.nextQuestionIds.map(String);
          if (finite(a?.parallelMatchThreshold) !== undefined) answer.parallelMatchThreshold = a.parallelMatchThreshold;
          if (a?.isMatch) answer.isMatch = true;
          if (a?.isIgnore) answer.isIgnore = true;
          if (a?.isTerminal) answer.isTerminal = true;
          return answer;
        }),
      };
      if (q?.answerSelectionMode === 'multiple') question.answerSelectionMode = 'multiple';
      if (nonEmpty(q?.nextQuestionId)) question.nextQuestionId = q.nextQuestionId;
      if (Array.isArray(q?.branchingLogic) && q.branchingLogic.length) {
        question.branchingLogic = q.branchingLogic.map((b: any) => ({ answerId: String(b?.answerId ?? ''), nextQuestionId: String(b?.nextQuestionId ?? '') }));
      }
      if (type === 'route' && Array.isArray(q?.contextPath)) {
        question.contextPath = q.contextPath.map((s: any) => ({ questionId: String(s?.questionId ?? ''), answerId: String(s?.answerId ?? '') }));
      }
      if (q?.isAgeGate) question.isAgeGate = true;
      if (q?.isAggregatable) question.isAggregatable = true;
      if (q?.reciprocalTagContext) question.reciprocalTagContext = true;
      if (q?.tagKind === 'simple') question.tagKind = 'simple';
      if (IMPORTANCE.has(q?.collectionImportance)) question.collectionImportance = q.collectionImportance;
      const builtIn = builtInOf(q?.builtIn);
      if (builtIn) question.builtIn = builtIn;
      return question;
    }),
  };
  if (finite(talk?.matchThreshold) !== undefined) structure.matchThreshold = talk.matchThreshold;
  if (IMPORTANCE.has(talk?.collectionImportance)) structure.collectionImportance = talk.collectionImportance;
  return structure;
}

export function talkStructureKey(structure: TalkStructure): string {
  return structureKey(structure);
}

/** Whose side a Pair tag is read from: the author's, or a responder's (reversed). */
export type Perspective = 'author' | 'responder';

export function tagScopeFor(structure: TalkStructure, question: StructureQuestion, perspective: Perspective): TagScope {
  const pair = findTagPairAncestor(structure, question);
  if (!pair) return {};
  return perspective === 'author'
    ? { selfTag: pair.questionText, counterpartTag: pair.answerText }
    : { selfTag: pair.answerText, counterpartTag: pair.questionText };
}

/** The `q/<key>` of each question, from this reader's side. */
export function questionKeysOf(structure: TalkStructure, perspective: Perspective): Map<string, string> {
  return new Map(structure.questions.map((question) => [question.id, questionKey({
    text: question.text,
    language: structure.language,
    selection: question.answerSelectionMode || 'single',
    ...tagScopeFor(structure, question, perspective),
  })]));
}

/** Soul names. Authored ids are encoded, since they are keys inside a soul. */
export function graphSouls(prefix = 'local/') {
  const id = (value: string) => encodeURIComponent(value);
  return {
    question: (key: string) => `${prefix}q/${key}`,
    answer: (key: string) => `${prefix}a/${key}`,
    rev: (key: string) => `${prefix}rev/${key}`,
    revOrder: (key: string) => `${prefix}rev/${key}/order`,
    revQuestion: (key: string, qid: string) => `${prefix}rev/${key}/q/${id(qid)}`,
    revSub: (key: string, qid: string, name: string) => `${prefix}rev/${key}/q/${id(qid)}/${name}`,
    revAnswer: (key: string, qid: string, aid: string) => `${prefix}rev/${key}/q/${id(qid)}/a/${id(aid)}`,
    revNextMany: (key: string, qid: string, aid: string) => `${prefix}rev/${key}/q/${id(qid)}/a/${id(aid)}/nextMany`,
    event: (eventId: string) => `${prefix}ev/${eventId}`,
    answerSet: (key: string) => `${prefix}s/${key}`,
    answerSetEntry: (key: string, context: string) => `${prefix}s/${key}/${context}`,
    index: (name: string) => `${prefix}ix/${name}`,
    mine: (name: string) => `${prefix}mine/${name}`,
  };
}

// `n` keeps an empty list a non-empty node (Gun has no empty node) and lets a reader check length.
const list = (items: string[]): GraphNode => ({ n: items.length, ...Object.fromEntries(items.map((item, i) => [String(i), item])) });
const pairs = (items: Array<[string, string]>): GraphNode => list(items.flat());
/** A stored list, or undefined when it is missing or shorter than its `n` (not fully read). */
const readList = (node: GraphNode | null): string[] | undefined => {
  if (!node) return undefined;
  const out: string[] = [];
  for (let i = 0; typeof node[String(i)] === 'string'; i += 1) out.push(node[String(i)] as string);
  if (typeof node.n === 'number' && node.n !== out.length) return undefined;
  return out;
};

class Incomplete extends Error {}
const need = <T>(value: T | undefined | null): T => {
  if (value === undefined || value === null) throw new Incomplete();
  return value;
};

/**
 * The soul key a structure is stored under. A structure with a Pair tag links each question to a
 * `q/<key>` of the reader's side, so a responder's copy of it differs from the author's: it is
 * stored as `rev/<hash>-r`. Every other structure is the same from both sides and stored once.
 */
export function storedStructureKey(revKey: string, structure: TalkStructure, perspective: Perspective): string {
  return perspective === 'responder' && structure.questions.some((q) => q.reciprocalTagContext) ? `${revKey}-r` : revKey;
}

export type StructureRecords = { revKey: string; soulKey: string; text: Map<string, GraphNode>; nodes: Array<[string, GraphNode]>; root: [string, GraphNode] };

/** Every node of a structure, without writing anything. */
export function structureRecords(talk: any, options: { perspective: Perspective; prefix?: string | undefined; now: number }): StructureRecords {
  const structure = talkStructureOf(talk);
  const revKey = talkStructureKey(structure);
  const soulKey = storedStructureKey(revKey, structure, options.perspective);
  const souls = graphSouls(options.prefix);
  const qKeys = questionKeysOf(structure, options.perspective);
  const text = new Map<string, GraphNode>();
  const nodes: Array<[string, GraphNode]> = [];
  const v = GRAPH_SCHEMA_VERSION;

  for (const question of structure.questions) {
    const qKey = qKeys.get(question.id)!;
    const scope = tagScopeFor(structure, question, options.perspective);
    text.set(souls.question(qKey), {
      v, text: question.text, language: structure.language, selection: question.answerSelectionMode || 'single',
      ...(scope.selfTag ? { selfTag: scope.selfTag } : {}),
      ...(scope.counterpartTag ? { counterpartTag: scope.counterpartTag } : {}),
      firstSeen: options.now,
    });
    const qNode: GraphNode = { v, q: link(souls.question(qKey)), choices: link(souls.revSub(soulKey, question.id, 'choices')) };
    if (question.nextQuestionId) qNode.next = question.nextQuestionId;
    if (question.isAgeGate) qNode.isAgeGate = true;
    if (question.isAggregatable) qNode.isAggregatable = true;
    if (question.reciprocalTagContext) qNode.reciprocalTagContext = true;
    if (question.tagKind) qNode.tagKind = question.tagKind;
    if (question.collectionImportance) qNode.collectionImportance = question.collectionImportance;
    if (question.builtIn) {
      qNode.builtIn = link(souls.revSub(soulKey, question.id, 'builtIn'));
      nodes.push([souls.revSub(soulKey, question.id, 'builtIn'), { ...builtInValues(question.builtIn) } as GraphNode]);
    }
    if (question.contextPath) {
      qNode.path = link(souls.revSub(soulKey, question.id, 'path'));
      nodes.push([souls.revSub(soulKey, question.id, 'path'), pairs(question.contextPath.map((s) => [s.questionId, s.answerId]))]);
    }
    if (question.branchingLogic) {
      qNode.branch = link(souls.revSub(soulKey, question.id, 'branch'));
      nodes.push([souls.revSub(soulKey, question.id, 'branch'), pairs(question.branchingLogic.map((b) => [b.answerId, b.nextQuestionId]))]);
    }
    nodes.push([souls.revSub(soulKey, question.id, 'choices'), list(question.answers.map((a) => a.id))]);
    for (const answer of question.answers) {
      const aKey = answerKey(answer.text);
      if (!text.has(souls.answer(aKey))) text.set(souls.answer(aKey), { v, text: answer.text, firstSeen: options.now });
      const aNode: GraphNode = { v, a: link(souls.answer(aKey)) };
      if (answer.nextQuestionId) aNode.next = answer.nextQuestionId;
      if (answer.nextQuestionIds) {
        aNode.nextMany = link(souls.revNextMany(soulKey, question.id, answer.id));
        nodes.push([souls.revNextMany(soulKey, question.id, answer.id), list(answer.nextQuestionIds)]);
      }
      if (answer.parallelMatchThreshold !== undefined) aNode.threshold = answer.parallelMatchThreshold;
      if (answer.isMatch) aNode.match = true;
      if (answer.isIgnore) aNode.ignore = true;
      if (answer.isTerminal) aNode.terminal = true;
      nodes.push([souls.revAnswer(soulKey, question.id, answer.id), aNode]);
    }
    nodes.push([souls.revQuestion(soulKey, question.id), qNode]);
  }
  nodes.push([souls.revOrder(soulKey), list(structure.questions.map((q) => q.id))]);
  const root: GraphNode = {
    v, type: structure.type, language: structure.language, grammar: structure.grammar,
    start: structure.questions[0]?.id ?? '', order: link(souls.revOrder(soulKey)),
  };
  if (structure.matchThreshold !== undefined) root.matchThreshold = structure.matchThreshold;
  if (structure.collectionImportance) root.collectionImportance = structure.collectionImportance;
  return { revKey, soulKey, text, nodes, root: [souls.rev(soulKey), root] };
}

/**
 * Store a Talk's structure. Returns its `rev/` key and how many nodes were written: none when the
 * structure is already on the device; text nodes that exist are never rewritten.
 *
 * One read of every node at once, then one write of whatever is missing: Radisk confirms a write
 * only after ~250 ms of batching, so writes that wait on each other cost a quarter second each.
 * A write cut short (the app killed mid-flush) is completed the next time the same structure is
 * written, and a reader never accepts a partial structure (`readTalkStructure`).
 */
export async function writeTalkStructure(
  store: NodeStore,
  talk: any,
  options: { perspective: Perspective; prefix?: string | undefined; now: number },
): Promise<{ revKey: string; soulKey: string; written: number }> {
  const records = structureRecords(talk, options);
  const all: Array<[string, GraphNode]> = [...records.text, ...records.nodes, records.root];
  const exists = await Promise.all(all.map(([soul]) => store.get(soul)));
  const missing = all.filter((_, i) => !exists[i]);
  await Promise.all(missing.map(([soul, node]) => store.put(soul, node)));
  return { revKey: records.revKey, soulKey: records.soulKey, written: missing.length };
}

/** A structure read back from the graph by its soul key, or undefined when it is not (completely) stored. */
export async function readTalkStructure(store: NodeStore, revKey: string, prefix?: string): Promise<TalkStructure | undefined> {
  try {
    return await readStructureOrThrow(store, revKey, graphSouls(prefix));
  } catch (error) {
    if (error instanceof Incomplete) return undefined;
    throw error;
  }
}

async function readStructureOrThrow(store: NodeStore, revKey: string, souls: ReturnType<typeof graphSouls>): Promise<TalkStructure | undefined> {
  const root = await store.get(souls.rev(revKey));
  if (!root) return undefined;
  const getLinked = async (value: unknown) => need(await store.get(need(linkSoul(value))));
  const pairList = (flat: string[]) => {
    const out: Array<[string, string]> = [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
    return out;
  };
  const order = need(readList(await getLinked(root.order)));
  const questions = await Promise.all(order.map(async (qid): Promise<StructureQuestion> => {
    const qNode = need(await store.get(souls.revQuestion(revKey, qid)));
    const qText = await getLinked(qNode.q);
    const choiceIds = need(readList(await getLinked(qNode.choices)));
    const answers = await Promise.all(choiceIds.map(async (aid): Promise<StructureAnswer> => {
      const aNode = need(await store.get(souls.revAnswer(revKey, qid, aid)));
      const aText = await getLinked(aNode.a);
      const answer: StructureAnswer = { id: aid, text: String(aText.text ?? '') };
      if (typeof aNode.next === 'string') answer.nextQuestionId = aNode.next;
      if (aNode.nextMany) answer.nextQuestionIds = need(readList(await getLinked(aNode.nextMany)));
      if (finite(aNode.threshold) !== undefined) answer.parallelMatchThreshold = aNode.threshold as number;
      if (aNode.match === true) answer.isMatch = true;
      if (aNode.ignore === true) answer.isIgnore = true;
      if (aNode.terminal === true) answer.isTerminal = true;
      return answer;
    }));
    const question: StructureQuestion = { id: qid, text: String(qText.text ?? ''), answers };
    if (qText.selection === 'multiple') question.answerSelectionMode = 'multiple';
    if (typeof qNode.next === 'string') question.nextQuestionId = qNode.next;
    if (qNode.branch) {
      question.branchingLogic = pairList(need(readList(await getLinked(qNode.branch))))
        .map(([answerId, nextQuestionId]) => ({ answerId, nextQuestionId }));
    }
    if (qNode.path) {
      question.contextPath = pairList(need(readList(await getLinked(qNode.path))))
        .map(([questionId, answerId]) => ({ questionId, answerId }));
    }
    if (qNode.isAgeGate === true) question.isAgeGate = true;
    if (qNode.isAggregatable === true) question.isAggregatable = true;
    if (qNode.reciprocalTagContext === true) question.reciprocalTagContext = true;
    if (qNode.tagKind === 'simple') question.tagKind = 'simple';
    if (typeof qNode.collectionImportance === 'string' && IMPORTANCE.has(qNode.collectionImportance)) question.collectionImportance = qNode.collectionImportance as 'important' | 'must-have';
    if (qNode.builtIn) question.builtIn = builtInFromValues(await getLinked(qNode.builtIn));
    return question;
  }));
  const structure: TalkStructure = {
    type: root.type as TalkStructure['type'],
    language: String(root.language ?? ''),
    grammar: String(root.grammar ?? ''),
    questions,
  };
  if (finite(root.matchThreshold) !== undefined) structure.matchThreshold = root.matchThreshold as number;
  if (typeof root.collectionImportance === 'string' && IMPORTANCE.has(root.collectionImportance)) structure.collectionImportance = root.collectionImportance as 'important' | 'must-have';
  return structure;
}
