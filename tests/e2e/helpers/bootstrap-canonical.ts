import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { injectIdbClear } from './clear-database';
import { ensureWindowFitsViewport } from './browser-window';
import { afterLoad, afterNav, afterSync } from './timing';
import { webAppURLStableChatroom } from './ports';
import { attachE2eBrowserTabLabel } from './e2e-tab-title';
import { isStagePipeline, stageStoragePath, type E2eStageName } from './e2e-stage-pipeline';
import { TECHSUPPORT, ADAM, EVE } from './canonical-users';
import { assertStatusChecks } from './e2e-status-checks';

export type BootstrapOptions = {
  /** Skip IndexedDB clear (restoring storage state). */
  skipIdbClear?: boolean;
  /** Restore Playwright storage from a saved stage user file. */
  storageStatePath?: string;
  viewport?: { width: number; height: number };
};

export async function bootstrapCanonicalUser(
  browser: Browser,
  label: string,
  stageName: string,
  options?: BootstrapOptions,
): Promise<{ context: BrowserContext; page: Page }> {
  const viewport = options?.viewport ?? { width: 640, height: 1000 };
  const hasStorageState = !!options?.storageStatePath && fs.existsSync(options.storageStatePath);
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    ...(hasStorageState
      ? { storageState: options.storageStatePath }
      : {}),
  });
  const page = await context.newPage();
  page.on('console', (m) => console.log(`[${label}]:`, m.text()));

  if (!hasStorageState && !options?.skipIdbClear) {
    await injectIdbClear(page);
  }

  await page.goto(webAppURLStableChatroom());
  await page.waitForLoadState('load');
  await ensureWindowFitsViewport(page, viewport.width, viewport.height);
  await afterLoad();

  if (!hasStorageState) {
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await expect
      .poll(
        () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? ''),
        { timeout: 15_000 },
      )
      .toBe(stageName);
  }

  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();

  await assertStatusChecks(page, [
    { kind: 'headerStageName', name: stageName },
    { kind: 'navActive', view: 'chatrooms' },
  ]);

  attachE2eBrowserTabLabel(page, label);
  return { context, page };
}

export async function bootstrapTechSupport(browser: Browser, label = 'TechSupport'): Promise<{ context: BrowserContext; page: Page }> {
  const storage = isStagePipeline() ? stageStoragePath('stage0', 'techsupport') : undefined;
  return bootstrapCanonicalUser(browser, label, TECHSUPPORT, {
    storageStatePath: storage,
    skipIdbClear: !!storage,
  });
}

export async function bootstrapAdam(browser: Browser, label = 'Adam'): Promise<{ context: BrowserContext; page: Page }> {
  const storage = isStagePipeline() ? stageStoragePath('stage2', 'adam') : undefined;
  return bootstrapCanonicalUser(browser, label, ADAM, {
    storageStatePath: storage,
    skipIdbClear: !!storage,
  });
}

export async function bootstrapEve(browser: Browser, label = 'Eve'): Promise<{ context: BrowserContext; page: Page }> {
  const storage = isStagePipeline() ? stageStoragePath('stage3', 'eve') : undefined;
  return bootstrapCanonicalUser(browser, label, EVE, {
    storageStatePath: storage,
    skipIdbClear: !!storage,
  });
}

export async function saveUserStorageState(
  context: BrowserContext,
  stage: E2eStageName,
  userKey: string,
): Promise<void> {
  const file = stageStoragePath(stage, userKey);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await context.storageState({ path: file });
}
