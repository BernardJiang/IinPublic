/** First-run product introduction plus removable demo contacts and their incoming Talks. */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { afterNav, reloadAppReady } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';

test.describe('First-run introduction', () => {
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

  test('introduces digital you first, then lets a demo contact be removed', async () => {
    const p = page!;
    const url = new URL(webAppURLStableChatroom());
    url.searchParams.set('e2e_walkthrough', '1');
    await gotoWebApp(p, url.toString());
    await expect(p).toHaveTitle(/IinPublic — Build Your Digital You$/);

    const introduction = p.locator('[data-testid="walkthrough-modal"]');
    await expect(introduction).toBeVisible();
    await expect(p.locator('[data-testid="walkthrough-step-0"]')).toContainText('Build your digital you');
    await expect(p.locator('[data-testid="walkthrough-tagline"]')).toHaveText('Say it once. Let your digital you repeat it.');
    await expect(p.locator('[data-testid="walkthrough-step-0"]')).toContainText('Ask or answer once');
    await expect(p.locator('[data-testid="walkthrough-step-0"]')).toContainText('automatically reuse');
    await expect(p.locator('[data-testid="walkthrough-step-0"]')).toContainText("handle what's new");
    await expect(p.locator('[data-testid="walkthrough-skip-btn"]')).toHaveCount(0);
    await expect(p.locator('[data-testid="walkthrough-back-btn"]')).toHaveCount(0);

    await p.locator('[data-testid="walkthrough-next-btn"]').click();
    await expect(p.locator('[data-testid="walkthrough-step-1"]')).toBeVisible();
    await expect(p.locator('[data-testid="walkthrough-step-1"]')).toContainText('Broadcast your Talks');
    await expect(p.locator('[data-testid="walkthrough-step-1"]')).toContainText("Receive others' Talks");
    await expect(p.locator('[data-testid="walkthrough-back-btn"]')).toBeVisible();
    await p.locator('[data-testid="walkthrough-next-btn"]').click();
    await expect(p.locator('[data-testid="walkthrough-step-2"]')).toContainText('Contacts');
    await p.locator('[data-testid="walkthrough-next-btn"]').click();
    await expect(p.locator('[data-testid="walkthrough-step-3"]')).toContainText('Create questions for your digital you to ask on your behalf.');
    await expect(p.locator('[data-testid="walkthrough-step-3"]')).toContainText('Create and answer questions in one place');
    await expect(p.locator('[data-testid="walkthrough-step-3"]')).toContainText('Answer your own questions to share what you think.');
    await expect(p.locator('[data-testid="walkthrough-step-3"]')).toContainText('Respond to questions you receive from others.');
    await p.locator('[data-testid="walkthrough-back-btn"]').click();
    await expect(p.locator('[data-testid="walkthrough-step-2"]')).toBeVisible();
    await p.locator('[data-testid="walkthrough-close-btn"]').click();
    await expect(introduction).toHaveCount(0);
    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
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
    await expect(introduction).toHaveCount(0);
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.help);
    await expect(p.locator('[data-testid="settings-start-guide-btn"]')).toHaveText('Build my digital you');
  });

  test('keeps the introduction usable at a 320px phone width', async () => {
    const p = page!;
    await p.setViewportSize({ width: 320, height: 700 });
    const url = new URL(webAppURLStableChatroom());
    url.searchParams.set('e2e_walkthrough', '1');
    await gotoWebApp(p, url.toString());

    await expect(p.locator('[data-testid="walkthrough-next-btn"]')).toBeInViewport();
    await expect(p.locator('[data-testid="walkthrough-tagline"]')).toHaveText('Say it once. Let your digital you repeat it.');
    const widths = await p.locator('[data-testid="walkthrough-modal"]').evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    await p.locator('[data-testid="walkthrough-close-btn"]').click();
    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('.talk-list-item[data-role="incoming"]')).toHaveCount(7);
  });
});
