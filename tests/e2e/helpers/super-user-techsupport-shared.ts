import { expect, Page } from '@playwright/test';
import type { Browser, BrowserContext } from '@playwright/test';
import { gotoWebApp, injectIdbClear } from './clear-database';
import { ensureWindowFitsViewport } from './browser-window';
import { afterLoad, afterNav, afterAction, afterSync } from './timing';
import { webAppURLStableChatroom } from './ports';
import { wait } from './timing';
import { syncIncomingFromServer, waitForIncomingTalkClusterOnServer } from './talks-matching-flow';
import { attachE2eBrowserTabLabel } from './e2e-tab-title';
import { TECHSUPPORT_ROOT_USER_ID, TECHSUPPORT_STAGE_NAME } from '../../../src/shared/techsupport';
import { attachFilteredConsoleLog } from './e2e-console';
import {
  expectCurrentUserIsOrdinaryUser,
  expectCurrentUserIsTechSupportRoot,
} from './techsupport-contract';

export const TECH_SUPPORT_NAME = 'TechSupport';
export const TOM_NAME = 'Tom';

export const TAG_NAMES = [
  'Coffee',
  'Cat',
  'Tennis',
  'Jobs',
  'Food',
  'Music',
  'Travel',
  'Books',
  'Movies',
  'Sports',
];

export const TALK_TITLES = [
  'Tennis Partner',
  'Coffee Meetup',
  'Job Search',
  'Foodie',
  'Music Lover',
  'Travel Buddy',
  'Book Club',
  'Movie Night',
  'Sports Fan',
  'Hiking',
];

export const MATCH_ANSWER = 'Yes, match.';
export const IGNORE_ANSWER = 'No thanks.';

export async function bootstrapSuperUser(
  browser: Browser,
  label: string,
  stageName: string,
  // See bootstrapUser() in talks-matching-flow.ts — same oversubscribed-worker rationale.
  appReadyTimeoutMs?: number,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 640, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  attachFilteredConsoleLog(page, label);
  await injectIdbClear(page);
  if (stageName === TECHSUPPORT_STAGE_NAME) {
    await page.addInitScript((rootUserId) => {
      window.localStorage.setItem('iinpublic_user_id', rootUserId);
    }, TECHSUPPORT_ROOT_USER_ID);
  }
  try {
    await gotoWebApp(page, webAppURLStableChatroom(), appReadyTimeoutMs);
  } catch {
    await wait(1500, 2000);
    await gotoWebApp(page, webAppURLStableChatroom(), appReadyTimeoutMs);
  }
  await ensureWindowFitsViewport(page, 640, 1000);
  await afterLoad();

  if (stageName !== TECHSUPPORT_STAGE_NAME) {
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.waitForSelector(
      '#settings-stage-name-input',
      appReadyTimeoutMs ? { timeout: appReadyTimeoutMs } : undefined,
    );
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
  }

  const headerStageName = page.locator('[data-testid="user-stage-name"]');
  await expect(headerStageName).toContainText(
    stageName,
    appReadyTimeoutMs ? { timeout: appReadyTimeoutMs } : undefined,
  );
  if (stageName === TECHSUPPORT_STAGE_NAME) {
    await expectCurrentUserIsTechSupportRoot(page);
  } else {
    await expectCurrentUserIsOrdinaryUser(page, stageName);
  }

  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  attachE2eBrowserTabLabel(page, label);
  return { context, page };
}

export async function waitForTabActive(
  page: Page,
  view: 'chatrooms' | 'talks' | 'contacts' | 'answers' | 'me',
): Promise<void> {
  await expect(page.locator(`.nav-btn[data-view="${view}"].active`)).toBeVisible({ timeout: 10000 });
}

const TOM_INCOMING_SERVER_WAIT_MS = 120_000;
const TOM_INCOMING_ROW_POLL_MS = 5000;
const TOM_INCOMING_ROW_FINAL_MS = 12_000;
const TOM_RESPONSE_MODAL_MS = 20_000;
const TOM_INCOMING_NAV_DEADLINE_MS = 180_000;

/** Open an incoming row via View (reliable with Gun/backend-synced IN list). */
export async function openTomIncomingModal(
  page: Page,
  titleSubstring: string,
  typeBadge: 'tag' | 'flow',
): Promise<void> {
  const talksNav = page.locator('.nav-btn[data-view="talks"]');
  if (!(await talksNav.evaluate((el) => el.classList.contains('active')))) {
    await talksNav.click();
    await waitForTabActive(page, 'talks');
    await afterNav();
  } else {
    await waitForTabActive(page, 'talks');
  }
  // Server mirror can lag under heavy 20-talk overlap; use as a hint, not a hard gate.
  await waitForIncomingTalkClusterOnServer(page, titleSubstring, {
    timeout: TOM_INCOMING_SERVER_WAIT_MS,
    polling: 400,
  }).catch(() => {});
  await syncIncomingFromServer(page);
  await afterAction();
  const row = page
    .locator(`.talk-list-item[data-role="incoming"][data-incoming-type="${typeBadge}"]`)
    .filter({ hasText: titleSubstring })
    .first();
  const deadline = Date.now() + TOM_INCOMING_NAV_DEADLINE_MS;
  while (Date.now() < deadline) {
    try {
      await row.waitFor({ state: 'visible', timeout: TOM_INCOMING_ROW_POLL_MS });
      break;
    } catch {
      await syncIncomingFromServer(page);
      await page.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(page, 'chatrooms');
      await afterAction();
      await page.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(page, 'talks');
      await afterSync();
    }
  }
  await expect(row).toBeVisible({ timeout: TOM_INCOMING_ROW_FINAL_MS });
  await row.locator('button.view-talk-btn').click();
  await page.waitForSelector('#talk-response-modal .modal-content', { timeout: TOM_RESPONSE_MODAL_MS });
}
