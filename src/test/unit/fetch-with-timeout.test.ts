import { fetchWithTimeout } from '../../web/services/fetch-with-timeout';

describe('fetchWithTimeout', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  /** A fetch that never answers unless its signal aborts — a hung network. */
  const hungFetch = (): jest.Mock => jest.fn((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));

  it('rejects a hung request after the timeout instead of waiting forever', async () => {
    jest.useFakeTimers();
    global.fetch = hungFetch() as unknown as typeof fetch;
    const pending = fetchWithTimeout('http://hub/api/x', {}, 3_000);
    jest.advanceTimersByTime(3_000);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('returns the response when it arrives in time', async () => {
    const response = { ok: true } as Response;
    global.fetch = jest.fn().mockResolvedValue(response) as unknown as typeof fetch;
    await expect(fetchWithTimeout('http://hub/api/x')).resolves.toBe(response);
  });

  it("still honours the caller's own abort signal", async () => {
    global.fetch = hungFetch() as unknown as typeof fetch;
    const caller = new AbortController();
    const pending = fetchWithTimeout('http://hub/api/x', { signal: caller.signal }, 60_000);
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
