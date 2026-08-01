import { FlowCapture } from '../../shared/talk-engine';
import { checkIfMatch, checkIfIgnore } from '../../shared/talk-engine';

/**
 * docs/TODO.md §V — Auto Linear Capture (FR-TK-7, spec'd 2026-01-19, implemented 2026-08-01).
 *
 * Grammar decided 2026-08-01 (Bernard, "keep it simple enough"): no `**`/`*` markers —
 * plain `Question? Answer1; Answer2; ...; AnswerN.`, first answer matches and advances,
 * every other answer ends the flow. No synthetic "Ignore"/"Let's talk in person" buttons.
 */

describe('FlowCapture.parseChatLine', () => {
  it('parses a question and semicolon-separated answers', () => {
    const parsed = FlowCapture.parseChatLine('Do you like tennis? Yes; No.');
    expect(parsed).toEqual({ question: 'Do you like tennis?', answers: ['Yes.', 'No.'] });
  });

  it('parses more than two answers', () => {
    const parsed = FlowCapture.parseChatLine('Hot or iced? Hot; Iced; Neither.');
    expect(parsed?.answers).toEqual(['Hot.', 'Iced.', 'Neither.']);
  });

  it('returns null when there is no question mark', () => {
    expect(FlowCapture.parseChatLine('Great, let\'s meet tomorrow.')).toBeNull();
  });

  it('trims whitespace around the question and each answer', () => {
    const parsed = FlowCapture.parseChatLine('  Do you like coffee?   Yes ;  No.');
    expect(parsed?.question).toBe('Do you like coffee?');
    expect(parsed?.answers).toEqual(['Yes.', 'No.']);
  });

  it('allows a single answer (no alternative to ignore, but still a valid line)', () => {
    const parsed = FlowCapture.parseChatLine('Ready? Yes.');
    expect(parsed?.answers).toEqual(['Yes.']);
  });

  it('drops empty answers from stray semicolons', () => {
    const parsed = FlowCapture.parseChatLine('Coffee? Yes;; No.');
    expect(parsed?.answers).toEqual(['Yes.', 'No.']);
  });
});

describe('FlowCapture.isTerminatorLine', () => {
  it('is true for a plain sentence ending with a period', () => {
    expect(FlowCapture.isTerminatorLine("Great, let's meet tomorrow.")).toBe(true);
  });

  it('is false for a captured question line (contains a question mark)', () => {
    expect(FlowCapture.isTerminatorLine('Do you like tennis? Yes; No.')).toBe(false);
  });

  it('is false when the line does not end with a period', () => {
    expect(FlowCapture.isTerminatorLine('no ending punctuation')).toBe(false);
  });
});

describe('FlowCapture.assembleCapturedTalk', () => {
  it("TC-LIN-01's worked example: two captured lines chain into one flow talk", () => {
    // Do you like coffee? Yes; No.
    // Hot or iced? Hot; Iced.
    // Great, let's meet tomorrow. (terminator — the caller stops collecting before this line)
    const talk = FlowCapture.assembleCapturedTalk([
      'Do you like coffee? Yes; No.',
      'Hot or iced? Hot; Iced.',
    ]);
    expect(talk).not.toBeNull();
    expect(talk!.type).toBe('flow');
    expect(talk!.questions).toHaveLength(2);

    const [q1, q2] = talk!.questions;
    expect(q1.text).toBe('Do you like coffee?');
    expect(q1.answers).toHaveLength(2);
    // First answer (Yes) advances to q2 — not a terminal match yet, there's another question.
    expect(q1.answers[0].text).toBe('Yes.');
    expect(q1.answers[0].nextQuestionId).toBe(q2.id);
    expect(q1.answers[0].isMatch).toBeFalsy();
    // Second answer (No) terminates as ignore.
    expect(q1.answers[1].text).toBe('No.');
    expect(q1.answers[1].isIgnore).toBe(true);
    expect(q1.answers[1].isTerminal).toBe(true);

    expect(q2.text).toBe('Hot or iced?');
    expect(q2.answers).toHaveLength(2);
    // First answer on the LAST question is the terminal match — no next question to advance to.
    expect(q2.answers[0].text).toBe('Hot.');
    expect(q2.answers[0].isMatch).toBe(true);
    expect(q2.answers[0].isTerminal).toBe(true);
    expect(q2.answers[0].nextQuestionId).toBeUndefined();
    // Second answer still ignores.
    expect(q2.answers[1].text).toBe('Iced.');
    expect(q2.answers[1].isIgnore).toBe(true);
  });

  it('adds no synthetic Ignore/"Let\'s talk in person" buttons — exactly the captured answers', () => {
    const talk = FlowCapture.assembleCapturedTalk(['Do you like tennis? Yes; No.']);
    expect(talk!.questions[0].answers.map((a) => a.text)).toEqual(['Yes.', 'No.']);
  });

  it('a single captured line becomes one question whose first answer is the terminal match', () => {
    const talk = FlowCapture.assembleCapturedTalk(['Ready to start? Yes; Not yet.']);
    expect(talk!.questions).toHaveLength(1);
    const [q] = talk!.questions;
    expect(q.answers[0].isMatch).toBe(true);
    expect(q.answers[0].nextQuestionId).toBeUndefined();
    expect(q.answers[1].isIgnore).toBe(true);
  });

  it('returns null when no line parses as a captured question', () => {
    expect(FlowCapture.assembleCapturedTalk(['just a plain sentence.', 'another one.'])).toBeNull();
    expect(FlowCapture.assembleCapturedTalk([])).toBeNull();
  });

  it('skips lines that fail to parse and keeps the rest', () => {
    const talk = FlowCapture.assembleCapturedTalk([
      'Do you like tennis? Yes; No.',
      'not a question line',
      'Hot or iced? Hot; Iced.',
    ]);
    expect(talk!.questions).toHaveLength(2);
  });

  it('returns a draft — empty id/authorId, left for the caller to fill in', () => {
    const talk = FlowCapture.assembleCapturedTalk(['Do you like tennis? Yes; No.']);
    expect(talk!.id).toBe('');
    expect(talk!.authorId).toBe('');
    expect(talk!.tags).toEqual([]);
  });

  it('derives a title from the first captured question', () => {
    const talk = FlowCapture.assembleCapturedTalk(['Do you like tennis? Yes; No.']);
    expect(talk!.title).toBe('Do you like tennis');
  });

  it('end-to-end: answering the first (match) answer at every step matches; any other answer ignores immediately', () => {
    const talk = FlowCapture.assembleCapturedTalk([
      'Do you like coffee? Yes; No.',
      'Hot or iced? Hot; Iced.',
    ])!;
    const [q1, q2] = talk.questions;

    // Picking "No" on q1 — the flow ends there; checkIfIgnore looks only at the LAST answer given.
    expect(checkIfIgnore(talk, [{ questionId: q1.id, answerId: q1.answers[1].id }])).toBe(true);
    expect(checkIfMatch(talk, [{ questionId: q1.id, answerId: q1.answers[1].id }])).toBe(false);

    // Picking "Yes" then "Hot" — advances through both questions and ends as a match.
    const fullPath = [
      { questionId: q1.id, answerId: q1.answers[0].id },
      { questionId: q2.id, answerId: q2.answers[0].id },
    ];
    expect(checkIfMatch(talk, fullPath)).toBe(true);
    expect(checkIfIgnore(talk, fullPath)).toBe(false);
  });
});
