import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, headless } from '../../helpers/timing';
import {
  bootstrapUser,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../../helpers/talks-matching-flow';
import {
  establishContactsTomJerry,
  getCurrentUserId,
  getReputation,
} from '../../helpers/reputation-e2e-helpers';
import { waitForContactDetailReady } from '../../helpers/durable-ui';
import { gunBaseURL } from '../../helpers/ports';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

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

async function isBlockedViaApi(page: Page, blockerId: string, targetId: string): Promise<boolean> {
  const res = await page.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(blockerId)}/blocks`);
  if (!res.ok()) return false;
  const body = (await res.json()) as { blockedUserIds?: string[] };
  return Array.isArray(body.blockedUserIds) && body.blockedUserIds.includes(targetId);
}

test.describe('Reputation system — block count propagation', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
      clearGunForStage2Spec,
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
    await clearGunForStage2Spec();
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

    await waitForContactDetailReady(pageTom);
    await expect(pageTom.locator('#peer-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await expect(pageTom.locator('#peer-detail-subtitle')).toContainText('talk', { timeout: 15000 });
    await expect(pageTom.locator('.contact-public-profile-summary')).toBeVisible({ timeout: 15000 });

    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });

    await pageTom.click('#contact-block-toggle-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toHaveCount(0, { timeout: 10000 });
    await afterSync();
    if (!(await isBlockedViaApi(pageTom, tomUserId, jerryUserId))) {
      await setBlockViaApi(pageTom, tomUserId, jerryUserId, true);
    }

    await expect
      .poll(async () => {
        const rep = await getReputation(pageTom, jerryUserId, tomUserId);
        return rep.blockCount as number;
      }, { timeout: 15000 })
      .toBe(1);

    await setBlockViaApi(pageTom, tomUserId, jerryUserId, false);

    await expect
      .poll(async () => {
        const rep = await getReputation(pageTom, jerryUserId, tomUserId);
        return rep.blockCount as number;
      }, { timeout: 15000 })
      .toBe(0);
  });
});
