import type { Page } from '@playwright/test';
import { selectTalkEditorType } from './talk-editor-e2e';
import {
  clickBroadcastUntilBulkAck,
  waitForBroadcastableTalkIds,
  waitForDistinctGunPeersExcludingSelf,
} from './talk-demo-ui';
import { afterAction, afterNav, afterSync } from './timing';
import { openCurrentChatroom } from './chatroom-nav';
import { openTalkEditor } from './open-talk-editor';

/** Minimal flow talk + broadcast for stage seeding (TechSupport → room). */
export async function createSimpleFlowTalkAndBroadcast(
  page: Page,
  title: string,
  questionText: string,
): Promise<void> {
  await openTalkEditor(page);
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await selectTalkEditorType(page, 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill(questionText);
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-submit-btn');
  await afterSync();
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterAction();
  await openCurrentChatroom(page);
  await afterNav();
  await waitForBroadcastableTalkIds(page, 120_000);
  await waitForDistinctGunPeersExcludingSelf(page, 1, 240_000);
  await clickBroadcastUntilBulkAck(page);
  await afterSync();
}
