import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync } from '../../helpers/timing';
import {
  bootstrapUser,
  waitForIncomingTalkClusterOnLocalGun,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import { createSimpleFlowTalk, goToChatrooms } from '../../helpers/broadcast-cancellation-helpers';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { gunBaseURL } from '../../helpers/ports';

test.describe('P0 direct talk delivery over Gun mesh', () => {
  let browserTom: Browser;
  let browserJerry: Browser;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    browserTom = await chromium.launch({ headless: process.env.CI ? true : false });
    browserJerry = await chromium.launch({ headless: process.env.CI ? true : false });
    await clearGunForStage2Spec();
  });

  test.afterAll(async () => {
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('delivers talk to receiver local Gun without server incoming-talks inbox', async () => {
    test.setTimeout(120_000);
    const title = `P0 mesh talk ${Date.now()}`;

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom P0');
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry P0');
    const pageTom = tom.page;
    const pageJerry = jerry.page;

    try {
      await expect
        .poll(() => pageTom.evaluate(() => !!window.__iinpublic_app?.getApp?.()?.isDirectTalkDeliveryEnabled?.()))
        .toBe(true);
      await expect
        .poll(() => pageJerry.evaluate(() => !!window.__iinpublic_app?.getApp?.()?.isDirectTalkDeliveryEnabled?.()))
        .toBe(true);

      await pageTom.click('.chatroom-item:has-text("Global")');
      await pageJerry.click('.chatroom-item:has-text("Global")');
      await afterSync();

      await createSimpleFlowTalk(pageTom, title, 'Yes', 'No', { sendToChatroom: false });
      await goToChatrooms(pageTom);
      await pageTom.click('.chatroom-item:has-text("Global")');
      await afterSync();
      await clickBroadcastUntilBulkAck(pageTom);

      const jerryId = await pageJerry.evaluate(() =>
        String(window.__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
      );
      expect(jerryId).toBeTruthy();

      const serverInbox = await pageJerry.context().request.get(
        `${gunBaseURL()}/api/users/${encodeURIComponent(jerryId)}/incoming-talks`,
        { headers: { 'Cache-Control': 'no-cache' } },
      );
      expect(serverInbox.ok()).toBe(true);
      expect(serverInbox.headers()['x-p0-direct-talk-delivery']).toBe('1');
      const serverClusters = await serverInbox.json();
      expect(Array.isArray(serverClusters) ? serverClusters.length : -1).toBe(0);

      await waitForIncomingTalkClusterOnLocalGun(pageJerry, title, { timeout: 60_000, polling: 500 });

      await pageJerry.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageJerry, 'talks');
      await afterSync();
      await expect(pageJerry.locator('.talk-list-item[data-role="incoming"]', { hasText: title })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });
});
