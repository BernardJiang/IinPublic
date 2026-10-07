/**
 * An author edits one question of a Flow talk the receiver already answered. The edited talk is
 * treated as a new talk; because the receiver has already answered every question on its path
 * (the changed one in a different talk), the receiver's chatbot answers it fully automatically —
 * no dialog, no typing — using the default "Whenever offered" scope.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction } from '../../helpers/timing';
import { launchThreeBrowsers, shutdownThreeBrowsers, type ThreeBrowsers } from '../../helpers/talks-matching-browsers';
import {
  broadcastFromGlobalChatroom,
  createFlowOrSurveyTalkViaEditor,
  createRouteTalkViaEditor,
  submitTalkEditorAndWaitForOut,
  type UiRouteNodeSpec,
} from '../../helpers/talk-demo-ui';
import {
  bootstrapUser,
  waitForTabActive,
  waitForResponseModalClosed,
  openIncomingTalkModal,
  openIncomingTalkModalWithAutoAnswers,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../../helpers/talks-matching-flow';
import { dismissNotificationOverlays } from '../../helpers/durable-ui';

const TITLE_A = 'E2E Edited Auto A';
const TITLE_B = 'E2E Edited Auto B';
const Q1 = 'Do you play tennis?';
const Q2 = 'Can you play at Balboa Activity Center?';
const Q3_OLD = 'Can you play on Sunday?';
const Q3_NEW = 'Can you play on Saturday?';
// Talk B shares only the Saturday question with the edited Talk A, so the edited A is genuinely
// new content (a content-identical talk would rightly be treated as already exchanged).
const QB1 = 'Do you like pickleball?';

async function fillThreeQuestionFlow(page: Page, title: string, q3: string, q1 = Q1): Promise<void> {
  await dismissNotificationOverlays(page);
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  await page.click('#add-question-btn');
  await afterAction();
  await page.click('#add-question-btn');
  await afterAction();
  const texts = [q1, Q2, q3];
  const next = ['q_1', 'q_2', 'noticed'];
  for (let i = 0; i < 3; i++) {
    const q = page.locator('.question-item').nth(i);
    await q.locator('.question-text').fill(texts[i]);
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption(next[i]);
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  }
  await submitTalkEditorAndWaitForOut(page, title);
}

/** Route dialogs preview the branch an answer leads to; confirm it when shown. */
async function continueRoutePreview(page: Page): Promise<void> {
  const next = page.locator('#talk-response-modal [data-testid="route-branch-continue"]');
  if (await next.isVisible().catch(() => false)) {
    await next.click();
    await afterAction();
  }
}

/** Answer the listed (still-open) questions of the response dialog with Yes / Auto. */
async function answerYesAuto(page: Page, questionTexts: string[]): Promise<void> {
  const modal = page.locator('#talk-response-modal');
  for (const text of questionTexts) {
    await expect(modal.locator('.modal-content').first()).toContainText(text, { timeout: 20_000 });
    await modal.locator('input.choice-radio[data-answer-text="Yes"][value$="_auto"]').first().click();
    await afterAction();
    await continueRoutePreview(page);
  }
  await waitForResponseModalClosed(page);
}


/** Survey: three independent Yes/No questions (no routing). */
async function createSurvey(page: Page, title: string, texts: string[]): Promise<void> {
  await createFlowOrSurveyTalkViaEditor(page, {
    title,
    type: 'survey',
    questions: texts.map((text) => ({
      text,
      answers: [{ text: 'Yes', outcome: 'match' as const }, { text: 'No', outcome: 'ignore' as const }],
    })),
  });
}

/** Route: a linear Yes-chain q1 -> q2 -> q3, ending in a match. */
async function createRoute(page: Page, title: string, texts: string[]): Promise<void> {
  const node = (i: number): UiRouteNodeSpec => ({
    text: texts[i],
    answers: i === texts.length - 1
      ? [{ text: 'Yes', outcome: 'match' }, { text: 'No', outcome: 'ignore' }]
      : [{ text: 'Yes', child: node(i + 1) }, { text: 'No', outcome: 'ignore' }],
  });
  await createRouteTalkViaEditor(page, { title, root: node(0) });
}

/** Edits question `index` of an owned talk in place and saves it. */
async function editQuestionText(page: Page, title: string, index: number, text: string, route: boolean): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await page.locator('.talk-list-item[data-role="created"]').filter({ hasText: title }).first().click();
  await page.waitForSelector('#talk-editor-form');
  const field = route
    ? page.locator('.route-question-text').nth(index)
    : page.locator('.question-item').nth(index).locator('.question-text');
  await field.fill(text);
  await submitTalkEditorAndWaitForOut(page, title);
}

