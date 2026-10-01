/** @jest-environment jsdom */

/**
 * Proves the actual thing Bernard asked for: after an `ANSWER_CONTEXT_VERSION` bump, the
 * chatbot's memory is silently resynced from `myTalks` + the legacy per-question answer log —
 * no user interaction, no "it forgot everything and has to ask again" regression — and stale,
 * unrecoverable old-version keys are dropped rather than left to rot forever.
 */
import {
  needsAnswerContextMigration,
  runAnswerContextMigration,
} from '../../web/ui/answer-context-migration';
import { resolveAnswerPreferenceForTalkQuestion } from '../../web/ui/answer-preference-resolution';
import {
  getAnswerPreferences,
  getFlattenedAnswerPreferences,
  getQuestionDefaultContracts,
  setAnswerPreferences,
  setTypedPreferenceState,
  type AnswerPreferenceEntry,
} from '../../web/ui/answer-preferences-storage';
import { setMyTalks, type MyTalkEntry } from '../../web/ui/my-talks-storage';
import { ANSWER_CONTEXT_VERSION } from '../../shared/flattened-answer-keys';
import { LOCAL_EXACT_CHATBOT_USER_ID } from '../../shared/exact-chatbot-memory';
import { saveTypedPreference, makeTypedPreferenceScopeKey } from '../../shared/typed-preference-store';
import { createEmptyTypedPreferenceState } from '../../shared/typed-preference-store';

const USER_ID = 'me';

/** A stale legacy entry the way OLD (pre-v2) code, or any earlier version, would have written it
 *  — no `contextHash`/`contextVersion` at all. This is exactly the shape the resolver must never
 *  match against, and exactly the shape this migration must still be able to READ (the fact of
 *  "which answer was given" doesn't depend on the hashing algorithm's version). */
