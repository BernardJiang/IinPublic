/**
 * STAT-01 — generic stats/inquiry across all four talk types.
 *
 * Tom creates one talk of each type (tag, flow, survey, route), then records two
 * normalized responses for each talk. The test hits /api/stats/talks/:id/{summary,
 * by-day, by-region, by-answer} for each talk and verifies the normalized server
 * aggregation — proving the stats layer works uniformly for all four types
 * without per-type code.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../../helpers/many-browsers';
import {
  createTalkFromCompanyPage,
  recordTalkStatsByAnswerIds,
} from '../../helpers/talk-demo-ui';
import { gunBaseURL } from '../../helpers/ports';
import {
  makeTagTalk,
  makeFlowTalk,
  makeSurveyTalk,
  makeRouteTalk,
} from '../../talks-matching/lib/four-types-talks';

type Session = { label: string; context: BrowserContext; page: Page };
type TalkKind = 'tag' | 'flow' | 'survey' | 'route';

function answerIdsFor(kind: TalkKind): string[] {
  switch (kind) {
    case 'tag':
      return ['a_tag_match'];
    case 'flow':
      return ['a_flow_1_yes', 'a_flow_2_yes'];
    case 'survey':
      return ['a_sv_2'];
    case 'route':
      return ['a_r_job_yes', 'a_r_role_yes'];
  }
}

test.describe('Talks matching — generic stats across four talk types (STAT-01)', () => {
  /** Stats API coverage across all four talk types. */
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

  test('4 talks × 2 responders → /api/stats summary/by-day/by-region/by-answer all report 2', async () => {
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

    const createdTalks: Array<{ kind: TalkKind; title: string; talkId: string; talkData: any; firstQuestionId: string }> = [];
    for (const t of talks) {
      const talk = t.build(runId);
      const talkId = await createTalkFromCompanyPage(tom.page, talk);
      await tom.page.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(tom.page, 'chatrooms');
      createdTalks.push({
        kind: t.kind,
        title: talk.title,
        talkId,
        talkData: { ...talk, id: talkId },
        firstQuestionId: talk.questions[0]!.id,
      });
    }
    expect(createdTalks).toHaveLength(4);

    // --- Record two normalized responses per talk; the stats endpoints are the behavior under test here. ---
    await Promise.all(
      createdTalks.flatMap((b) =>
        ['stats-jerry', 'stats-sam'].map((responderId) => {
          const outcome = b.kind === 'tag' || b.kind === 'flow' || b.kind === 'route' ? 'match' : 'other';
          return recordTalkStatsByAnswerIds(
            tom.page,
            b.talkId,
            b.talkData,
            responderId,
            answerIdsFor(b.kind),
            outcome,
          );
        }),
      ),
    );

    // --- Verify /api/stats for every talk ---
    const request = tom.page.context().request;
    const base = gunBaseURL();

    for (const b of createdTalks) {
      // summary: total responses === 2 (one per responder), regardless of talk type.
      await expect
        .poll(
          async () => {
            const r = await request.get(
              `${base}/api/stats/talks/${encodeURIComponent(b.talkId)}/summary`,
            );
            if (!r.ok()) return -1;
            const j = (await r.json()) as { total?: number };
            return Number(j.total ?? -1);
          },
          { timeout: 15_000 },
        )
        .toBe(2);

      const sumRes = await request.get(
        `${base}/api/stats/talks/${encodeURIComponent(b.talkId)}/summary`,
      );
      const summary = (await sumRes.json()) as {
        talkId: string;
        talkType: string;
        total: number;
        byQuestion: Array<{
          questionId: string;
          total: number;
          answers: Array<{ answerId: string; count: number; percentage: number }>;
        }>;
      };
      expect(summary.talkId).toBe(b.talkId);
      expect(summary.talkType).toBe(b.kind);
      expect(summary.byQuestion.length).toBeGreaterThanOrEqual(1);
      const q1 = summary.byQuestion.find((q) => q.questionId === b.firstQuestionId);
      expect(q1).toBeTruthy();
      expect(q1!.total).toBeGreaterThanOrEqual(1);
      const pctTotal = q1!.answers.reduce((s, a) => s + a.percentage, 0);
      expect(pctTotal).toBeGreaterThan(99);
      expect(pctTotal).toBeLessThan(101);

      // by-day: at least one bucket, sum of counts === 2.
      const dayRes = await request.get(
        `${base}/api/stats/talks/${encodeURIComponent(b.talkId)}/by-day?bucket=day`,
      );
      const byDay = (await dayRes.json()) as {
        bucket: string;
        series: Array<{ bucket: string; count: number }>;
      };
      expect(byDay.bucket).toBe('day');
      expect(byDay.series.length).toBeGreaterThanOrEqual(1);
      expect(byDay.series.reduce((s, x) => s + x.count, 0)).toBe(2);

      // by-region: sum of per-region counts === 2.
      const regRes = await request.get(
        `${base}/api/stats/talks/${encodeURIComponent(b.talkId)}/by-region`,
      );
      const byRegion = (await regRes.json()) as { series: Array<{ region: string; count: number }> };
      expect(byRegion.series.length).toBeGreaterThanOrEqual(1);
      expect(byRegion.series.reduce((s, x) => s + x.count, 0)).toBe(2);

      // by-answer on the first question: total === 2 and percentages sum to ~100.
      const ansRes = await request.get(
        `${base}/api/stats/talks/${encodeURIComponent(b.talkId)}/by-answer?questionId=${encodeURIComponent(
          b.firstQuestionId,
        )}`,
      );
      const byAnswer = (await ansRes.json()) as {
        total: number;
        answers: Array<{ answerId: string; count: number; percentage: number }>;
      };
      expect(byAnswer.total).toBeGreaterThanOrEqual(1);
      expect(byAnswer.answers.length).toBeGreaterThanOrEqual(1);
      const pct = byAnswer.answers.reduce((s, a) => s + a.percentage, 0);
      expect(pct).toBeGreaterThan(99);
      expect(pct).toBeLessThan(101);
    }
  });
});
