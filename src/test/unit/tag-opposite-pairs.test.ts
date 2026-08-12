import {
  createEmptyTagOppositePairRegistryState,
  createSeededTagOppositePairRegistryState,
  getOppositeTagId,
  getOppositeTagName,
  hasOppositeTag,
  makeTagId,
  registerOppositeTagPair,
} from '../../shared/tag-opposite-pairs';

describe('tag-opposite-pairs', () => {
  it('canonicalizes tag identity case-insensitively', () => {
    expect(makeTagId('Buy')).toBe(makeTagId('buy'));
    expect(makeTagId('  Buy  ')).toBe(makeTagId('buy'));
    expect(makeTagId('buy')).not.toBe(makeTagId('sell'));
  });

  it('has no pairs in an empty registry', () => {
    const state = createEmptyTagOppositePairRegistryState();
    expect(hasOppositeTag(state, 'buy')).toBe(false);
    expect(getOppositeTagName(state, 'buy')).toBeUndefined();
  });

  it('registers a symmetric pair', () => {
    let state = createEmptyTagOppositePairRegistryState();
    state = registerOppositeTagPair(state, 'buy', 'sell');

    expect(getOppositeTagName(state, 'buy')).toBe('sell');
    expect(getOppositeTagName(state, 'sell')).toBe('buy');
    expect(getOppositeTagId(state, makeTagId('buy'))).toBe(makeTagId('sell'));
    expect(getOppositeTagId(state, makeTagId('sell'))).toBe(makeTagId('buy'));
  });

  it('resolves pairs registered with different casing/whitespace to the same identity', () => {
    let state = createEmptyTagOppositePairRegistryState();
    state = registerOppositeTagPair(state, ' Buy ', 'SELL');

    expect(getOppositeTagName(state, 'buy')).toBe('sell');
    expect(getOppositeTagName(state, 'sell')).toBe('buy');
  });

  it('does not mutate the input state (returns a new state)', () => {
    const before = createEmptyTagOppositePairRegistryState();
    const after = registerOppositeTagPair(before, 'buy', 'sell');

    expect(before.pairs).toEqual({});
    expect(after.pairs).not.toEqual({});
  });

  it('last-write-wins when a tag is re-paired with a different opposite', () => {
    let state = createEmptyTagOppositePairRegistryState();
    state = registerOppositeTagPair(state, 'buy', 'sell');
    state = registerOppositeTagPair(state, 'buy', 'trade');

    expect(getOppositeTagName(state, 'buy')).toBe('trade');
    expect(getOppositeTagName(state, 'trade')).toBe('buy');
    // 'sell' is no longer paired with 'buy', but its own stale entry still points at 'buy'
    // until something re-registers it — a real orphan case, documented via this assertion.
    expect(getOppositeTagName(state, 'sell')).toBe('buy');
  });

  it('seeds the predefined pairs: buy/sell, hiring/jobseeking, male/female', () => {
    const state = createSeededTagOppositePairRegistryState();

    expect(getOppositeTagName(state, 'buy')).toBe('sell');
    expect(getOppositeTagName(state, 'sell')).toBe('buy');
    expect(getOppositeTagName(state, 'hiring')).toBe('jobseeking');
    expect(getOppositeTagName(state, 'jobseeking')).toBe('hiring');
    expect(getOppositeTagName(state, 'male')).toBe('female');
    expect(getOppositeTagName(state, 'female')).toBe('male');
  });

  it('has no opposite for an unregistered tag', () => {
    const state = createSeededTagOppositePairRegistryState();
    expect(hasOppositeTag(state, 'notacatalogedtag')).toBe(false);
    expect(getOppositeTagId(state, makeTagId('notacatalogedtag'))).toBeUndefined();
  });
});
