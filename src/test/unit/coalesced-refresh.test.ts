import { coalesced } from '../../web/services/coalesced-refresh';

describe('coalesced refresh', () => {
  it('runs one read at a time; calls during a read share one more read after the gap', async () => {
    jest.useFakeTimers();
    let reads = 0;
    let release: Array<() => void> = [];
    const refresh = coalesced(() => new Promise<number>((resolve) => { reads += 1; const n = reads; release.push(() => resolve(n)); }), 1_000);
    const first = refresh();
    const second = refresh();
    const third = refresh();
    expect(reads).toBe(1);
    release.shift()!();
    await Promise.resolve(); await Promise.resolve();
    expect(reads).toBe(1); // waiting the gap
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(reads).toBe(2);
    release.shift()!();
    expect(await first).toBe(2);
    expect(await second).toBe(2);
    expect(await third).toBe(2);
    // Idle again: the next call reads at once.
    void refresh();
    expect(reads).toBe(3);
    release.shift()!();
    jest.useRealTimers();
    release = [];
  });
});
