/**
 * Local stats aggregation across all four talk types (flow, tag, survey, route).
 *
 * The server-side /api/stats talk aggregates were removed (see playwright.config.ts testIgnore:
 * 10-stats-four-types et al are ignored pending a local-ledger replacement). What still exists is
 * the LOCAL stats surface on the Talks tab: per-talk `.talk-item-stats` lines
 * ("Responses: N · Matches: N · …") derived from the author's local talk ledger
 * (getTalkLedgerDoc().outcomes, wired through the `needTalkStats` handler), plus the aggregate
 * status-bar match count. This spec tests THAT surface.
 *
 * Author A creates one talk per type (distinct question text per talk — ids are content-hashed, so
 * identical questions would dedup into one talk). Responder B answers each with a distinct outcome
 * via the pair-direct submit path, whose mailbox fallback A drains locally:
 *
 *   flow   → MATCH  (last answer isMatch=true)                → 1 response, 1 match
 *   tag    → MATCH  (checked item, isMatch=true)              → 1 response, 1 match
 *   survey → NEUTRAL (no match/ignore; checkIfMatch=false)    → 1 response, 0 matches
 *   route  → TERMINAL (no match/ignore; checkIfMatch=false)   → 1 response, 0 matches
 *
 * Expected numbers are anchored to src/shared/talk-engine.ts `checkIfMatch`: only flow/tag can
 * match; survey/route always return false. So overall = 4 responses, 2 matches.
 *
 * See companion 41-stats-aggregation-four-types.md for a plain-English description.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';

const FLOW_TIMEOUT_MS = 30_000;

type TalkSpec = {
  type: 'flow' | 'tag' | 'survey' | 'route';
  def: any;
  answers: any[];
  expectMatch: boolean;
};

test.describe('Stats aggregation across all four talk types (flow, tag, survey, route)', () => {
  let browserA: Browser;
  let browserB: Browser;
  let contextA: BrowserContext | undefined;
  let contextB: BrowserContext | undefined;
  let pageA: Page | undefined;
  let pageB: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=640,1100'] });
    browserB = await chromium.launch({ headless, args: ['--window-position=640,0', '--window-size=640,1100'] });
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch {
        /* ignore */
      }
      await p.close().catch(() => {});
    };
    await cleanup(pageA);
    await cleanup(pageB);
    await contextA?.close().catch(() => {});
    await contextB?.close().catch(() => {});
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('per-talk and aggregate stats reflect the right response/match counts per type', async () => {
    // ── 1. Bootstrap both users ──────────────────────────────────────────────
    const [a, b] = await Promise.all([
      bootstrapUser(browserA, 'StatsA', 'StatsA'),
      bootstrapUser(browserB, 'StatsB', 'StatsB'),
    ]);
    contextA = a.context;
    pageA = a.page;
    contextB = b.context;
    pageB = b.page;

    const [userIdA, userIdB] = await Promise.all([
      pageA.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
      pageB.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
    ]);
    expect(userIdA).toBeTruthy();
    expect(userIdB).toBeTruthy();

    const authorEpub = await pageA.evaluate(() => {
      const pair = (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.();
      return pair?.epub ?? '';
    });

    const stamp = Date.now();
    // ── 2. Build one talk per type (distinct question text ⇒ distinct content-hash id) ─
    const talks: TalkSpec[] = [
      {
        type: 'flow',
        expectMatch: true,
        def: {
          id: `stats-flow-${stamp}`,
          authorId: userIdA,
          authorEpub,
          title: `Stats Flow ${stamp}`,
          type: 'flow',
          questions: [
            {
              id: 'q1',
              text: 'Flow: do you want to grab lunch together?',
              answers: [
                { id: 'a-match', text: 'Yes lunch', isMatch: true },
                { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true },
              ],
            },
          ],
        },
        answers: [{ questionId: 'q1', answerId: 'a-match', answerText: 'Yes lunch', mode: 'manual', isMatch: true }],
      },
      {
        type: 'tag',
        expectMatch: true,
        def: {
          id: `stats-tag-${stamp}`,
          authorId: userIdA,
          authorEpub,
          title: `Stats Tag ${stamp}`,
          type: 'tag',
          questions: [
            {
              id: 'q1',
              text: 'Tag: rock climbing enthusiast',
              answers: [
                { id: 'a-match', text: 'Yes', isMatch: true },
                { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true },
              ],
            },
          ],
        },
        answers: [{ questionId: 'q1', answerId: 'a-match', answerText: 'Yes', mode: 'manual', isMatch: true }],
      },
      {
        type: 'survey',
        expectMatch: false,
        def: {
          id: `stats-survey-${stamp}`,
          authorId: userIdA,
          authorEpub,
          title: `Stats Survey ${stamp}`,
          type: 'survey',
          questions: [
            {
              id: 'q1',
              text: 'Survey: how often do you travel abroad?',
              isAggregatable: true,
              answers: [
                { id: 'a-often', text: 'Often', counter: 0 },
                { id: 'a-rarely', text: 'Rarely', counter: 0 },
              ],
            },
          ],
        },
        answers: [{ questionId: 'q1', answerId: 'a-often', answerText: 'Often', mode: 'manual' }],
      },
      {
        type: 'route',
        expectMatch: false,
        def: {
          id: `stats-route-${stamp}`,
          authorId: userIdA,
          authorEpub,
          title: `Stats Route ${stamp}`,
          type: 'route',
          questions: [
            {
              id: 'q1',
              text: 'Route: which neighborhood do you live in?',
              contextPath: [],
              answers: [
                { id: 'a-north', text: 'North side', isTerminal: true },
                { id: 'a-south', text: 'South side', isTerminal: true },
              ],
            },
          ],
        },
        answers: [{ questionId: 'q1', answerId: 'a-north', answerText: 'North side', mode: 'manual' }],
      },
    ];

    // ── 3. A authors all four talks (cache body + record in myTalks) ─────────
    await pageA.evaluate((defs) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      for (const def of defs) {
        app?.peerMeshService?.cacheTalkBody?.(def.id, def);
        myTalks[def.id] = { role: 'created', fullTalk: def };
      }
      localStorage.setItem('myTalks', JSON.stringify(myTalks));
    }, talks.map((t) => t.def));

    // ── 4. B answers each talk with its designated outcome (pair-direct submit) ─
    for (const t of talks) {
      await pageB.evaluate(
        async ({ def, answers, authorId, authorName }) => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          app?.peerMeshService?.cacheTalkBody?.(def.id, def);
          await app.submitTalkResponsePairDirect({
            talkId: def.id,
            talkData: def,
            answers,
            isChatbotResponse: false,
            authorId,
            authorName,
            isAutoResponse: false,
          });
        },
        { def: t.def, answers: t.answers, authorId: userIdA, authorName: 'StatsA' },
      );
    }

    // ── 5. A drains its mailbox until all four responses are recorded in the ledger ─
    const flowId = talks[0].def.id;
    const tagId = talks[1].def.id;
    const surveyId = talks[2].def.id;
    const routeId = talks[3].def.id;

    // Wait for all four outcomes to land, then trigger the UI stats path on the Talks tab.
    await expect
      .poll(
        async () =>
          pageA!.evaluate(
            async ({ ids, aId }) => {
              const app = (window as any).__iinpublic_app?.getApp?.();
              await app.drainMailbox?.();
              // Count author-side ledger outcomes via localTalkExchanges (author 'sent' projection is
              // recorded on receipt; every received response also writes a ledger outcome). We read the
              // localTalkExchanges map keyed by `${responderId}::${talkId}` as a robust proxy.
              const exchanges = JSON.parse(localStorage.getItem('localTalkExchanges') || '{}');
              const have = (tid: string) =>
                Object.keys(exchanges).some((k) => k.endsWith(`::${tid}`));
              void aId;
              return ids.every((id: string) => have(id));
            },
            { ids: [flowId, tagId, surveyId, routeId], aId: userIdA },
          ),
        { timeout: FLOW_TIMEOUT_MS, intervals: [400, 800, 1200], message: 'A: not all four responses recorded' },
      )
      .toBe(true);

    // ── 6. Render the Talks tab (out mode) so `needTalkStats` populates talkStatsMap ─
    await waitForTabActive(pageA, 'talks');
    await pageA.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      // default talksViewMode 'all' renders the OUT section too; force a re-render to emit needTalkStats.
      app?.uiManager?.displayTalksList?.();
    });

    // Poll the in-memory talkStatsMap (authoritative source the UI renders from) until the
    // four outcomes have been aggregated by the needTalkStats handler.
    const readStats = () =>
      pageA!.evaluate(() => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        const ui: any = app?.uiManager;
        // talkStatsMap is private; read via the same accessor the status bar uses plus a JSON dump.
        const map = (ui as any).talkStatsMap ?? {};
        return JSON.parse(JSON.stringify(map));
      });

    await expect
      .poll(
        async () => {
          await pageA!.evaluate(() => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            app?.uiManager?.displayTalksList?.();
          });
          const map = await readStats();
          const s = (id: string) => map[id]?.responses ?? 0;
          return s(flowId) + s(tagId) + s(surveyId) + s(routeId);
        },
        { timeout: FLOW_TIMEOUT_MS, intervals: [400, 800, 1200], message: 'A: talkStatsMap did not aggregate 4 responses' },
      )
      .toBe(4);

    const stats = await readStats();

    // ── 7. Per-talk assertions anchored to checkIfMatch semantics ────────────
    expect(stats[flowId], 'flow talk stats').toMatchObject({ responses: 1, matches: 1 });
    expect(stats[tagId], 'tag talk stats').toMatchObject({ responses: 1, matches: 1 });
    expect(stats[surveyId], 'survey talk stats (neutral → 0 matches)').toMatchObject({ responses: 1, matches: 0 });
    expect(stats[routeId], 'route talk stats (terminal → 0 matches)').toMatchObject({ responses: 1, matches: 0 });

    // ── 8. Aggregate: overall responses = 4, overall matches = 2 ─────────────
    const totalResponses = [flowId, tagId, surveyId, routeId].reduce((sum, id) => sum + (stats[id]?.responses ?? 0), 0);
    const totalMatches = [flowId, tagId, surveyId, routeId].reduce((sum, id) => sum + (stats[id]?.matches ?? 0), 0);
    expect(totalResponses, 'overall responses across the four types').toBe(4);
    expect(totalMatches, 'overall matches (only flow + tag can match)').toBe(2);

    // getTotalMatches() drives the status-bar aggregate ("N matches").
    const statusBarMatches = await pageA.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      return app?.uiManager?.getTotalMatches?.() ?? -1;
    });
    expect(statusBarMatches, 'status-bar aggregate match count = 2').toBe(2);

    // ── 9. Per-talk rendered stats line reflects the counts (DOM surface) ─────
    const flowLine = await pageA
      .locator(`.talk-list-item[data-talk-id="${flowId}"] .talk-item-stats`)
      .first()
      .textContent();
    expect(flowLine ?? '', 'flow per-talk stats line').toMatch(/Responses:\s*1/);
    expect(flowLine ?? '', 'flow per-talk stats line matches').toMatch(/Matches:\s*1/);

    const surveyLine = await pageA
      .locator(`.talk-list-item[data-talk-id="${surveyId}"] .talk-item-stats`)
      .first()
      .textContent();
    expect(surveyLine ?? '', 'survey per-talk stats line').toMatch(/Responses:\s*1/);
    expect(surveyLine ?? '', 'survey per-talk stats line 0 matches').toMatch(/Matches:\s*0/);
  });
});
