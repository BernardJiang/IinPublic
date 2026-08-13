import {
  createEmptyTagOppositePairRegistryState,
  createSeededTagOppositePairRegistryState,
  dealRoleForTag,
  getOppositeTagId,
  getOppositeTagName,
  hasOppositeTag,
  makeTagId,
  questionTemplateForTag,
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

  describe('dealRoleForTag', () => {
    it('maps sell/hiring to offer and buy/jobseeking to request', () => {
      expect(dealRoleForTag('sell')).toBe('offer');
      expect(dealRoleForTag('hiring')).toBe('offer');
      expect(dealRoleForTag('buy')).toBe('request');
      expect(dealRoleForTag('jobseeking')).toBe('request');
    });

    it('is case/whitespace-insensitive, same canonicalization as makeTagId', () => {
      expect(dealRoleForTag(' Buy ')).toBe('request');
      expect(dealRoleForTag('SELL')).toBe('offer');
    });

    it('has no role mapping for male/female (reserved for §DD) or an unknown tag', () => {
      expect(dealRoleForTag('male')).toBeUndefined();
      expect(dealRoleForTag('female')).toBeUndefined();
      expect(dealRoleForTag('notacatalogedtag')).toBeUndefined();
    });
  });

  describe('questionTemplateForTag', () => {
    it('generates a template addressed to the OPPOSITE side, filling in the item', () => {
      expect(questionTemplateForTag('buy', 'a used notebook')).toBe('Do you sell a used notebook?');
      expect(questionTemplateForTag('sell', 'a used notebook')).toBe('Do you want to buy a used notebook?');
      expect(questionTemplateForTag('hiring', 'anything')).toBe('Are you looking for a job?');
      expect(questionTemplateForTag('jobseeking', 'anything')).toBe('Are you hiring?');
    });

    it('falls back to a generic "this" when the item is blank', () => {
      expect(questionTemplateForTag('buy', '')).toBe('Do you sell this?');
      expect(questionTemplateForTag('buy', '   ')).toBe('Do you sell this?');
    });

    it('has no template for male/female or an unknown tag', () => {
      expect(questionTemplateForTag('male', 'anything')).toBeUndefined();
      expect(questionTemplateForTag('notacatalogedtag', 'anything')).toBeUndefined();
    });
  });
});
