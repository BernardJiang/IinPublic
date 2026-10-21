import { mergeRemoteDealConfirmations } from '../../web/services/web-conversation-service';

describe('mergeRemoteDealConfirmations', () => {
  it('adds the sender confirmation to the local set', () => {
    expect(mergeRemoteDealConfirmations('["adam"]', '["eve"]', 'eve')).toBe('["adam","eve"]');
  });

  it('keeps a local confirmation when a stale peer snapshot arrives without it', () => {
    expect(mergeRemoteDealConfirmations('["eve","adam"]', '["eve"]', 'eve')).toBe('["eve","adam"]');
  });

  it('never accepts a confirmation the peer claims on the local user behalf', () => {
    expect(mergeRemoteDealConfirmations('[]', '["adam","eve"]', 'eve')).toBe('["eve"]');
  });

  it('ignores malformed payloads and stores nothing when neither side has a value', () => {
    expect(mergeRemoteDealConfirmations('["adam"]', 'not json', 'eve')).toBe('["adam"]');
    expect(mergeRemoteDealConfirmations(undefined, undefined, 'eve')).toBeUndefined();
  });
});
