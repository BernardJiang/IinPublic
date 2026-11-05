/**
 * A tag Talk's tags as separate things to exchange (REQ-LEDGER-16, step 11): each tag has a key, so
 * an offer can leave out the tags a person already has (`omit`) and the receiver trims them.
 * What was exchanged is kept in the device graph (`src/core/device-graph/exchanged.ts`).
 */

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const tagKey = (text: unknown) => `qa_tag_${fnv1a32(String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase())}`;

/**
 * The keys of a tag Talk's tags: one per tag, or one for a one-keyword tag (its question). Any
 * other Talk is one whole: `[wholeTalkIdentityKey]`.
 */
export function buildTagIdentityKeys(
  talkData: { type?: string; questions?: Array<{ text?: string; answers?: Array<{ text?: string; isIgnore?: boolean }> }> },
  wholeTalkIdentityKey: string,
): string[] {
  if (!talkData || talkData.type !== 'tag') return [wholeTalkIdentityKey];
  const question = talkData.questions?.[0];
  const answers = question?.answers;
  if (!Array.isArray(answers) || answers.length === 0) return [wholeTalkIdentityKey];
  if (answers.some((a) => a?.isIgnore)) {
    const keyword = String(question?.text ?? '').trim();
    return keyword ? [tagKey(keyword)] : [wholeTalkIdentityKey];
  }
  return answers.map((a) => tagKey(a?.text));
}

/**
 * A tag Talk without the tags in `omitted` (their keys). Null when nothing is left, when nothing
 * was left out, or for any other Talk.
 */
export function filterTalkForRecipient(
  talkData: { type?: string; questions?: Array<{ answers?: Array<{ text?: string }> }> },
  omitted: Set<string>,
): { filtered: Record<string, unknown> } | null {
  if (!talkData || talkData.type !== 'tag') return null;
  const answers = talkData.questions?.[0]?.answers;
  if (!Array.isArray(answers) || answers.length === 0) return null;
  const remaining = answers.filter((a) => !omitted.has(tagKey(a?.text)));
  if (remaining.length === 0 || remaining.length === answers.length) return null;
  const talkRecord = talkData as Record<string, unknown>;
  const questions = Array.isArray(talkRecord['questions']) ? (talkRecord['questions'] as unknown[]) : [];
  const q0 = questions[0] as Record<string, unknown> | undefined;
  return { filtered: { ...talkRecord, questions: [{ ...q0, answers: remaining }, ...questions.slice(1)] } };
}
