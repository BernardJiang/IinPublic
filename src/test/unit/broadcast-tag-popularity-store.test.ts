import { BroadcastTagPopularityStore } from '../../server/services/broadcast-tag-popularity-store';

describe('BroadcastTagPopularityStore', () => {
  it('dedupes same slug inside one POST and bumps separate slugs', () => {
    const s = new BroadcastTagPopularityStore();
    s.recordFromTargetTags(['Coffee', 'coffee', ' Tennis ']);
    expect(s.getSnapshot()).toEqual([
      { id: 'coffee', count: 1 },
      { id: 'tennis', count: 1 },
    ]);
  });

  it('accumulates across calls and sorts descending by count', () => {
    const s = new BroadcastTagPopularityStore();
    s.recordFromTargetTags(['Food & drinks']);
    s.recordFromTargetTags(['Coffee']);
    s.recordFromTargetTags(['Coffee']);
    const rows = s.getSnapshot();
    expect(rows[0].id).toBe('coffee');
    expect(rows[0].count).toBe(2);
    expect(rows.find((r) => r.id === 'food-drinks')).toMatchObject({ count: 1 });
  });
});
