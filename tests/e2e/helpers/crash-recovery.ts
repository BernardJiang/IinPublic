/**
 * Helpers for the hard-crash-recovery spec (37).
 *
 * A hard crash = SIGKILL of the browser process (not graceful `context.close()`).
 * To survive a SIGKILL + relaunch as the SAME user, B must reuse the SAME on-disk
 * profile: Playwright `storageState` captures localStorage/cookies but NOT the Web
 * Worker IndexedDB where Gun-on-device persists. `chromium.launchPersistentContext`
 * with a fixed `userDataDir` captures BOTH, so a killed-then-relaunched persistent
 * context boots with the same `iinpublic_user_id`, the same SEA keypair, and the same
 * local Gun graph.
 *
 * bootstrapUser() in talks-matching-flow.ts takes a `Browser` and calls
 * `browser.newContext()`; a persistent context has no such affordance. This helper
 * therefore replicates the same bootstrap steps against an already-open page.
 */
import { execFileSync } from 'child_process';
import { chromium, BrowserContext, Page, expect } from '@playwright/test';
import { webAppURLStableChatroom } from './ports';
import { WEBRTC_CHROMIUM_ARGS } from './webrtc-chromium';
import { headless, afterNav, E2E_ASSERT_TIMEOUT_MS, waitForAppReady } from './timing';
import { pinStableE2eLocation } from './talks-matching-flow';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../src/shared/techsupport';
import { openSettingsSection } from './settings-nav';

/**
 * Launch a regular chromium `Browser` (so `browser.process()` is a real ChildProcess we can
 * SIGKILL) but pin it to a fixed on-disk profile via `--user-data-dir`. That profile holds
 * BOTH localStorage and the Web Worker IndexedDB (Gun-on-device), so relaunching against the
 * same directory after a SIGKILL boots as the same user with the same local Gun graph.
 *
 * `launchPersistentContext` would also persist the profile, but its `context.browser()` does
 * not expose a killable `.process()` in this Playwright version — hence the regular-Browser +
 * `--user-data-dir` combination.
 */
export async function launchPersistentUser(
  userDataDir: string,
  windowX: number,
): Promise<{ context: BrowserContext; page: Page; kill: () => void }> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 640, height: 1000 },
    args: [`--window-position=${windowX},0`, '--window-size=640,1100', ...WEBRTC_CHROMIUM_ARGS],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  // A persistent context runs the browser out-of-process behind the Playwright RPC
  // connection; `context.browser()` does NOT expose a public/killable `.process()` in this
  // Playwright version, and the ChildProcess is not reachable through the client object graph.
  // So we hard-kill the real chromium process by matching its unique `--user-data-dir` on the
  // OS process table (`pkill -9 -f <userDataDir>`). This is an unambiguously HARD crash — the
  // process receives SIGKILL with no chance to flush or run shutdown handlers.
  const kill = () => {
    try {
      execFileSync('pkill', ['-9', '-f', userDataDir], { stdio: 'ignore' });
    } catch {
      // pkill exits non-zero when nothing matched; if the context is already gone that's fine.
    }
  };
  return { context, page, kill };
}

/**
 * Bootstrap a fresh user on an already-open page (persistent-context flavor).
 * Mirrors talks-matching-flow.bootstrapUser: goto → set stage name → chatrooms tab →
 * pin the stable E2E location → wait for the TechSupport greeting.
 */
export async function bootstrapOnPage(page: Page, stageName: string): Promise<string> {
  await page.goto(webAppURLStableChatroom(), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await page.click('.nav-btn[data-view="settings"]');
  await afterNav();
  await openSettingsSection(page, 'settings-section-profile');
  await page.waitForSelector('#settings-stage-name-input', { timeout: E2E_ASSERT_TIMEOUT_MS });
  await page.fill('#settings-stage-name-input', stageName);
  await page.locator('#settings-stage-name-input').blur();
  await afterNav();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? ''),
      { timeout: E2E_ASSERT_TIMEOUT_MS },
    )
    .toBe(stageName);
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  // Pin the stable E2E location so both users share the same room.
  await pinStableE2eLocation(page);
  await afterNav();
  return page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
}

/** Poll until the TechSupport welcome conversation is present (app is fully booted). */
export async function waitForGreeting(page: Page, stageName?: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ techSupportId, name }) => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return Object.values(conversations).some((c: any) => {
              const message = String(c?.lastMessage || '');
              return (
                c?.otherUserId === techSupportId &&
                message.includes('Welcome to IinPublic') &&
                (!name || message.includes(name))
              );
            });
          },
          { techSupportId: TECHSUPPORT_ROOT_USER_ID, name: stageName || '' },
        ),
      { timeout: E2E_ASSERT_TIMEOUT_MS },
    )
    .toBe(true);
}
