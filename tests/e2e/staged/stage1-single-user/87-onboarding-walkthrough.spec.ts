/**
 * First-run walkthrough regression coverage.
 *
 * Automated E2E bundles suppress the automatic modal so feature-agnostic specs can
 * interact with the app shell. This spec explicitly opts in and proves that the real
 * first-run, once-per-device, and Settings replay paths remain covered.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { afterNav, reloadAppReady } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';

test.describe('First-run walkthrough', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

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

  test('opens once automatically, stays dismissed, and remains replayable from Settings', async () => {
    const p = page!;
    const url = new URL(webAppURLStableChatroom());
    url.searchParams.set('e2e_walkthrough', '1');

    await gotoWebApp(p, url.toString());
    await expect(p).toHaveTitle(/IinPublic — Build Your Digital You$/);

    const modal = p.locator('[data-testid="walkthrough-modal"]');
    await expect(modal).toBeVisible();
    await expect(p.locator('[data-testid="walkthrough-step-0"]')).toBeVisible();
    await expect(p.locator('#walkthrough-title')).toHaveText('Welcome to IinPublic');
    await expect(p.locator('[data-testid="walkthrough-tagline"]')).toHaveText(
      'Talk to hundreds of people about hundreds of topics—simultaneously.',
    );

    await p.locator('[data-testid="walkthrough-next-btn"]').click();
    await expect(p.locator('[data-testid="walkthrough-step-1"]')).toBeVisible();
    await expect(p.locator('#walkthrough-title')).toHaveText('Chatrooms');
    await p.locator('[data-testid="walkthrough-next-btn"]').click();
    await expect(p.locator('[data-testid="walkthrough-tagline"]')).toHaveText('Talks are mini-programs you write in natural language.');
    await expect(p.locator('[data-testid="walkthrough-points"]')).toContainText(
      'A chatbot that repeats you—not invents you. It reuses your approved answer when the same exact question returns.',
    );
    await expect(p.locator('[data-testid="walkthrough-points"]')).toContainText("You only need to answer what's new.");
    await p.locator('[data-testid="walkthrough-skip-btn"]').click();

    await expect(modal).toHaveCount(0);
    await expect.poll(() => p.evaluate(() => localStorage.getItem('iinpublic_walkthrough_seen'))).toBe('true');

    await reloadAppReady(p);
    await expect(modal).toHaveCount(0);

    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('#talks-list')).toContainText('One answer. Hundreds of conversations.');
    await p.locator('#create-talk-btn').click();
    await expect(p.locator('.talk-editor-promise')).toHaveText('Write conversations, not code.');
    await p.locator('#cancel-talk-btn').click();

    await p.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await expect(p.locator('[data-testid="contacts-product-promise"]')).toHaveText(
      'Find people through what matters to you.',
    );

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('[data-testid="settings-product-promise"]')).toHaveText(
      'Your identity. Your answers. Your data.',
    );
    await openSettingsSection(p, SETTINGS_SECTION.help);
    await p.locator('[data-testid="settings-replay-walkthrough-btn"]').click();
    await expect(modal).toBeVisible();
    await p.locator('[data-testid="walkthrough-dot-4"]').click();
    await expect(p.locator('[data-testid="walkthrough-tagline"]')).toHaveText(
      'Build your digital you, one answer at a time.',
    );
    await p.locator('[data-testid="walkthrough-dot-5"]').click();
    await expect(p.locator('[data-testid="walkthrough-points"]')).toContainText(
      'Your reputation is earned from others. You decide how much to show.',
    );
    await expect(p.locator('[data-testid="walkthrough-points"]')).toContainText(
      'Choose what reaches you. Block who can reach you. Everyone else has the same control.',
    );

    await p.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
  });
});
