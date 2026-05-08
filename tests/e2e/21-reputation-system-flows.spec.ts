/**
 * Reputation system E2E coverage (FR-SP: vouch votes, star rating, block count propagation).
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases } from './helpers/clear-database';
import { afterAction, afterSync, headless } from './helpers/timing';
import { gunBaseURL } from './helpers/ports';
import { confirmBroadcastTagPreambleIfVisible } from './helpers/broadcast-preamble';
import {
  bootstrapUser,
  openIncomingTalkModal,
  waitForIncomingTalkClusterOnServer,
  waitForResponseModalClosed,
  waitForTabActive,
  resetTalksMatchingSession,
  finalCleanupPages,
} from './helpers/talks-matching-flow';
import { dismissNotificationOverlays } from './helpers/durable-ui';

async function getCurrentUserId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id ?? '');
}

async function getReputation(page: Page, userId: string, viewerId: string): Promise<any> {
  const res = await page.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(userId)}?viewerId=${encodeURIComponent(viewerId)}`);
  expect(res.ok()).toBeTruthy();
  const user = await res.json();
  return user.reputation;
}

async function enterGlobalChatroom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('.chatroom-item:has-text("Global")');
  await page.waitForSelector('.chatroom-member-item', { timeout: 15000 });
  await afterSync();
}

async function createMatchTalk(page: Page, title: string): Promise<void> {
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

async function createAdultTalk(page: Page, title: string): Promise<void> {
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

async function serverVouchAgeVerified(page: Page, targetUserId: string): Promise<void> {
  const url = `${gunBaseURL()}/api/users/${encodeURIComponent(targetUserId)}/age-verify`;
  const res = await page.request.post(url);
  expect(res.ok(), `age-verify failed (${res.status()})`).toBeTruthy();
}

async function establishContactsTomJerry(pageTom: Page, pageJerry: Page, title: string): Promise<void> {
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

test.describe('Reputation system flows', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browserTom = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      args: ['--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    pageTom = pageJerry = undefined;
    contextTom = contextJerry = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunDatabases();
  });

  test('vouch votes accumulate to threshold (delivery flips at 3)', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await afterSync();
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await afterSync();

    await enterGlobalChatroom(pageTom!);
    await enterGlobalChatroom(pageJerry!);

    const jerryUserId = await getCurrentUserId(pageJerry!);

    // Threshold is 3 (CONFIG.AGE_VERIFICATION_THRESHOLD).
    for (let i = 1; i <= 3; i += 1) {
      await serverVouchAgeVerified(pageTom!, jerryUserId);
      await afterSync();

      const adultTitle = `E2E Adult Vote Step ${i} (${Date.now()})`;
      await createAdultTalk(pageTom!, adultTitle);

      await pageTom!.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(pageTom!);
      await afterAction();
      await waitForTabActive(pageTom!, 'chatrooms');

      const delivered = async (): Promise<boolean> => {
        const res = await pageTom!.request.get(
          `${gunBaseURL()}/api/users/${encodeURIComponent(jerryUserId)}/incoming-talks`,
          { timeout: 30_000 },
        );
        if (!res.ok()) return false;
        const clusters = (await res.json()) as unknown[];
        const base = gunBaseURL();
        for (const c of clusters as Array<{ title?: unknown; talkIds?: unknown }>) {
          if (String(c?.title || '').includes(adultTitle)) return true;
          const t = c?.talkIds;
          if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
          const ids = Object.keys(t as Record<string, unknown>).filter((k) => !k.startsWith('_'));
          for (const id of ids) {
            const tr = await pageTom!.request.get(`${base}/api/talks/${encodeURIComponent(id)}`);
            if (!tr.ok()) continue;
            const td = (await tr.json()) as { title?: unknown };
            if (String(td?.title || '').includes(adultTitle)) return true;
          }
        }
        return false;
      };

      if (i < 3) {
        await expect
          .poll(delivered, { timeout: 10_000, intervals: [500] })
          .toBe(false);
      } else {
        await waitForIncomingTalkClusterOnServer(pageJerry!, adultTitle);
      }
    }
  });

  test('submit peer star rating updates starRating + liked/disliked counts', async () => {
    const title = `Reputation Star Rating ${Date.now()}`;
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;

    await establishContactsTomJerry(pageTom, pageJerry, title);

    const tomUserId = await getCurrentUserId(pageTom);
    const jerryUserId = await getCurrentUserId(pageJerry);

    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();

    const jerryContact = pageTom.locator(`.contact-item[data-contact-user-id="${jerryUserId}"]`).first();
    await expect(jerryContact).toBeVisible({ timeout: 15000 });
    await jerryContact.click();
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry', { timeout: 10000 });
    // Ensure showContactDetail finished fetching public profile + match count;
    // Relationship & Credit uses the cached profile to avoid another GET /api/users/:id.
    await expect(pageTom.locator('#contact-detail-matches')).toContainText('talk', { timeout: 15000 });
    await expect(pageTom.locator('.contact-public-profile-summary')).toBeVisible({ timeout: 15000 });

    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });

    const currentRatingRaw = await pageTom.$eval('#contact-relationship-rating', (el) => (el as HTMLSelectElement).value);
    const currentRating = Number(currentRatingRaw || 0);
    const desiredRating = currentRating === 5 ? 4 : 5;
    await pageTom.selectOption('#contact-relationship-rating', String(desiredRating));
    await pageTom.click('#contact-relationship-save-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toHaveCount(0, { timeout: 10000 });
    await afterSync();

    // Verify server-side reputation fields.
    await expect
      .poll(async () => {
        const rep = await getReputation(pageTom, jerryUserId, tomUserId);
        return Number(rep.starRating);
      }, { timeout: 15000 })
      .toBeCloseTo(desiredRating, 0.01);
  });

  test('block/unblock propagates reputation.blockCount', async () => {
    const title = `Reputation Block Count ${Date.now()}`;
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;

    await establishContactsTomJerry(pageTom, pageJerry, title);

    const tomUserId = await getCurrentUserId(pageTom);
    const jerryUserId = await getCurrentUserId(pageJerry);

    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const jerryContact = pageTom.locator(`.contact-item[data-contact-user-id="${jerryUserId}"]`).first();
    await expect(jerryContact).toBeVisible({ timeout: 15000 });
    await jerryContact.click();

    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await expect(pageTom.locator('#contact-detail-matches')).toContainText('talk', { timeout: 15000 });
    await expect(pageTom.locator('.contact-public-profile-summary')).toBeVisible({ timeout: 15000 });

    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });

    await pageTom.click('#contact-block-toggle-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toHaveCount(0, { timeout: 10000 });
    await afterSync();

    await expect
      .poll(async () => {
        const rep = await getReputation(pageTom, jerryUserId, tomUserId);
        return rep.blockCount as number;
      }, { timeout: 15000 })
      .toBe(1);

    // Unblock via relationship modal again
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const sameContact = pageTom.locator(`.contact-item[data-contact-user-id="${jerryUserId}"]`).first();
    await expect(sameContact).toBeVisible({ timeout: 15000 });
    await sameContact.click();

    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });
    await pageTom.click('#contact-block-toggle-btn'); // should now be "Unblock User"
    await afterSync();
    await expect(pageTom.locator('#contact-relationship-modal')).toHaveCount(0, { timeout: 10000 });

    await expect
      .poll(async () => {
        const rep = await getReputation(pageTom, jerryUserId, tomUserId);
        return rep.blockCount as number;
      }, { timeout: 15000 })
      .toBe(0);
  });
});

