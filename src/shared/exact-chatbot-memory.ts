import type { TalkRole } from './types';

export type AnswerMode = 'TEMPORARY' | 'PERMANENT' | 'SUPPRESSED';

export type AutoAnswerAction = 'ANSWER' | 'ASK_USER' | 'SKIP';

export type AutoAnswerReason =
  | 'NO_HISTORY'
  | 'QUESTION_SUPPRESSED'
  | 'PERMANENT_MATCH'
  | 'PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS'
  | 'TEMPORARY_HISTORY_MATCH'
  | 'NO_VALID_HISTORY_ANSWER'
  | 'ROLE_CONFLICT';

export interface ChatbotUseEvent {
  usedAt: number;
}

export interface ChatbotAnswerHistoryEvent {
  mode: AnswerMode;
  answerId: string | null;
  answerText: string | null;
  createdAt: number;
  autoUseCount: number;
  lastAutoUsedAt: number | null;
  uses?: Record<string, ChatbotUseEvent>;
}

export interface ChatbotQuestionSummary {
  mode: AnswerMode;
  suppressed: boolean;
  permanentAnswerId: string | null;
  permanentAnswerText: string | null;
  latestTemporaryAnswerId: string | null;
  latestTemporaryAnswerText: string | null;
  updatedAt: number;
  /**
   * The two-sided deal role (see `Talk.role`) the user was holding when this answer was
   * recorded — 'offer' if it came from their own offer-talk (or from answering someone
   * else's request-talk), 'request' likewise. Undefined for answers with no role context.
   * `findAutoAnswer` refuses to auto-answer when this equals the INCOMING talk's own role
   * (e.g. two buyers), even if the question/answer text otherwise matches exactly.
   */
  role?: TalkRole;
}

export interface ChatbotQuestionMemory {
  questionText: string;
  language?: string;
  summary: ChatbotQuestionSummary;
  history: Record<string, ChatbotAnswerHistoryEvent>;
}

export interface ExactChatbotMemoryState {
  users: Record<string, Record<string, ChatbotQuestionMemory>>;
  questions: Record<string, { text: string; language?: string }>;
  answers: Record<string, { text: string }>;
}

export interface AutoAnswerResult {
  action: AutoAnswerAction;
  reason: AutoAnswerReason;
  answerId?: string;
  answerText?: string;
  matchedEventId?: string;
}

export const LOCAL_EXACT_CHATBOT_USER_ID = 'local';

export function createEmptyExactChatbotMemoryState(): ExactChatbotMemoryState {
  return {
    users: {},
    questions: {},
    answers: {},
  };
}

export function normalizeText(text: string, opts?: { caseInsensitive?: boolean }): string {
  const trimmed = String(text || '').trim();
  return opts?.caseInsensitive ? trimmed.toLowerCase() : trimmed;
}

export async function sha256(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return stableTextHash(text);
  }
  const data = new TextEncoder().encode(text);
  const hashBuffer = await subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Synchronous stable hash for UI paths that must consult local chatbot memory
 * while rendering. FNV-1a is deterministic in Node and browsers.
 */
export function stableTextHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

type QuestionIdOptions = {
  caseInsensitive?: boolean;
  language?: string;
};

function normalizedLanguage(language: string | undefined): string | undefined {
  if (language == null) return undefined;
  return normalizeText(language, { caseInsensitive: true }) || 'en';
}

export function makeQuestionId(questionText: string, opts?: QuestionIdOptions): string {
  const normalizedQuestion = normalizeText(
    questionText,
    opts?.caseInsensitive == null ? undefined : { caseInsensitive: opts.caseInsensitive },
  );
  const language = normalizedLanguage(opts?.language);
  const identity = language ? `${language}\n${normalizedQuestion}` : normalizedQuestion;
  return `q_${stableTextHash(identity)}`;
}

export function makeAnswerId(answerText: string, opts?: { caseInsensitive?: boolean }): string {
  return `a_${stableTextHash(normalizeText(answerText, opts))}`;
}

function getUserQuestions(state: ExactChatbotMemoryState, userId: string): Record<string, ChatbotQuestionMemory> {
  state.users[userId] ??= {};
  return state.users[userId];
}

function makeEventId(prefix: string, now: number): string {
  return `${prefix}_${now}_${Math.random().toString(36).slice(2, 9)}`;
}

