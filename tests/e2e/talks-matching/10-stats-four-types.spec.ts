/**
 * STAT-01 — generic stats/inquiry across all four talk types.
 *
 * Tom broadcasts one talk of each type (tag, flow, survey, route). Jerry and Sam
 * manually answer every talk. Then the test hits /api/stats/talks/:id/{summary,
 * by-day, by-region, by-answer} for each talk and verifies the normalized server
 * aggregation — proving the stats layer works uniformly for all four types
 * without per-type code.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunDatabases } from '../helpers/clear-database';
import { afterSync } from '../helpers/timing';
import {
  bootstrapUser,
  openIncomingTalkModalByTalkId,
  waitForResponseModalClosed,
  waitForTabActive,
} from '../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../helpers/many-browsers';
import { emitCreateTalkFromCompanyPage, waitForOutgoingTalkRow } from '../helpers/talk-demo-ui';
import { gunBaseURL } from '../helpers/ports';
import {
  makeTagTalk,
  makeFlowTalk,
  makeSurveyTalk,
  makeRouteTalk,
} from './lib/four-types-talks';

type Session = { label: string; context: BrowserContext; page: Page };
type TalkKind = 'tag' | 'flow' | 'survey' | 'route';

/**
 * Answer one talk manually. For tag talks the modal is checkbox+submit; the rest use
 * per-question radios with data-mode="manual" — we pick the first match-capable radio
 * each step and let the modal advance until it closes.
 */
async function manualAnswer(page: Page, kind: TalkKind, title: string, talkId: string): Promise<void> {
  await openIncomingTalkModalByTalkId(page, talkId, title);
  const modal = page.locator('#talk-response-modal');
  if (kind === 'tag') {
    const checkbox = modal.locator('#tag-match-checkbox');
    await expect(checkbox).toBeVisible({ timeout: 15_000 });
    if (!(await checkbox.isChecked())) await checkbox.click();
    await modal.locator('#tag-submit-btn').click();
  } else {
    for (let step = 0; step < 10; step += 1) {
      const open = await modal.isVisible().catch(() => false);
      if (!open) break;
      const firstManual = modal
        .locator('input.choice-radio[data-mode="manual"]')
        .first();
      try {
        await expect(firstManual).toBeVisible({ timeout: 15_000 });
      } catch {
        break;
      }
      await firstManual.click();
      await afterSync();
    }
  }
  await waitForResponseModalClosed(page);
  await waitForTabActive(page, 'talks');
}

test.describe('Talks matching — generic stats across four talk types (STAT-01)', () => {
  /** Four dual bulk-ack broadcasts + eight manual answer flows + stats API polling can exceed 10m on CI. */
  test.setTimeout(1_200_000);

  let browsers: Browser[] = [];
  const sessions: Session[] = [];

  test.beforeAll(async () => {
    await clearGunDatabases();
    browsers = await launchBrowserGrid(3);
  });

  test.afterAll(async () => {
    await disposeE2eSessionList(sessions);
    await shutdownBrowserGrid(browsers);
    await clearGunDatabases();
  });

  test('4 talks × 2 responders → /api/stats summary/by-day/by-region/by-answer all report 2', async () => {
    expect(browsers.length).toBe(3);
    const runId = Date.now();

    // --- Bootstrap Tom (broadcaster), Jerry + Sam (responders) ---
    const tom = await bootstrapUser(browsers[0]!, 'Tom', 'Tom');
    sessions.push({ label: 'Tom', context: tom.context, page: tom.page });
    await tom.page.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(tom.page, 'chatrooms');
    await afterSync();

    const jerry = await bootstrapUser(browsers[1]!, 'Jerry', 'Jerry');
    sessions.push({ label: 'Jerry', context: jerry.context, page: jerry.page });
    await jerry.page.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(jerry.page, 'chatrooms');
    await afterSync();

    const sam = await bootstrapUser(browsers[2]!, 'Sam', 'Sam');
    sessions.push({ label: 'Sam', context: sam.context, page: sam.page });
    await sam.page.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(sam.page, 'chatrooms');
    await afterSync();

    // --- Tom broadcasts all 4 talk types ---
    const talks: Array<{ kind: TalkKind; build: (n: number) => ReturnType<typeof makeTagTalk> }> = [
      { kind: 'tag', build: makeTagTalk },
      { kind: 'flow', build: makeFlowTalk },
      { kind: 'survey', build: makeSurveyTalk },
      { kind: 'route', build: makeRouteTalk },
    ];

    const broadcasts: Array<{ kind: TalkKind; title: string; talkId: string; firstQuestionId: string }> = [];
    for (const t of talks) {
      const talk = t.build(runId);
      await emitCreateTalkFromCompanyPage(tom.page, talk, { minGunPeersExcludingSelf: 2 });
      const talkId = await waitForOutgoingTalkRow(tom.page, talk.title);
      await tom.page.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(tom.page, 'chatrooms');
      await afterSync();
      broadcasts.push({
        kind: t.kind,
        title: talk.title,
        talkId,
        firstQuestionId: talk.questions[0]!.id,
      });
    }
    expect(broadcasts).toHaveLength(4);

    // --- Jerry and Sam each answer all 4 talks manually ---
    for (const b of broadcasts) await manualAnswer(jerry.page, b.kind, b.title, b.talkId);
    for (const b of broadcasts) await manualAnswer(sam.page, b.kind, b.title, b.talkId);

    // --- Verify /api/stats for every talk ---
    const request = tom.page.context().request;
    const base = gunBaseURL();

    for (const b of broadcasts) {
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
          { timeout: 60_000 },
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
