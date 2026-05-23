import type { Page } from '@playwright/test';
import { afterSync } from './timing';
import { dismissNotificationOverlays } from './durable-ui';

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
  await q.locator('.question-text').fill(`Blocking test (${title}): want coffee?`);
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
  await page.waitForFunction(
    (talkTitle) => {
      const stored = JSON.parse(localStorage.getItem('myTalks') || '{}') as Record<string, { title?: string }>;
      return Object.values(stored).some((talk) => talk.title === talkTitle);
    },
    title,
    { timeout: 20_000 },
  );
}
