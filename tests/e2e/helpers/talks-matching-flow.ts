import { expect, Browser, BrowserContext, Page } from '@playwright/test';
import { clearGunDatabases } from './clear-database';
import { ensureWindowFitsViewport } from './browser-window';
import { afterLoad, afterNav, afterAction, afterSync } from './timing';

export async function bootstrapUser(
  browser: Browser,
  label: string,
  stageName: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 640, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on('console', (m) => console.log(`[${label}]:`, m.text()));
  await page.goto('/');
  await page.waitForLoadState('load');
  await ensureWindowFitsViewport(page, 640, 1000);
  await afterLoad();
  await page.click('.nav-btn[data-view="me"]');
  await afterNav();
  await page.waitForSelector('#edit-stagename-btn');
  await page.click('#edit-stagename-btn');
  await afterAction();
  await page.fill('#new-stage-name', stageName);
  await page.click('#edit-stagename-form button[type="submit"]');
  await afterNav();
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  return { context, page };
}

export async function waitForTabActive(
  page: Page,
  view: 'chatrooms' | 'talks' | 'contacts' | 'answers' | 'me',
): Promise<void> {
  await expect(page.locator(`.nav-btn[data-view="${view}"].active`)).toBeVisible({ timeout: 10000 });
}

export async function waitForResponseModalClosed(page: Page): Promise<void> {
  await page.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 15000 });
}

/** Open an incoming talk via the View button (more reliable than row click for Gun-synced rows). */
export async function openIncomingTalkModal(page: Page, titleSubstring: string): Promise<void> {
  await afterSync();
  const row = page.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: titleSubstring });
  await expect(row.first()).toBeVisible({ timeout: 45000 });
  await row.first().locator('button.view-talk-btn').click();
  await page.waitForSelector('#talk-response-modal .modal-content', { timeout: 25000 });
}

/** Close pages/contexts, manualCleanup, clear Gun — use in beforeEach for multi-user talks suites. */
export async function resetTalksMatchingSession(
  pages: { tom?: Page; jerry?: Page; bob?: Page },
  contexts: { tom?: BrowserContext; jerry?: BrowserContext; bob?: BrowserContext },
): Promise<void> {
  const closePage = async (p?: Page) => {
    if (!p) return;
    try {
      await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
    } catch {}
    await p.close().catch(() => {});
  };
  await closePage(pages.tom);
  await closePage(pages.jerry);
  await closePage(pages.bob);
  await contexts.tom?.close().catch(() => {});
  await contexts.jerry?.close().catch(() => {});
  await contexts.bob?.close().catch(() => {});
  await clearGunDatabases();
}

export async function finalCleanupPages(
  pages: { tom?: Page; jerry?: Page; bob?: Page },
  contexts: { tom?: BrowserContext; jerry?: BrowserContext; bob?: BrowserContext },
): Promise<void> {
  const cleanup = async (p?: Page) => {
    if (!p) return;
    try {
      await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    } catch {}
  };
  await cleanup(pages.tom);
  await cleanup(pages.jerry);
  await cleanup(pages.bob);
  await pages.tom?.close();
  await pages.jerry?.close();
  await pages.bob?.close();
  await contexts.tom?.close();
  await contexts.jerry?.close();
  await contexts.bob?.close();
}
