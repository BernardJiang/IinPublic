/**
 * Context-aware keys for saved talk answers: multi-question talks use a chain of
 * prior (question, answer) pairs; tag / single-question talks scope by content hash.
 */

import { hashIdentityPayload, normalizeIdentityText } from './talk-content-id';

export type QAPair = { questionText: string; answerText: string };

/**
 * Stable lookup key for localStorage. Tag and single-question talks include content hash
 * so unrelated talks do not share answers. Multi-question talks: first question uses
 * type + empty path + question text (cross-talk reuse); later questions use the path
 * of normalized prior Q/A pairs so a new talk with the same prefix can auto-fill until
 * a question diverges.
 */
export function buildAnswerPreferenceLookupKey(
  talk: { type?: string; questions?: unknown[] },
  talkContentHash: string,
  questionIndex: number,
  previousQAPairs: QAPair[],
  questionText: string,
): string {
  const nq = normalizeIdentityText(questionText);
  const mt = normalizeIdentityText(talk?.type || 'matching');
  const qCount = Array.isArray(talk?.questions) ? talk.questions.length : 0;
  const isTagOrSingle = talk?.type === 'tag' || qCount <= 1;

  if (isTagOrSingle) {
    const payload = { h: talkContentHash, t: mt, q: nq };
    return `flat_${hashIdentityPayload(JSON.stringify(payload))}`;
  }

  if (questionIndex === 0) {
    const payload = { t: mt, path: [] as const, q: nq };
    return `flat_${hashIdentityPayload(JSON.stringify(payload))}`;
  }

  const payload = {
    t: mt,
    path: previousQAPairs.map((p) => ({
      q: normalizeIdentityText(p.questionText),
      a: normalizeIdentityText(p.answerText),
    })),
    q: nq,
  };
  return `flat_${hashIdentityPayload(JSON.stringify(payload))}`;
}

export function sessionAnswersToQAPairs(
  talk: { questions?: Array<{ id: string; text?: string }> },
  sessionAnswers: Array<{ questionId: string; answerText?: string }>,
): QAPair[] {
  const out: QAPair[] = [];
  for (const sa of sessionAnswers) {
    const q = talk.questions?.find((qu) => qu.id === sa.questionId);
    out.push({
      questionText: (q?.text || '').trim(),
      answerText: (sa.answerText || '').trim(),
    });
  }
  return out;
}
