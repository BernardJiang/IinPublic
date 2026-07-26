/**
 * Unit tests for the K1 item 1 built-in Global member floor (docs/TODO.md).
 * `rosterWithTechSupportFloor` is pure/sync, so this exercises the dedup-safety invariant
 * directly instead of through a Gun.js roundtrip.
 */

import { WebChatroomService } from '../../web/services/web-chatroom-service';
import { TECHSUPPORT_ROOT_USER_ID, TECHSUPPORT_STAGE_NAME } from '../../shared/techsupport';
import type { WebGunService } from '../../web/services/web-gun-service';

class MockWebGunService implements Partial<WebGunService> {
  getGun(): any {
    return null;
  }

  getStoredPair(): any {
    return { pub: 'test-pub' };
  }
}

describe('WebChatroomService — TechSupport Global member floor (docs/TODO.md K1 item 1)', () => {
  let service: WebChatroomService;

  beforeEach(() => {
    service = new WebChatroomService(new MockWebGunService() as any);
  });

  function floor(chatroomId: string, members: Array<{ userId: string; stageName: string }>) {
    return (service as any).rosterWithTechSupportFloor(chatroomId, members);
  }

  it('injects the synthetic TechSupport member into an empty Global roster', () => {
    const result = floor('global', []);
    expect(result).toEqual([{ userId: TECHSUPPORT_ROOT_USER_ID, stageName: TECHSUPPORT_STAGE_NAME }]);
  });

  it('does not inject a second entry when a real TechSupport row is already present', () => {
    const real = { userId: TECHSUPPORT_ROOT_USER_ID, stageName: TECHSUPPORT_STAGE_NAME, joinedAt: '2026-01-01' };
    const result = floor('global', [real]);
    expect(result).toEqual([real]);
    expect(result.filter((m: { userId: string }) => m.userId === TECHSUPPORT_ROOT_USER_ID)).toHaveLength(1);
  });

  it('appends alongside other real members without disturbing them', () => {
    const alice = { userId: 'user_1', stageName: 'Alice' };
    const result = floor('global', [alice]);
    expect(result).toEqual([alice, { userId: TECHSUPPORT_ROOT_USER_ID, stageName: TECHSUPPORT_STAGE_NAME }]);
  });

  it('never injects into a non-Global room', () => {
    const result = floor('some-other-room', []);
    expect(result).toEqual([]);
  });
});
