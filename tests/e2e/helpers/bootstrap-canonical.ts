import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {injectIdbClear, gotoWebApp} from './clear-database';
import { ensureWindowFitsViewport } from './browser-window';
import { afterLoad, afterNav, afterSync } from './timing';
import { webAppURLStableChatroom } from './ports';
import { attachE2eBrowserTabLabel } from './e2e-tab-title';
import { isStagePipeline, stageStoragePath, type E2eStageName } from './e2e-stage-pipeline';
import { TECHSUPPORT, ADAM, EVE } from './canonical-users';
import { assertStatusChecks } from './e2e-status-checks';
import { TECHSUPPORT_ROOT_USER_ID, TECHSUPPORT_STAGE_NAME } from '../../../src/shared/techsupport';
import { attachFilteredConsoleLog } from './e2e-console';
import {
  expectCurrentUserIsOrdinaryUser,
  expectCurrentUserIsTechSupportRoot,
} from './techsupport-contract';

export type BootstrapOptions = {
  /** Skip IndexedDB clear (restoring storage state). */
  skipIdbClear?: boolean;
  /** Restore Playwright storage from a saved stage user file. */
  storageStatePath?: string;
  viewport?: { width: number; height: number };
};

export async function expectTechSupportGreetingReceived(page: Page, stageName?: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ techSupportId, name }) => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return Object.values(conversations).some((conversation: any) => {
              const message = String(conversation?.lastMessage || '');
              return (
                conversation?.supportChannel === true &&
                conversation?.otherUserId === techSupportId &&
                message.includes('Welcome to IinPublic') &&
                (!name || message.includes(name))
              );
            });
          },
          { techSupportId: TECHSUPPORT_ROOT_USER_ID, name: stageName || '' },
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}

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
  attachFilteredConsoleLog(page, label);

  if (!hasStorageState && !options?.skipIdbClear) {
    await injectIdbClear(page);
  }
  if (!hasStorageState && stageName === TECHSUPPORT_STAGE_NAME) {
    await page.addInitScript((rootUserId) => {
      window.localStorage.setItem('iinpublic_user_id', rootUserId);
    }, TECHSUPPORT_ROOT_USER_ID);
  }

  await gotoWebApp(page, webAppURLStableChatroom());
  await ensureWindowFitsViewport(page, viewport.width, viewport.height);
  await afterLoad();

  if (!hasStorageState && stageName !== TECHSUPPORT_STAGE_NAME) {
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

  if (stageName === TECHSUPPORT_STAGE_NAME) {
    await expectCurrentUserIsTechSupportRoot(page);
  } else {
    await expectCurrentUserIsOrdinaryUser(page, stageName);
    await expectTechSupportGreetingReceived(page);
  }

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
