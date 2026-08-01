import { FlowCapture, buildRevisedTalkDraft, checkIfMatch, checkIfIgnore } from '../../shared/talk-engine';
import type { Talk } from '../../shared/types';

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

/**
 * docs/TODO.md §V — two-author credit model. Bernard, 2026-08-01: "after editing a talk, it
 * gets a new id, then treat it as a new talk ... new talk can hold a reference to old talk
 * in case that further work is needed."
 */
describe('buildRevisedTalkDraft', () => {
  function pristineTalk(overrides: Partial<Talk> = {}): Talk {
    return {
      id: 'old_talk_id',
      title: 'Do you like tennis?',
      authorId: 'adam',
      type: 'flow',
      isAdult: false,
      language: 'en',
      tags: [],
      questions: [{ id: 'q1', text: 'Do you like tennis?', answers: [{ id: 'q1_a0', text: 'Yes.', isMatch: true, isTerminal: true }, { id: 'q1_a1', text: 'No.', isIgnore: true, isTerminal: true }] }],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      isTemplate: false,
      usageCount: 3,
      authorLocation: { latitude: 37.77, longitude: -122.41 },
      ...overrides,
    };
  }

  it('on a talk\'s first edit, seeds original* fields from its plain authorId/createdAt/authorLocation', () => {
    const draft = buildRevisedTalkDraft(pristineTalk(), [], 'eve');
    expect(draft.originalAuthorId).toBe('adam');
    expect(draft.originalCreatedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(draft.originalAuthorLocation).toEqual({ latitude: 37.77, longitude: -122.41 });
  });

  it('on a later edit, copies original* fields forward unchanged rather than re-seeding', () => {
    const alreadyRevised = pristineTalk({
      id: 'revised_once',
      authorId: 'eve', // eve edited it once already
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      authorLocation: { latitude: 40.71, longitude: -74.01 },
      originalAuthorId: 'adam', // but the ORIGINAL creator is still adam
      originalCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
      originalAuthorLocation: { latitude: 37.77, longitude: -122.41 },
    });
    const draft = buildRevisedTalkDraft(alreadyRevised, [], 'bob');
    // Original stays adam's, from the very first creation — not eve's intermediate edit.
    expect(draft.originalAuthorId).toBe('adam');
    expect(draft.originalCreatedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(draft.originalAuthorLocation).toEqual({ latitude: 37.77, longitude: -122.41 });
    // Current author becomes the new editor, bob.
    expect(draft.authorId).toBe('bob');
  });

  it('authorId becomes the editor, not the previous author', () => {
    const draft = buildRevisedTalkDraft(pristineTalk(), [], 'eve');
    expect(draft.authorId).toBe('eve');
  });

  it('supersedesTalkId points at the predecessor', () => {
    const draft = buildRevisedTalkDraft(pristineTalk(), [], 'eve');
    expect(draft.supersedesTalkId).toBe('old_talk_id');
  });

  it('leaves id empty for the caller\'s real content-hash computation', () => {
    const draft = buildRevisedTalkDraft(pristineTalk(), [], 'eve');
    expect(draft.id).toBe('');
  });

  it('does not set createdAt/authorLocation — the caller stamps those fresh at submission time', () => {
    const draft = buildRevisedTalkDraft(pristineTalk(), [], 'eve');
    expect(draft.createdAt).toBeUndefined();
    expect(draft.authorLocation).toBeUndefined();
  });

  it('carries forward type/language/tags/isAdult/isTemplate from the predecessor by default', () => {
    const old = pristineTalk({ language: 'zh', isAdult: true, isTemplate: true, tags: [{ id: 't1', name: 'sport', category: 'other', popularity: 5 }] });
    const draft = buildRevisedTalkDraft(old, [], 'eve');
    expect(draft.type).toBe('flow');
    expect(draft.language).toBe('zh');
    expect(draft.isAdult).toBe(true);
    expect(draft.isTemplate).toBe(true);
    expect(draft.tags).toEqual([{ id: 't1', name: 'sport', category: 'other', popularity: 5 }]);
  });

  it('lets the caller override metadata fields explicitly', () => {
    const draft = buildRevisedTalkDraft(pristineTalk(), [], 'eve', { title: 'New title', language: 'zh' });
    expect(draft.title).toBe('New title');
    expect(draft.language).toBe('zh');
  });

  it('uses the supplied questions verbatim, not the predecessor\'s', () => {
    const newQuestions = [{ id: 'q9', text: 'New question?', answers: [] }];
    const draft = buildRevisedTalkDraft(pristineTalk(), newQuestions, 'eve');
    expect(draft.questions).toBe(newQuestions);
  });

  it('omits originalAuthorLocation entirely when the predecessor never had a location', () => {
    const noLocation = pristineTalk();
    delete (noLocation as Partial<Talk>).authorLocation;
    const draft = buildRevisedTalkDraft(noLocation, [], 'eve');
    expect(draft.originalAuthorLocation).toBeUndefined();
  });

  it('carries expiresAt/locationRadiusMiles forward only when the predecessor has them', () => {
    const withExpiry = pristineTalk({ expiresAt: 12345, locationRadiusMiles: 50 });
    const draft = buildRevisedTalkDraft(withExpiry, [], 'eve');
    expect(draft.expiresAt).toBe(12345);
    expect(draft.locationRadiusMiles).toBe(50);

    const without = pristineTalk();
    const draft2 = buildRevisedTalkDraft(without, [], 'eve');
    expect(draft2.expiresAt).toBeUndefined();
    expect(draft2.locationRadiusMiles).toBeUndefined();
  });
});
