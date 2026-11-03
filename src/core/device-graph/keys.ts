/**
 * Content keys of the device graph (spec §31.3). Every key is a full SHA-256 hex digest with its
 * own domain string (D12, REQ-GRAPH-14). Text is exact: nothing is case-folded (D15); the grammar
 * filter has already run on any text that reaches these functions.
 */
import { portableSha256Hex } from '../../shared/portable-sha256';

export const QUESTION_KEY_DOMAIN = 'iinpublic-question-v2';
export const ANSWER_KEY_DOMAIN = 'iinpublic-answer-v2';
export const CONTEXT_HASH_DOMAIN = 'iinpublic-answer-context-v3';
export const STRUCTURE_HASH_DOMAIN = 'iinpublic-talk-structure-v1';
export const ANSWER_SET_DOMAIN = 'iinpublic-answer-set-v1';
export const ROOT_CONTEXT = 'root';

/** A Pair-tag scope as the reader sees it (REQ-GRAPH-11): my side's tag and the other side's. */
export type TagScope = { selfTag?: string | undefined; counterpartTag?: string | undefined };

/** JSON with object keys sorted at every level, so equal content always hashes equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function hash(domain: string, payload: Record<string, unknown>): string {
  return portableSha256Hex(canonicalJson({ domain, ...payload }));
}

/** A language code compared as a code, not as text: `EN` and `en` are one language. */
export function languageCode(language: string | undefined): string {
  return String(language || 'en').trim().toLowerCase();
}

/** `q/<key>`: exact question text, language, selection mode and Pair-tag scope. No choices. */
export function questionKey(params: { text: string; language?: string | undefined; selection?: string | undefined } & TagScope): string {
  return hash(QUESTION_KEY_DOMAIN, {
    text: params.text,
    language: languageCode(params.language),
    selection: params.selection || 'single',
    selfTag: params.selfTag || '',
    counterpartTag: params.counterpartTag || '',
  });
}

/** `a/<hash>`: exact choice text. */
export function answerKey(text: string): string {
  return hash(ANSWER_KEY_DOMAIN, { text });
}

/** A built-in comparison's values in the flat shape the graph stores (D13). */
export type BuiltInValues = {
  kind: string;
  quantity?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  start?: number | undefined;
  end?: number | undefined;
  age?: number | undefined;
  rangeMin?: number | undefined;
  rangeMax?: number | undefined;
};

/**
 * The situation (REQ-GRAPH-12): Talk type, language, the parent context and the answer chosen
 * there, the exact question, its sorted exact choices, built-in values, selection mode and Pair-tag
 * scope. A survey question is independent, so its parent is always the root.
 */
export function contextHash(params: {
  type: string;
  language?: string | undefined;
  parent?: { contextHash: string; answers: string[] } | undefined;
  question: string;
  choices: string[];
  builtIn?: BuiltInValues | undefined;
  selection?: string | undefined;
} & TagScope): string {
  const independent = params.type === 'survey';
  return hash(CONTEXT_HASH_DOMAIN, {
    type: params.type,
    language: languageCode(params.language),
    parent: independent ? ROOT_CONTEXT : (params.parent?.contextHash || ROOT_CONTEXT),
    // A multiple-choice parent contributes its whole chosen set, in a fixed order.
    previousAnswers: independent ? [] : [...new Set(params.parent?.answers || [])].sort(),
    question: params.question,
    choices: [...new Set(params.choices)].sort(),
    builtIn: params.builtIn || null,
    selection: params.selection || 'single',
    selfTag: params.selfTag || '',
    counterpartTag: params.counterpartTag || '',
  });
}

/** `rev/<hash>`: a Talk's structure (see `talkStructureOf`). */
export function structureKey(structure: unknown): string {
  return hash(STRUCTURE_HASH_DOMAIN, { structure });
}

/** One answer in an answer set: chosen choice keys, or a built-in's typed value. */
export type AnswerSetEntry = { choices: string[] } | { typed: BuiltInValues };

/** `s/<hash>`: context hash → what was chosen there. Choice keys are sorted, so order is free. */
export function answerSetKey(entries: Record<string, AnswerSetEntry>): string {
  const normalized: Record<string, unknown> = {};
  for (const [context, entry] of Object.entries(entries)) {
    normalized[context] = 'choices' in entry ? { choices: [...new Set(entry.choices)].sort() } : { typed: entry.typed };
  }
  return hash(ANSWER_SET_DOMAIN, { entries: normalized });
}
