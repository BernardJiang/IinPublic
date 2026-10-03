/** First-run handoff to removable demo contacts and their ordinary incoming Talks. */
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

  test('opens demo-contact Talks, returns from the reference tour, and lets a bot be removed', async () => {
    const p = page!;
    const url = new URL(webAppURLStableChatroom());
    url.searchParams.set('e2e_walkthrough', '1');
    await gotoWebApp(p, url.toString());
    await expect(p).toHaveTitle(/IinPublic — Build Your Digital You$/);

    const guide = p.locator('[data-testid="actionable-guide-modal"]');
    await expect(guide).toBeVisible();
    await expect(guide).toContainText('Your demo contacts sent a few Talks.');

    await p.locator('[data-testid="actionable-guide-product-tour"]').click();
    await expect(p.locator('[data-testid="walkthrough-modal"]')).toBeVisible();
    await expect(guide).toBeHidden();
    await p.keyboard.press('Escape');
    await expect(guide).toBeVisible();

    await p.locator('[data-testid="actionable-guide-next"]').click();
    await expect(guide).toHaveCount(0);
    await expect(p.locator('#talks-view')).toHaveClass(/active/);
    await expect(p.locator('.talk-list-item[data-role="incoming"]')).toHaveCount(7);
    await expect.poll(() => p.evaluate(() => localStorage.getItem('iinpublic_actionable_guide_seen_v1'))).toBe('true');

    await p.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await expect(p.locator('.starter-practice-contact')).toHaveCount(4);
    await p.locator('.starter-practice-contact[data-starter-contact-id="tag-guide"] .starter-contact-remove').click();
    await expect(p.locator('.starter-practice-contact')).toHaveCount(3);

    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('.talk-list-item[data-role="incoming"]')).toHaveCount(3);

    await reloadAppReady(p);
    await expect(guide).toHaveCount(0);
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.help);
    await expect(p.locator('[data-testid="settings-start-guide-btn"]')).toHaveText('Build my digital you');
  });

  test('keeps the one-step guide usable at a 320px phone width', async () => {
    const p = page!;
    await p.setViewportSize({ width: 320, height: 700 });
    const url = new URL(webAppURLStableChatroom());
    url.searchParams.set('e2e_walkthrough', '1');
    await gotoWebApp(p, url.toString());

    await expect(p.locator('[data-testid="actionable-guide-next"]')).toBeInViewport();
    const widths = await p.locator('[data-testid="actionable-guide-modal"]').evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    await p.locator('[data-testid="actionable-guide-next"]').click();
    await expect(p.locator('.talk-list-item[data-role="incoming"]')).toHaveCount(7);
  });
});
