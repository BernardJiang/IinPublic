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

function resolveE2EAssertTimeoutMs(): number {
  const explicit = Number(process.env.E2E_ASSERT_TIMEOUT_MS || '');
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const workers = Number(process.env.PW_WORKERS ?? process.env.PW_WORKER ?? '1');
  if (Number.isFinite(workers) && workers >= 16) return 30_000;
  if (Number.isFinite(workers) && workers >= 8) return 20_000;
  return 10_000;
}

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

/** Short: 100ms — after a single action (click, fill). */
export const afterAction = () => wait(100, 1000);
/** Short: 100ms — after login or nav. */
export const afterNav = () => wait(100, 2000);
/** Short: 200ms — after broadcast or multi-user join. */
export const afterSync = () => wait(200, 4000);
/** Short: 400ms — after createTalk before Broadcast. */
export const afterCreateTalkBeforeBroadcast = () => wait(400, 6000);
/** Short: 300ms — after page load for Gun connect. */
export const afterLoad = () => wait(300, 6000);

export { E2E_INTERVAL, isLong };

/**
 * Hard cap for expect(), poll(), and locator waits in e2e helpers (Playwright config mirrors this).
 * Fail fast — do not stretch polls to 90s+; fix sync/delivery instead.
 * Override only in a spec when debugging locally (`PW_SLOW_MO`, `E2E_INTERVAL=long`).
 */
export const E2E_ASSERT_TIMEOUT_MS = resolveE2EAssertTimeoutMs();

/**
 * Wait until Gun auth + user bootstrap finished (settings shell needs currentUser).
 *
 * `timeoutMs` defaults to the global fail-fast budget. Heavy single-worker specs that
 * bring up many simultaneous browser contexts (e.g. mass/ and staged/stage5 capacity)
 * pass a larger value: by the ~20th cold bootstrap the idle Gun/WebRTC peers already
 * running in the same worker starve a fresh app's bootstrap past 10s. This is a local
 * override for those oversubscribed specs only — it does not loosen the global budget.
 */
export async function waitForAppReady(
  page: import('@playwright/test').Page,
  timeoutMs: number = E2E_ASSERT_TIMEOUT_MS,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const app = (window as unknown as { __iinpublic_app?: { getApp: () => { currentUser?: { id?: string }; initialized?: boolean } } })
            .__iinpublic_app?.getApp?.();
          const hasUser = Boolean(app?.currentUser?.id);
          const initialized = app?.initialized === true;
          const hasNav = Boolean(document.querySelector('.bottom-nav .nav-btn[data-view="chatrooms"]'));
          return hasUser && initialized && hasNav;
        }),
      { timeout: timeoutMs, intervals: [200, 400, 800, 1200] },
    )
    .toBe(true);
}

/** goto + load + app bootstrap — use from specs that do not use the fixtures `page` wrapper. */
export async function gotoAppReady(
  page: import('@playwright/test').Page,
  url: string,
  timeoutMs?: number,
): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('load');
  await waitForAppReady(page, timeoutMs);
}

/** Reload and wait for app bootstrap + stored UI language labels (if set). */
export async function reloadAppReady(page: import('@playwright/test').Page): Promise<void> {
  const lang = await page.evaluate(() => localStorage.getItem('iinpublic_ui_language'));
  await page.reload();
  await page.waitForLoadState('load');
  await waitForAppReady(page);
  if (lang === 'zh' || lang === 'en') {
    const want = lang === 'zh' ? '设置' : 'Settings';
    const { expect } = await import('@playwright/test');
    await expect(page.locator('.nav-btn[data-view="settings"] .nav-label')).toHaveText(want, {
      timeout: E2E_ASSERT_TIMEOUT_MS,
    });
  }
}

/** Target wall-clock for full suite at PW_WORKERS=20 (see playwright.config.ts). */
export const E2E_SUITE_TARGET_MINUTES = 10;

/**
 * Whether to run browsers in headless mode.
 * Always headless in CI; show the window in local dev.
 * Matches the `use.headless` value in playwright.config.ts.
 */
export const headless = !!process.env.CI;
