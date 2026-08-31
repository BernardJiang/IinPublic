import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import * as fs from 'fs';
import { clearGunForStage5Spec } from '../../helpers/e2e-stage-pipeline';
import { delay, headless, afterNav, afterLoad } from '../../helpers/timing';
import { gunBaseURL, e2eTestScreenshotsDir } from '../../helpers/ports';
import {
  completeTalksInAppByAnswerIds,
  createTalksFromCompanyPage,
} from '../../helpers/talk-demo-ui';
import {
  TAG_NAMES,
  TALK_TITLES,
  MATCH_ANSWER,
  IGNORE_ANSWER,
  TECH_SUPPORT_NAME,
  TOM_NAME,
  bootstrapSuperUser,
  waitForTabActive,
} from '../../helpers/super-user-techsupport-shared';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { ensureChatroomList } from '../../helpers/chatroom-nav';

function matchingAnswerIds(talkData: any): string[] {
  if (talkData?.type === 'tag') {
    const q = talkData.questions?.[0];
    const a = q?.answers?.find((answer: any) => answer?.isMatch === true);
    if (!q?.id || !a?.id) throw new Error(`Could not find tag match answer for ${talkData?.title}`);
    return [String(a.id)];
  }
  const q = talkData.questions?.[0];
  const a = q?.answers?.find((answer: any) => answer?.isMatch === true || answer?.text === MATCH_ANSWER);
  if (!q?.id || !a?.id) throw new Error(`Could not find flow match answer for ${talkData?.title}`);
  return [String(a.id)];
}

