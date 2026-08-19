/**
 * Regression coverage for a sender-side match-detection bug on route talks:
 * checkIfMatch/checkIfIgnore (src/shared/talk-engine.ts, and the duplicate actually
 * exercised at runtime in src/web/app/app.ts) unconditionally returned false for
 * `type: 'route'`, so a route talk's SENDER never registered a match — no matter
 * what the receiver actually answered — while the receiver's own screen correctly
 * showed "Match." Fixed by widening the type gate; route's terminal answer is
 * resolved the same way flow/tag's is (find the question by id, find the chosen
 * answer, read its isMatch/isIgnore flag) since every route node's id is unique
 * across the talk and answers[] is the full root-to-terminal path in order.
 *
 * Scenario: an HR agent's route talk — "Which position are you applying for?" —
 * has TWO distinct match points at different DAG depths (Accountant → CPA screen,
 * Engineer → portfolio screen) plus two immediate root-level rejects (Doctor,
 * Lawyer). Four jobseekers answer; the assertions are on the HR agent's (the
 * sender's, the side the bug broke) own Contacts list and Talks-tab stats.
 *
 * Companion doc: tests/e2e/staged/stage5-multi-user/route-hr-hiring-match-detection.md
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage5Spec } from '../../helpers/e2e-stage-pipeline';
import {
  bootstrapUser,
  finalCleanupPages,
  resetTalksMatchingSession,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import {
  buildRouteAnswerIdMap,
  clickBroadcastUntilBulkAck,
  completeTalksInAppByAnswerIds,
  createRouteTalkViaEditor,
  talkRouteQuestionsToUiSpec,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { delay, headless } from '../../helpers/timing';

type Candidate = {
  name: string;
  stageName: string;
  browser: Browser;
  context?: BrowserContext;
  page?: Page;
  path: string[];
  expectMatch: boolean;
};

function buildHrRouteTalk(authorId: string, runId: string): any {
  const title = `${runId} HR hiring route`;
  return {
    title,
    authorId,
    type: 'route',
    language: 'en',
    isAdult: false,
    tags: [],
    questions: [
      {
        id: 'q_position',
        text: 'Which position are you applying for?',
        contextPath: [],
        answers: [
          { id: 'a_accountant', text: 'Accountant', nextQuestionId: 'q_accountant_screen' },
          { id: 'a_engineer', text: 'Engineer', nextQuestionId: 'q_engineer_screen' },
          { id: 'a_doctor', text: 'Doctor', isIgnore: true, isTerminal: true },
          { id: 'a_lawyer', text: 'Lawyer', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_accountant_screen',
        text: 'Do you hold a CPA license?',
        contextPath: [{ questionId: 'q_position', answerId: 'a_accountant' }],
        answers: [
          { id: 'a_cpa_yes', text: 'Yes', isMatch: true, isTerminal: true },
          { id: 'a_cpa_no', text: 'No', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_engineer_screen',
        text: 'Do you have a coding portfolio?',
        contextPath: [{ questionId: 'q_position', answerId: 'a_engineer' }],
        answers: [
          { id: 'a_portfolio_yes', text: 'Yes', isMatch: true, isTerminal: true },
          { id: 'a_portfolio_no', text: 'No', isIgnore: true, isTerminal: true },
        ],
      },
    ],
    createdAt: new Date().toISOString(),
    isTemplate: false,
    usageCount: 0,
  };
}

test.describe('Route talk: HR hiring — sender correctly detects match vs. mismatch per candidate', () => {
  let hrBrowser: Browser | undefined;
  let hrContext: BrowserContext | undefined;
  let hrPage: Page | undefined;
  const candidates: Candidate[] = [
    { name: 'Alice', stageName: 'Alice Accountant', path: ['a_accountant', 'a_cpa_yes'], expectMatch: true, browser: undefined as unknown as Browser },
    { name: 'Bob', stageName: 'Bob Engineer', path: ['a_engineer', 'a_portfolio_yes'], expectMatch: true, browser: undefined as unknown as Browser },
    { name: 'Carol', stageName: 'Carol Doctor', path: ['a_doctor'], expectMatch: false, browser: undefined as unknown as Browser },
    { name: 'Dave', stageName: 'Dave Lawyer', path: ['a_lawyer'], expectMatch: false, browser: undefined as unknown as Browser },
  ];

  test.afterEach(async () => {
    const pages: Record<string, Page | undefined> = { hr: hrPage };
    const contexts: Record<string, BrowserContext | undefined> = { hr: hrContext };
    for (const c of candidates) {
      pages[c.name] = c.page;
      contexts[c.name] = c.context;
    }
    await finalCleanupPages(pages as any, contexts as any);
    await Promise.all(candidates.map((c) => c.browser?.close().catch(() => {})));
    await hrBrowser?.close().catch(() => {});
    hrBrowser = undefined;
    hrContext = undefined;
    hrPage = undefined;
    for (const c of candidates) {
      c.browser = undefined as unknown as Browser;
      c.context = undefined;
      c.page = undefined;
    }
    await clearGunForStage5Spec();
  });

  test('Alice and Bob land in HR contacts as matches; Carol and Dave do not', async () => {
    test.setTimeout(180_000);
    await resetTalksMatchingSession({}, {}, clearGunForStage5Spec);

    const launch = () =>
      chromium.launch({
        headless,
        slowMo: headless ? 0 : delay(50, 120),
        args: [...WEBRTC_CHROMIUM_ARGS, '--force-device-scale-factor=1'],
      });

    hrBrowser = await launch();
    for (const c of candidates) c.browser = await launch();

    const hrBoot = await bootstrapUser(hrBrowser, 'HR', 'HR Agent');
    hrContext = hrBoot.context;
    hrPage = hrBoot.page;
    await hrPage.click('.chatroom-item:has-text("Global")');

    await Promise.all(
      candidates.map(async (c) => {
        const boot = await bootstrapUser(c.browser, c.name, c.stageName);
        c.context = boot.context;
        c.page = boot.page;
        await c.page.click('.chatroom-item:has-text("Global")');
      }),
    );

    const hrId = await hrPage.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    await waitForDistinctGunPeersExcludingSelf(hrPage, candidates.length, 120_000);

    const runId = `hr-route-${Date.now()}`;
    const originalTalk = buildHrRouteTalk(hrId, runId);
    const talk = await createRouteTalkViaEditor(hrPage, {
      title: originalTalk.title,
      root: talkRouteQuestionsToUiSpec(originalTalk.questions),
    });
    const idMap = buildRouteAnswerIdMap(originalTalk.questions, talk.talkData.questions);
    await clickBroadcastUntilBulkAck(hrPage, { minGunPeers: candidates.length, minSent: 1 });

    for (const c of candidates) {
      await completeTalksInAppByAnswerIds(c.page!, [
        {
          talkId: talk.talkId,
          talkData: talk.talkData,
          answerIds: c.path.map((id) => idMap[id] ?? id),
          outcome: c.expectMatch ? 'match' : 'mismatch',
        },
      ]);
    }

    // The bug this test guards: the HR agent (sender) independently recomputes
    // match/mismatch from each candidate's transmitted answer path — it does not
    // trust whatever outcome the candidate locally recorded above.
    //
    // Contacts shows everyone the HR agent has exchanged a talk with, matched or
    // not (deriveLocalPeers pulls from all local talk exchanges regardless of
    // outcome — confirmed by reading local-peer-derivation.ts; this is intended
    // interaction history, not a match-only list). So all 4 candidates appear —
    // the fix is verified by each candidate's own match badge, not by who's
    // present at all.
    await hrPage.click('.nav-btn[data-view="contacts"]');
    await waitForTabActive(hrPage, 'contacts');
    const realContacts = hrPage.locator('#contacts-list .contact-item:not([data-support-contact="true"])');
    await expect
      .poll(async () => realContacts.count(), { timeout: 60_000, intervals: [500, 1000] })
      .toBe(candidates.length);

    for (const c of candidates) {
      const row = hrPage.locator('#contacts-list .contact-item').filter({ hasText: c.stageName });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row).toHaveAttribute('data-matched-talks', c.expectMatch ? '1' : '0');
    }

    // Talks-tab stats: all 4 candidates' responses were delivered and counted,
    // but only Alice and Bob's count as matches.
    await hrPage.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(hrPage, 'talks');
    const talkRow = hrPage.locator('.talk-list-item[data-role="created"]').filter({ hasText: talk.title });
    await expect
      .poll(
        async () => talkRow.first().locator('.talk-item-stats').textContent(),
        { timeout: 30_000, intervals: [500, 1000] },
      )
      .toMatch(/Responses:\s*4/);
    await expect(talkRow.first().locator('.talk-item-stats')).toContainText(/Matches:\s*2/);
  });
});
