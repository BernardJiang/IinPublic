/**
 * The simplified location model (docs/design/nearby-and-place-chatrooms.md §2, §3.5):
 * Resident (blurred GPS) or Traveler ✈ (chosen point), one area size, quiet places with
 * Blur me more / Hide me, the Talk audience in Talk Behavior, and one distance unit.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { webBaseURL } from '../../helpers/ports';
import { openSettingsSection, backToSettingsMenu, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { waitForTabActive } from '../../helpers/talks-matching-flow';

const CONTACTS_SCOPE = 'local_contacts_only_v1';

test.describe('Location model settings', () => {
  let context: BrowserContext | undefined;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 900, height: 1100 } });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await expect.poll(() => roomOf(), { timeout: 60_000 }).toMatch(/^nearby_/);
  });

  test.afterAll(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  const roomOf = () => page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || ''));
  const effectiveMode = () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.effectiveNearbyMode?.());
  const traveler = () => page.evaluate(() => !!(window as any).__iinpublic_app?.getApp?.()?.appearsAsTraveler?.());
  const openLocation = async () => {
    await page.click('.nav-btn[data-view="settings"]');
    await waitForTabActive(page, 'settings');
    await openSettingsSection(page, SETTINGS_SECTION.distanceHome);
  };

  test('Resident by default: area sizes only, quiet places, no distance filter', async () => {
    await openLocation();
    await expect(page.locator('[data-testid="settings-location-source-resident"]')).toBeChecked();
    const area = page.locator('#settings-nearby-privacy-mode');
    await expect(area.locator('option')).toHaveText([/Close nearby/, /Neighborhood/, /Citywide/, /Regional/]);
    await expect(page.locator('[data-testid="settings-quiet-places"]')).toBeVisible();
    await expect(page.locator('#settings-min-distance')).toHaveCount(0);
    expect(await traveler()).toBe(false);
    await backToSettingsMenu(page);
  });

  test('Quiet now blurs to Regional by default, Hide me leaves Nearby, and turning it off returns', async () => {
    await openLocation();
    await page.locator('[data-testid="settings-quiet-now"]').check();
    await expect.poll(effectiveMode, { timeout: 15_000 }).toBe('regional');
    await expect.poll(roomOf, { timeout: 30_000 }).toMatch(/^nearby_/);

    await page.locator('[data-testid="settings-quiet-action"]').selectOption('hide');
    await expect.poll(effectiveMode, { timeout: 15_000 }).toBe('contacts-only');
    await expect.poll(roomOf, { timeout: 30_000 }).toBe(CONTACTS_SCOPE);

    await page.locator('[data-testid="settings-quiet-now"]').uncheck();
    await expect.poll(effectiveMode, { timeout: 15_000 }).toBe('neighborhood');
    await expect.poll(roomOf, { timeout: 30_000 }).toMatch(/^nearby_/);
    await backToSettingsMenu(page);
  });

  test('Traveler ✈: no GPS; a random point (still on the map) until one is chosen, then Nearby there', async () => {
    await openLocation();
    await page.locator('[data-testid="settings-location-source-traveler"]').check();
    await expect(page.locator('[data-testid="settings-encounter-location"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="settings-quiet-places"]')).toHaveCount(0);
    // No point yet: placed at random as a Traveler (never Contacts only), and asked to pick one.
    await expect(page.locator('[data-testid="encounter-location-modal"]')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('iinpublic_encounter_location_v1') || '{}').auto))
      .toBe(true);
    await expect.poll(roomOf, { timeout: 30_000 }).toMatch(/^nearby_/);
    expect(await roomOf()).not.toBe(CONTACTS_SCOPE);
    expect(await traveler()).toBe(true);

    await page.locator('[data-testid="encounter-location-lat"]').fill('51.50135');
    await page.locator('[data-testid="encounter-location-lng"]').fill('-0.14189');
    await page.locator('[data-testid="encounter-location-confirm"]').click();
    await expect.poll(roomOf, { timeout: 30_000 }).toMatch(/^nearby_/);
    expect(await traveler()).toBe(true);

    // Back to Resident: GPS (the test location) again, no longer a Traveler.
    await openLocation();
    await page.locator('[data-testid="settings-location-source-resident"]').check();
    await expect.poll(traveler, { timeout: 15_000 }).toBe(false);
    await backToSettingsMenu(page);
  });

  test('Talk audience lives in Talk Behavior; one distance unit across Settings', async () => {
    await openSettingsSection(page, SETTINGS_SECTION.talkBehavior);
    await expect(page.locator('[data-testid="settings-talk-audience-everyone"]')).toBeChecked();
    await page.locator('[data-testid="settings-talk-audience-residents"]').check();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}').residentsOnlyTalks))
      .toBe(true);
    await backToSettingsMenu(page);

    await openSettingsSection(page, SETTINGS_SECTION.appearance);
    await page.locator('[data-testid="settings-distance-unit"]').selectOption('mi');
    await openLocation();
    await expect(page.locator('#settings-nearby-privacy-mode option[value="regional"]')).toContainText('mi');
    await expect(page.locator('#settings-nearby-privacy-mode option[value="regional"]')).not.toContainText('km');
  });
});
