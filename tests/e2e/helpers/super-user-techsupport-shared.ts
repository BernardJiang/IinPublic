import { expect, Page } from '@playwright/test';
import type { Browser, BrowserContext } from '@playwright/test';
import { injectIdbClear } from './clear-database';
import { ensureWindowFitsViewport } from './browser-window';
import { afterLoad, afterNav, afterAction, afterSync } from './timing';
import { webBaseURL } from './ports';
import { syncIncomingFromServer, waitForIncomingTalkClusterOnServer } from './talks-matching-flow';

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
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 640, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on('console', (msg) => console.log(`[${label}]:`, msg.text()));
  await injectIdbClear(page);
  await page.goto(webBaseURL());
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

  const headerStageName = page.locator('[data-testid="user-stage-name"]');
  await expect(headerStageName).toContainText(stageName);

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

/** Open an incoming row via View (reliable with Gun/backend-synced IN list). */
export async function openTomIncomingModal(
  page: Page,
  titleSubstring: string,
  typeBadge: 'tag' | 'flow',
): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await afterNav();
  await waitForIncomingTalkClusterOnServer(page, titleSubstring);
  await syncIncomingFromServer(page);
  await afterAction();
  const row = page
    .locator(`.talk-list-item[data-role="incoming"][data-incoming-type="${typeBadge}"]`)
    .filter({ hasText: titleSubstring })
    .first();
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      await expect(row).toBeVisible({ timeout: 12000 });
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
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.locator('button.view-talk-btn').click();
  await page.waitForSelector('#talk-response-modal .modal-content', { timeout: 30000 });
}
