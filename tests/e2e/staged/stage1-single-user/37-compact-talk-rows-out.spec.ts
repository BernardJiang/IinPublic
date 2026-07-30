/**
 * TODO §M2 (OUT row): flow/survey/route rows collapse to 2 visible lines (title+badges,
 * status+inline icon actions) with everything else (language badge, expiration, location,
 * rank/weighted-score) moved into a hidden .talk-item-details, opened on demand via the "ℹ️"
 * icon into a shared popup. Inline icon actions (broadcast toggle, survey-stats, remove) fire
 * on a single click with no prior row-selection step — verifying Bernard's 2026-07-29 actions
 * requirement isn't broken by the layout change. Tag rows are intentionally excluded: they're
 * already a simpler single-line chip branch, not touched by this item.
 */
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../../helpers/many-browsers';
import { createTalkFromCompanyPage } from '../../helpers/talk-demo-ui';
import { makeFlowTalk, makeSurveyTalk, makeRouteTalk } from '../../talks-matching/lib/four-types-talks';
import type { Browser, BrowserContext, Page } from '@playwright/test';

type Session = { label: string; context: BrowserContext; page: Page };

test.describe('Compact talk rows (M2) — OUT row 2-line collapse + popup details', () => {
  test.setTimeout(120_000);

  let browsers: Browser[] = [];
  const sessions: Session[] = [];

  test.beforeAll(async () => {
    await clearGunForStage1Spec();
    browsers = await launchBrowserGrid(1);
  });

  test.afterAll(async () => {
    await disposeE2eSessionList(sessions);
    await shutdownBrowserGrid(browsers);
    await clearGunForStage1Spec();
  });

  test('flow/survey/route OUT rows: 2 visible lines, no dedicated actions row, popup shows moved fields, icons act on first click', async () => {
    const runId = Date.now();
    const tom = await bootstrapUser(browsers[0]!, 'Tom', 'Tom');
    sessions.push({ label: 'Tom', context: tom.context, page: tom.page });
    const page = tom.page;

    const flowTalk = makeFlowTalk(runId);
    const surveyTalk = makeSurveyTalk(runId);
    const routeTalk = makeRouteTalk(runId);

    await createTalkFromCompanyPage(page, flowTalk);
    await page.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(page, 'chatrooms');
    await createTalkFromCompanyPage(page, surveyTalk);
    await page.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(page, 'chatrooms');
    await createTalkFromCompanyPage(page, routeTalk);

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');

    for (const talk of [flowTalk, surveyTalk, routeTalk]) {
      const row = page.locator('.talk-list-item[data-role="created"]').filter({ hasText: talk.title });
      await expect(row).toBeVisible({ timeout: 15_000 });

      // Exactly the 2 visible lines: header + status-line. Details stays hidden until opened.
      await expect(row.locator('.talk-item-header')).toBeVisible();
      await expect(row.locator('.talk-item-status-line')).toBeVisible();
      await expect(row.locator('.talk-item-details')).toBeHidden();
      // No dedicated actions row remains.
      await expect(row.locator('.talk-item-actions')).toHaveCount(0);

      // Details popup: opens on first click of the "ℹ️" icon, shows the moved-out fields.
      await row.locator('.talk-details-btn').click();
      const popup = page.locator('#item-details-popup');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await expect(popup.locator('.talk-item-meta').first()).toBeVisible();
      await expect(popup).toContainText('Expir');

      // Closing the popup restores the details node to the row, hidden again.
      await popup.locator('#close-item-details-popup').click();
      await expect(popup).toHaveCount(0);
      await expect(row.locator('.talk-item-details')).toBeHidden();
      await expect(row.locator('.talk-item-details')).toHaveCount(1);

      // Broadcast-toggle icon fires immediately on a single click — no prior selection step.
      const toggle = row.locator('.talk-broadcast-toggle-btn');
      await expect(toggle).toHaveAttribute('data-broadcast-enabled', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('data-broadcast-enabled', 'false');
      await expect(row).toHaveClass(/talk-broadcast-disabled/);
    }

    // Survey-stats icon: single click opens the stats dialog directly, no prior selection.
    const surveyRow = page.locator('.talk-list-item[data-role="created"]').filter({ hasText: surveyTalk.title });
    await surveyRow.locator('.survey-stats-btn').click();
    await expect(page.locator('#survey-stats-body')).toBeVisible({ timeout: 10_000 });
    await page.locator('#survey-stats-close-btn').click();

    // Remove icon: single click removes the row immediately, no confirmation step.
    const routeRow = page.locator('.talk-list-item[data-role="created"]').filter({ hasText: routeTalk.title });
    await routeRow.locator('.remove-talk-btn').click();
    await expect(routeRow).toHaveCount(0, { timeout: 10_000 });
  });
});
