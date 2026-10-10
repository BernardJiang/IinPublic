/**
 * OPEN-40 Contacts-only migration. TechSupport keeps its pinned Contacts row but never enters a
 * Nearby roster. Three ordinary users in one Nearby cell see only one another in room details.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync } from '../../helpers/timing';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';

test.describe.configure({ timeout: 120_000 });

test.describe('TechSupport stays out of Nearby room rosters', () => {
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

  test('room details contain only ordinary Nearby participants', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;

    await pageTom.locator('.chatroom-item.current-room').click();
    await afterSync();

    // Tom is the current viewer, so only the other two ordinary members appear.
    await expect(pageTom.locator('.chatroom-member-item')).toHaveCount(2, { timeout: 15_000 });
    await expect(pageTom.locator(
      `.chatroom-member-item[data-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`,
    )).toHaveCount(0);

    const rows = pageTom.locator('.chatroom-member-item');
    await expect(rows.nth(0).locator('.chatroom-member-avatar')).toBeVisible();
    await expect(rows.nth(1).locator('.chatroom-member-avatar')).toBeVisible();
    const firstId = await rows.nth(0).getAttribute('data-user-id');
    const secondId = await rows.nth(1).getAttribute('data-user-id');
    expect(firstId).not.toBe(TECHSUPPORT_ROOT_USER_ID);
    expect(secondId).not.toBe(TECHSUPPORT_ROOT_USER_ID);
    expect(new Set([firstId, secondId]).size).toBe(2);
  });
});
