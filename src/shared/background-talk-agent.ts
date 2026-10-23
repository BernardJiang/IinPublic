import { canonicalSerialize, computeResponseId, computeTalkIdFromTalkData } from './cid';
import { checkIfMatch } from './talk-engine';
import type { P2PMeshTalkBodyPayload, P2PMeshTalkResponsePayload } from './p2p-mesh-protocol';
import { intakeFilterRejectReasons } from './talk-intake-filters';
import { talkContactPolicyAllowsPeer } from './talk-contact-policy';
import type { TalkIntakeFilters } from './types';

export const BACKGROUND_AGENT_VERSION = 1 as const;
export const BACKGROUND_AGENT_MAX_EVENTS = 500;

export type BackgroundAnswerRule = {
  questionText: string;
  answerTexts: string[];
  selectedAnswerTexts: string[];
  selectionMode: 'single' | 'multiple';
};

export type BackgroundTalkAgentConfig = {
  version: 1;
  enabled: boolean;
  userId: string;
  stageName: string;
  activeRoomId: string;
  autoAnswerEnabled: boolean;
  answerRules: BackgroundAnswerRule[];
  chatbotTemplates: Record<string, { answers?: unknown[]; talkData?: unknown }>;
  authoredTalks: Record<string, unknown>;
  matchCollectionStore?: string;
  intakeFilters?: TalkIntakeFilters;
  knownContactIds?: string[];
  travelerIds?: string[];
  ageVerified?: boolean;
};

/** Convert the UI's exact-answer persistence shape into the minimal native policy snapshot. */
export function backgroundAnswerRulesFromPreferences(
  flattened: Record<string, any>,
): BackgroundAnswerRule[] {
  return Object.values(flattened).flatMap((entry: any) => {
    // saveAnswerPreference persists an exact reusable `auto` choice as `temporary`; the
    // foreground resolver promotes that back to auto at read time. Keep the native bridge in
    // lockstep or a rule approved in the UI disappears as soon as the Activity sleeps.
    if (!['auto', 'temporary', 'whenever'].includes(String(entry?.mode || '')) || !entry?.questionText) return [];
    const allAnswers = Array.isArray(entry.allAnswers) ? entry.allAnswers : [];
    const answerTexts = allAnswers.map((answer: any) => String(answer?.text || '')).filter(Boolean);
    const selectedAnswerTexts = Array.isArray(entry.answerTexts) && entry.answerTexts.length > 0
      ? entry.answerTexts.map(String)
      : [String(entry.answerText || '')].filter(Boolean);
    if (answerTexts.length === 0 || selectedAnswerTexts.length === 0) return [];
    return [{
      questionText: String(entry.questionText),
      answerTexts,
      selectedAnswerTexts,
      selectionMode: entry.answerSelectionMode === 'multiple' ? 'multiple' as const : 'single' as const,
    }];
  });
}

export type BackgroundAgentTalkEvent = {
  version: 1;
  id: string;
  kind: 'incoming-talk';
  createdAt: string;
  envelopeId: string;
  payload: P2PMeshTalkBodyPayload;
  answers?: Array<{ questionId: string; answerId: string; answerText: string; answerIds?: string[]; mode: 'auto' }>;
  response?: P2PMeshTalkResponsePayload;
};

export type BackgroundAgentResponseEvent = {
  version: 1;
  id: string;
  kind: 'talk-response';
  createdAt: string;
  envelopeId: string;
  payload: P2PMeshTalkResponsePayload;
  outcome: 'match' | 'mismatch';
  collectionSessionId?: string;
};

export type BackgroundAgentEvent = BackgroundAgentTalkEvent | BackgroundAgentResponseEvent;

const normalized = (value: unknown): string => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

function selectedTexts(rule: BackgroundAnswerRule): string[] {
  return rule.selectedAnswerTexts.map(normalized).filter(Boolean);
}

function resolveQuestion(
  rules: readonly BackgroundAnswerRule[],
  question: any,
): { answerId: string; answerText: string; answerIds?: string[]; mode: 'auto' } | null {
  const answers = Array.isArray(question?.answers) ? question.answers : [];
  const offered = answers.map((answer: any) => normalized(answer?.text)).filter(Boolean).sort();
  const selectionMode = question?.answerSelectionMode === 'multiple' ? 'multiple' : 'single';
  const rule = rules.find((candidate) =>
    normalized(candidate.questionText) === normalized(question?.text)
    && candidate.selectionMode === selectionMode
    && candidate.answerTexts.map(normalized).filter(Boolean).sort().join('\u0000') === offered.join('\u0000'));
  if (!rule) return null;
  const wanted = selectedTexts(rule);
  if (wanted.length === 0 || (selectionMode === 'single' && wanted.length !== 1)) return null;
  const chosen = wanted.map((text) => answers.find((answer: any) => normalized(answer?.text) === text));
  if (chosen.some((answer: any) => !answer?.id)) return null;
  const answerIds = [...new Set(chosen.map((answer: any) => String(answer.id)))];
  if (answerIds.length !== wanted.length) return null;
  return {
    answerId: answerIds[0]!,
    answerText: chosen.map((answer: any) => String(answer.text || '')).join(', '),
    ...(selectionMode === 'multiple' ? { answerIds } : {}),
    mode: 'auto',
  };
}

/**
 * Resolve a Talk without inference. Exact saved templates win; otherwise every traversed
 * question must have an approved rule with the same question text and complete answer frame.
 */
