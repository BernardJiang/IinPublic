/** @jest-environment node */

// Spec §31.8: a map keyed by a person or an atom is spread over bucket nodes, so no node holds more
// than a few thousand entries (Gun answers a node over one Radisk file, ~7,000 links, in parts).

import { memoryNodeStore } from '../../core/device-graph/node-store';
import { getKeyed, getKeyedMany, KEY_BUCKETS, keyBucket, putKeyed, readKeyed } from '../../core/device-graph/keyed-buckets';
import { bucketOf } from '../../core/device-graph/index-buckets';

describe('keyed buckets', () => {
  it('20,000 keys: every node stays under 2,000 entries; one key is one read; the whole map reads back', async () => {
    const store = memoryNodeStore();
    const entries = Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`person-${i}`, `v${i}`]));
    for (let i = 0; i < 20_000; i += 1000) await putKeyed(store, 'local/ix/sent-test', Object.fromEntries(Object.entries(entries).slice(i, i + 1000)));
    for (const soul of store.souls()) expect(Object.keys((await store.get(soul))!).length).toBeLessThan(2_000);
    expect(Object.keys((await store.get('local/ix/sent-test'))!).length).toBe(KEY_BUCKETS);
    expect(await getKeyed(store, 'local/ix/sent-test', 'person-123')).toBe('v123');
    expect(await getKeyedMany(store, 'local/ix/sent-test', ['person-1', 'person-2', 'nobody'])).toEqual({ 'person-1': 'v1', 'person-2': 'v2' });
    expect(Object.keys(await readKeyed(store, 'local/ix/sent-test'))).toHaveLength(20_000);
  });

  it('a null removes a key; the bucket of a key never changes', async () => {
    const store = memoryNodeStore();
    await putKeyed(store, 'm', { a: 1, b: 2 });
    await putKeyed(store, 'm', { a: null });
    expect(await readKeyed(store, 'm')).toEqual({ b: 2 });
    expect(await getKeyed(store, 'm', 'a')).toBeUndefined();
    expect(keyBucket('b')).toBe(keyBucket('b'));
    expect(keyBucket('b')).toMatch(/^[0-9a-f]$/);
  });

  it('time buckets: every event by hour, arrivals by day, other lists by month', () => {
    const when = Date.UTC(2026, 10, 4, 9, 30);
    expect([bucketOf(when, 'hour'), bucketOf(when, 'day'), bucketOf(when, 'month')]).toEqual(['2026-11-04T09', '2026-11-04', '2026-11']);
  });
});
