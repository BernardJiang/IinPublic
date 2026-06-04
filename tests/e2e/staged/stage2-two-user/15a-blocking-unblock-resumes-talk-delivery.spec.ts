import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterSync, headless } from '../../helpers/timing';
import { gunBaseURL } from '../../helpers/ports';
import {
  clickBroadcastUntilBulkAck,
  deliverBroadcastViaAppPath,
  waitForBroadcastableTalkIds,
} from '../../helpers/talk-demo-ui';
import { E2E_ASSERT_TIMEOUT_MS } from '../../helpers/timing';
import { waitForContactDetailReady } from '../../helpers/durable-ui';
import {
  bootstrapUser,
  openIncomingTalkModal,
  waitForIncomingTalkCluster,
  waitForResponseModalClosed,
  waitForTabActive,
  resetTalksMatchingSession,
  incomingClustersIncludeTitleForUser,
} from '../../helpers/talks-matching-flow';
import { createMatchTalk, enterGlobalChatroom, ensureNoBlockBetween } from '../../helpers/blocking-e2e-helpers';

async function openContactsList(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="contacts"]');
  await afterSync();
  if (await page.locator('#contact-detail-container').isVisible().catch(() => false)) {
    await page.click('#back-to-contacts-list');
    await afterAction();
  }
}

async function setBlockViaApi(page: Page, blockerId: string, targetId: string, blocked: boolean): Promise<void> {
  const base = gunBaseURL();
  const url = blocked
    ? `${base}/api/users/${encodeURIComponent(blockerId)}/blocks`
    : `${base}/api/users/${encodeURIComponent(blockerId)}/blocks/${encodeURIComponent(targetId)}`;
  const res = blocked
    ? await page.request.post(url, { data: { targetId } })
    : await page.request.delete(url);
  expect(res.ok(), `setBlockViaApi(${blocked}) failed with ${res.status()}`).toBeTruthy();
}

test.describe('Blocking system — unblock resumes talk delivery', () => {
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

  test('unblock resumes talk delivery', async () => {
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

    const tomUserId = await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');
    const jerryUserId = await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');

    await createMatchTalk(pageTom, 'Unblock Warmup Talk');
    await ensureNoBlockBetween(pageTom, tomUserId, pageJerry, jerryUserId);
    await clickBroadcastUntilBulkAck(pageTom);
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');
    await openIncomingTalkModal(pageJerry, 'Unblock Warmup Talk');
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes, I would."][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await afterSync();

    await openContactsList(pageTom);
    const jerryContact = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Jerry' }).first();
    await expect(jerryContact).toBeVisible({ timeout: 15000 });
    await jerryContact.click();
    await waitForContactDetailReady(pageTom);
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });
    await pageTom.click('#contact-block-toggle-btn'); // Block
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
    await enterGlobalChatroom(pageTom);
    await createMatchTalk(pageTom, 'Blocked Talk');
    await clickBroadcastUntilBulkAck(pageTom, { minSent: 0 });
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await expect
      .poll(
        async () => incomingClustersIncludeTitleForUser(pageJerry, jerryUserId, 'Blocked Talk'),
        { timeout: 12000 },
      )
      .toBe(false);

    await openContactsList(pageTom);
    const jerryContactBlocked = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Jerry' }).first();
    await expect(jerryContactBlocked).toBeVisible({ timeout: 10000 });
    await jerryContactBlocked.click();
    await waitForContactDetailReady(pageTom);
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });
    const blockToggleText = ((await pageTom.locator('#contact-block-toggle-btn').textContent({ timeout: 10000 })) || '').trim();
    if (/unblock/i.test(blockToggleText)) {
      await pageTom.click('#contact-block-toggle-btn'); // Unblock
      await expect(pageTom.locator('#contact-relationship-modal')).toHaveCount(0, { timeout: 10000 });
    } else {
      await setBlockViaApi(pageTom, tomUserId, jerryUserId, false);
      await pageTom.evaluate(() => document.getElementById('contact-relationship-modal')?.remove());
    }

    await expect
      .poll(
        async () => {
          const res = await pageTom.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(tomUserId)}/blocks`);
          if (!res.ok()) return [jerryUserId];
          return (await res.json() as { blockedUserIds: string[] }).blockedUserIds;
        },
        { timeout: 15000 },
      )
      .not.toContain(jerryUserId);

    await pageTom.click('#back-to-contacts-list');
    await afterAction();
    await enterGlobalChatroom(pageTom);
    await expect
      .poll(
        async () => {
          const res = await pageTom.request.get(
            `${gunBaseURL()}/api/users/${encodeURIComponent(tomUserId)}/block-status/${encodeURIComponent(jerryUserId)}`,
          );
          if (!res.ok()) return true;
          return Boolean(((await res.json()) as { eitherBlocked?: boolean }).eitherBlocked);
        },
        { timeout: 10_000 },
      )
      .toBe(false);
    await createMatchTalk(pageTom, 'Post-Unblock Talk');
    await ensureNoBlockBetween(pageTom, tomUserId, pageJerry, jerryUserId);
    await enterGlobalChatroom(pageTom);
    await waitForBroadcastableTalkIds(pageTom, E2E_ASSERT_TIMEOUT_MS);
    const postUnblock = await deliverBroadcastViaAppPath(pageTom, { minReceivers: 1 });
    expect(postUnblock.talksSent).toBeGreaterThanOrEqual(1);
    await afterAction();
    await expect
      .poll(
        async () => incomingClustersIncludeTitleForUser(pageJerry, jerryUserId, 'Post-Unblock Talk'),
        { timeout: 20_000, intervals: [200, 400, 800] },
      )
      .toBe(true);
    await openIncomingTalkModal(pageJerry, 'Post-Unblock Talk');
  });
});