export function resolveBackgroundTalkAnswers(
  config: BackgroundTalkAgentConfig,
  payload: P2PMeshTalkBodyPayload,
): BackgroundAgentTalkEvent['answers'] | null {
  if (!config.enabled || !config.autoAnswerEnabled) return null;
  if (payload.roomId !== config.activeRoomId) return null;
  const talk = { ...payload.talkData, id: payload.talkId, authorId: payload.authorId } as any;
  const contentId = computeTalkIdFromTalkData(talk);
  const template = config.chatbotTemplates[payload.talkId]
    || (contentId ? config.chatbotTemplates[contentId] : undefined);
  if (Array.isArray(template?.answers) && template.answers.length > 0) {
    return template.answers.map((answer: any) => ({
      questionId: String(answer.questionId || ''),
      answerId: String(answer.answerId || ''),
      answerText: String(answer.answerText || ''),
      ...(Array.isArray(answer.answerIds) ? { answerIds: answer.answerIds.map(String) } : {}),
      mode: 'auto' as const,
    })).filter((answer) => answer.questionId && answer.answerId);
  }

  const questions: any[] = Array.isArray(talk.questions) ? talk.questions : [];
  if (questions.length === 0) return null;
  if (talk.type === 'survey') {
    const survey = questions.map((question) => ({ question, resolved: resolveQuestion(config.answerRules, question) }));
    if (survey.some(({ resolved }) => !resolved)) return null;
    return survey.map(({ question, resolved }) => ({ questionId: String(question.id), ...resolved! }));
  }

  const byId = new Map(questions.map((question) => [String(question.id), question]));
  const root = questions.find((question) => Array.isArray(question.contextPath) && question.contextPath.length === 0)
    || questions[0];
  const output: NonNullable<BackgroundAgentTalkEvent['answers']> = [];
  const visit = (question: any, seen: Set<string>): boolean => {
    const questionId = String(question?.id || '');
    if (!questionId || seen.has(questionId)) return false;
    const resolved = resolveQuestion(config.answerRules, question);
    if (!resolved) return false;
    output.push({ questionId, ...resolved });
    if (resolved.answerIds) return true;
    const chosen = question.answers?.find((answer: any) => String(answer.id) === resolved.answerId);
    const nextSeen = new Set(seen).add(questionId);
    if (Array.isArray(chosen?.nextQuestionIds) && chosen.nextQuestionIds.length > 0) {
      return chosen.nextQuestionIds.every((id: unknown) => {
        const child = byId.get(String(id));
        return !!child && visit(child, nextSeen);
      });
    }
    const nextId = String(chosen?.nextQuestionId || question.nextQuestionId || '');
    return !nextId || (!!byId.get(nextId) && visit(byId.get(nextId), nextSeen));
  };
  return visit(root, new Set()) ? output : null;
}

export function backgroundTalkPassesPolicy(
  config: BackgroundTalkAgentConfig,
  payload: P2PMeshTalkBodyPayload,
): boolean {
  const filters = config.intakeFilters;
  if (!filters) return false;
  const knownPeople = (config.knownContactIds || []).map((userId) => ({ userId }));
  if (!talkContactPolicyAllowsPeer(
    payload.authorId,
    filters,
    knownPeople,
    new Set(config.travelerIds || []),
  )) return false;
  const talk = payload.talkData as any;
  return intakeFilterRejectReasons({
    title: String(talk?.title || payload.title || ''),
    type: String(talk?.type || payload.type || ''),
    language: String(talk?.language || payload.language || 'en'),
    createdAt: String(talk?.createdAt || payload.broadcastAt),
    updatedAt: String(talk?.updatedAt || talk?.createdAt || payload.broadcastAt),
    ...(talk?.expiresAt !== undefined ? { expiresAt: talk.expiresAt } : {}),
    questions: Array.isArray(talk?.questions) ? talk.questions : [],
    isAdult: !!(talk?.isAdult || payload.isAdult),
  }, filters, undefined, { ageVerified: config.ageVerified === true }).length === 0;
}

export async function responseIdForBackgroundAnswers(
  talkId: string,
  responderId: string,
  answers: NonNullable<BackgroundAgentTalkEvent['answers']>,
): Promise<string> {
  return computeResponseId({ talkId, responderId, responseContentJson: canonicalSerialize(answers) });
}

export function classifyBackgroundResponse(
  config: BackgroundTalkAgentConfig,
  payload: P2PMeshTalkResponsePayload,
  answers: any[],
): { outcome: 'match' | 'mismatch'; collectionSessionId?: string } | null {
  const stored = config.authoredTalks[payload.talkId] as any;
  const talk = stored?.fullTalk || stored;
  if (!talk) return null;
  const outcome = checkIfMatch(talk, answers) ? 'match' : 'mismatch';
  let collectionSessionId: string | undefined;
  try {
    const collection = JSON.parse(config.matchCollectionStore || 'null') as any;
    const association = [...(Array.isArray(collection?.associations) ? collection.associations : [])]
      .reverse()
      .find((row: any) => row?.talkId === payload.talkId && row?.peerId === payload.responderId);
    if (association?.sessionId) collectionSessionId = String(association.sessionId);
  } catch {
    // A corrupt UI snapshot cannot prevent background response delivery.
  }
  return { outcome, ...(collectionSessionId ? { collectionSessionId } : {}) };
}

export function appendBackgroundEvent(
  events: readonly BackgroundAgentEvent[],
  event: BackgroundAgentEvent,
): BackgroundAgentEvent[] {
  return [...events.filter((candidate) => candidate.id !== event.id), event].slice(-BACKGROUND_AGENT_MAX_EVENTS);
}
