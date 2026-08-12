import {
  clearTypedPreference,
  createEmptyTypedPreferenceState,
  getTypedPreference,
  LOCAL_TYPED_PREFERENCE_USER_ID,
  makeTypedPreferenceScopeKey,
  saveTypedPreference,
} from '../../shared/typed-preference-store';

describe('typed-preference-store', () => {
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
