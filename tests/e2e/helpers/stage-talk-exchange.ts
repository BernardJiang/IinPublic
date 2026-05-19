import type { Page } from '@playwright/test';
import { selectTalkEditorType } from './talk-editor-e2e';
import {
  clickBroadcastUntilBulkAck,
  waitForBroadcastableTalkIds,
  waitForDistinctGunPeersExcludingSelf,
} from './talk-demo-ui';
import { afterAction, afterNav, afterSync } from './timing';

/** Minimal flow talk + broadcast for stage seeding (TechSupport → room). */
export async function createSimpleFlowTalkAndBroadcast(
  page: Page,
  title: string,
  questionText: string,
): Promise<void> {
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await selectTalkEditorType(page, 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill(questionText);
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterAction();
  await page.click('.chatroom-item[data-chatroom-id="global"]');
  await afterNav();
  await waitForBroadcastableTalkIds(page, 120_000);
  await waitForDistinctGunPeersExcludingSelf(page, 1, 240_000);
  await clickBroadcastUntilBulkAck(page);
  await afterSync();
}