function legacyEntry(overrides: Partial<AnswerPreferenceEntry> & { talkId: string; answerId: string; answerText: string; questionText: string }): AnswerPreferenceEntry {
  return {
    mode: 'auto',
    language: 'en',
    timestamp: new Date(0).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('answer-context-migration', () => {
  it('needsAnswerContextMigration is true with no marker and false after running', () => {
    expect(needsAnswerContextMigration()).toBe(true);
    const { migratedTalks } = runAnswerContextMigration(USER_ID);
    expect(migratedTalks).toBe(0); // nothing saved yet — still a legitimate, marked run
    expect(needsAnswerContextMigration()).toBe(false);
  });

  it('is idempotent — a second run is a no-op and does not throw', () => {
    const talk = {
      id: 'flow-1',
      type: 'flow',
      language: 'en',
      authorId: 'other',
      questions: [
        { id: 'q1', text: 'Buying fruit?', answers: [{ id: 'yes', text: 'Yes', nextQuestionId: 'q2' }, { id: 'no', text: 'No', isIgnore: true, isTerminal: true }] },
        { id: 'q2', text: 'Which fruit?', answers: [{ id: 'apple', text: 'Apple', isMatch: true, isTerminal: true }] },
      ],
    };
    setMyTalks({
      'flow-1': {
        talkId: 'flow-1', title: 'Fruit', type: 'flow', timestamp: new Date(0).toISOString(), role: 'answered',
        fullTalk: talk,
        completedAnswers: [
          { questionId: 'q1', answerId: 'yes', answerText: 'Yes' },
          { questionId: 'q2', answerId: 'apple', answerText: 'Apple' },
        ],
        outcome: 'match',
      } as MyTalkEntry,
    });
    setAnswerPreferences({
      'flow-1_q1': legacyEntry({ talkId: 'flow-1', answerId: 'yes', answerText: 'Yes', questionText: 'Buying fruit?' }),
      'flow-1_q2': legacyEntry({ talkId: 'flow-1', answerId: 'apple', answerText: 'Apple', questionText: 'Which fruit?' }),
    });

    const first = runAnswerContextMigration(USER_ID);
    expect(first.migratedTalks).toBe(1);
    const afterFirst = JSON.stringify(getFlattenedAnswerPreferences());

    const second = runAnswerContextMigration(USER_ID);
    expect(second.migratedTalks).toBe(0);
    expect(JSON.stringify(getFlattenedAnswerPreferences())).toBe(afterFirst);
  });

  it('reconstructs a flow chain so the resolver recognizes it exactly as a live session would', () => {
    const talk = {
      id: 'flow-2',
      type: 'flow',
      language: 'en',
      authorId: 'other',
      questions: [
        { id: 'q1', text: 'Buying fruit?', answers: [{ id: 'yes', text: 'Yes', nextQuestionId: 'q2' }, { id: 'no', text: 'No', isIgnore: true, isTerminal: true }] },
        { id: 'q2', text: 'Which fruit?', answers: [{ id: 'apple', text: 'Apple', isMatch: true, isTerminal: true }, { id: 'banana', text: 'Banana', isMatch: true, isTerminal: true }] },
      ],
    };
    setMyTalks({
      'flow-2': {
        talkId: 'flow-2', title: 'Fruit', type: 'flow', timestamp: new Date(0).toISOString(), role: 'answered',
        fullTalk: talk,
        completedAnswers: [
          { questionId: 'q1', answerId: 'yes', answerText: 'Yes' },
          { questionId: 'q2', answerId: 'apple', answerText: 'Apple' },
        ],
        outcome: 'match',
      } as MyTalkEntry,
    });
    setAnswerPreferences({
      'flow-2_q1': legacyEntry({ talkId: 'flow-2', answerId: 'yes', answerText: 'Yes', questionText: 'Buying fruit?' }),
      'flow-2_q2': legacyEntry({ talkId: 'flow-2', answerId: 'apple', answerText: 'Apple', questionText: 'Which fruit?' }),
    });

    runAnswerContextMigration(USER_ID);

    const q1Result = resolveAnswerPreferenceForTalkQuestion(USER_ID, talk, 0, [], talk.questions[0], talk.id);
    expect(q1Result).toMatchObject({ answerId: 'yes', answerText: 'Yes', mode: 'auto', autoAnswerReason: 'KNOWN_CONTEXT_MATCH' });
    expect(q1Result?.contextHash).toBeTruthy();
    const q1ContextHash = q1Result!.contextHash!;

    const q2Result = resolveAnswerPreferenceForTalkQuestion(
      USER_ID,
      talk,
      1,
      [{ questionText: 'Buying fruit?', answerText: 'Yes', contextHash: q1ContextHash }],
      talk.questions[1],
      talk.id,
    );
    expect(q2Result).toMatchObject({ answerId: 'apple', answerText: 'Apple', mode: 'auto', autoAnswerReason: 'KNOWN_CONTEXT_MATCH' });
  });

  it('replays Whenever offered history into the separate broad-contract store', () => {
    const talk = {
      id: 'flow-default', type: 'flow', language: 'en', authorId: 'other',
      questions: [{
        id: 'q1', text: 'Which fruit?',
        answers: [{ id: 'apple', text: 'Apple', isMatch: true, isTerminal: true }, { id: 'banana', text: 'Banana', isMatch: true, isTerminal: true }],
      }],
    };
    setMyTalks({
      'flow-default': {
        talkId: 'flow-default', title: 'Fruit', type: 'flow', timestamp: new Date(0).toISOString(),
        role: 'answered', fullTalk: talk,
        completedAnswers: [{ questionId: 'q1', answerId: 'apple', answerText: 'Apple' }], outcome: 'match',
      } as MyTalkEntry,
    });
    setAnswerPreferences({
      'flow-default_q1': legacyEntry({
        talkId: 'flow-default', answerId: 'apple', answerText: 'Apple', questionText: 'Which fruit?', mode: 'whenever',
      }),
    });

    runAnswerContextMigration(USER_ID);

    expect(getFlattenedAnswerPreferences()).toEqual({});
    expect(Object.values(getQuestionDefaultContracts())[0]?.answers.map((answer) => answer.answerText))
      .toEqual(['Apple']);
    const changedQuestion = {
      id: 'changed', text: 'Which fruit?',
      answers: [{ id: 'pear', text: 'Pear', isMatch: true }, { id: 'apple-new', text: 'Apple', isMatch: true }],
    };
    const result = resolveAnswerPreferenceForTalkQuestion(
      USER_ID,
      { ...talk, id: 'changed-talk', questions: [changedQuestion] },
      0,
      [],
      changedQuestion,
      'changed-talk',
    );
    expect(result).toMatchObject({
      answerId: 'apple-new', answerText: 'Apple', autoAnswerReason: 'KNOWN_QUESTION_DEFAULT',
    });
  });

  it('reconstructs a self-authored tag talk', () => {
    const talk = {
      id: 'tag-1',
      type: 'tag',
      language: 'en',
      authorId: USER_ID,
      questions: [{
        id: 'q_0', text: 'Tennis', tagKind: 'simple',
        answers: [{ id: 'a_0_match', text: 'Tennis', isMatch: true, isTerminal: true }, { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true }],
      }],
    };
    setMyTalks({
      'tag-1': { talkId: 'tag-1', title: 'Tennis', type: 'tag', timestamp: new Date(0).toISOString(), role: 'created', fullTalk: talk, disabled: false } as MyTalkEntry,
    });
    setAnswerPreferences({
      'tag-1_q_0': legacyEntry({ talkId: 'tag-1', answerId: 'a_0_match', answerText: 'Tennis', questionText: 'Tennis' }),
    });

    runAnswerContextMigration(USER_ID);

    const result = resolveAnswerPreferenceForTalkQuestion(USER_ID, talk, 0, [], talk.questions[0], talk.id);
    expect(result).toMatchObject({ answerId: 'a_0_match', answerText: 'Tennis', mode: 'auto', autoAnswerReason: 'KNOWN_CONTEXT_MATCH' });
  });

  it('reconstructs a route with a builtIn root feeding a Pair-tag branch (Dating-template shape) — the case a live self-answer session cannot recover on its own', () => {
    const talk = {
      id: 'route-1',
      type: 'route',
      language: 'en',
      title: 'Dating',
      isAdult: true,
      authorId: USER_ID,
      questions: [
        {
          id: 'q_0', text: 'Age range', contextPath: [],
          builtIn: { kind: 'ageRange', ageRange: { age: 28, acceptableRange: { min: 21, max: 45 } } },
          answers: [
            { id: 'q_0_compatible', text: 'Compatible', isMatch: true, nextQuestionIds: ['q_1'] },
            { id: 'q_0_incompatible', text: 'Not compatible', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q_1', text: 'men', contextPath: [{ questionId: 'q_0', answerId: 'q_0_compatible' }],
          reciprocalTagContext: true,
          answers: [{ id: 'a_1_match', text: 'women', nextQuestionId: 'q_1c' }],
        },
        {
          id: 'q_1c', text: 'Confirm: interested in women',
          contextPath: [{ questionId: 'q_0', answerId: 'q_0_compatible' }, { questionId: 'q_1', answerId: 'a_1_match' }],
          answers: [{ id: 'a_1c_match', text: 'Yes', isMatch: true, isTerminal: true }],
        },
      ],
    };
    // The talk's own author declares their age preference once, e.g. at profile/onboarding
    // time — this is what `resolveBuiltInQuestion` reads to resolve the root deterministically,
    // exactly like a live incoming-talk auto-reply would.
    const typedState = createEmptyTypedPreferenceState();
    const scopeKey = makeTypedPreferenceScopeKey('general', 'Dating', 'Age range', '');
    saveTypedPreference(typedState, LOCAL_EXACT_CHATBOT_USER_ID, scopeKey, { kind: 'ageRange', ageRange: { age: 30, acceptableRange: { min: 20, max: 50 } } });
    setTypedPreferenceState(typedState);

    setMyTalks({
      'route-1': { talkId: 'route-1', title: 'Dating', type: 'route', timestamp: new Date(0).toISOString(), role: 'created', fullTalk: talk } as MyTalkEntry,
    });
    // Note: q_0 (builtIn) deliberately has NO legacy entry — route-editor-model.ts's
    // buildRouteSelfAnswers never records one for a builtIn node, which is exactly the gap this
    // migration bridges by resolving it live instead of requiring a recorded self-answer.
    setAnswerPreferences({
      'route-1_q_1': legacyEntry({ talkId: 'route-1', answerId: 'a_1_match', answerText: 'women', questionText: 'men' }),
      'route-1_q_1c': legacyEntry({ talkId: 'route-1', answerId: 'a_1c_match', answerText: 'Yes', questionText: 'Confirm: interested in women' }),
    });

    const { migratedTalks } = runAnswerContextMigration(USER_ID);
    expect(migratedTalks).toBe(1);

    // The proof: an incoming talk asking the identical q_1c question, reached via the identical
    // builtIn-root chain, now resolves from memory — no re-ask.
    const q0Result = resolveAnswerPreferenceForTalkQuestion(USER_ID, talk, 0, [], talk.questions[0], talk.id);
    expect(q0Result).toMatchObject({ answerId: 'q_0_compatible', mode: 'auto' });
    const q0ContextHash = q0Result!.contextHash!;
    const q1cResult = resolveAnswerPreferenceForTalkQuestion(
      USER_ID,
      talk,
      2,
      [{ questionText: 'Age range', answerText: 'Compatible', contextHash: q0ContextHash }],
      talk.questions[2],
      talk.id,
    );
    expect(q1cResult).toMatchObject({ answerId: 'a_1c_match', answerText: 'Yes', mode: 'auto', autoAnswerReason: 'KNOWN_CONTEXT_MATCH' });
  });

  it('drops stale/unrecoverable old-version entries instead of leaving them to rot', () => {
    const talk = {
      id: 'flow-3', type: 'flow', language: 'en', authorId: 'other',
      questions: [{ id: 'q1', text: 'Q', answers: [{ id: 'a', text: 'A', isMatch: true, isTerminal: true }] }],
    };
    setMyTalks({
      'flow-3': { talkId: 'flow-3', title: 'Q', type: 'flow', timestamp: new Date(0).toISOString(), role: 'answered', fullTalk: talk, completedAnswers: [{ questionId: 'q1', answerId: 'a', answerText: 'A' }], outcome: 'match' } as MyTalkEntry,
    });
    setAnswerPreferences({
      'flow-3_q1': legacyEntry({ talkId: 'flow-3', answerId: 'a', answerText: 'A', questionText: 'Q' }),
    });
    // Simulate leftover data from a retired algorithm: a pre-v2 `flat_<hash>` key (no version
    // segment at all) and a same-shaped-but-wrong-version entry — neither is reachable by any
    // current key-building path, so they're just dead weight.
    localStorage.setItem('flattenedAnswerPreferences', JSON.stringify({
      flat_deadbeef: { answerId: 'a', answerText: 'A', mode: 'temporary', questionText: 'Q', talkId: 'flow-3' },
      [`flat_v${ANSWER_CONTEXT_VERSION - 1}_deadbeef`]: { answerId: 'a', answerText: 'A', mode: 'temporary', questionText: 'Q', talkId: 'flow-3', contextVersion: ANSWER_CONTEXT_VERSION - 1 },
    }));

    runAnswerContextMigration(USER_ID);

    const flatMap = getFlattenedAnswerPreferences();
    expect(flatMap.flat_deadbeef).toBeUndefined();
    expect(flatMap[`flat_v${ANSWER_CONTEXT_VERSION - 1}_deadbeef`]).toBeUndefined();
    expect(Object.values(flatMap).every((entry) => entry.contextVersion === ANSWER_CONTEXT_VERSION)).toBe(true);
    expect(Object.values(flatMap).some((entry) => entry.answerText === 'A')).toBe(true);
  });

  it('refreshes the Me-tab legacy preferences entry in place (same key, current contextVersion)', () => {
    const talk = {
      id: 'flow-4', type: 'flow', language: 'en', authorId: 'other',
      questions: [{ id: 'q1', text: 'Q', answers: [{ id: 'a', text: 'A', isMatch: true, isTerminal: true }] }],
    };
    setMyTalks({
      'flow-4': { talkId: 'flow-4', title: 'Q', type: 'flow', timestamp: new Date(0).toISOString(), role: 'answered', fullTalk: talk, completedAnswers: [{ questionId: 'q1', answerId: 'a', answerText: 'A' }], outcome: 'match' } as MyTalkEntry,
    });
    setAnswerPreferences({
      'flow-4_q1': legacyEntry({ talkId: 'flow-4', answerId: 'a', answerText: 'A', questionText: 'Q' }),
    });

    runAnswerContextMigration(USER_ID);

    const refreshed = getAnswerPreferences()['flow-4_q1'];
    expect(refreshed).toBeDefined();
    expect(refreshed.contextVersion).toBe(ANSWER_CONTEXT_VERSION);
    expect(refreshed.contextHash).toBeTruthy();
  });

  it('is safe (no-op, no throw) with no myTalks and no legacy data at all', () => {
    expect(() => runAnswerContextMigration(USER_ID)).not.toThrow();
    expect(runAnswerContextMigration('anyone')).toEqual({ migratedTalks: 0 });
    expect(getFlattenedAnswerPreferences()).toEqual({});
  });
});
