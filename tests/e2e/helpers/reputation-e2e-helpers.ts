import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { afterAction, afterSync } from './timing';
import { gunBaseURL } from './ports';
import { confirmBroadcastTagPreambleIfVisible } from './broadcast-preamble';
import { openIncomingTalkModal, waitForResponseModalClosed, waitForTabActive } from './talks-matching-flow';
import { dismissNotificationOverlays } from './durable-ui';

export async function getCurrentUserId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id ?? '');
}

export async function getReputation(page: Page, userId: string, viewerId: string): Promise<any> {
  const res = await page.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(userId)}?viewerId=${encodeURIComponent(viewerId)}`);
  expect(res.ok()).toBeTruthy();
  const user = await res.json();
  return user.reputation;
}

export async function enterGlobalChatroom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('.chatroom-item:has-text("Global")');
  await page.waitForSelector('.chatroom-member-item', { timeout: 15000 });
  await afterSync();
}

export async function createMatchTalk(page: Page, title: string): Promise<void> {
  await dismissNotificationOverlays(page);
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill(`Reputation test (${title}): want coffee?`);
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

export async function createAdultTalk(page: Page, title: string): Promise<void> {
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

export async function serverVouchAgeVerified(page: Page, targetUserId: string): Promise<void> {
  const url = `${gunBaseURL()}/api/users/${encodeURIComponent(targetUserId)}/age-verify`;
  const res = await page.request.post(url);
  expect(res.ok(), `age-verify failed (${res.status()})`).toBeTruthy();
}

export async function establishContactsTomJerry(pageTom: Page, pageJerry: Page, title: string): Promise<void> {
  await enterGlobalChatroom(pageTom);
  await enterGlobalChatroom(pageJerry);

  await createMatchTalk(pageTom, title);
  await pageTom.click('#broadcast-talk-btn');
  await confirmBroadcastTagPreambleIfVisible(pageTom);
  await afterAction();
  await waitForTabActive(pageTom, 'chatrooms');

  await openIncomingTalkModal(pageJerry, title);
  await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
  await waitForResponseModalClosed(pageJerry);
  await afterSync();
}
