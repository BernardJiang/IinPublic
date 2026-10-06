import { chatroomCapacityTestOverride } from '../../web/services/web-chatroom-service';

describe('chatroomCapacityTestOverride', () => {
  it('never overrides the signed manifest capacity in a production bundle', () => {
    expect(chatroomCapacityTestOverride('production', 3)).toBeNull();
  });

  it('returns an explicit local-debug/E2E capacity outside production', () => {
    expect(chatroomCapacityTestOverride('development', 3)).toBe(3);
    expect(chatroomCapacityTestOverride(undefined, 50)).toBe(50);
  });

  it('defers to the manifest when only the release default is configured', () => {
    expect(chatroomCapacityTestOverride('development', 498)).toBeNull();
    expect(chatroomCapacityTestOverride('development', Number.NaN)).toBeNull();
  });
});
