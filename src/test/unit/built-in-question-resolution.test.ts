import { pickBuiltInAnswer, resolveBuiltInQuestion } from '../../shared/built-in-question-resolution';
import {
  createEmptyTypedPreferenceState,
  makeTypedPreferenceScopeKey,
  saveTypedPreference,
} from '../../shared/typed-preference-store';

const userId = 'local';

// The scope key under test is always MY OWN tag (`tagContext.myTag`, derived by the caller
// from the nearest Pair-tag ancestor — see the doc comment in built-in-question-resolution.ts)
// — this is what `processTalkForm` (ui-manager.ts) saves under when I author my own talk, so a
// test simulating "I'm responding to a talk whose own declared tag is 'sell'" must seed my
// preference under scope 'buy' (my own tag), not 'sell' (their tag). `theirTag` is the incoming
// talk's own declared tag, needed only to know which direction a `quantity` comparison's
// want/have runs. The question's own text is also part of the scope key (a real bug found via
// docs/TODO.md §HH: without it, two builtIn questions in the same talk collide on the same
// (myTag, title) key).

describe('resolveBuiltInQuestion', () => {
  it('asks the user when the question has no builtIn spec', () => {
    const state = createEmptyTypedPreferenceState();
    expect(resolveBuiltInQuestion({ myTag: 'buy', theirTag: 'sell', title: 'Notebook' }, {}, state, userId)).toEqual({
      action: 'ASK_USER',
    });
  });

  it('asks the user when there is no stored preference at all (missing data, not incompatible)', () => {
    const state = createEmptyTypedPreferenceState();
    const tagContext = { myTag: 'buy', theirTag: 'sell', title: 'Notebook' };
    const question = { text: 'How many?', builtIn: { kind: 'quantity' as const, quantity: 5 } };
    expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({ action: 'ASK_USER' });
  });

  it('defers location entirely — always asks the user regardless of stored data', () => {
    const state = createEmptyTypedPreferenceState();
    const tagContext = { myTag: 'buy', theirTag: 'sell', title: 'Notebook' };
    const question = { text: 'Where?', builtIn: { kind: 'location' as const } };
    expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({ action: 'ASK_USER' });
  });

  describe('quantity', () => {
    it('is compatible when the sell-side (seller) has enough for the responder\'s want', () => {
      const state = createEmptyTypedPreferenceState();
      const tagContext = { myTag: 'buy', theirTag: 'sell', title: 'Notebook' }; // they declared "have" = 5
      const scopeKey = makeTypedPreferenceScopeKey('buy', 'Notebook', 'How many?'); // my own tag: buyer
      saveTypedPreference(state, userId, scopeKey, { kind: 'quantity', quantity: 2 }); // I want 2
      const question = { text: 'How many?', builtIn: { kind: 'quantity' as const, quantity: 5 } };

      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: true,
      });
    });

    it('is not compatible when the responder wants more than the sell-side declared', () => {
      const state = createEmptyTypedPreferenceState();
      const tagContext = { myTag: 'buy', theirTag: 'sell', title: 'Notebook' }; // they have 2
      const scopeKey = makeTypedPreferenceScopeKey('buy', 'Notebook', 'How many?');
      saveTypedPreference(state, userId, scopeKey, { kind: 'quantity', quantity: 5 }); // I want 5
      const question = { text: 'How many?', builtIn: { kind: 'quantity' as const, quantity: 2 } };

      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: false,
      });
    });

    it('is compatible when the buy-side (buyer) wants no more than the responder has', () => {
      const state = createEmptyTypedPreferenceState();
      const tagContext = { myTag: 'sell', theirTag: 'buy', title: 'Notebook' }; // they want 3
      const scopeKey = makeTypedPreferenceScopeKey('sell', 'Notebook', 'How many?'); // my own tag: seller
      saveTypedPreference(state, userId, scopeKey, { kind: 'quantity', quantity: 10 }); // I have 10
      const question = { text: 'How many?', builtIn: { kind: 'quantity' as const, quantity: 3 } };

      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: true,
      });
    });

    it('asks the user when there is no theirTag at all (ambiguous which side is want vs have)', () => {
      const state = createEmptyTypedPreferenceState();
      const tagContext = { title: 'Notebook' };
      const scopeKey = makeTypedPreferenceScopeKey('general', 'Notebook', 'How many?');
      saveTypedPreference(state, userId, scopeKey, { kind: 'quantity', quantity: 5 });
      const question = { text: 'How many?', builtIn: { kind: 'quantity' as const, quantity: 5 } };

      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({ action: 'ASK_USER' });
    });

    it('asks the user when the stored preference is a different kind than the question', () => {
      const state = createEmptyTypedPreferenceState();
      const tagContext = { myTag: 'buy', theirTag: 'sell', title: 'Notebook' };
      const scopeKey = makeTypedPreferenceScopeKey('buy', 'Notebook', 'How many?');
      saveTypedPreference(state, userId, scopeKey, { kind: 'priceRange', priceRange: { min: 1, max: 2 } });
      const question = { text: 'How many?', builtIn: { kind: 'quantity' as const, quantity: 5 } };

      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({ action: 'ASK_USER' });
    });

    it('does not resolve using a preference saved for a DIFFERENT question text under the same myTag — the bug §HH found', () => {
      // A talk with two builtIn questions (e.g. quantity AND priceRange) used to collapse to
      // one stored value, since the old 2-arg scope key (myTag, title) was identical for
      // both — the second save silently overwrote the first. This proves the fix: a preference
      // saved for "How many?" must not answer "What is the price?" even though myTag+title match.
      const state = createEmptyTypedPreferenceState();
      const tagContext = { myTag: 'buy', theirTag: 'sell', title: 'Notebook' };
      const scopeKey = makeTypedPreferenceScopeKey('buy', 'Notebook', 'How many?');
      saveTypedPreference(state, userId, scopeKey, { kind: 'quantity', quantity: 2 });
      const question = { text: 'What is the price?', builtIn: { kind: 'quantity' as const, quantity: 5 } };

      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({ action: 'ASK_USER' });
    });
  });

  describe('priceRange', () => {
    it('is compatible when the ranges genuinely overlap (not identical, real interval math)', () => {
      const state = createEmptyTypedPreferenceState();
      const tagContext = { myTag: 'buy', theirTag: 'sell', title: 'Notebook' };
      const scopeKey = makeTypedPreferenceScopeKey('buy', 'Notebook', 'What is the price?');
      saveTypedPreference(state, userId, scopeKey, { kind: 'priceRange', priceRange: { min: 300, max: 500 } });
      const question = { text: 'What is the price?', builtIn: { kind: 'priceRange' as const, priceRange: { min: 400, max: 600 } } };

      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: true,
      });
    });

    it('is not compatible when the ranges are disjoint', () => {
      const state = createEmptyTypedPreferenceState();
      const tagContext = { myTag: 'buy', theirTag: 'sell', title: 'Notebook' };
      const scopeKey = makeTypedPreferenceScopeKey('buy', 'Notebook', 'What is the price?');
      saveTypedPreference(state, userId, scopeKey, { kind: 'priceRange', priceRange: { min: 10, max: 20 } });
      const question = { text: 'What is the price?', builtIn: { kind: 'priceRange' as const, priceRange: { min: 400, max: 600 } } };

      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: false,
      });
    });
  });

  describe('timeFrame', () => {
    it('is compatible when date ranges overlap', () => {
      const state = createEmptyTypedPreferenceState();
      const tagContext = { myTag: 'buy', theirTag: 'sell', title: 'Studio rental' };
      const scopeKey = makeTypedPreferenceScopeKey('buy', 'Studio rental', 'When?');
      saveTypedPreference(state, userId, scopeKey, {
        kind: 'timeFrame',
        timeFrame: { start: new Date('2026-09-01').getTime(), end: new Date('2026-09-30').getTime() },
      });
      const question = {
        text: 'When?',
        builtIn: {
          kind: 'timeFrame' as const,
          timeFrame: { start: new Date('2026-09-15').getTime(), end: new Date('2026-10-15').getTime() },
        },
      };

      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: true,
      });
    });

    it('is not compatible when date ranges do not overlap', () => {
      const state = createEmptyTypedPreferenceState();
      const tagContext = { myTag: 'buy', theirTag: 'sell', title: 'Studio rental' };
      const scopeKey = makeTypedPreferenceScopeKey('buy', 'Studio rental', 'When?');
      saveTypedPreference(state, userId, scopeKey, {
        kind: 'timeFrame',
        timeFrame: { start: new Date('2026-09-01').getTime(), end: new Date('2026-09-30').getTime() },
      });
      const question = {
        text: 'When?',
        builtIn: {
          kind: 'timeFrame' as const,
          timeFrame: { start: new Date('2026-11-01').getTime(), end: new Date('2026-11-30').getTime() },
        },
      };

      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: false,
      });
    });
  });

  describe('ageRange (§DD)', () => {
    it('asks the user when there is no stored age/range preference (missing data, not incompatible)', () => {
      const state = createEmptyTypedPreferenceState();
      const tagContext = { myTag: 'seeking women', theirTag: 'seeking men', title: 'Dating' };
      const question = {
        text: 'Age range',
        builtIn: { kind: 'ageRange' as const, ageRange: { age: 28, acceptableRange: { min: 25, max: 35 } } },
      };
      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({ action: 'ASK_USER' });
    });

    it('is compatible when each side\'s declared age falls within the OTHER side\'s acceptable range, mutually', () => {
      const state = createEmptyTypedPreferenceState();
      const tagContext = { myTag: 'seeking women', theirTag: 'seeking men', title: 'Dating' };
      const scopeKey = makeTypedPreferenceScopeKey('seeking women', 'Dating', 'Age range');
      saveTypedPreference(state, userId, scopeKey, { kind: 'ageRange', ageRange: { age: 30, acceptableRange: { min: 26, max: 40 } } });
      const question = {
        text: 'Age range',
        builtIn: { kind: 'ageRange' as const, ageRange: { age: 28, acceptableRange: { min: 25, max: 35 } } },
      };

      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: true,
      });
    });

    it('is not compatible when one side\'s age falls outside the other\'s acceptable range', () => {
      const state = createEmptyTypedPreferenceState();
      const tagContext = { myTag: 'seeking women', theirTag: 'seeking men', title: 'Dating' };
      const scopeKey = makeTypedPreferenceScopeKey('seeking women', 'Dating', 'Age range');
      saveTypedPreference(state, userId, scopeKey, { kind: 'ageRange', ageRange: { age: 30, acceptableRange: { min: 26, max: 40 } } });
      const question = {
        text: 'Age range',
        // Incoming side is 50 — outside my 26-40 acceptable range.
        builtIn: { kind: 'ageRange' as const, ageRange: { age: 50, acceptableRange: { min: 25, max: 55 } } },
      };

      expect(resolveBuiltInQuestion(tagContext, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: false,
      });
    });
  });

  it('resolves two DIFFERENT builtIn questions in the SAME talk independently (priceRange + timeFrame, §HH)', () => {
    const state = createEmptyTypedPreferenceState();
    const tagContext = { myTag: 'buy', theirTag: 'sell', title: 'Home Repair Help' };
    saveTypedPreference(
      state,
      userId,
      makeTypedPreferenceScopeKey('buy', 'Home Repair Help', 'What is the hourly rate range?'),
      { kind: 'priceRange', priceRange: { min: 80, max: 120 } },
    );
    saveTypedPreference(
      state,
      userId,
      makeTypedPreferenceScopeKey('buy', 'Home Repair Help', 'When is the work needed?'),
      { kind: 'timeFrame', timeFrame: { start: new Date('2026-09-15').getTime(), end: new Date('2026-10-15').getTime() } },
    );

    const priceQuestion = {
      text: 'What is the hourly rate range?',
      builtIn: { kind: 'priceRange' as const, priceRange: { min: 50, max: 100 } },
    };
    const timeQuestion = {
      text: 'When is the work needed?',
      builtIn: {
        kind: 'timeFrame' as const,
        timeFrame: { start: new Date('2026-09-01').getTime(), end: new Date('2026-09-30').getTime() },
      },
    };

    expect(resolveBuiltInQuestion(tagContext, priceQuestion, state, userId)).toEqual({ action: 'ANSWER', compatible: true });
    expect(resolveBuiltInQuestion(tagContext, timeQuestion, state, userId)).toEqual({ action: 'ANSWER', compatible: true });
  });
});

