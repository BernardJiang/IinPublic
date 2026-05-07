import {
  buildTargetingTokenSet,
  normalizeTagToken,
  receiverPassesBroadcastTagTargeting,
} from '../../shared/broadcast-tag-targeting';

describe('broadcast-tag-targeting', () => {
  it('normalizeTagToken lowercases and trims', () => {
    expect(normalizeTagToken('  Tennis  ')).toBe('tennis');
    expect(normalizeTagToken(undefined)).toBe('');
  });

  it('receiverPassesBroadcastTagTargeting is true when no broadcast tags', () => {
    expect(
      receiverPassesBroadcastTagTargeting({
        broadcastTargetTags: [],
        talkTags: [{ name: 'x' }],
        receiverInterestTokens: ['y'],
      }),
    ).toBe(true);
  });

  it('receiverPassesBroadcastTagTargeting is true when receiver has no interests (profile gap)', () => {
    expect(
      receiverPassesBroadcastTagTargeting({
        broadcastTargetTags: ['tennis'],
        receiverInterestTokens: [],
      }),
    ).toBe(true);
  });

  it('receiverPassesBroadcastTagTargeting matches on normalized overlap', () => {
    expect(
      receiverPassesBroadcastTagTargeting({
        broadcastTargetTags: ['Tennis'],
        receiverInterestTokens: ['tennis'],
      }),
    ).toBe(true);
  });

  it('receiverPassesBroadcastTagTargeting includes talk.tags in the targeting union', () => {
    expect(
      receiverPassesBroadcastTagTargeting({
        broadcastTargetTags: [],
        talkTags: [{ name: 'Music' }],
        receiverInterestTokens: ['music'],
      }),
    ).toBe(true);
  });

  it('receiverPassesBroadcastTagTargeting fails when interests do not intersect', () => {
    expect(
      receiverPassesBroadcastTagTargeting({
        broadcastTargetTags: ['tennis'],
        receiverInterestTokens: ['cooking'],
      }),
    ).toBe(false);
  });

  it('buildTargetingTokenSet merges preamble and authored tags deduped', () => {
    const s = buildTargetingTokenSet(['A'], [{ name: 'a' }, { name: 'b' }]);
    expect(Array.from(s).sort()).toEqual(['a', 'b']);
  });
});