function getQuestionMemory(
  state: ExactChatbotMemoryState,
  userId: string,
  questionText: string,
  now: number,
  context?: { language?: string },
): { questionId: string; memory: ChatbotQuestionMemory } {
  const normalizedQuestion = normalizeText(questionText);
  const language = normalizedLanguage(context?.language);
  const questionId = makeQuestionId(normalizedQuestion, language ? { language } : undefined);
  const userQuestions = getUserQuestions(state, userId);
  userQuestions[questionId] ??= {
    questionText: normalizedQuestion,
    ...(language ? { language } : {}),
    summary: {
      mode: 'TEMPORARY',
      suppressed: false,
      permanentAnswerId: null,
      permanentAnswerText: null,
      latestTemporaryAnswerId: null,
      latestTemporaryAnswerText: null,
      updatedAt: now,
    },
    history: {},
  };
  userQuestions[questionId].questionText = normalizedQuestion;
  if (language) userQuestions[questionId].language = language;
  state.questions[questionId] = { text: normalizedQuestion, ...(language ? { language } : {}) };
  return { questionId, memory: userQuestions[questionId] };
}

export function saveTemporaryAnswer(
  state: ExactChatbotMemoryState,
  userId: string,
  questionText: string,
  answerText: string,
  now = Date.now(),
  context?: { language?: string },
  role?: TalkRole,
): { questionId: string; answerId: string; eventId: string } {
  const { questionId, memory } = getQuestionMemory(state, userId, questionText, now, context);
  const normalizedAnswer = normalizeText(answerText);
  const answerId = makeAnswerId(normalizedAnswer);
  const eventId = makeEventId('e', now);

  memory.summary = {
    ...memory.summary,
    mode: 'TEMPORARY',
    suppressed: false,
    latestTemporaryAnswerId: answerId,
    latestTemporaryAnswerText: normalizedAnswer,
    updatedAt: now,
    // Only overwrite when this save actually knows the role — an unrelated no-role save
    // (e.g. a plain talk with no role at all) must not erase a role learned earlier.
    ...(role !== undefined ? { role } : {}),
  };
  memory.history[eventId] = {
    mode: 'TEMPORARY',
    answerId,
    answerText: normalizedAnswer,
    createdAt: now,
    autoUseCount: 0,
    lastAutoUsedAt: null,
    uses: {},
  };
  state.answers[answerId] = { text: normalizedAnswer };
  return { questionId, answerId, eventId };
}

export function savePermanentAnswer(
  state: ExactChatbotMemoryState,
  userId: string,
  questionText: string,
  answerText: string,
  now = Date.now(),
  context?: { language?: string },
  role?: TalkRole,
): { questionId: string; answerId: string; eventId: string } {
  const { questionId, memory } = getQuestionMemory(state, userId, questionText, now, context);
  const normalizedAnswer = normalizeText(answerText);
  const answerId = makeAnswerId(normalizedAnswer);
  const eventId = makeEventId('e', now);

  memory.summary = {
    ...memory.summary,
    mode: 'PERMANENT',
    suppressed: false,
    permanentAnswerId: answerId,
    permanentAnswerText: normalizedAnswer,
    updatedAt: now,
    ...(role !== undefined ? { role } : {}),
  };
  memory.history[eventId] = {
    mode: 'PERMANENT',
    answerId,
    answerText: normalizedAnswer,
    createdAt: now,
    autoUseCount: 0,
    lastAutoUsedAt: null,
    uses: {},
  };
  state.answers[answerId] = { text: normalizedAnswer };
  return { questionId, answerId, eventId };
}

export function saveSuppressedQuestion(
  state: ExactChatbotMemoryState,
  userId: string,
  questionText: string,
  now = Date.now(),
  context?: { language?: string },
): { questionId: string; eventId: string } {
  const { questionId, memory } = getQuestionMemory(state, userId, questionText, now, context);
  const eventId = makeEventId('e', now);

  memory.summary = {
    ...memory.summary,
    mode: 'SUPPRESSED',
    suppressed: true,
    permanentAnswerId: null,
    permanentAnswerText: null,
    updatedAt: now,
  };
  memory.history[eventId] = {
    mode: 'SUPPRESSED',
    answerId: null,
    answerText: null,
    createdAt: now,
    autoUseCount: 0,
    lastAutoUsedAt: null,
    uses: {},
  };
  return { questionId, eventId };
}

