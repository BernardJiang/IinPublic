import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, delay, headless } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { confirmBroadcastTagPreambleIfVisible } from '../../helpers/broadcast-preamble';
import { waitForBroadcastBulkAck } from '../../helpers/broadcast-ack';
import { gunBaseURL } from '../../helpers/ports';

/** Expand parent only when collapsed (▶). Default UI already expands NA/Europe — blind toggle hides children. */
async function ensureHierarchyParentExpanded(page: Page, parentId: string): Promise<void> {
  const icon = page.locator(`.chatroom-item[data-chatroom-id="${parentId}"] .chatroom-expand-icon`);
  const label = ((await icon.textContent()) ?? '').trim();
  if (label.includes('▶')) {
    await icon.click();
    await afterSync();
  }
}

/**
 * Chatroom list → expand parent row → open a hierarchy leaf (e.g. United States under North America).
 */
async function openHierarchyLeafRoom(page: Page, parentId: string, roomId: string): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await waitForTabActive(page, 'chatrooms');
  await afterSync();
  await ensureHierarchyParentExpanded(page, parentId);
  const leaf = page.locator(`.chatroom-item[data-chatroom-id="${roomId}"]`);
  await expect(leaf).toBeVisible({ timeout: 20_000 });
  await leaf.click();
  await afterSync();
}

/** Open detail for an internal node (continent) from the list. */
async function openHierarchyNodeRoom(page: Page, roomId: string): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await waitForTabActive(page, 'chatrooms');
  await afterSync();
  await page.locator(`.chatroom-item[data-chatroom-id="${roomId}"]`).click();
  await afterSync();
}

/** Wait until Gun lists exactly `peerCount` other active members in `chatroomId` (excludes self). */
async function waitForGunPeerCountInRoom(page: Page, chatroomId: string, peerCount: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const count = await page.evaluate(async ({ room }) => {
          const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
          const me = String(app?.currentUser?.id || '').trim();
          const ids: string[] = (await app?.chatroomService?.getActiveMembers(room)) || [];
          return ids.filter((id: string) => id && id !== me).length;
        }, { room: chatroomId });
        return count === peerCount ? 'ok' : String(count);
      },
      { timeout: 90_000, intervals: [500, 1000, 2000] },
    )
    .toBe('ok');
}

async function createSimpleFlowTalk(page: Page, title: string): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await selectTalkEditorType(page, 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill('Hierarchy broadcast smoke?');
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('Chatroom hierarchy navigation and regional broadcast', () => {
  let browserTom: Browser;
  let browserJerry: Browser;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.beforeEach(async () => {
    await clearGunForStage2Spec();
  });

  test.afterAll(async () => {
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('Global → North America → United States; broadcast in country room reaches peer', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    try {
      await openHierarchyLeafRoom(pageTom, 'north-america', 'usa');
      await expect(pageTom.locator('#current-chatroom-title')).toContainText('United States', {
        timeout: 20_000,
      });

      await openHierarchyLeafRoom(pageJerry, 'north-america', 'usa');
      await expect(pageJerry.locator('#current-chatroom-title')).toContainText('United States', {
        timeout: 20_000,
      });

      await waitForGunPeerCountInRoom(pageTom, 'usa', 1);
      await waitForGunPeerCountInRoom(pageJerry, 'usa', 1);

      await createSimpleFlowTalk(pageTom, 'USA room hierarchy broadcast');

      await pageTom.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(pageTom, 'chatrooms');
      await afterSync();
      await pageTom.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(pageTom);
      await waitForTabActive(pageTom, 'chatrooms');
      await waitForBroadcastBulkAck(pageTom, { talksSent: 1, receivers: 1 });

      await pageJerry.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageJerry, 'talks');
      await afterSync();
      await expect(
        pageJerry.locator('.talk-list-item[data-role="incoming"]').filter({
          hasText: 'USA room hierarchy broadcast',
        }),
      ).toBeVisible({ timeout: 60_000 });
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });

  test('Broadcaster on North America does not register inbox for peer joined only under United States', async () => {
    const tom = await bootstrapUser(browserTom, 'TomNA', 'Tom');
    const jerry = await bootstrapUser(browserJerry, 'JerryUSA', 'Jerry');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    try {
      await openHierarchyNodeRoom(pageTom, 'north-america');
      await expect(pageTom.locator('#current-chatroom-title')).toContainText('North America', {
        timeout: 20_000,
      });

      await openHierarchyLeafRoom(pageJerry, 'north-america', 'usa');
      await expect(pageJerry.locator('#current-chatroom-title')).toContainText('United States', {
        timeout: 20_000,
      });

      await waitForGunPeerCountInRoom(pageTom, 'north-america', 0);
      await waitForGunPeerCountInRoom(pageJerry, 'usa', 0);

      await createSimpleFlowTalk(pageTom, 'Parent-room-only isolation');

      await pageTom.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(pageTom, 'chatrooms');
      await afterSync();
      await pageTom.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(pageTom);
      await waitForTabActive(pageTom, 'chatrooms');
      // Tom is the only Gun member under `north-america`; Jerry is under `usa` only (FR-BM-7).
      await waitForBroadcastBulkAck(pageTom, { talksSent: 1, receivers: 0 });

      const jerryId = await pageJerry.evaluate(
        () =>
          (
            window as unknown as {
              __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } };
            }
          ).__iinpublic_app?.getApp?.()?.currentUser?.id || '',
      );
      expect(jerryId.length).toBeGreaterThan(0);

      await expect
        .poll(
          async () => {
            const res = await pageTom.request.get(
              `${gunBaseURL()}/api/users/${encodeURIComponent(jerryId)}/incoming-talks`,
              { headers: { 'Cache-Control': 'no-cache' } },
            );
            if (!res.ok()) return 'bad-status';
            const rows = (await res.json()) as Array<{ title?: string }>;
            return rows.some((r) => String(r.title || '').includes('Parent-room-only isolation'))
              ? 'found'
              : 'absent';
          },
          {
            timeout: 25_000,
            intervals: [500],
            message: 'USA-only peer must not get IN registration from North America parent broadcast',
          },
        )
        .toBe('absent');
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });

  test('Navigate Europe region and open Germany (hierarchy smoke)', async () => {
    const tom = await bootstrapUser(browserTom, 'TomEU', 'Tom');
    const pageTom = tom.page;
    try {
      await openHierarchyLeafRoom(pageTom, 'europe', 'germany');
      await expect(pageTom.locator('#current-chatroom-title')).toContainText('Germany', { timeout: 20_000 });
      await expect(pageTom.locator('#current-chatroom-status')).toBeVisible();
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
    }
  });
});
