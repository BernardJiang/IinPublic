import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterSync, headless } from '../../helpers/timing';
import { gunBaseURL } from '../../helpers/ports';
import { confirmBroadcastTagPreambleIfVisible } from '../../helpers/broadcast-preamble';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { waitForContactDetailReady } from '../../helpers/durable-ui';

import {
  bootstrapUser,
  openIncomingTalkModal,
  waitForResponseModalClosed,
  waitForTabActive,
  resetTalksMatchingSession,
  incomingClustersIncludeTitleForUser,
} from '../../helpers/talks-matching-flow';
import { createMatchTalk, enterGlobalChatroom } from '../../helpers/blocking-e2e-helpers';

test.describe('Blocking system — block stops delivery', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'] });
    browserJerry = await chromium.launch({ headless, args: ['--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'] });
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    pageTom = undefined;
    pageJerry = undefined;
    contextTom = undefined;
    contextJerry = undefined;
  });

  test.afterAll(async () => {
    await pageTom?.close().catch(() => {});
    await pageJerry?.close().catch(() => {});
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('block stops delivery and hides peer detail from the blocked user', async () => {
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

    await createMatchTalk(pageTom, 'Blocking Warmup Talk');
    await clickBroadcastUntilBulkAck(pageTom);
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await openIncomingTalkModal(pageJerry, 'Blocking Warmup Talk');
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes, I would."][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await afterSync();

    const tomUserId = await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');
    const jerryUserId = await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');

    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const jerryContact = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Jerry' }).first();
    await expect(jerryContact).toBeVisible({ timeout: 15000 });
    await jerryContact.click();
    await waitForContactDetailReady(pageTom);
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });
    await pageTom.click('#contact-block-toggle-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toHaveCount(0, { timeout: 10000 });

    await expect
      .poll(
        async () => {
          const res = await pageTom.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(tomUserId)}/blocks`);
          if (!res.ok()) return [];
          return (await res.json() as { blockedUserIds: string[] }).blockedUserIds;
        },
        { timeout: 15000 },
      )
      .toContain(jerryUserId);

    await pageTom.click('#back-to-contacts-list');
    await afterAction();
    await expect(pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Blocked' }).first()).toBeVisible({ timeout: 10000 });

    await enterGlobalChatroom(pageTom);
    const jerryMember = pageTom.locator('.chatroom-member-item').filter({ hasText: 'Jerry' }).first();
    await expect(jerryMember).toBeVisible({ timeout: 15000 });
    await jerryMember.click();
    await expect(pageTom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect(pageTom.locator('#peer-send-talks-btn')).toBeDisabled({ timeout: 10000 });
    await expect(pageTom.locator('#peer-block-user-btn')).toContainText('Unblock User');
    await pageTom.click('#back-from-peer-detail');

    await createMatchTalk(pageTom, 'Blocked Delivery Talk');
    await clickBroadcastUntilBulkAck(pageTom, { minSent: 0 });
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await expect
      .poll(
        async () => incomingClustersIncludeTitleForUser(pageJerry, jerryUserId, 'Blocked Delivery Talk'),
        { timeout: 12000 },
      )
      .toBe(false);

    await enterGlobalChatroom(pageJerry);
    await expect
      .poll(
        async () => {
          const res = await pageJerry.request.get(
            `${gunBaseURL()}/api/users/${encodeURIComponent(jerryUserId)}/block-status/${encodeURIComponent(tomUserId)}`,
          );
          if (!res.ok()) return false;
          return Boolean(((await res.json()) as { blockedBy?: boolean }).blockedBy);
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    const tomMember = pageJerry.locator('.chatroom-member-item').filter({ hasText: 'Tom' }).first();
    await expect(tomMember).toBeVisible({ timeout: 15000 });
    await tomMember.click();
    await expect(pageJerry.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect(pageJerry.locator('#peer-stats-section')).toContainText('Profile unavailable', { timeout: 10000 });
    await expect(pageJerry.locator('#peer-detail-subtitle')).toContainText('blocked', { timeout: 10000 });
  });
});
