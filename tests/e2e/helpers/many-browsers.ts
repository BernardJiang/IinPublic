/**
 * Launch multiple headed Chromium windows on a grid (for multi-user demos).
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { delay, headless } from './timing';
import { WEBRTC_CHROMIUM_ARGS } from './webrtc-chromium';

const COLS = 4;
const SLOT_WIDTH = 520;
const SLOT_HEIGHT = 700;

/**
 * Opens `count` separate browser instances (each can hold one user context).
 * Windows are tiled so they stay on-screen on common displays.
 */
export async function launchBrowserGrid(count: number): Promise<Browser[]> {
  const browsers: Browser[] = [];
  for (let i = 0; i < count; i += 1) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * SLOT_WIDTH;
    const y = 40 + row * SLOT_HEIGHT;
    const b = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(35, 90),
      args: [
        ...WEBRTC_CHROMIUM_ARGS,
        `--window-position=${x},${y}`,
        `--window-size=${SLOT_WIDTH},${SLOT_HEIGHT}`,
        '--force-device-scale-factor=1',
      ],
    });
    browsers.push(b);
  }
  return browsers;
}

export async function shutdownBrowserGrid(browsers: Browser[]): Promise<void> {
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));
}

/** Playwright retries re-run the whole test; clear stale contexts so `sessions[u+1]` maps to this attempt. */
export async function disposeE2eSessionList(sessions: { page: Page; context: BrowserContext }[]): Promise<void> {
  const copy = [...sessions];
  sessions.length = 0;
  for (const s of copy) {
    try {
      await s.page.evaluate(() =>
        (window as unknown as { __iinpublic_app?: { getApp: () => { manualCleanup?: () => void } } }).__iinpublic_app
          ?.getApp?.()
          ?.manualCleanup?.(),
      );
    } catch {
      /* ignore */
    }
    await s.page.close().catch(() => {});
    await s.context.close().catch(() => {});
  }
}
