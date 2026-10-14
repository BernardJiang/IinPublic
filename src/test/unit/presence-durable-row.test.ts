import { toGunPresenceRow } from '../../server/services/presence-durable-store';

describe('durable presence rows', () => {
  it('stores Date timestamps as ISO strings, which Gun accepts', () => {
    const joined = new Date('2026-10-14T08:00:00.000Z');
    const row = toGunPresenceRow({
      userId: 'u1',
      stageName: 'U',
      isActive: true,
      joinedAt: joined as unknown as string,
      lastSeen: '2026-10-14T08:01:00.000Z',
    });
    expect(row.joinedAt).toBe('2026-10-14T08:00:00.000Z');
    expect(row.lastSeen).toBe('2026-10-14T08:01:00.000Z');
    expect(Object.values(row as Record<string, unknown>).some((value) => value instanceof Date)).toBe(false);
  });
});