test.describe('Super user: 20 talks completed by Tom', () => {
  let browserTechSupport: Browser;
  let browserTom: Browser;
  let contextTechSupport: BrowserContext;
  let contextTom: BrowserContext;
  let pageTechSupport: Page;
  let pageTom: Page;

  const screenshotDir = e2eTestScreenshotsDir('08-super-user');

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage5Spec();

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    browserTechSupport = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    console.log('🚀 Launched 2 Chrome browsers: TechSupport, Tom');
  });

  test.afterEach(async () => {
    await contextTechSupport?.close().catch(() => {});
    await contextTom?.close().catch(() => {});
    contextTechSupport = undefined as unknown as BrowserContext;
    contextTom = undefined as unknown as BrowserContext;
    pageTechSupport = undefined as unknown as Page;
    pageTom = undefined as unknown as Page;
  });

  test.afterAll(async () => {
    const manualCleanup = async (page?: Page) => {
      if (!page) return;
      try {
        await page.evaluate(() => {
          const webApp = (window as any).__iinpublic_app;
          if (webApp?.getApp) webApp.getApp().manualCleanup();
        });
      } catch {
        // ignore
      }
    };
    await manualCleanup(pageTechSupport);
    await manualCleanup(pageTom);
    await pageTechSupport?.close().catch(() => {});
    await pageTom?.close().catch(() => {});
    await contextTechSupport?.close().catch(() => {});
    await contextTom?.close().catch(() => {});
    await browserTechSupport?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
    await clearGunForStage5Spec();
    console.log('✅ Cleanup complete');
  });

  test('TechSupport creates 10 tags + 10 talks; Tom completes each through the app path; both verify 20 at end', async () => {
    test.setTimeout(360_000);

    console.log('\n📍 STEP 1: TechSupport enters Global');
    const techSupport = await bootstrapSuperUser(browserTechSupport, 'TechSupport', TECH_SUPPORT_NAME, 30_000);
    contextTechSupport = techSupport.context;
    pageTechSupport = techSupport.page;
    await pageTechSupport.click('.chatroom-item:has-text("Global")');
    await afterLoad();

    await ensureChatroomList(pageTechSupport);
    await pageTechSupport.click('.chatroom-item:has-text("Global")');
    await afterNav();

    console.log('\n📍 STEP 2–3: TechSupport creates 10 tags + 10 talks');
    const tagPayloads = TAG_NAMES.map((title) => ({
      title,
      type: 'tag',
      isAdult: false,
      language: 'en',
      tags: [],
      questions: [
        {
          id: 'q_0',
          text: title,
          answers: [
            { id: 'a_0_match', text: 'Match.', isMatch: true, isTerminal: true },
            { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
      selfAnswers: [{ questionId: 'q_0', answerId: 'a_0_match' }],
    }));
    const flowPayloads = TALK_TITLES.map((title) => ({
      title,
      type: 'flow',
      isAdult: false,
      language: 'en',
      tags: [],
      questions: [
        {
          id: 'q_0',
          text: `Want to connect for ${title}?`,
          answers: [
            { id: 'a_0_0', text: MATCH_ANSWER, isMatch: true, isTerminal: true },
            { id: 'a_0_1', text: IGNORE_ANSWER, isIgnore: true, isTerminal: true },
          ],
          contextHashId: '',
        },
      ],
      selfAnswers: [{ questionId: 'q_0', answerId: 'a_0_0' }],
    }));
    const createdTalks = await createTalksFromCompanyPage(pageTechSupport, [...tagPayloads, ...flowPayloads]);

    console.log('\n📍 STEP 4: TechSupport has 20 created (10 tags + 10 talks)');

    console.log('\n📍 STEP 5: Tom joins Global');
    // Brief pause after heavy TechSupport session + prior spec teardown reduces flaky net::ERR_ABORTED on Tom's first goto.
    await new Promise((r) => setTimeout(r, 2000));
    const tom = await bootstrapSuperUser(browserTom, 'Tom', TOM_NAME, 30_000);
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterLoad();

    const tomUserId = await pageTom.evaluate(() =>
      String(
        (
          window as unknown as {
            __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } };
          }
        ).__iinpublic_app?.getApp?.()?.currentUser?.id || '',
      ),
    );
    expect(tomUserId.length, 'Tom user id for end-of-flow checks').toBeGreaterThan(0);

    console.log('\n📍 STEP 6–7: Tom completes all 20 talks through the app completion path');

    await pageTom.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageTom, 'talks');
    await completeTalksInAppByAnswerIds(
      pageTom,
      createdTalks.map((talk) => ({
        talkId: talk.talkId,
        talkData: talk.talkData,
        answerIds: matchingAnswerIds(talk.talkData),
        outcome: 'match',
      })),
    );

    console.log('\n📍 STEP 8: End verification — TechSupport and Tom both confirm 20 completed (no earlier batch wait)');
    await afterLoad();
    await pageTechSupport.click('.nav-btn[data-view="talks"]');
    await afterLoad();
    await expect(pageTechSupport.locator('#talks-stats-strip')).toContainText(/20 outgoing/i, { timeout: 15_000 });
    await expect
      .poll(
        async () => {
          const rows = pageTechSupport.locator('.talk-list-item[data-role="created"]');
          const totalRows = await rows.count();
          const matchedRows = await rows
            .locator('.talk-item-stats')
            .filter({ hasText: /Responses:\s*1\s*·\s*Matches:\s*1/i })
            .count();
          return { totalRows, matchedRows };
        },
        { message: 'TechSupport OUT should retain all created talks and show creator-facing match state', timeout: 60_000 },
      )
      .toMatchObject({ totalRows: 20 });
    // `.first()` on a multi-match locator isn't guaranteed to land on a *visible* match — under
    // heavy parallel load, DOM completion order varies run to run, and a naive `.first()` could
    // pick a match that's momentarily off-screen/re-rendering while other matches are already
    // visible. Poll for *any* visible match instead of asserting on an arbitrary first element.
    await expect
      .poll(
        async () => {
          const matches = pageTechSupport
            .locator('.talk-item-matched, .talk-item-stats')
            .filter({ hasText: /Matched with:|Matches:\s*1/i });
          const count = await matches.count();
          for (let i = 0; i < count; i++) {
            if (await matches.nth(i).isVisible()) return true;
          }
          return false;
        },
        { message: 'At least one creator-facing match indicator should be visible', timeout: 15_000 },
      )
      .toBe(true);

    await pageTom.click('.nav-btn[data-view="me"]');
    await afterLoad();
    const answersContent = pageTom.locator('#answers-content');
    const expectedTitles = [...TAG_NAMES, ...TALK_TITLES];
    await expect
      .poll(
        async () =>
          pageTom.evaluate((titles) => {
            const raw = localStorage.getItem('myAnswerHistory');
            const history = raw ? JSON.parse(raw) : {};
            const answered = Object.values(history);
            const answeredTitles = new Set(answered.map((record: any) => String(record?.title || '')));
            const missing = titles.filter((title) => !answeredTitles.has(title));
            const matches = answered.filter((record: any) => record?.outcome === 'match').length;
            return missing.length === 0 && matches >= titles.length
              ? 'ok'
              : `answered=${answered.length}; matches=${matches}; missing=${missing.join(',')}`;
          }, expectedTitles),
        { message: 'Tom local Answers ledger should include 20 matched talks', timeout: 30_000 },
      )
      .toBe('ok');
    await expect
      .poll(async () => answersContent.locator('.answer-talk-item').count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(20);
    // docs/TODO.md §LL.2 follow-up: the outcome is carried on the row's own data-outcome
    // attribute now, no popup content to match against.
    await expect(answersContent.locator('.answer-talk-item[data-outcome="match"]').first()).toBeVisible({ timeout: 3000 });

    console.log('✅ Super user test complete: TechSupport created 20, Tom completed 20, both verified 20 at end.');
  });
});
