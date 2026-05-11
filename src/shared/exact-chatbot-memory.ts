export type AnswerMode = 'TEMPORARY' | 'PERMANENT' | 'SUPPRESSED';

export type AutoAnswerAction = 'ANSWER' | 'ASK_USER' | 'SKIP';

export type AutoAnswerReason =
  | 'NO_HISTORY'
  | 'QUESTION_SUPPRESSED'
  | 'PERMANENT_MATCH'
  | 'PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS'
  | 'TEMPORARY_HISTORY_MATCH'
  | 'NO_VALID_HISTORY_ANSWER';

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
}

export interface ChatbotQuestionMemory {
  questionText: string;
  summary: ChatbotQuestionSummary;
  history: Record<string, ChatbotAnswerHistoryEvent>;
}

export interface ExactChatbotMemoryState {
  users: Record<string, Record<string, ChatbotQuestionMemory>>;
  questions: Record<string, { text: string }>;
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

export function makeQuestionId(questionText: string, opts?: { caseInsensitive?: boolean }): string {
  return `q_${stableTextHash(normalizeText(questionText, opts))}`;
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
): { questionId: string; memory: ChatbotQuestionMemory } {
  const normalizedQuestion = normalizeText(questionText);
  const questionId = makeQuestionId(normalizedQuestion);
  const userQuestions = getUserQuestions(state, userId);
  userQuestions[questionId] ??= {
    questionText: normalizedQuestion,
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
  state.questions[questionId] = { text: normalizedQuestion };
  return { questionId, memory: userQuestions[questionId] };
}

export function saveTemporaryAnswer(
  state: ExactChatbotMemoryState,
  userId: string,
  questionText: string,
  answerText: string,
  now = Date.now(),
): { questionId: string; answerId: string; eventId: string } {
  const { questionId, memory } = getQuestionMemory(state, userId, questionText, now);
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
): { questionId: string; answerId: string; eventId: string } {
  const { questionId, memory } = getQuestionMemory(state, userId, questionText, now);
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
): { questionId: string; eventId: string } {
  const { questionId, memory } = getQuestionMemory(state, userId, questionText, now);
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
): AutoAnswerResult {
  const questionId = makeQuestionId(questionText);
  const memory = state.users[userId]?.[questionId];
  if (!memory) {
    return { action: 'ASK_USER', reason: 'NO_HISTORY' };
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
