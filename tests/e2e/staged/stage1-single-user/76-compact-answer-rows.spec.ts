/**
 * docs/TODO.md §LL.2 follow-up: Me-tab answer entries render as one line (question -> answer,
 * with the context label shown inline when the question has a context path) with no dedicated
 * actions row and no expand-in-place popup — talk metadata (date/outcome/senders/language/
 * chatbot use) isn't shown on this page at all anymore. Copy-to-talks and "view sender" are
 * small independent links directly on the answer line itself (per-variant, since a merged row
 * can span more than one contributing talk).
 */
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../../helpers/many-browsers';
import {
  buildRouteAnswerIdMap,
  completeTalkInAppByAnswerIds,
  createRouteTalkViaEditor,
  talkRouteQuestionsToUiSpec,
} from '../../helpers/talk-demo-ui';
import { makeRouteTalk } from '../../talks-matching/lib/four-types-talks';
import type { Browser, BrowserContext, Page } from '@playwright/test';

type Session = { label: string; context: BrowserContext; page: Page };

test.describe('Compact answer rows (§LL.2) — 1-line collapse, no popup', () => {
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

  test('answer entry: one line with inline context label, copy link works with no popup', async () => {
    const runId = Date.now();
    const tom = await bootstrapUser(browsers[0]!, 'Tom', 'Tom');
    sessions.push({ label: 'Tom', context: tom.context, page: tom.page });
    const page = tom.page;

    // A route talk self-answers two questions, so the flattened history renders one
    // .answer-talk-item per question (each keyed by its own questionId) — the richest
    // nested per-question detail (prompt/answer/context) of all four types, and a good
    // stress case for the details-popup move.
    const routeTalk = makeRouteTalk(runId);
    const created = await createRouteTalkViaEditor(page, {
      title: routeTalk.title,
      root: talkRouteQuestionsToUiSpec(routeTalk.questions),
    });
    const idMap = buildRouteAnswerIdMap(routeTalk.questions, created.talkData.questions);
    await page.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(page, 'chatrooms');

    const talkId = created.talkId;
    const talkData = await page.evaluate(async (id) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      return app?.talkService?.getTalkWithRetry?.(id, { attempts: 30, gapMs: 250 }) ?? null;
    }, talkId);
    expect(talkData).toBeTruthy();

    const aids = ['a_r_job_yes', 'a_r_role_yes'].map((id) => idMap[id] ?? id);
    await completeTalkInAppByAnswerIds(page, talkId, talkData, aids, 'match');

    await page.click('.nav-btn[data-view="me"]');
    await waitForTabActive(page, 'me');

    // The child question ("Engineer?") carries the context-path detail — the richer of the two
    // rows for this test.
    const row = page.locator('.answer-talk-item').filter({ hasText: 'Engineer?' }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // One visible line: question -> answer, with its context label shown inline — no popup,
    // no hidden detail node, no dedicated actions row.
    await expect(row.locator('.qa-line')).toBeVisible();
    await expect(row.locator('.qa-question')).toContainText('Engineer?');
    await expect(row).toContainText('Looking for a job? -> Yes.');
    await expect(page.locator('#item-details-popup')).toHaveCount(0);

    // Copy-to-talks: a small link directly on the answer line, single click, no popup.
    await row.locator('.answer-copy-talk-jump').click();

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');
    await expect(
      page.locator('.talk-list-item[data-role="copied"]').filter({ hasText: routeTalk.title }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
