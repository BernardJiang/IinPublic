/**
 * §BB / spec §30.2: opposite-tag registry. Generalizes the hardcoded `Talk.role`
 * 'offer'/'request' pair into an arbitrary set of app-predefined and user-created
 * opposite-tag pairs (buy/sell, hiring/jobseeking, male/female, ...), so a talk-editor
 * tag ("buy") resolves to its counterpart ("sell") without either side hand-typing it.
 *
 * Tag identity is canonicalized the same way `makeQuestionId` canonicalizes question
 * text (normalize + stable hash) so two users independently typing "Buy" and "buy"
 * resolve to the same tag.
 */
import { normalizeText, stableTextHash } from './exact-chatbot-memory';

export interface TagOppositePairEntry {
  tagName: string;
  oppositeTagId: string;
  oppositeTagName: string;
}

export interface TagOppositePairRegistryState {
  /** tagId -> entry. Symmetric: registering (A, B) writes both A->B and B->A. */
  pairs: Record<string, TagOppositePairEntry>;
}

/** Tags are canonicalized case-insensitively, unlike question text (tags are short labels). */
function normalizeTagName(tagName: string): string {
  return normalizeText(tagName, { caseInsensitive: true });
}

export function makeTagId(tagName: string): string {
  return `t_${stableTextHash(normalizeTagName(tagName))}`;
}

export function createEmptyTagOppositePairRegistryState(): TagOppositePairRegistryState {
  return { pairs: {} };
}

/**
 * Registers a symmetric opposite-tag pair. Re-registering a tag with a different
 * opposite overwrites its prior pairing (last-write-wins) — matching the mutable,
 * free-creation posture already decided for ordinary tags (FR-TG-1), no separate
 * governance process for pairs. Does not mutate `state`; returns a new state.
 */
export function registerOppositeTagPair(
  state: TagOppositePairRegistryState,
  tagNameA: string,
  tagNameB: string,
): TagOppositePairRegistryState {
  const idA = makeTagId(tagNameA);
  const idB = makeTagId(tagNameB);
  const nameA = normalizeTagName(tagNameA);
  const nameB = normalizeTagName(tagNameB);
  return {
    pairs: {
      ...state.pairs,
      [idA]: { tagName: nameA, oppositeTagId: idB, oppositeTagName: nameB },
      [idB]: { tagName: nameB, oppositeTagId: idA, oppositeTagName: nameA },
    },
  };
}

/** App-predefined seed pairs. Callers still get a fresh empty state from
 * `createEmptyTagOppositePairRegistryState` — this constant is only consumed by
 * `createSeededTagOppositePairRegistryState`. */
const PREDEFINED_OPPOSITE_TAG_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['buy', 'sell'],
  ['hiring', 'jobseeking'],
  ['male', 'female'],
];

export function createSeededTagOppositePairRegistryState(): TagOppositePairRegistryState {
  let state = createEmptyTagOppositePairRegistryState();
  for (const [tagNameA, tagNameB] of PREDEFINED_OPPOSITE_TAG_PAIRS) {
    state = registerOppositeTagPair(state, tagNameA, tagNameB);
  }
  return state;
}

export function getOppositeTagId(
  state: TagOppositePairRegistryState,
  tagId: string,
): string | undefined {
  return state.pairs[tagId]?.oppositeTagId;
}

export function getOppositeTagName(
  state: TagOppositePairRegistryState,
  tagName: string,
): string | undefined {
  return state.pairs[makeTagId(tagName)]?.oppositeTagName;
}

export function hasOppositeTag(state: TagOppositePairRegistryState, tagName: string): boolean {
  return state.pairs[makeTagId(tagName)] !== undefined;
}

/**
 * A first-question template addressed to the OPPOSITE side, for the app-predefined deal tag
 * pairs — the "self-describing tags, decoupled question wording" idea (docs/TODO.md §BB): the
 * literal first question shown to a responder is generated from a per-tag template, never
 * hand-typed by the author, so two independently-authored talks can share exact wording (which
 * the chatbot's exact-text memory depends on) without either side typing it. Keyed by MY OWN
 * tag — a "buy"-tagged talk's template asks the responder "Do you sell?", not the reverse.
 * Returns `undefined` for any tag with no known deal-question template — the author types
 * their own first question, exactly like before.
 */
export function questionTemplateForTag(tagName: string, item: string): string | undefined {
  const id = makeTagId(tagName);
  const trimmedItem = item.trim() || 'this';
  if (id === makeTagId('buy')) return `Do you sell ${trimmedItem}?`;
  if (id === makeTagId('sell')) return `Do you want to buy ${trimmedItem}?`;
  if (id === makeTagId('hiring')) return 'Are you looking for a job?';
  if (id === makeTagId('jobseeking')) return 'Are you hiring?';
  return undefined;
}
