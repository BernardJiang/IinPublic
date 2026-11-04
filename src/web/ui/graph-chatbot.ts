/**
 * The chatbot from the device graph (OPEN-106 step 2e v): the answer dialog's pre-filled answers,
 * the chatbot's own replies, passing a tag again, and what I last answered a question with. The
 * core answers (`src/core/device-graph/sync/app-chatbot.ts`); the dialog resolves each question
 * from the Talk's lookups read once when it opens (`ChatbotView`), so it stays synchronous.
 */
import { resolveChatbotQuestion, type AnswerStep, type ChatbotView } from '../../core/device-graph/answers';
import { talkStructureOf } from '../../core/device-graph/talk-structure';
import type { AppChatbotAnswer } from '../../core/device-graph/sync/app-chatbot';
import { getLocationAutoMatchConsent } from './ui-settings-storage';

/* eslint-disable @typescript-eslint/no-explicit-any */

type CoreCall = (request: any) => Promise<any>;

let core: CoreCall | null = null;

/** Set by the app once the core has a device graph; null turns the chatbot off. */
export function setGraphChatbotSource(call: CoreCall | null): void {
  core = call;
}

export function graphChatbotAvailable(): boolean {
  return core !== null;
}

/** The Talk's lookups (null without a graph, or if the core cannot read them). */
export async function loadChatbotView(talk: any, mine: boolean): Promise<ChatbotView | null> {
  if (!core || !Array.isArray(talk?.questions)) return null;
  try {
    return await core({ name: 'graph.chatbotView', talk, mine, locationConsent: getLocationAutoMatchConsent() });
  } catch (error) {
    console.warn('[chatbot] lookups failed:', error);
    return null;
  }
}

/** What the chatbot answers for this Talk by itself; whether I passed it; answered it already. */
export async function graphChatbotAnswers(talk: any, talkId?: string): Promise<{ answers: AppChatbotAnswer[] | null; passed: boolean; answered: boolean }> {
  const none = { answers: null, passed: false, answered: false };
  if (!core || !Array.isArray(talk?.questions)) return none;
  try {
    return await core({ name: 'graph.chatbot', talk, ...(talkId ? { talkId } : {}), locationConsent: getLocationAutoMatchConsent() });
  } catch (error) {
    console.warn('[chatbot] answer lookup failed:', error);
    return none;
  }
}

/** I passed a one-keyword tag (the chatbot passes it again when it comes back). */
export function graphPassTag(talk: any, passed = true): void {
  if (!core || !Array.isArray(talk?.questions)) return;
  void core({ name: 'graph.pass', talk, passed }).catch((error) => console.warn('[chatbot] pass failed:', error));
}

/** My Pair-tag side and source Talk for my latest answer to a question with this text. */
export async function graphQuestionMemory(text: string, language?: string): Promise<{ selfTag?: string; sourceTalkId?: string }> {
  if (!core || !text) return {};
  try {
    return await core({ name: 'graph.questionMemory', text, language: String(language || 'en').toLowerCase() });
  } catch {
    return {};
  }
}

export type DialogPreference = {
  answerId: string;
  answerText: string;
  mode: string;
  questionText?: string;
  allAnswers?: any[];
  autoAnswerAction?: string;
  autoAnswerReason?: string;
  answerIds?: string[];
} | null;

const REASONS: Record<string, string> = {
  'same-context': 'KNOWN_CONTEXT_MATCH',
  'root-context': 'KNOWN_ROOT_CONTEXT_MATCH',
  'whenever-offered': 'KNOWN_QUESTION_DEFAULT',
  'built-in': 'BUILT_IN',
  'pair-tag': 'RECIPROCAL_TAG_CONTEXT',
};

/**
 * One question's pre-filled answer from the Talk's lookups, after the answers given so far in this
 * dialog. `mode: 'auto'` when the chatbot may answer it by itself; `manual` for a Just once answer
 * shown as a suggestion.
 */
export function resolveFromView(
  view: ChatbotView | null | undefined,
  talk: any,
  mine: boolean,
  currentQuestion: { id: string; text?: string; answers?: any[]; answerSelectionMode?: string },
  sessionAnswers: Array<{ questionId: string; answerId?: string; answerIds?: string[] }> = [],
): DialogPreference {
  if (!view || !Array.isArray(talk?.questions)) return null;
  let structure;
  try {
    structure = talkStructureOf(talk);
  } catch {
    return null;
  }
  const steps: AnswerStep[] = [];
  for (const answer of sessionAnswers) {
    if (answer.questionId === currentQuestion.id) continue;
    const ids = (answer.answerIds?.length ? answer.answerIds : answer.answerId ? [answer.answerId] : []).map(String);
    if (!ids.length || ids.includes('ignore') || ids.some((id) => id.startsWith('typed:'))) continue;
    const step = steps.find((s) => s.questionId === answer.questionId);
    if (step) step.answerIds = [...new Set([...(step.answerIds || []), ...ids])];
    else steps.push({ questionId: String(answer.questionId), answerIds: ids });
  }
  const found = resolveChatbotQuestion(structure, mine ? 'author' : 'responder', view, steps, currentQuestion.id);
  if (!found?.answerIds?.length) return null;
  const chosen = found.answerIds.map((id) => (currentQuestion.answers || []).find((a: any) => a?.id === id)).filter(Boolean);
  if (!chosen.length) return null;
  return {
    answerId: String(chosen[0].id),
    answerText: chosen.map((a: any) => String(a.text || '')).join(', '),
    mode: found.auto ? 'auto' : 'manual',
    questionText: currentQuestion.text || '',
    allAnswers: currentQuestion.answers || [],
    autoAnswerAction: 'ANSWER',
    autoAnswerReason: REASONS[found.reason] ?? found.reason,
    ...(currentQuestion.answerSelectionMode === 'multiple' ? { answerIds: chosen.map((a: any) => String(a.id)) } : {}),
  };
}
