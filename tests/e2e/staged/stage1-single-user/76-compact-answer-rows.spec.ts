/**
 * TODO §M3: Me-tab answer entries collapse to 2 visible lines (title, outcome+answered-count
 * status) with the copy-to-talks action as an inline icon rather than its own row — the metadata
 * line, type/language badges, and the per-question breakdown (prompt/answer/mode badges/context)
 * move into a hidden .answer-item-details, opened on demand via the "ℹ️" icon into the shared M2
 * popup. The copy icon still fires on a single click with no prior selection step.
 */
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../../helpers/many-browsers';
import { createTalkFromCompanyPage, completeTalkInAppByAnswerIds } from '../../helpers/talk-demo-ui';
import { makeRouteTalk } from '../../talks-matching/lib/four-types-talks';
import type { Browser, BrowserContext, Page } from '@playwright/test';

type Session = { label: string; context: BrowserContext; page: Page };

test.describe('Compact answer rows (M3) — 2-line collapse + popup details', () => {
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

  test('answer entry: 2 visible lines, no dedicated actions row, popup shows the per-question breakdown, copy icon acts on first click', async () => {
    const runId = Date.now();
    const tom = await bootstrapUser(browsers[0]!, 'Tom', 'Tom');
    sessions.push({ label: 'Tom', context: tom.context, page: tom.page });
    const page = tom.page;

    // A route talk self-answers two questions, so the flattened history renders one
    // .answer-talk-item per question (sharing the source talk's title) — the richest nested
    // per-question detail (prompt/answer/context) of all four types, and a good stress case
    // for the details-popup move.
    const routeTalk = makeRouteTalk(runId);
    const talkId = await createTalkFromCompanyPage(page, routeTalk);
    await page.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(page, 'chatrooms');

    const talkData = await page.evaluate(async (id) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      return app?.talkService?.getTalkWithRetry?.(id, { attempts: 30, gapMs: 250 }) ?? null;
    }, talkId);
    expect(talkData).toBeTruthy();

    await completeTalkInAppByAnswerIds(page, talkId, talkData, ['a_r_job_yes', 'a_r_role_yes'], 'match');

    await page.click('.nav-btn[data-view="me"]');
    await waitForTabActive(page, 'me');

    // The child question ("Engineer?") carries the context-path detail — the richer of the two
    // rows for this test.
    const row = page.locator('.answer-talk-item').filter({ hasText: 'Engineer?' }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Exactly 2 visible lines: title + status-line. Details stays hidden until opened.
    await expect(row.locator('.answer-item-title')).toBeVisible();
    await expect(row.locator('.answer-item-status-line')).toBeVisible();
    await expect(row.locator('.answer-item-details')).toBeHidden();
    await expect(row.locator('.answer-outcome-item')).toHaveCount(1);
    await expect(row.locator('.answer-outcome-item')).not.toBeVisible();

    // Details popup shows the per-question breakdown that used to render inline.
    await row.locator('.answer-details-btn').click();
    const popup = page.locator('#item-details-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(popup.locator('.answer-outcome-item')).toBeVisible();
    await expect(popup).toContainText('Engineer?');
    await expect(popup).toContainText('Context path:');
    await expect(popup).toContainText('Looking for a job? -> Yes.');

    // Closing the popup restores the details node to the row, hidden again.
    await popup.locator('#close-item-details-popup').click();
    await expect(popup).toHaveCount(0);
    await expect(row.locator('.answer-item-details')).toBeHidden();
    await expect(row.locator('.answer-item-details')).toHaveCount(1);

    // Copy-to-talks icon: single click, no prior selection step, and the copied talk shows up
    // as a fresh OUT row.
    await row.locator('.answer-copy-talk-btn').click();
    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');
    await expect(
      page.locator('.talk-list-item[data-role="copied"]').filter({ hasText: routeTalk.title }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