export function readHistory(memory: ChatbotQuestionMemory | null): Array<ChatbotAnswerHistoryEvent & { eventId: string }> {
  if (!memory) return [];
  return Object.entries(memory.history)
    .map(([eventId, event]) => ({ ...event, eventId }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function appendAutoUse(
  state: ExactChatbotMemoryState,
  userId: string,
  questionId: string,
  eventId: string,
  now = Date.now(),
): void {
  const event = state.users[userId]?.[questionId]?.history[eventId];
  if (!event) return;
  const useEventId = makeEventId('use', now);
  event.uses ??= {};
  event.uses[useEventId] = { usedAt: now };
  const uses = Object.values(event.uses);
  event.autoUseCount = uses.length;
  event.lastAutoUsedAt = uses.reduce<number | null>((latest, use) => {
    if (latest == null) return use.usedAt;
    return Math.max(latest, use.usedAt);
  }, null);
}

export function findAutoAnswer(
  state: ExactChatbotMemoryState,
  userId: string,
  questionText: string,
  currentOptions: string[],
  now = Date.now(),
  context?: { language?: string },
  incomingTalkRole?: TalkRole,
): AutoAnswerResult {
  const language = normalizedLanguage(context?.language);
  let questionId = makeQuestionId(questionText, language ? { language } : undefined);
  let memory = state.users[userId]?.[questionId];
  // Historical memory predates language scoping; only English talks may reuse it.
  if (!memory && language === 'en') {
    questionId = makeQuestionId(questionText);
    memory = state.users[userId]?.[questionId];
  }
  if (!memory) {
    return { action: 'ASK_USER', reason: 'NO_HISTORY' };
  }

  // Same-role veto (see Talk.role): this stored answer came from the user's own role in
  // some other talk — if that role is the SAME as the talk currently asking (e.g. this
  // memory came from being a buyer, and the incoming talk is also a buyer's), refuse to
  // auto-answer no matter how exactly the question/answer text lines up. A different role,
  // or no role on either side, is unaffected.
  if (incomingTalkRole && memory.summary.role && memory.summary.role === incomingTalkRole) {
    return { action: 'ASK_USER', reason: 'ROLE_CONFLICT' };
  }

  const currentOptionMap = new Map<string, string>();
  for (const optionText of currentOptions) {
    const normalized = normalizeText(optionText);
    currentOptionMap.set(makeAnswerId(normalized), normalized);
  }

  if (memory.summary.mode === 'SUPPRESSED' || memory.summary.suppressed) {
    return { action: 'SKIP', reason: 'QUESTION_SUPPRESSED' };
  }

  if (memory.summary.mode === 'PERMANENT') {
    const permanentAnswerId = memory.summary.permanentAnswerId;
    if (permanentAnswerId && currentOptionMap.has(permanentAnswerId)) {
      const answerText = currentOptionMap.get(permanentAnswerId);
      if (!answerText) {
        return {
          action: 'SKIP',
          reason: 'PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS',
        };
      }
      const matchingEvent = readHistory(memory).find(
        (event) => event.mode === 'PERMANENT' && event.answerId === permanentAnswerId,
      );
      if (matchingEvent) {
        appendAutoUse(state, userId, questionId, matchingEvent.eventId, now);
      }
      return {
        action: 'ANSWER',
        reason: 'PERMANENT_MATCH',
        answerId: permanentAnswerId,
        answerText,
        ...(matchingEvent ? { matchedEventId: matchingEvent.eventId } : {}),
      };
    }

    return {
      action: 'SKIP',
      reason: 'PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS',
    };
  }

  for (const event of readHistory(memory)) {
    if (event.mode !== 'TEMPORARY' || !event.answerId) continue;
    if (currentOptionMap.has(event.answerId)) {
      const answerText = currentOptionMap.get(event.answerId);
      if (!answerText) continue;
      appendAutoUse(state, userId, questionId, event.eventId, now);
      return {
        action: 'ANSWER',
        reason: 'TEMPORARY_HISTORY_MATCH',
        answerId: event.answerId,
        answerText,
        matchedEventId: event.eventId,
      };
    }
  }

  return { action: 'ASK_USER', reason: 'NO_VALID_HISTORY_ANSWER' };
}

/**
 * Multi-value counterpart to `findAutoAnswer` (spec §3.4 FR-QA-15/16, §30.8) — for a
 * `'multiple'`-mode ("pick any that apply") question. Mirrors every non-selection-shape
 * concern exactly (suppression, role veto, permanent-answer-not-in-current-options): only
 * the TEMPORARY-mode resolution differs, since "pick any that apply" has no single
 * "newest answer wins" concept.
 *
 * TEMPORARY resolution: every distinct answerId that has EVER appeared in this question's
 * history AND is present in the current option set is included in the pre-checked set — not
 * just the newest. This reuses `saveTemporaryAnswer`'s existing per-event history storage
 * unchanged: the caller saves one event per selected checkbox on submit (§DD/§FF's UI layer),
 * and this function reads back every distinct answerId that accumulated. Known simplification
 * (documented, not a bug): an answer id checked in an earlier submission and explicitly
 * unchecked in a later one is still remembered and re-offered, since history is append-only
 * and this function does not track a per-id "most recent checked state" — acceptable for a
 * first cut; a future pass could add that if it proves surprising in practice.
 */
export function findAutoAnswerMultiple(
  state: ExactChatbotMemoryState,
  userId: string,
  questionText: string,
  currentOptions: string[],
  now = Date.now(),
  context?: { language?: string },
  incomingTalkRole?: TalkRole,
): AutoAnswerResult & { answerIds?: string[]; answerTexts?: string[] } {
  const language = normalizedLanguage(context?.language);
  let questionId = makeQuestionId(questionText, language ? { language } : undefined);
  let memory = state.users[userId]?.[questionId];
  if (!memory && language === 'en') {
    questionId = makeQuestionId(questionText);
    memory = state.users[userId]?.[questionId];
  }
  if (!memory) {
    return { action: 'ASK_USER', reason: 'NO_HISTORY' };
  }

  if (incomingTalkRole && memory.summary.role && memory.summary.role === incomingTalkRole) {
    return { action: 'ASK_USER', reason: 'ROLE_CONFLICT' };
  }

  const currentOptionMap = new Map<string, string>();
  for (const optionText of currentOptions) {
    const normalized = normalizeText(optionText);
    currentOptionMap.set(makeAnswerId(normalized), normalized);
  }

  if (memory.summary.mode === 'SUPPRESSED' || memory.summary.suppressed) {
    return { action: 'SKIP', reason: 'QUESTION_SUPPRESSED' };
  }

  if (memory.summary.mode === 'PERMANENT') {
    const permanentAnswerId = memory.summary.permanentAnswerId;
    if (permanentAnswerId && currentOptionMap.has(permanentAnswerId)) {
      const answerText = currentOptionMap.get(permanentAnswerId);
      if (!answerText) {
        return { action: 'SKIP', reason: 'PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS' };
      }
      const matchingEvent = readHistory(memory).find(
        (event) => event.mode === 'PERMANENT' && event.answerId === permanentAnswerId,
      );
      if (matchingEvent) {
        appendAutoUse(state, userId, questionId, matchingEvent.eventId, now);
      }
      return {
        action: 'ANSWER',
        reason: 'PERMANENT_MATCH',
        answerIds: [permanentAnswerId],
        answerTexts: [answerText],
        ...(matchingEvent ? { matchedEventId: matchingEvent.eventId } : {}),
      };
    }
    return { action: 'SKIP', reason: 'PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS' };
  }

  const matchedIds: string[] = [];
  const matchedTexts: string[] = [];
  const matchedEventIds: string[] = [];
  const seen = new Set<string>();
  for (const event of readHistory(memory)) {
    if (event.mode !== 'TEMPORARY' || !event.answerId) continue;
    if (seen.has(event.answerId)) continue;
    if (!currentOptionMap.has(event.answerId)) continue;
    const answerText = currentOptionMap.get(event.answerId);
    if (!answerText) continue;
    seen.add(event.answerId);
    matchedIds.push(event.answerId);
    matchedTexts.push(answerText);
    matchedEventIds.push(event.eventId);
  }

  if (matchedIds.length === 0) {
    return { action: 'ASK_USER', reason: 'NO_VALID_HISTORY_ANSWER' };
  }

  for (const eventId of matchedEventIds) appendAutoUse(state, userId, questionId, eventId, now);
  return {
    action: 'ANSWER',
    reason: 'TEMPORARY_HISTORY_MATCH',
    answerIds: matchedIds,
    answerTexts: matchedTexts,
  };
}

/**
 * The role (see `Talk.role`) recorded alongside the user's own stored answer for this
 * exact question text, if any — used by `checkIfMatch` (talk-engine.ts) callers to veto a
 * same-role match on the manual answering path, the same way `findAutoAnswer` already does
 * for the chatbot's automatic path. Mirrors `findAutoAnswer`'s own question-id resolution
 * (including the legacy pre-language-scoping fallback) so both paths agree on which memory
 * entry is "the" one for a given question.
 */
export function getRoleForQuestionText(
  state: ExactChatbotMemoryState,
  userId: string,
  questionText: string,
  context?: { language?: string },
): TalkRole | undefined {
  const language = normalizedLanguage(context?.language);
  let questionId = makeQuestionId(questionText, language ? { language } : undefined);
  let memory = state.users[userId]?.[questionId];
  if (!memory && language === 'en') {
    questionId = makeQuestionId(questionText);
    memory = state.users[userId]?.[questionId];
  }
  return memory?.summary.role;
}
