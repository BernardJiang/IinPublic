/**
 * Place creation rules and lifecycle (docs/design/nearby-and-place-chatrooms.md §4.2):
 * a contact minimum gates New Room, the form carries a trademark reminder, an empty Place is
 * listed under "Places near you", and each person can have only one live Place.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Place creation rules', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  const currentRoomId = (p: Page) => p.evaluate(() =>
    (window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || '');

  const open = async (query = ''): Promise<Page> => {
    const p = page!;
    await gotoWebApp(p, `${webBaseURL()}/${query}`);
    await afterSync();
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    return p;
  };

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('New Room needs the minimum number of contacts', async () => {
    const p = await open('?e2e_place_min_contacts=3');
    await p.locator('#create-custom-chatroom-btn').click();
    await expect(p.locator('.notification', { hasText: /at least 3 contacts.*You have 0/i })).toBeVisible({ timeout: 10_000 });
    await expect(p.locator('[data-testid="custom-room-name-input"]')).toHaveCount(0);
  });

  test('the form reminds the creator of trademark law', async () => {
    const p = await open();
    await p.locator('#create-custom-chatroom-btn').click();
    await afterNav();
    await expect(p.locator('[data-testid="custom-room-trademark-notice"]')).toContainText(/trademark/i);
    await p.locator('#cancel-custom-room-btn').click();
  });

  test('an empty Place is listed under Places near you; one live Place per person', async () => {
    const p = await open();
    const name = `Empty Place ${Date.now()}`;
    await p.locator('#create-custom-chatroom-btn').click();
    await afterNav();
    await p.locator('[data-testid="custom-room-name-input"]').fill(name);
    await p.locator('[data-testid="custom-room-submit-btn"]').click();
    // The creator is moved into the new Place at once.
    await expect(p.locator('#chatroom-members-list')).toBeVisible({ timeout: 15_000 });
    await expect(p.locator('#return-home-btn')).toBeEnabled({ timeout: 15_000 });
    await expect.poll(() => currentRoomId(p), { timeout: 15_000 }).toMatch(/^place_b[a-z2-7]+$/);

    // Leave it: the Place is now empty, so it is listed under "Places near you".
    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    await p.locator('#return-home-btn').click();
    await afterNav();
    await expect(p.locator('#return-home-btn')).toBeDisabled({ timeout: 15_000 });
    await expect.poll(() => currentRoomId(p), { timeout: 15_000 }).toMatch(/^nearby-v3$/);
    const section = p.locator('[data-testid="places-near-you-section"]');
    await expect(section).toContainText(name, { timeout: 20_000 });

    // A second Place by the same person is refused.
    await p.locator('#create-custom-chatroom-btn').click();
    await afterNav();
    await p.locator('[data-testid="custom-room-name-input"]').fill(`Second ${Date.now()}`);
    await p.locator('[data-testid="custom-room-submit-btn"]').click();
    await expect(p.locator('.notification', { hasText: /already have a room/i })).toBeVisible({ timeout: 15_000 });

    // Tapping the listed empty Place enters it.
    await section.locator('[data-testid="room-list-row"]', { hasText: name }).click();
    await expect(p.locator('#return-home-btn')).toBeEnabled({ timeout: 15_000 });
  });
});
