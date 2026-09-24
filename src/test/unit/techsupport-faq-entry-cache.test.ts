/**
 * docs/TODO.md OPEN-31: per-entry cache + targeted fetch in techsupport-faq-cache.ts.
 * Node test env; `localStorage` is polyfilled by src/test/setup.ts.
 */
import {
  FAQ_ENTRY_CACHE_MAX,
  applyRawFaqEntry,
  fetchFaqEntryFromServer,
  fetchRecentFaqEntriesFromServer,
  readCachedFaqEntry,
} from '../../web/services/techsupport-faq-cache';
import { signFaqEntry } from '../../shared/techsupport-faq-entry';
import { buildSupportFaqEntry } from '../../shared/techsupport-faq';
import SEA from 'gun/sea';
import { describeWithRealTechSupportPair } from '../support/techsupport-real-pair';

const gun = { get: () => ({}) };

function fetchReturning(body: unknown, ok = true): jest.Mock {
  return jest.fn().mockResolvedValue({ ok, json: async () => body });
}

describeWithRealTechSupportPair('per-entry FAQ cache (docs/TODO.md OPEN-31)', (DEV_PAIR) => {
  const realFetch = global.fetch;
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    global.fetch = realFetch;
  });

  const signedFor = (q: string, a: string, at = '2026-09-24T00:00:00.000Z') => {
    const e = buildSupportFaqEntry({ question: q, answer: a, answeredAt: at });
    if (!e) throw new Error('bad entry');
    return signFaqEntry(e, DEV_PAIR);
  };

  it('fetches exactly one key with one request and caches only that record', async () => {
    const signed = await signedFor('How do I log in?', 'Use Settings.');
    const fetchMock = fetchReturning({ entry: signed });
    global.fetch = fetchMock as any;
    const got = await fetchFaqEntryFromServer('http://hub', gun, signed.questionKey);
    expect(got).toEqual(signed);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://hub/api/support/faq-entries/${signed.questionKey}`);
    expect(readCachedFaqEntry(signed.questionKey)).toEqual(signed);
  });

  it('never caches an entry that fails verification', async () => {
    const stranger = await SEA.pair();
    const e = buildSupportFaqEntry({ question: 'q', answer: 'a' })!;
    const forged = await signFaqEntry(e, stranger);
    global.fetch = fetchReturning({ entry: forged }) as any;
    expect(await fetchFaqEntryFromServer('http://hub', gun, forged.questionKey)).toBeNull();
    expect(readCachedFaqEntry(forged.questionKey)).toBeNull();
  });

  it('falls back to the previously cached verified record when the relay is unreachable (offline auto-answer)', async () => {
    const signed = await signedFor('q', 'a');
    expect(await applyRawFaqEntry(gun, signed)).toEqual(signed);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as any;
    expect(await fetchFaqEntryFromServer('http://hub', gun, signed.questionKey)).toEqual(signed);
  });

  it('falls back to the cache on a non-OK response and on a "no entry" answer, and returns null when nothing is cached', async () => {
    const signed = await signedFor('q', 'a');
    await applyRawFaqEntry(gun, signed);
    global.fetch = fetchReturning({}, false) as any;
    expect(await fetchFaqEntryFromServer('http://hub', gun, signed.questionKey)).toEqual(signed);
    global.fetch = fetchReturning({ entry: null }) as any;
    expect(await fetchFaqEntryFromServer('http://hub', gun, signed.questionKey)).toEqual(signed);
    expect(await fetchFaqEntryFromServer('http://hub', gun, 'unknown-key')).toBeNull();
  });

  it('a newer answer replaces the cached one, but a replayed older one does not', async () => {
    const older = await signedFor('q', 'old', '2026-09-01T00:00:00.000Z');
    const newer = await signedFor('q', 'new', '2026-09-02T00:00:00.000Z');
    await applyRawFaqEntry(gun, older);
    await applyRawFaqEntry(gun, newer);
    expect(readCachedFaqEntry(newer.questionKey)?.answer).toBe('new');
    expect((await applyRawFaqEntry(gun, older))?.answer).toBe('new');
    expect(readCachedFaqEntry(newer.questionKey)?.answer).toBe('new');
  });

  it('caps the cache so it can never grow with the global FAQ size (least-recently-cached evicted first)', async () => {
    const total = FAQ_ENTRY_CACHE_MAX + 5;
    const keys: string[] = [];
    for (let i = 0; i < total; i++) {
      const signed = await signedFor(`question number ${i}`, `answer ${i}`);
      keys.push(signed.questionKey);
      await applyRawFaqEntry(gun, signed);
    }
    const raw = JSON.parse(localStorage.getItem('iinpublic_techsupport_faq_entries_v1') || '{}');
    expect(Object.keys(raw)).toHaveLength(FAQ_ENTRY_CACHE_MAX);
    expect(readCachedFaqEntry(keys[total - 1])).not.toBeNull();
    expect(readCachedFaqEntry(keys[0])).toBeNull();
  });

  it('survives localStorage being unavailable: still returns the verified entry', async () => {
    const signed = await signedFor('q', 'a');
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      global.fetch = fetchReturning({ entry: signed }) as any;
      expect(await fetchFaqEntryFromServer('http://hub', gun, signed.questionKey)).toEqual(signed);
    } finally {
      spy.mockRestore();
    }
  });

  it('the admin listing verifies each record, drops bad ones, and does NOT write to the asker cache', async () => {
    const good = await signedFor('q1', 'a1');
    const bad = { ...(await signedFor('q2', 'a2')), answer: 'tampered' };
    global.fetch = fetchReturning({ entries: [good, bad] }) as any;
    const listed = await fetchRecentFaqEntriesFromServer('http://hub', gun, 50);
    expect(listed).toEqual([good]);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://hub/api/support/faq-entries?limit=50');
    expect(readCachedFaqEntry(good.questionKey)).toBeNull();
  });
});
