/**
 * Reconnect recovery: incoming talks are visible after a browser goes offline and returns.
 */
import { Browser } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases } from './helpers/clear-database';
import { afterNav, afterSync } from './helpers/timing';
import { bootstrapUser, waitForIncomingTalkClusterOnServer } from './helpers/talks-matching-flow';
import {
  createSimpleFlowTalk,
  goToChatrooms,
  waitForBroadcastBulkAckMinSent,
} from './helpers/broadcast-cancellation-helpers';
import { confirmBroadcastTagPreambleIfVisible } from './helpers/broadcast-preamble';

test.describe('Reconnect recovery', () => {
  let browserTom: Browser;
  let browserJerry: Browser;

  test.beforeAll(async ({ browser }) => {
    await clearGunDatabases();
    browserTom = browser;
    browserJerry = browser;
  });

  test.afterAll(async () => {
    await clearGunDatabases();
  });

  test('incoming talk sync recovers after offline/online transition', async () => {
    const title = `Reconnect Recovery Talk ${Date.now()}`;
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Reconnect');
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Reconnect');

    try {
      await createSimpleFlowTalk(tom.page, title);
      await goToChatrooms(tom.page);

      await jerry.page.context().setOffline(true);
      await afterSync();

      await tom.page.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(tom.page);
      await waitForBroadcastBulkAckMinSent(tom.page, { receivers: 1, minSent: 1 }, 120_000);

      await jerry.page.context().setOffline(false);
      await afterSync();
      await waitForIncomingTalkClusterOnServer(jerry.page, title, { timeout: 60_000, polling: 500 });

      await jerry.page.click('.nav-btn[data-view="talks"]');
      await afterNav();
      await expect(
        jerry.page.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: title }).first(),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await tom.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
      await jerry.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
      await tom.context?.close().catch(() => {});
      await jerry.context?.close().catch(() => {});
    }
  });
});
