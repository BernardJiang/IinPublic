import { chromium, Browser } from '@playwright/test';
import { clearGunDatabases } from './clear-database';
import { delay } from './timing';

export type ThreeBrowsers = { tom: Browser; jerry: Browser; bob: Browser };

/**
 * Launch three Chromium instances (Tom / Jerry / Bob windows), matching legacy 05-talks layout.
 * Does not clear DB — call clearGunDatabases in beforeEach/beforeAll as your suite needs.
 */
export async function launchThreeBrowsers(): Promise<ThreeBrowsers> {
  const mk = (x: string) => ({
    headless: false,
    slowMo: delay(50, 120),
    args: [`--window-position=${x}`, '--window-size=640,1200', '--force-device-scale-factor=1'],
  });
  const [tom, jerry, bob] = await Promise.all([
    chromium.launch(mk('0,0')),
    chromium.launch(mk('640,0')),
    chromium.launch(mk('1280,0')),
  ]);
  return { tom, jerry, bob };
}

export async function shutdownThreeBrowsers(b: ThreeBrowsers | undefined): Promise<void> {
  if (!b?.tom && !b?.jerry && !b?.bob) return;
  await b?.tom?.close().catch(() => {});
  await b?.jerry?.close().catch(() => {});
  await b?.bob?.close().catch(() => {});
}
