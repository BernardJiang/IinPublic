/**
 * Actionable first-run guide plus the optional product-reference tour.
 *
 * Most E2E bundles suppress automatic onboarding so unrelated specs can use the app shell. This
 * spec opts in and covers the real once-per-device entry, local-only practice boundary, tour
 * return path, empty-Talk practice bots, Settings replay actions, and narrow-phone layout.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { afterNav, reloadAppReady } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';

test.describe('Actionable first-run guide', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
    await injectIdbClear(page);
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('chooses a practice bot, returns from the reference tour, and opens a local exercise', async () => {
    const p = page!;
    const url = new URL(webAppURLStableChatroom());
    url.searchParams.set('e2e_walkthrough', '1');
    await gotoWebApp(p, url.toString());
    await expect(p).toHaveTitle(/IinPublic — Build Your Own Bot$/);

    const guide = p.locator('[data-testid="actionable-guide-modal"]');
    await expect(guide).toBeVisible();
    await expect(p.locator('[data-testid="actionable-guide-step-0"]')).toContainText(
      'Build your own bot—one answer at a time.',
    );
    await p.locator('[data-testid="actionable-guide-next"]').click();
    await expect(p.locator('.actionable-starter-card')).toHaveCount(3);
    await p.locator('[data-testid="actionable-starter-echo"]').click();
    await p.locator('[data-testid="actionable-guide-next"]').click();
    await expect(p.locator('[data-testid="actionable-choice-preview"]')).toHaveText('Echo Bot');

    await p.locator('[data-testid="actionable-guide-product-tour"]').click();
    await expect(p.locator('[data-testid="walkthrough-modal"]')).toBeVisible();
    await expect(guide).toBeHidden();
    await p.keyboard.press('Escape');
    await expect(p.locator('[data-testid="walkthrough-modal"]')).toHaveCount(0);
    await expect(guide).toBeVisible();
    await expect(p.locator('[data-testid="actionable-choice-preview"]')).toHaveText('Echo Bot');

    const talksBefore = await p.evaluate(() => localStorage.getItem('myTalks'));
    await p.locator('[data-testid="actionable-guide-next"]').click();
    await expect(guide).toHaveCount(0);
    await expect(p.locator('#talk-response-modal')).toBeVisible();
    await expect(p.locator('#talk-response-modal')).toContainText('Echo Bot: Teach me one answer');
    expect(await p.evaluate(() => localStorage.getItem('myTalks'))).toBe(talksBefore);
    await expect.poll(() => p.evaluate(() => localStorage.getItem('iinpublic_actionable_guide_seen_v1'))).toBe('true');
    await p.locator('[data-testid="close-response-btn"]').click();

    await reloadAppReady(p);
    await expect(guide).toHaveCount(0);

    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('[data-testid="talks-starter-shelf"]')).toBeVisible();
    await expect(p.locator('.starter-practice-card')).toHaveCount(3);

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.help);
    await expect(p.locator('[data-testid="settings-start-guide-btn"]')).toBeVisible();
    await expect(p.locator('[data-testid="settings-replay-walkthrough-btn"]')).toHaveText('How IinPublic works');
    await p.locator('[data-testid="settings-replay-walkthrough-btn"]').click();
    await expect(p.locator('[data-testid="walkthrough-modal"]')).toBeVisible();
    await p.keyboard.press('Escape');
    await p.locator('[data-testid="settings-start-guide-btn"]').click();
    await expect(guide).toBeVisible();
    await p.locator('[data-testid="actionable-guide-close"]').click();
  });

  test('keeps custom text and controls usable at a 320px phone width', async () => {
    const p = page!;
    await p.setViewportSize({ width: 320, height: 700 });
    const url = new URL(webAppURLStableChatroom());
    url.searchParams.set('e2e_walkthrough', '1');
    await gotoWebApp(p, url.toString());

    await p.locator('[data-testid="actionable-guide-next"]').click();
    await p.locator('[data-testid="actionable-custom-prompt"]').fill('Would anyone like to practice Spanish together?');
    await p.locator('[data-testid="actionable-guide-next"]').click();
    await expect(p.locator('[data-testid="actionable-choice-preview"]')).toHaveText(
      'Would anyone like to practice Spanish together?',
    );
    await expect(p.locator('[data-testid="actionable-guide-next"]')).toBeInViewport();
    const widths = await p.locator('[data-testid="actionable-guide-modal"]').evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);

    await p.locator('[data-testid="actionable-guide-next"]').click();
    await expect(p.locator('#talk-title')).toHaveValue('Would anyone like to practice Spanish together?');
    expect(await p.evaluate(() => localStorage.getItem('myTalks'))).toBeNull();
  });
});
