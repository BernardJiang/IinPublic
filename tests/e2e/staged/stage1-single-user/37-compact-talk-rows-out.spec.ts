/**
 * Outgoing flow/survey/route rows collapse to 2 visible lines: header (broadcast checkbox +
 * type icon badge, title, chevron) and a status-line summary (stats + relative time). No
 * dedicated action-icon row — 🗑️ delete is now a swipe-left gesture, ℹ️ details is a long-press
 * (no drag), and 📊 survey results moved from its own button into the details popup, reached the
 * same way. The broadcast toggle is the one persistent explicit control, now a real checkbox
 * (same widget the tag pill's own checkbox uses) instead of a button, firing on 'change' with no
 * prior selection step. Tag rows are intentionally excluded: they're already a simpler
 * single-line chip branch, not touched by this item.
 */
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser, waitForTabActive, longPressTalkRow, dragTalkRow } from '../../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../../helpers/many-browsers';
import {
  createFlowOrSurveyTalkViaEditor,
  createRouteTalkViaEditor,
  talkQuestionsToUiSpec,
  talkRouteQuestionsToUiSpec,
} from '../../helpers/talk-demo-ui';
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

  test('flow/survey/route OUT rows: 2 visible lines, no dedicated actions row, popup shows moved fields, checkbox toggles on change', async () => {
    const runId = Date.now();
    const tom = await bootstrapUser(browsers[0]!, 'Tom', 'Tom');
    sessions.push({ label: 'Tom', context: tom.context, page: tom.page });
    const page = tom.page;

    const flowTalk = makeFlowTalk(runId);
    const surveyTalk = makeSurveyTalk(runId);
    const routeTalk = makeRouteTalk(runId);

    await createFlowOrSurveyTalkViaEditor(page, { title: flowTalk.title, type: 'flow', questions: talkQuestionsToUiSpec(flowTalk.questions) });
    await page.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(page, 'chatrooms');
    await createFlowOrSurveyTalkViaEditor(page, { title: surveyTalk.title, type: 'survey', questions: talkQuestionsToUiSpec(surveyTalk.questions) });
    await page.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(page, 'chatrooms');
    await createRouteTalkViaEditor(page, { title: routeTalk.title, root: talkRouteQuestionsToUiSpec(routeTalk.questions) });

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

      // Details popup: opens on long-press (no drag), shows the moved-out fields.
      await longPressTalkRow(page, row);
      const popup = page.locator('#item-details-popup');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await expect(popup.locator('.talk-item-meta').first()).toBeVisible();
      await expect(popup).toContainText('Expir');

      // Closing the popup restores the details node to the row, hidden again.
      await popup.locator('#close-item-details-popup').click();
      await expect(popup).toHaveCount(0);
      await expect(row.locator('.talk-item-details')).toBeHidden();
      await expect(row.locator('.talk-item-details')).toHaveCount(1);

      // Broadcast-toggle checkbox fires immediately on 'change' — no prior selection step.
      const checkbox = row.locator('.talk-broadcast-toggle-checkbox');
      await expect(checkbox).toBeChecked();
      await checkbox.uncheck();
      await expect(row).toHaveClass(/talk-broadcast-disabled/);
      await checkbox.check();
      await expect(row).toHaveClass(/talk-broadcast-enabled/);
    }

    // Survey-stats: only reachable now from inside the long-press details popup.
    const surveyRow = page.locator('.talk-list-item[data-role="created"]').filter({ hasText: surveyTalk.title });
    await longPressTalkRow(page, surveyRow);
    const surveyPopup = page.locator('#item-details-popup');
    await expect(surveyPopup).toBeVisible({ timeout: 10_000 });
    await surveyPopup.locator('.survey-stats-btn').click();
    await expect(page.locator('#survey-stats-body')).toBeVisible({ timeout: 10_000 });
    await page.locator('#survey-stats-close-btn').click();
    await expect(surveyPopup.locator('#close-item-details-popup')).toBeVisible();
    await surveyPopup.locator('#close-item-details-popup').click();

    // Remove: swipe-left gesture past the commit threshold, replacing the old 🗑️ button.
    const routeRow = page.locator('.talk-list-item[data-role="created"]').filter({ hasText: routeTalk.title });
    await dragTalkRow(page, routeRow, 'left');
    await expect(routeRow).toHaveCount(0, { timeout: 10_000 });
  });
});
