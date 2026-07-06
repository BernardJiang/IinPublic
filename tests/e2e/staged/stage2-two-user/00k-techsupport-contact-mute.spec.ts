import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync, headless } from '../../helpers/timing';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';

test.describe('TechSupport built-in contact controls', () => {
  test.describe.configure({ retries: 0 });
  let browser: Browser;
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browser = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('pins TechSupport and mutes notifications without ordinary blocking', async () => {
    const tom = await bootstrapUser(browser, 'Tom support contact', 'Tom');
    context = tom.context;
    page = tom.page;
    const currentUserId = await page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
    const readSupportConversationId = () =>
      page!.evaluate((techSupportId) => {
        const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
        const support = Object.entries(conversations).find(
          ([, conversation]: [string, any]) =>
            conversation?.supportChannel === true &&
            conversation?.otherUserId === techSupportId,
        ) as [string, any] | undefined;
        return String(support?.[0] || '');
      }, TECHSUPPORT_ROOT_USER_ID);
    await expect.poll(readSupportConversationId, { timeout: 15_000 }).not.toBe('');
    const supportConversationId = await readSupportConversationId();

    await page.evaluate((conversationId) => {
      localStorage.setItem('iinpublic_ui_language', 'zh');
      (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showConversationDetail?.(conversationId);
    }, supportConversationId);
    await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10_000 });
    await page.locator('#conversation-message-input').fill('你好，TechSupport');
    await page.locator('#send-conversation-message').click();
    await expect(page.locator('#conversation-messages')).toContainText('收到你的消息，Tom', { timeout: 20_000 });
    await page.locator('#back-from-conversation').click();
    await page.evaluate(() => localStorage.setItem('iinpublic_ui_language', 'en'));

    await page.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    const supportRow = page.locator(`.contact-support-item[data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await expect(supportRow).toBeVisible({ timeout: 15_000 });
    await expect(supportRow).toContainText('Built-in support contact');

    await supportRow.click();
    await expect(page.locator('#contact-edit-relationship-btn')).toContainText('Support Notifications');
    await page.click('#contact-edit-relationship-btn');
    await expect(page.locator('#contact-relationship-modal')).toContainText('Support Notifications');
    await expect(page.locator('#contact-block-toggle-btn')).toHaveCount(0);
    await page.click('#contact-support-mute-btn');
    await expect(page.locator('.notification').filter({ hasText: 'TechSupport notifications muted' })).toBeVisible();

    await page.click('#back-to-contacts-list');
    await afterSync();
    await expect(supportRow).toContainText('Support notifications are muted locally.');
    await expect
      .poll(() => page!.evaluate((userId) => localStorage.getItem(`iinpublic_support_notifications_muted:${userId}`), currentUserId), {
        timeout: 10_000,
      })
      .toBe('1');

    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await page.click('.chatroom-item[data-chatroom-id="global"]');
    await afterSync();
    const supportMember = page.locator(`.chatroom-member-item[data-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await expect(supportMember).toHaveAttribute('data-support-contact', 'true');
    await expect(supportMember).toContainText('Built-in support contact');
    await supportMember.click();
    await expect(page.locator('#peer-block-user-btn')).toContainText('Unmute Support');
    await expect(page.locator('#peer-detail-overlay')).not.toContainText('Block User');
  });
});
