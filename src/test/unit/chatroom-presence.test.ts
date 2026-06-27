import { isMemberRecordLive, MEMBER_STALE_MS } from '../../shared/chatroom-presence';

describe('isMemberRecordLive', () => {
  const now = 1_000_000_000_000;
  const iso = (ms: number) => new Date(ms).toISOString();

  it('counts an active member with a fresh heartbeat', () => {
    expect(isMemberRecordLive({ isActive: true, lastSeen: iso(now - 1000) }, now)).toBe(true);
  });

  it('drops an active member whose heartbeat is stale (ghost)', () => {
    expect(isMemberRecordLive({ isActive: true, lastSeen: iso(now - MEMBER_STALE_MS - 1) }, now)).toBe(false);
  });

  it('never counts an inactive member regardless of heartbeat', () => {
    expect(isMemberRecordLive({ isActive: false, lastSeen: iso(now) }, now)).toBe(false);
  });

  it('keeps an active member that has no lastSeen (server/API/TechSupport, never proven stale)', () => {
    expect(isMemberRecordLive({ isActive: true }, now)).toBe(true);
    expect(isMemberRecordLive({ isActive: true, lastSeen: 'not-a-date' }, now)).toBe(true);
  });

  it('treats the exact window boundary as live (inclusive)', () => {
    expect(isMemberRecordLive({ isActive: true, lastSeen: iso(now - MEMBER_STALE_MS) }, now)).toBe(true);
  });

  it('accepts a numeric epoch lastSeen', () => {
    expect(isMemberRecordLive({ isActive: true, lastSeen: now - 500 }, now)).toBe(true);
    expect(isMemberRecordLive({ isActive: true, lastSeen: now - MEMBER_STALE_MS - 500 }, now)).toBe(false);
  });

  it('ignores null/undefined records', () => {
    expect(isMemberRecordLive(null, now)).toBe(false);
    expect(isMemberRecordLive(undefined, now)).toBe(false);
  });
});
