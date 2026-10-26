/**
 * Small Talk rules the delivery, chatbot and deal code share (OPEN-91 P4), moved out of `app.ts`.
 */
import { buildTalkIdentityKey } from '../shared/cid';
import { findAutoAnswer, LOCAL_EXACT_CHATBOT_USER_ID, type ExactChatbotMemoryState } from '../shared/exact-chatbot-memory';
import { buildTagIdentityKeys } from '../shared/talk-ledger';
import { computeRouteMatchScore } from '../shared/talk-engine';
import { computeTalkRevisionHash } from '../shared/talk-revision';

/** The identities an answer covers: the whole Talk, or for a tag Talk the tags I selected. */
export function selectedTalkIdentityKeys(talkData: any, answers?: any[]): string[] {
  const wholeTalkIdentityKey = buildTalkIdentityKey(talkData);
  if (talkData?.type !== 'tag' || !Array.isArray(answers)) return [wholeTalkIdentityKey];
  const selectedAnswerIds = new Set(answers.map((answer: any) => String(answer?.answerId || '')).filter(Boolean));
  const selectedAnswerTexts = new Set(answers.map((answer: any) => String(answer?.answerText || '').trim().toLowerCase()).filter(Boolean));
  const selectedTalk = {
    ...talkData,
    questions: Array.isArray(talkData?.questions)
      ? talkData.questions.map((question: any, index: number) => index === 0
        ? {
            ...question,
            answers: (Array.isArray(question?.answers) ? question.answers : []).filter((answer: any) =>
              selectedAnswerIds.has(String(answer?.id || ''))
              || selectedAnswerTexts.has(String(answer?.text || '').trim().toLowerCase())),
          }
        : question)
      : [],
  };
  return buildTagIdentityKeys(selectedTalk, wholeTalkIdentityKey);
}

/**
 * One revision of one Talk from one sender (OPEN-45): the full revision (content + title +
 * routing), so an in-place routing or title update is taken again, not dropped as delivered.
 */
export function talkRevisionPairKey(talkId: string, authorId: string, talkData: unknown): string {
  let content = '';
  try {
    content = talkData ? computeTalkRevisionHash(talkData) : '';
  } catch {
    // An unidentifiable body falls back to the per-talk key.
  }
  return `${talkId}::${authorId}::${content}`;
}

/**
 * A Talk with a Pair-tag question anywhere (spec §30.2 — taxi, dealmaker, buy/sell) is
 * deal-eligible: several compatible responders can each match, and confirming on both sides is
 * what closes the listing.
 */
export function isDealEligibleTalk(talkData: any): boolean {
  const questions = Array.isArray(talkData?.questions) ? talkData.questions : [];
  return questions.some((q: any) => q?.reciprocalTagContext === true);
}

/** A route's matchThreshold score, for the conversation record (spec §30.2). */
export function matchScoreParamsFor(talkData: any, answers: any[]): { matchScore?: number; matchTotal?: number } {
  const result = computeRouteMatchScore(talkData, answers);
  return result ? { matchScore: result.score, matchTotal: result.total } : {};
}

/** I already answered this content for this sender (the copy of it I answered lists them). */
export function answeredBeforeFor(
  contentId: string,
  authorId: string,
  answeredTalkByContent: Record<string, string>,
  myTalks: Record<string, { senders?: string[] | undefined } | undefined>,
): boolean {
  const answeredTalkId = contentId ? answeredTalkByContent[contentId] : undefined;
  const answeredSenders = answeredTalkId ? myTalks[answeredTalkId]?.senders || [] : [];
  return answeredSenders.includes(authorId);
}

/** A one-keyword tag whose keyword I passed (a suppressed question in exact memory). */
export function isPassedTag(talkData: any, memory: ExactChatbotMemoryState, nowMs: number): boolean {
  const questions = Array.isArray(talkData?.questions) ? talkData.questions : [];
  if (String(talkData?.type || '').toLowerCase() !== 'tag' || questions.length !== 1 || !questions[0]?.text) return false;
  const options = (questions[0].answers || []).map((answer: any) => String(answer?.text || ''));
  return findAutoAnswer(memory, LOCAL_EXACT_CHATBOT_USER_ID, String(questions[0].text), options, nowMs, {
    language: String(talkData?.language || 'en').toLowerCase(),
  }).reason === 'QUESTION_SUPPRESSED';
}
