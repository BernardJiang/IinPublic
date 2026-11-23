import {
  buildTargetingTokenSet,
  normalizeTagToken,
  receiverPassesBroadcastTagTargeting,
} from '../../shared/broadcast-tag-targeting';

describe('broadcast-tag-targeting', () => {
  it('normalizeTagToken trims the ends only: tags match exactly', () => {
    expect(normalizeTagToken('  Tennis  ')).toBe('Tennis');
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

  it('receiverPassesBroadcastTagTargeting matches the exact tag, ends trimmed', () => {
    expect(
      receiverPassesBroadcastTagTargeting({
        broadcastTargetTags: [' Tennis '],
        receiverInterestTokens: ['Tennis'],
      }),
    ).toBe(true);
    expect(
      receiverPassesBroadcastTagTargeting({
        broadcastTargetTags: ['Tennis'],
        receiverInterestTokens: ['tennis'],
      }),
    ).toBe(false);
  });

  it('receiverPassesBroadcastTagTargeting includes talk.tags in the targeting union', () => {
    expect(
      receiverPassesBroadcastTagTargeting({
        broadcastTargetTags: [],
        talkTags: [{ name: 'Music' }],
        receiverInterestTokens: ['Music'],
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
    const s = buildTargetingTokenSet(['a'], [{ name: ' a ' }, { name: 'b' }, { name: 'A' }]);
    expect(Array.from(s).sort()).toEqual(['A', 'a', 'b']);
  });
});
