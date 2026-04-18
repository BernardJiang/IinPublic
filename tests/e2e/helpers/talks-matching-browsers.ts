import { chromium, Browser } from '@playwright/test';
import { clearGunDatabases } from './clear-database';
import { delay, headless } from './timing';

export type ThreeBrowsers = { tom: Browser; jerry: Browser; bob: Browser };

/**
 * Launch three Chromium instances (Tom / Jerry / Bob windows), matching legacy 05-talks layout.
 * Does not clear DB — call clearGunDatabases in beforeEach/beforeAll as your suite needs.
 */
export async function launchThreeBrowsers(): Promise<ThreeBrowsers> {
  // Y=40 avoids stacking exactly on 008-super-user's 0,0 and 640,0 after back-to-back runs (macOS window/CDP oddities).
  const mk = (x: number) => ({
    headless,
    slowMo: headless ? 0 : delay(50, 120),
    args: [`--window-position=${x},40`, '--window-size=640,1200', '--force-device-scale-factor=1'],
  });
  const [tom, jerry, bob] = await Promise.all([
    chromium.launch(mk(0)),
    chromium.launch(mk(640)),
    chromium.launch(mk(1280)),
  ]);
  return { tom, jerry, bob };
}

export async function shutdownThreeBrowsers(b: ThreeBrowsers | undefined): Promise<void> {
  if (!b?.tom && !b?.jerry && !b?.bob) return;
  await b?.tom?.close().catch(() => {});
  await b?.jerry?.close().catch(() => {});
  await b?.bob?.close().catch(() => {});
}
