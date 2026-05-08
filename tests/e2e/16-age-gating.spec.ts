/**
 * Age-gating: Tom creates an adult talk, Jerry is age-verified (3 vouch calls via API),
 * Bob is not. Verifies Bob does NOT receive the adult talk, Jerry does.
 * (Spec: FR-SP-7, FR-SP-8)
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases } from './helpers/clear-database';
import { afterAction, afterSync, headless } from './helpers/timing';
import { gunBaseURL } from './helpers/ports';
import { confirmBroadcastTagPreambleIfVisible } from './helpers/broadcast-preamble';
import {
  bootstrapUser,
  waitForIncomingTalkClusterOnServer,
  waitForTabActive,
  resetTalksMatchingSession,
} from './helpers/talks-matching-flow';
import { dismissNotificationOverlays } from './helpers/durable-ui';

const ADULT_TALK_TITLE = 'E2E Adult Content Tennis';

async function createAdultTalk(page: Page, title: string): Promise<void> {
  await dismissNotificationOverlays(page);
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill('Adult question: interested?');
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.check('#talk-is-adult');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

/**
 * Call POST /api/users/:id/age-verify on the server 3 times to push the user over
 * AGE_VERIFICATION_THRESHOLD (3) and flip ageVerified to true. Each call is awaited
 * sequentially so the cumulative writes complete before broadcasting.
 */
async function serverVouchAgeVerified(page: Page, userId: string): Promise<void> {
  const url = `${gunBaseURL()}/api/users/${encodeURIComponent(userId)}/age-verify`;
  for (let i = 0; i < 3; i++) {
    const res = await page.request.post(url);
    expect(res.ok(), `age-verify vouch ${i + 1} failed with status ${res.status()}`).toBeTruthy();
  }
}

test.describe('Age-gating — adult talk blocked for unverified user', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let browserBob: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browserTom = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'] });
    browserJerry = await chromium.launch({ headless, args: ['--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'] });
    browserBob = await chromium.launch({ headless, args: ['--window-position=1280,0', '--window-size=640,1100', '--force-device-scale-factor=1'] });
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
    );
    pageTom = pageJerry = pageBob = undefined;
    contextTom = contextJerry = contextBob = undefined;
  });

  test.afterAll(async () => {
    await pageTom?.close().catch(() => {});
    await pageJerry?.close().catch(() => {});
    await pageBob?.close().catch(() => {});
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await contextBob?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await browserBob?.close().catch(() => {});
    await clearGunDatabases();
  });

  test('age-verified Jerry receives adult talk; unverified Bob does not', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerryUserId = await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id ?? '');
    const bobUserId = await pageBob.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id ?? '');

    // Vouch Jerry age-verified (3 sequential ack-awaited server writes hit threshold=3)
    await serverVouchAgeVerified(pageTom, jerryUserId);

    // Tom creates and broadcasts an adult talk
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(pageTom, 'chatrooms');
    await createAdultTalk(pageTom, ADULT_TALK_TITLE);
    await pageTom.click('#broadcast-talk-btn');
    await confirmBroadcastTagPreambleIfVisible(pageTom);
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    // Jerry (age-verified) should receive the adult talk
    await waitForIncomingTalkClusterOnServer(pageJerry, ADULT_TALK_TITLE);

    // Bob (not age-verified) should NOT receive the adult talk — the server already processed
    // the broadcast by the time Jerry's assertion passed, so no additional wait is needed.
    const bobRes = await pageTom.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(bobUserId)}/incoming-talks`);
    expect(bobRes.ok()).toBeTruthy();
    const bobClusters = (await bobRes.json()) as Array<{ title?: string }>;
    expect(
      bobClusters.some((c) => String(c.title ?? '').includes(ADULT_TALK_TITLE)),
      'Bob (not age-verified) must NOT receive the adult talk',
    ).toBe(false);
  });
});
