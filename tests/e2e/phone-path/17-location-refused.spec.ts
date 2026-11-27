/**
 * J-START-04 on the phone route (docs/testing/journey-coverage.md): a person who refuses location
 * is not stuck. The phone path serves the production bundle, so the real permission path runs (the
 * web version, platform-smoke/02, needs a production build too). With no location permission the
 * app still starts; after the GPS wait it places the person as a Traveler ✈ at a random point in
 * Nearby, invents no cached fix, and Settings offers "Use my location". The real-phone version,
 * native-app/35, also taps that button through Android's dialog (OPEN-121).
 */
import { expect, test } from '@playwright/test';
import { openSettingsSection, SETTINGS_SECTION } from '../helpers/settings-nav';
import { closeUsers, openUser, resetPhonePath, type JourneyUser } from './phone-path-helpers';

test.describe('Location refused on a phone', () => {
  let alice: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(alice);
    alice = undefined;
  });

  test('J-START-04: no location permission → a usable Traveler with "Use my location"', async ({ browser }) => {
    test.setTimeout(240_000);
    alice = await openUser(browser, 'Alice', 'phoneA', { denyLocation: true });
    const page = alice.page;
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const encounter = localStorage.getItem('iinpublic_encounter_location_v1');
      return {
        room: String(app?.currentChatroomId || ''),
        traveler: app?.appearsAsTraveler?.() === true,
        randomPoint: encounter ? JSON.parse(encounter).auto === true : false,
      };
    }), { timeout: 60_000, message: 'placed as a random-point Traveler in Nearby' })
      .toEqual({ room: 'nearby-v3', traveler: true, randomPoint: true });
    expect(await page.evaluate(() => localStorage.getItem('iinpublic_cached_location'))).toBeNull();
    await expect(page.locator('body')).not.toContainText('Oops! Something went wrong');

    // An explicit refusal opens the place picker so the person can choose a point; they cancel it
    // and stay the random-point Traveler. (Firefox's unanswered prompt in platform-smoke/02 takes the
    // 15 s path instead, without the picker.)
    const picker = page.locator('#encounter-location-modal');
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await page.locator('#encounter-location-cancel').click();
    await expect(picker).toBeHidden({ timeout: 10_000 });
    expect(await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.appearsAsTraveler?.() === true)).toBe(true);

    // Settings offers to ask again.
    await page.locator('.nav-btn[data-view="settings"]').evaluate((element) => (element as HTMLElement).click());
    await openSettingsSection(page, SETTINGS_SECTION.distanceHome);
    await expect(page.locator('[data-testid="settings-use-my-location"]')).toBeVisible({ timeout: 30_000 });

    // Still usable: every tab opens.
    for (const view of ['chatrooms', 'contacts', 'talks', 'me'] as const) {
      await page.locator(`.nav-btn[data-view="${view}"]`).evaluate((element) => (element as HTMLElement).click());
      await expect(page.locator(`.nav-btn[data-view="${view}"].active`)).toBeVisible({ timeout: 10_000 });
    }
  });
});
