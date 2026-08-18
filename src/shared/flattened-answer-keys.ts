/**
 * Context-aware keys for saved talk answers: multi-question talks use a chain of
 * prior (question, answer) pairs; tag / single-question talks scope by content hash.
 */

import { hashIdentityPayload, normalizeIdentityText } from './cid';

export type QAPair = { questionText: string; answerText: string };

/**
 * docs/TODO.md §KK: the single derived "my own effective tag" for this exchange (`mySelfTag`
 * in `ui-manager.ts`) and one specific counterpart tag my own talk declares compatibility with
 * (one member of `Talk.preferenceSet`, or the incoming talk's own `selfTag` when I'm answering
 * someone else's talk — see `myEffectiveTagContext`). Two of a user's own talks can share an
 * identically-worded question chain but mean different things (a "buy iPhone" talk looking for
 * a seller vs. a "buy buddies iPhone" talk looking for fellow buyers both have `selfTag: 'buy'`)
 * — omitting this from the key collided their stored answers into one bucket.
 */
export type TagContext = { mySelfTag?: string | undefined; counterpartTag?: string | undefined };

/**
 * Stable lookup key for localStorage. Tag and single-question talks include content hash
 * so unrelated talks do not share answers — content hash already encodes `selfTag`/
 * `preferenceSet` (see `cid.ts`'s `buildIdentityPayloadFromTalk`), so `tagContext` is not
 * needed there. Multi-question talks: first question uses type + empty path + question text
 * (cross-talk reuse); later questions use the path of normalized prior Q/A pairs so a new talk
 * with the same prefix can auto-fill until a question diverges. `tagContext` is folded into
 * both of those multi-question cases so a differently-tagged reuse of the same wording gets its
 * own bucket instead of colliding.
 */
export function buildAnswerPreferenceLookupKey(
  talk: { type?: string; language?: string; questions?: unknown[] },
  talkContentHash: string,
  questionIndex: number,
  previousQAPairs: QAPair[],
  questionText: string,
  tagContext?: TagContext,
): string {
  const nq = normalizeIdentityText(questionText);
  const mt = normalizeIdentityText(talk?.type || 'flow');
  const language = normalizeIdentityText(talk?.language || 'en');
  const qCount = Array.isArray(talk?.questions) ? talk.questions.length : 0;
  const isTagOrSingle = talk?.type === 'tag' || qCount <= 1;

  if (isTagOrSingle) {
    const payload = { h: talkContentHash, t: mt, l: language, q: nq };
    return `flat_${hashIdentityPayload(JSON.stringify(payload))}`;
  }

  const tagSuffix: { st?: string; ct?: string } = {};
  if (tagContext?.mySelfTag) tagSuffix.st = normalizeIdentityText(tagContext.mySelfTag);
  if (tagContext?.counterpartTag) tagSuffix.ct = normalizeIdentityText(tagContext.counterpartTag);

  if (questionIndex === 0) {
    const payload = { t: mt, l: language, path: [] as const, q: nq, ...tagSuffix };
    return `flat_${hashIdentityPayload(JSON.stringify(payload))}`;
  }

  const payload = {
    t: mt,
    l: language,
    path: previousQAPairs.map((p) => ({
      q: normalizeIdentityText(p.questionText),
      a: normalizeIdentityText(p.answerText),
    })),
    q: nq,
    ...tagSuffix,
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
