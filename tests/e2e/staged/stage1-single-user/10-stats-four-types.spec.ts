/**
 * STAT-01 — local stats aggregation across all four talk types.
 *
 * Tom creates one talk of each type (tag, flow, survey, route), then seeds two
 * ledger outcomes per talk directly into localStorage via seedTalkLedgerOutcome().
 * The test verifies that the app's local stats pipeline (TalkLedger → setTalkStats →
 * talk-item-stats UI element) reports 2 responses per talk for all four types.
 *
 * Server-side per-talk stats endpoints were removed in P0 Step 7; stats are
 * now local-only. This test exercises the client-side aggregation path.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../../helpers/many-browsers';
import {
  createTalkFromCompanyPage,
  seedTalkLedgerOutcome,
  expectTalkResponsesLine,
} from '../../helpers/talk-demo-ui';
import {
  makeTagTalk,
  makeFlowTalk,
  makeSurveyTalk,
  makeRouteTalk,
} from '../../talks-matching/lib/four-types-talks';

type Session = { label: string; context: BrowserContext; page: Page };
type TalkKind = 'tag' | 'flow' | 'survey' | 'route';

test.describe('Talks matching — local stats aggregation across four talk types (STAT-01)', () => {
  /** Local stats pipeline coverage across all four talk types. */
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

  test('4 talks × 2 seeded outcomes → talk-item-stats shows "Responses: 2" for each type', async () => {
    expect(browsers.length).toBe(1);
    const runId = Date.now();

    // --- Bootstrap Tom (creator) ---
    const tom = await bootstrapUser(browsers[0]!, 'Tom', 'Tom');
    sessions.push({ label: 'Tom', context: tom.context, page: tom.page });
    await tom.page.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(tom.page, 'chatrooms');

    // --- Tom creates all 4 talk types ---
    const talks: Array<{ kind: TalkKind; build: (n: number) => ReturnType<typeof makeTagTalk> }> = [
      { kind: 'tag', build: makeTagTalk },
      { kind: 'flow', build: makeFlowTalk },
      { kind: 'survey', build: makeSurveyTalk },
      { kind: 'route', build: makeRouteTalk },
    ];

    const createdTalks: Array<{ kind: TalkKind; title: string; talkId: string }> = [];
    for (const t of talks) {
      const talk = t.build(runId);
      const talkId = await createTalkFromCompanyPage(tom.page, talk);
      await tom.page.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(tom.page, 'chatrooms');
      createdTalks.push({ kind: t.kind, title: talk.title, talkId });
    }
    expect(createdTalks).toHaveLength(4);

    // --- Seed 2 ledger outcomes per talk into localStorage ---
    // This replaces the deleted POST /api/stats/talks/:id/record endpoint.
    // The outcome mapping: tag/flow/route get 'matched', survey gets 'other'.
    await Promise.all(
      createdTalks.flatMap((b) =>
        ['stats-jerry', 'stats-sam'].map((responderId) => {
          const ledgerOutcome = b.kind === 'tag' || b.kind === 'flow' || b.kind === 'route'
            ? 'matched' as const
            : 'other' as const;
          return seedTalkLedgerOutcome(tom.page, b.talkId, responderId, ledgerOutcome);
        }),
      ),
    );

    // --- Verify the UI shows "Responses: 2" for every talk ---
    // expectTalkResponsesLine navigates to the Talks tab and reads talk-item-stats.
    // The app's needTalkStats → setTalkStats pipeline reads from talkLedger localStorage.
    for (const b of createdTalks) {
      await expectTalkResponsesLine(tom.page, b.title, 2);
    }
  });
});
