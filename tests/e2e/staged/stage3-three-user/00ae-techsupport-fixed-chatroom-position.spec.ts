/**
 * TechSupport in a chatroom's member list gets a fixed, compact pinned row — never sorted
 * in among ordinary members by recency/relationship, and visually smaller (single line,
 * no avatar/status block) than an ordinary member row. Same treatment the Contacts tab
 * already gives its own pinned TechSupport row (contacts-view.ts).
 *
 * Flow: Tom joins Global first, then Jerry, then Bob (recency order: Bob, Jerry newest-
 * first among ordinary members). From Tom's roster:
 *  - TechSupport is always the FIRST row in the DOM, regardless of when Jerry/Bob joined.
 *  - TechSupport's row carries the compact pinned class and no avatar/status elements.
 *  - Jerry and Bob (ordinary members) still sort by recency beneath it, as before.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync } from '../../helpers/timing';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';

test.describe.configure({ timeout: 120_000 });

test.describe('TechSupport gets a fixed, compact chatroom roster position', () => {
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
    await clearGunForStage3Spec();
    browserTom = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
    browserJerry = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
    browserBob = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
  });

  test.afterAll(async () => {
    for (const p of [pageTom, pageJerry, pageBob]) {
      await p?.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup?.()).catch(() => {});
    }
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await contextBob?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await browserBob?.close().catch(() => {});
    await clearGunForStage3Spec();
  });

  test('TechSupport row stays first and compact regardless of ordinary-member join order', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;

    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // TechSupport + 2 ordinary members (Jerry, Bob) visible in Tom's roster.
    await expect(pageTom.locator('.chatroom-member-item')).toHaveCount(3, { timeout: 15_000 });

    const rows = pageTom.locator('.chatroom-member-item');
    const firstRow = rows.first();
    await expect(firstRow).toHaveAttribute('data-support-contact', 'true');
    await expect(firstRow).toHaveAttribute('data-user-id', TECHSUPPORT_ROOT_USER_ID);
    await expect(firstRow).toHaveClass(/chatroom-member-support-pinned/);

    // Compact single-line treatment — no avatar circle, no separate status line.
    await expect(firstRow.locator('.chatroom-member-avatar')).toHaveCount(0);
    await expect(firstRow.locator('.chatroom-member-status')).toHaveCount(0);
    await expect(firstRow.locator('.chatroom-member-support-badge')).toContainText('Built-in');

    // Ordinary members (Jerry, Bob) keep the normal 2-line row and sort beneath TechSupport.
    const secondRow = rows.nth(1);
    const thirdRow = rows.nth(2);
    await expect(secondRow.locator('.chatroom-member-avatar')).toBeVisible();
    await expect(thirdRow.locator('.chatroom-member-avatar')).toBeVisible();
    const secondId = await secondRow.getAttribute('data-user-id');
    const thirdId = await thirdRow.getAttribute('data-user-id');
    expect(secondId).not.toBe(TECHSUPPORT_ROOT_USER_ID);
    expect(thirdId).not.toBe(TECHSUPPORT_ROOT_USER_ID);
    expect(new Set([secondId, thirdId]).size).toBe(2);
  });
});
