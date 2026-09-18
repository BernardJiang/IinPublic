import {
  clearTypedPreference,
  createEmptyTypedPreferenceState,
  formatTypedAnswerValue,
  getTypedPreference,
  LOCAL_TYPED_PREFERENCE_USER_ID,
  makeTypedPreferenceScopeKey,
  saveTypedPreference,
  typedAnswerValueFromBuiltIn,
  typedPreferenceQuestionContext,
} from '../../shared/typed-preference-store';

describe('typed-preference-store', () => {
  it('round-trips a structured built-in declaration without aliasing its question object', () => {
    const builtIn = { kind: 'ageRange' as const, ageRange: { age: 31, acceptableRange: { min: 28, max: 40 } } };
    const value = typedAnswerValueFromBuiltIn(builtIn);
    expect(value).toEqual(builtIn);
    builtIn.ageRange.acceptableRange.min = 99;
    expect(value?.ageRange?.acceptableRange.min).toBe(28);
    expect(formatTypedAnswerValue(value!)).toBe('Age 31; accepts 28 – 40');
    expect(typedAnswerValueFromBuiltIn({ kind: 'location' })).toBeUndefined();
  });

  it('isolates identical prompts on different route branches while omitting Pair-tag ancestry', () => {
    const talk = {
      questions: [
        { id: 'pair', text: 'sell', reciprocalTagContext: true, answers: [{ id: 'buy', text: 'buy' }] },
        { id: 'item', text: 'Which item?', answers: [{ id: 'notebook', text: 'Notebook' }, { id: 'pen', text: 'Pen' }] },
      ],
    };
    const notebookContext = typedPreferenceQuestionContext(talk, {
      contextPath: [{ questionId: 'pair', answerId: 'buy' }, { questionId: 'item', answerId: 'notebook' }],
    });
    const penContext = typedPreferenceQuestionContext(talk, {
      contextPath: [{ questionId: 'pair', answerId: 'buy' }, { questionId: 'item', answerId: 'pen' }],
    });
    expect(notebookContext).toBe('Which item?→Notebook');
    expect(penContext).toBe('Which item?→Pen');
    expect(makeTypedPreferenceScopeKey('sell', 'Stock', 'How many?', notebookContext)).not.toBe(
      makeTypedPreferenceScopeKey('sell', 'Stock', 'How many?', penContext),
    );
  });

  it('has no preference in an empty state', () => {
    const state = createEmptyTypedPreferenceState();
    const key = makeTypedPreferenceScopeKey('t_buy');
    expect(getTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, key)).toBeUndefined();
  });

  it('saves and reads back a quantity preference', () => {
    const state = createEmptyTypedPreferenceState();
    const key = makeTypedPreferenceScopeKey('t_buy', 'notebook');
    saveTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, key, { kind: 'quantity', quantity: 2 }, 1000);

    const value = getTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, key);
    expect(value).toMatchObject({ kind: 'quantity', quantity: 2, updatedAt: 1000 });
  });

  it('scopes preferences per tag+item — same tag, different items, do not collide', () => {
    const state = createEmptyTypedPreferenceState();
    const notebookKey = makeTypedPreferenceScopeKey('t_buy', 'notebook');
    const bookKey = makeTypedPreferenceScopeKey('t_buy', 'book');
    saveTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, notebookKey, {
      kind: 'priceRange',
      priceRange: { min: 300, max: 500 },
    });
    saveTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, bookKey, {
      kind: 'priceRange',
      priceRange: { min: 10, max: 20 },
    });

    expect(getTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, notebookKey)?.priceRange).toEqual({
      min: 300,
      max: 500,
    });
    expect(getTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, bookKey)?.priceRange).toEqual({
      min: 10,
      max: 20,
    });
  });

  it('normalizes item casing/whitespace to the same scope key', () => {
    expect(makeTypedPreferenceScopeKey('t_buy', 'Notebook')).toBe(makeTypedPreferenceScopeKey('t_buy', ' notebook '));
  });

  it('an item-less scope key is just the bare tag id', () => {
    expect(makeTypedPreferenceScopeKey('t_buy')).toBe('t_buy');
  });

  it('overwrites a prior preference for the same scope (last-write-wins)', () => {
    const state = createEmptyTypedPreferenceState();
    const key = makeTypedPreferenceScopeKey('t_buy', 'notebook');
    saveTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, key, { kind: 'quantity', quantity: 2 }, 1000);
    saveTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, key, { kind: 'quantity', quantity: 5 }, 2000);

    expect(getTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, key)).toMatchObject({
      kind: 'quantity',
      quantity: 5,
      updatedAt: 2000,
    });
  });

  it('clears a preference', () => {
    const state = createEmptyTypedPreferenceState();
    const key = makeTypedPreferenceScopeKey('t_buy');
    saveTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, key, { kind: 'quantity', quantity: 2 });
    clearTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, key);

    expect(getTypedPreference(state, LOCAL_TYPED_PREFERENCE_USER_ID, key)).toBeUndefined();
  });
});
