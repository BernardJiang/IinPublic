/**
 * E2E timing: short intervals for automatic regression, long for human verification.
 * Set E2E_INTERVAL=long when you want to watch the run (e.g. npm run test:e2e -- --env E2E_INTERVAL=long).
 *
 * Gun.js must have time to propagate (member counts, talks, etc.). Too-short delays cause headcount
 * stuck at 1 and tests to hang. Use 'load' (not networkidle) so WebSocket activity doesn't block;
 * rely on afterLoad/afterSync to allow Gun to sync.
 */
const E2E_INTERVAL = (process.env.E2E_INTERVAL || 'short') as 'short' | 'long';
const isLong = E2E_INTERVAL === 'long';

/** Multiplier for "long" mode (human watch). Short uses 1x, long uses ~3x for most waits. */
const LONG_MULTIPLIER = 3;

/**
 * Delay in ms. In "short" mode uses shortMs; in "long" mode uses longMs (or shortMs * LONG_MULTIPLIER).
 */
export function delay(shortMs: number, longMs?: number): number {
  if (isLong) return longMs ?? shortMs * LONG_MULTIPLIER;
  return shortMs;
}

/**
 * Async wait using delay(). Use for Gun sync, UI settle, etc.
 */
export async function wait(shortMs: number, longMs?: number): Promise<void> {
  const ms = delay(shortMs, longMs);
  await new Promise((r) => setTimeout(r, ms));
}

/** Short: 100ms, Long: 1000ms — after a single action (click, fill). */
export const afterAction = () => wait(100, 1000);
/** Short: 200ms, Long: 2s — after login or nav. */
export const afterNav = () => wait(200, 2000);
/** Short: 600ms, Long: 4s — after broadcast or multi-user join; Gun needs time to propagate. */
export const afterSync = () => wait(600, 4000);
/** Short: 1s, Long: 6s — after page load so Gun can connect and initial sync; required for headcount. */
export const afterLoad = () => wait(1000, 6000);

export { E2E_INTERVAL, isLong };

/**
 * Whether to run browsers in headless mode.
 * Always headless in CI; show the window in local dev.
 * Matches the `use.headless` value in playwright.config.ts.
 */
export const headless = !!process.env.CI;
