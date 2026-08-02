import { nextSurveyQuestion } from '../../web/ui/talk-response-dialog';

/**
 * docs/TODO.md §W Gap 2 completeness note — Bernard, 2026-08-01: "if receiver answers 2 out of
 * 3 questions talk, it is considered not yet done on his side. the sender should not receive
 * incomplete answer and should consider not yet answered."
 *
 * Root cause: a survey's per-question "Ignore" answer (required by TalkValidator on every
 * question) was being treated as "abandon the whole survey" instead of "not interested in this
 * one question" — completeAndClose() fired on the first Ignore pick regardless of question
 * position. `nextSurveyQuestion` is the shared decision helper that fixes this: only the
 * genuinely last question ends the response; every other position always advances.
 */

function surveyOf(questionCount: number): { type: 'survey'; questions: Array<{ id: string }> } {
  return {
    type: 'survey',
    questions: Array.from({ length: questionCount }, (_, i) => ({ id: `q_${i}` })),
  };
}

describe('nextSurveyQuestion', () => {
  it('advances to the next question when not on the last one', () => {
    const talk = surveyOf(3);
    const next = nextSurveyQuestion(talk, talk.questions[0]);
    expect(next).toBe(talk.questions[1]);
  });

  it('advances from the middle question too', () => {
    const talk = surveyOf(3);
    const next = nextSurveyQuestion(talk, talk.questions[1]);
    expect(next).toBe(talk.questions[2]);
  });

  it('returns null on the last question — this is what actually ends the response', () => {
    const talk = surveyOf(3);
    const next = nextSurveyQuestion(talk, talk.questions[2]);
    expect(next).toBeNull();
  });

  it('returns null for a single-question survey (first question is also the last)', () => {
    const talk = surveyOf(1);
    const next = nextSurveyQuestion(talk, talk.questions[0]);
    expect(next).toBeNull();
  });

  it('is agnostic to which answer (ignore, terminal, whatever) triggered the call — position is the only input that matters', () => {
    // The function itself takes no answer-flag argument at all: callers are responsible for
    // calling it on EVERY answer for a survey question, not just non-ignore ones — that's the
    // actual fix (see talk-response-dialog.ts's applyChoice and the auto-answer path, which both
    // now call this unconditionally for survey before checking isIgnore/isMatch/isTerminal).
    const talk = surveyOf(2);
    expect(nextSurveyQuestion(talk, talk.questions[0])).toBe(talk.questions[1]);
    expect(nextSurveyQuestion(talk, talk.questions[1])).toBeNull();
  });
});