describe('pickBuiltInAnswer', () => {
  it('returns undefined when the resolution is ASK_USER', () => {
    const answers = [
      { id: 'q_0_compatible', text: 'Compatible' },
      { id: 'q_0_incompatible', text: 'Not compatible' },
    ];
    expect(pickBuiltInAnswer(answers, 'q_0', { action: 'ASK_USER' })).toBeUndefined();
  });

  it('picks the compatible answer by id when it is TERMINAL (still isMatch-flagged, last in the chain)', () => {
    // Mirrors what TalkAutofix.fix produces for a builtIn question with no question after it.
    const answers = [
      { id: 'q_0_compatible', text: 'Compatible', isMatch: true, isTerminal: true },
      { id: 'q_0_incompatible', text: 'Not compatible', isIgnore: true, isTerminal: true },
    ];
    expect(pickBuiltInAnswer(answers, 'q_0', { action: 'ANSWER', compatible: true })).toEqual(answers[0]);
    expect(pickBuiltInAnswer(answers, 'q_0', { action: 'ANSWER', compatible: false })).toEqual(answers[1]);
  });

  it('picks the compatible answer by id when it is NON-TERMINAL — the real bug §HH found', () => {
    // Mirrors what TalkAutofix.fix's flow-normalization step produces for a builtIn question
    // that links to a next question: isMatch is stripped and replaced with nextQuestionId, so
    // an isMatch-based lookup (the original, buggy implementation) would find nothing here.
    const answers = [
      { id: 'q_0_compatible', text: 'Compatible', nextQuestionId: 'q_1' },
      { id: 'q_0_incompatible', text: 'Not compatible', isIgnore: true, isTerminal: true },
    ];
    expect(pickBuiltInAnswer(answers, 'q_0', { action: 'ANSWER', compatible: true })).toEqual(answers[0]);
    expect(pickBuiltInAnswer(answers, 'q_0', { action: 'ANSWER', compatible: false })).toEqual(answers[1]);
  });

  it('returns undefined when answers is empty or missing (malformed talk data, fail-safe)', () => {
    expect(pickBuiltInAnswer(undefined, 'q_0', { action: 'ANSWER', compatible: true })).toBeUndefined();
    expect(pickBuiltInAnswer([], 'q_0', { action: 'ANSWER', compatible: true })).toBeUndefined();
  });
});
