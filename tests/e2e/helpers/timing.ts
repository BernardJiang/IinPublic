/**
 * E2E timing: short intervals for automatic regression, long for human verification.
 * Set E2E_INTERVAL=long when you want to watch the run (e.g. npm run test:e2e -- --env E2E_INTERVAL=long).
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

/** Short: 500ms, Long: 1500ms — after a single action (click, fill). */
export const afterAction = () => wait(500, 1500);
/** Short: 1s, Long: 3s — after login or nav. */
export const afterNav = () => wait(1000, 3000);
/** Short: 2.5s, Long: 6s — after broadcast or Gun sync (Gun needs time to propagate). */
export const afterSync = () => wait(2500, 6000);
/** Short: 3.5s, Long: 8s — initial load / multiple users synced. */
export const afterLoad = () => wait(3500, 8000);

export { E2E_INTERVAL, isLong };
