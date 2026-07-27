/**
 * Unit tests for src/web/services/techsupport-faq-cache.ts (docs/TODO.md K5).
 *
 * No jsdom needed — the module only touches `localStorage`, which src/test/setup.ts already
 * polyfills for the default Node test environment (same as techsupport-faq-bundle.test.ts).
 */
import { readCachedFaqBundle, readCachedFaqEntries, subscribeToFaqBundle } from '../../web/services/techsupport-faq-cache';
import { signFaqBundle } from '../../shared/techsupport-faq-bundle';
import { buildSupportFaqEntry } from '../../shared/techsupport-faq';
import SEA from 'gun/sea';

const DEV_PAIR = {
  pub: 'mYRexxiSF2FG3oV-3-LKXEtisnUv5JQ9nDHbRANxiZo.jRqTX1_rg0v3BbFWYt1ZqGwBRG7wzg44IKgPobrSpfQ',
  priv: 'yUVBUKZfcZDOxssGwm5CZNUnbnyH3QZLiMtM43vpSDo',
  epub: 'BCl0htwOHtTgNFQU0OK7HpzKg4M5OaJIZaGvVKICP_I.fwyq2-rc9lleKgpDrR0YlbhS2mW4024uEj0SHjmbiQE',
  epriv: 'y0MVYkN5wSAcAW4doxkv2EVlDLGgwy7bv6s8woJXTY4',
};

beforeEach(() => {
  localStorage.clear();
});

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitUntil: timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function fakeGun(initialValue: unknown) {
  let handler: ((data: unknown) => void) | null = null;
  let offCalled = false;
  const ref = {
    get: () => ref,
    on: (h: (data: unknown) => void) => {
      handler = h;
      h(initialValue);
    },
    off: () => {
      offCalled = true;
    },
  };
  return {
    gun: { get: () => ref },
    emit: (value: unknown) => handler?.(value),
    wasUnsubscribed: () => offCalled,
  };
}

describe('techsupport-faq-cache (docs/TODO.md K5)', () => {
  it('readCachedFaqBundle/readCachedFaqEntries return empty when nothing is cached', () => {
    expect(readCachedFaqBundle()).toBeNull();
    expect(readCachedFaqEntries()).toEqual([]);
  });

  it('subscribeToFaqBundle verifies and caches a valid bundle, exposing it via readCachedFaqEntries', async () => {
    const entry = buildSupportFaqEntry({ question: 'How do I log in?', answer: 'Use the Settings tab.' })!;
    const signed = await signFaqBundle([entry], DEV_PAIR);
    const { gun } = fakeGun(signed);

    let received: unknown = null;
    subscribeToFaqBundle(gun, (bundle) => {
      received = bundle;
    });
    await waitUntil(() => received !== null);

    expect(received).not.toBeNull();
    expect(readCachedFaqEntries()).toEqual([entry]);
  });

  it('does not cache an unverifiable publish, and leaves a prior good cache untouched', async () => {
    const entry = buildSupportFaqEntry({ question: 'q', answer: 'a' })!;
    const signed = await signFaqBundle([entry], DEV_PAIR);
    const { gun, emit } = fakeGun(signed);
    subscribeToFaqBundle(gun);
    await waitUntil(() => readCachedFaqEntries().length > 0);
    expect(readCachedFaqEntries()).toEqual([entry]);

    const strangerPair = await SEA.pair();
    const tamperedEntry = buildSupportFaqEntry({ question: 'q2', answer: 'a2' })!;
    const tamperedBundle = await signFaqBundle([tamperedEntry], strangerPair);
    emit(tamperedBundle);
    // No good signal to poll for a non-event, so give the (rejected) verify a beat to
    // resolve and confirm it did NOT overwrite the cache.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Still the original, verified cache — the untrusted publish never overwrote it.
    expect(readCachedFaqEntries()).toEqual([entry]);
  });

  it('unsubscribe calls off() on the underlying Gun ref', () => {
    const { gun, wasUnsubscribed } = fakeGun(null);
    const unsubscribe = subscribeToFaqBundle(gun);
    expect(wasUnsubscribed()).toBe(false);
    unsubscribe();
    expect(wasUnsubscribed()).toBe(true);
  });
});
