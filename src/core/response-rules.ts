/**
 * Rules both ends of a Talk response share (OPEN-91 P4), moved out of `app.ts`: when a response is
 * complete enough to send or take, whether it is an Ignore, and which version a response carries.
 */

/** A survey is answered only when every question is; other Talks end where their path ends. */
export function isResponseComplete(talkData: any, answers: readonly unknown[]): boolean {
  const totalQuestions = Array.isArray(talkData?.questions) ? talkData.questions.length : 0;
  return talkData?.type !== 'survey' || answers.length >= totalQuestions;
}

/** The answers include the Ignore choice (a talk-level opt-out). */
export function isIgnoreAnswerSet(answers: ReadonlyArray<{ answerId?: unknown; answerText?: unknown }>): boolean {
  return answers.some((answer) => {
    const answerId = String(answer?.answerId || '').toLowerCase();
    const answerText = String(answer?.answerText || '').toLowerCase();
    return answerId === 'ignore' || answerId.includes('ignore') || answerText === 'ignore';
  });
}

/**
 * The version a response carries (REQ-LEDGER-04): 1 for the first answer to this sender, the
 * same version when the same answers are sent again, one more when they changed (a change of mind).
 */
export function nextResponseVersion(priorResponseId: string | null, priorVersion: number, responseId: string): number {
  if (priorResponseId === null) return 1;
  return priorResponseId === responseId ? priorVersion : priorVersion + 1;
}