test.describe('Edited talk is answered fully automatically', () => {
  let browsers: ThreeBrowsers;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let browserTom: Browser;
  let browserJerry: Browser;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage3Spec();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
      clearGunForStage3Spec,
    );
    pageTom = pageJerry = undefined;
    contextTom = contextJerry = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages({ tom: pageTom, jerry: pageJerry }, { tom: contextTom, jerry: contextJerry });
    await shutdownThreeBrowsers(browsers);
    await clearGunForStage3Spec();
  });

  test('flow: author changes one question already answered elsewhere; receiver auto-answers all three', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    const autoReplyLogs: string[] = [];
    pageJerry.on('console', (m) => {
      const text = m.text();
      if (text.includes('Chatbot auto-reply')) autoReplyLogs.push(text);
    });
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // 1. Talk A (Sunday): Jerry answers all three with Auto.
    await fillThreeQuestionFlow(pageTom, TITLE_A, Q3_OLD);
    await broadcastFromGlobalChatroom(pageTom);
    await waitForTabActive(pageTom, 'chatrooms');
    await afterSync();
    await openIncomingTalkModal(pageJerry, TITLE_A);
    await answerYesAuto(pageJerry, [Q1, Q2, Q3_OLD]);

    // 2. Talk B (pickleball / Balboa / Saturday): Balboa auto-fills; Jerry answers the rest with Auto.
    await fillThreeQuestionFlow(pageTom, TITLE_B, Q3_NEW, QB1);
    await broadcastFromGlobalChatroom(pageTom);
    await waitForTabActive(pageTom, 'chatrooms');
    await afterSync();
    await openIncomingTalkModalWithAutoAnswers(pageJerry, TITLE_B);
    await answerYesAuto(pageJerry, [QB1, Q3_NEW]);

    // 3. Tom edits Talk A in place: Sunday -> Saturday, then broadcasts again.
    await pageTom.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageTom, 'talks');
    await pageTom.locator('.talk-list-item[data-role="created"]').filter({ hasText: TITLE_A }).first().click();
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.locator('.question-item').nth(2).locator('.question-text').fill(Q3_NEW);
    await submitTalkEditorAndWaitForOut(pageTom, TITLE_A);
    autoReplyLogs.length = 0;
    await broadcastFromGlobalChatroom(pageTom);
    await waitForTabActive(pageTom, 'chatrooms');

    // 4. Jerry's chatbot answers the edited talk with no dialog and no typing.
    await expect.poll(() => autoReplyLogs.some((l) => l.includes('auto-reply triggered')), {
      message: `chatbot auto-reply for edited talk (logs: ${autoReplyLogs.join(' | ')})`,
      timeout: 60_000,
    }).toBe(true);
    await expect(pageJerry.locator('#talk-response-modal')).toHaveCount(0);
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageJerry, 'talks');
    await expect(
      pageJerry.locator('.talk-list-item[data-role="incoming"].talk-incoming-new').filter({ hasText: TITLE_A }),
    ).toHaveCount(0, { timeout: 15_000 });
    // The record: the edited talk shows as answered by the chatbot (🤖), with no user action.
    const botRow = pageJerry.locator('.talk-list-item[data-answered-by="chatbot"]').filter({ hasText: TITLE_A });
    await expect(botRow).toHaveCount(1, { timeout: 15_000 });
    await expect(botRow.locator('[data-testid="talk-answered-by-chatbot"]')).toBeVisible();
    const stored = await pageJerry.evaluate((title) => {
      const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      const entry = Object.values(talks).find((t: any) => t?.title === title) as any;
      return { answeredBy: entry?.answeredBy, answers: (entry?.completedAnswers || []).length };
    }, TITLE_A);
    expect(stored).toEqual({ answeredBy: 'chatbot', answers: 3 });
    // Me tab keeps the same 🤖 record next to the auto-given answer.
    await pageJerry.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageJerry, 'me');
    await expect(pageJerry.locator('[data-testid="answer-answered-by-chatbot"]').first()).toBeVisible({ timeout: 15_000 });
  });

  for (const kind of ['survey', 'route'] as const) {
    test(`${kind}: slightly edited talk is answered fully automatically and can be re-answered later`, async () => {
      const titleA = `E2E Edited Auto ${kind} A`;
      const titleB = `E2E Edited Auto ${kind} B`;
      const create = kind === 'route' ? createRoute : createSurvey;
      const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
      contextTom = tom.context;
      pageTom = tom.page;
      await pageTom.click('.chatroom-item:has-text("Global")');
      await afterSync();
      const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
      contextJerry = jerry.context;
      pageJerry = jerry.page;
      await pageJerry.click('.chatroom-item:has-text("Global")');
      await afterSync();

      await create(pageTom, titleA, [Q1, Q2, Q3_OLD]);
      await broadcastFromGlobalChatroom(pageTom);
      await waitForTabActive(pageTom, 'chatrooms');
      await afterSync();
      await openIncomingTalkModal(pageJerry, titleA);
      await answerYesAuto(pageJerry, [Q1, Q2, Q3_OLD]);

      await create(pageTom, titleB, [QB1, Q3_NEW]);
      await broadcastFromGlobalChatroom(pageTom);
      await waitForTabActive(pageTom, 'chatrooms');
      await afterSync();
      await openIncomingTalkModal(pageJerry, titleB);
      await answerYesAuto(pageJerry, [QB1, Q3_NEW]);

      await editQuestionText(pageTom, titleA, 2, Q3_NEW, kind === 'route');
      await broadcastFromGlobalChatroom(pageTom);
      await waitForTabActive(pageTom, 'chatrooms');

      // Fully automatic: no dialog, and a 🤖 record of it.
      await pageJerry.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageJerry, 'talks');
      const botRow = pageJerry.locator('.talk-list-item[data-answered-by="chatbot"]').filter({ hasText: titleA });
      await expect(botRow).toHaveCount(1, { timeout: 60_000 });
      await expect(pageJerry.locator('#talk-response-modal')).toHaveCount(0);
      await expect(
        pageJerry.locator('.talk-list-item[data-role="incoming"].talk-incoming-new').filter({ hasText: titleA }),
      ).toHaveCount(0);

      // Edit later: open the 🤖 answer from Me, answer manually -> the 🤖 marker is cleared.
      await pageJerry.click('.nav-btn[data-view="me"]');
      await waitForTabActive(pageJerry, 'me');
      const mark = pageJerry.locator('[data-testid="answer-answered-by-chatbot"]').first();
      await expect(mark).toBeVisible({ timeout: 15_000 });
      await mark.locator('xpath=ancestor::span[contains(@class,"answer-context-jump")]').click();
      const modal = pageJerry.locator('#talk-response-modal');
      await expect(modal).toBeVisible({ timeout: 20_000 });
      for (let i = 0; i < 3 && (await modal.count()) > 0; i++) {
        await modal.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
        await afterAction();
        await continueRoutePreview(pageJerry);
      }
      await waitForResponseModalClosed(pageJerry);
      await expect.poll(() => pageJerry!.evaluate((title) => {
        const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        const entry = Object.values(talks).find((t: any) => t?.title === title) as any;
        return entry?.answeredBy ?? 'none';
      }, titleA)).toBe('none');
    });
  }

  // OPEN-40: a title/routing-only edit is the same content — receivers get it in place, not as a
  // new talk, and nothing is re-answered.
  test('title/routing-only edit updates the receiver\'s copy in place', async () => {
    const title = 'E2E Routing Edit';
    const retitled = 'E2E Routing Edit (renamed)';
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await fillThreeQuestionFlow(pageTom, title, Q3_OLD);
    await broadcastFromGlobalChatroom(pageTom);
    await waitForTabActive(pageTom, 'chatrooms');
    await afterSync();
    await openIncomingTalkModal(pageJerry, title);
    await answerYesAuto(pageJerry, [Q1, Q2, Q3_OLD]);
    const readJerryEntry = () => pageJerry!.evaluate(() => {
      const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      return Object.values(talks).filter((t: any) => String(t?.title || '').startsWith('E2E Routing Edit'))
        .map((t: any) => ({ title: t.title, answers: (t.completedAnswers || []).length, by: t.answeredBy ?? null }));
    });
    expect(await readJerryEntry()).toEqual([{ title, answers: 3, by: null }]);

    // Title + routing only: rename, and make "No" on the last question the match instead of "Yes".
    await pageTom.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageTom, 'talks');
    await pageTom.locator('.talk-list-item[data-role="created"]').filter({ hasText: title }).first().click();
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', retitled);
    const last = pageTom.locator('.question-item').nth(2);
    await last.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
    await last.locator('.answer-item').nth(1).locator('.answer-next').selectOption('noticed');
    await submitTalkEditorAndWaitForOut(pageTom, retitled);
    await broadcastFromGlobalChatroom(pageTom);
    await waitForTabActive(pageTom, 'chatrooms');

    // Jerry's one copy now carries the new title; still his own 3 answers, no second talk, no 🤖.
    await expect.poll(readJerryEntry, { timeout: 60_000 }).toEqual([{ title: retitled, answers: 3, by: null }]);
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageJerry, 'talks');
    await expect(pageJerry.locator('.talk-list-item.talk-incoming-new').filter({ hasText: 'E2E Routing Edit' })).toHaveCount(0);
  });
});
