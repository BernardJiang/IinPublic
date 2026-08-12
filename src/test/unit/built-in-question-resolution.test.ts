import { resolveBuiltInQuestion } from '../../shared/built-in-question-resolution';
import {
  createEmptyTypedPreferenceState,
  makeTypedPreferenceScopeKey,
  saveTypedPreference,
} from '../../shared/typed-preference-store';

const userId = 'local';

describe('resolveBuiltInQuestion', () => {
  it('asks the user when the question has no builtIn spec', () => {
    const state = createEmptyTypedPreferenceState();
    expect(resolveBuiltInQuestion({ role: 'offer', title: 'Notebook' }, {}, state, userId)).toEqual({
      action: 'ASK_USER',
    });
  });

  it('asks the user when there is no stored preference at all (missing data, not incompatible)', () => {
    const state = createEmptyTypedPreferenceState();
    const talk = { role: 'offer' as const, title: 'Notebook' };
    const question = { builtIn: { kind: 'quantity' as const, quantity: 5 } };
    expect(resolveBuiltInQuestion(talk, question, state, userId)).toEqual({ action: 'ASK_USER' });
  });

  it('defers location entirely — always asks the user regardless of stored data', () => {
    const state = createEmptyTypedPreferenceState();
    const talk = { role: 'offer' as const, title: 'Notebook' };
    const question = { builtIn: { kind: 'location' as const } };
    expect(resolveBuiltInQuestion(talk, question, state, userId)).toEqual({ action: 'ASK_USER' });
  });

  describe('quantity', () => {
    it('is compatible when the offer-side (seller) has enough for the responder\'s want', () => {
      const state = createEmptyTypedPreferenceState();
      const talk = { role: 'offer' as const, title: 'Notebook' }; // they declared "have" = 5
      const scopeKey = makeTypedPreferenceScopeKey('offer', 'Notebook');
      saveTypedPreference(state, userId, scopeKey, { kind: 'quantity', quantity: 2 }); // I want 2
      const question = { builtIn: { kind: 'quantity' as const, quantity: 5 } };

      expect(resolveBuiltInQuestion(talk, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: true,
      });
    });

    it('is not compatible when the responder wants more than the offer-side declared', () => {
      const state = createEmptyTypedPreferenceState();
      const talk = { role: 'offer' as const, title: 'Notebook' }; // they have 2
      const scopeKey = makeTypedPreferenceScopeKey('offer', 'Notebook');
      saveTypedPreference(state, userId, scopeKey, { kind: 'quantity', quantity: 5 }); // I want 5
      const question = { builtIn: { kind: 'quantity' as const, quantity: 2 } };

      expect(resolveBuiltInQuestion(talk, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: false,
      });
    });

    it('is compatible when the request-side (buyer) wants no more than the responder has', () => {
      const state = createEmptyTypedPreferenceState();
      const talk = { role: 'request' as const, title: 'Notebook' }; // they want 3
      const scopeKey = makeTypedPreferenceScopeKey('request', 'Notebook');
      saveTypedPreference(state, userId, scopeKey, { kind: 'quantity', quantity: 10 }); // I have 10
      const question = { builtIn: { kind: 'quantity' as const, quantity: 3 } };

      expect(resolveBuiltInQuestion(talk, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: true,
      });
    });

    it('asks the user when the talk has no role (ambiguous which side is want vs have)', () => {
      const state = createEmptyTypedPreferenceState();
      const talk = { title: 'Notebook' };
      const scopeKey = makeTypedPreferenceScopeKey('general', 'Notebook');
      saveTypedPreference(state, userId, scopeKey, { kind: 'quantity', quantity: 5 });
      const question = { builtIn: { kind: 'quantity' as const, quantity: 5 } };

      expect(resolveBuiltInQuestion(talk, question, state, userId)).toEqual({ action: 'ASK_USER' });
    });

    it('asks the user when the stored preference is a different kind than the question', () => {
      const state = createEmptyTypedPreferenceState();
      const talk = { role: 'offer' as const, title: 'Notebook' };
      const scopeKey = makeTypedPreferenceScopeKey('offer', 'Notebook');
      saveTypedPreference(state, userId, scopeKey, { kind: 'priceRange', priceRange: { min: 1, max: 2 } });
      const question = { builtIn: { kind: 'quantity' as const, quantity: 5 } };

      expect(resolveBuiltInQuestion(talk, question, state, userId)).toEqual({ action: 'ASK_USER' });
    });
  });

  describe('priceRange', () => {
    it('is compatible when the ranges genuinely overlap (not identical, real interval math)', () => {
      const state = createEmptyTypedPreferenceState();
      const talk = { role: 'offer' as const, title: 'Notebook' };
      const scopeKey = makeTypedPreferenceScopeKey('offer', 'Notebook');
      saveTypedPreference(state, userId, scopeKey, { kind: 'priceRange', priceRange: { min: 300, max: 500 } });
      const question = { builtIn: { kind: 'priceRange' as const, priceRange: { min: 400, max: 600 } } };

      expect(resolveBuiltInQuestion(talk, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: true,
      });
    });

    it('is not compatible when the ranges are disjoint', () => {
      const state = createEmptyTypedPreferenceState();
      const talk = { role: 'offer' as const, title: 'Notebook' };
      const scopeKey = makeTypedPreferenceScopeKey('offer', 'Notebook');
      saveTypedPreference(state, userId, scopeKey, { kind: 'priceRange', priceRange: { min: 10, max: 20 } });
      const question = { builtIn: { kind: 'priceRange' as const, priceRange: { min: 400, max: 600 } } };

      expect(resolveBuiltInQuestion(talk, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: false,
      });
    });
  });

  describe('timeFrame', () => {
    it('is compatible when date ranges overlap', () => {
      const state = createEmptyTypedPreferenceState();
      const talk = { role: 'offer' as const, title: 'Studio rental' };
      const scopeKey = makeTypedPreferenceScopeKey('offer', 'Studio rental');
      saveTypedPreference(state, userId, scopeKey, {
        kind: 'timeFrame',
        timeFrame: { start: new Date('2026-09-01').getTime(), end: new Date('2026-09-30').getTime() },
      });
      const question = {
        builtIn: {
          kind: 'timeFrame' as const,
          timeFrame: { start: new Date('2026-09-15').getTime(), end: new Date('2026-10-15').getTime() },
        },
      };

      expect(resolveBuiltInQuestion(talk, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: true,
      });
    });

    it('is not compatible when date ranges do not overlap', () => {
      const state = createEmptyTypedPreferenceState();
      const talk = { role: 'offer' as const, title: 'Studio rental' };
      const scopeKey = makeTypedPreferenceScopeKey('offer', 'Studio rental');
      saveTypedPreference(state, userId, scopeKey, {
        kind: 'timeFrame',
        timeFrame: { start: new Date('2026-09-01').getTime(), end: new Date('2026-09-30').getTime() },
      });
      const question = {
        builtIn: {
          kind: 'timeFrame' as const,
          timeFrame: { start: new Date('2026-11-01').getTime(), end: new Date('2026-11-30').getTime() },
        },
      };

      expect(resolveBuiltInQuestion(talk, question, state, userId)).toEqual({
        action: 'ANSWER',
        compatible: false,
      });
    });
  });
});
