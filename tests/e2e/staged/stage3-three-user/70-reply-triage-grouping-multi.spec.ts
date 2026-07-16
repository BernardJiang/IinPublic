/**
 * Reply-triage grouping semantics across 3 responders (catalog Part 5).
 *
 * Complements 00ad (group-by + date). Seeds a 3×3 reply matrix (one creator, 3
 * responders) and verifies the grouping modes partition the same reply set
 * correctly: no grouping = flat rows; group-by-responder = 3 groups; group-by-talk
 * = 3 groups; and every reply is accounted for in each grouped view.
 */
import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases, injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { afterAction, afterLoad, afterSync } from '../../helpers/timing';
import { waitForTabActive } from '../../helpers/talks-matching-flow';
import { buildMatrixTalks, type MatrixResponder } from '../../helpers/creator-reply-matrix';

const SIZE = 3;
const RESPONDERS: MatrixResponder[] = Array.from({ length: SIZE }, (_, i) => ({
  id: `grp_multi_responder_${i}`,
  stageName: `GM User ${i}`,
}));

test.describe.configure({ timeout: 180_000 });

test.describe('Reply triage grouping across 3 responders', () => {
  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
    await maybeClearGunDatabases();
    browser = await chromium.launch();
  });

  test.afterAll(async () => {
    await page?.close();
    await browser?.close();
    await maybeClearGunDatabases();
  });

  test('no/responder/talk grouping partitions the same 9 replies', async () => {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 } });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'GroupMulti');

    await page.click('.nav-btn[data-view="settings"]');
    await page.fill('#settings-stage-name-input', 'GM Creator');
    await page.locator('#settings-stage-name-input').blur();
    await afterSync();

    const creatorId = await page.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);

    const talks = buildMatrixTalks(creatorId, SIZE);
    // The replies panel derives its rows from localTalkExchanges (P0 step 5 —
    // pair-edge records, no server call), so seed the creator's local exchange
    // store directly: one 'sent' record per talk × responder.
    await page.evaluate(
      ({ seededTalks, responders }) => {
        const exchanges: Record<string, unknown> = {};
        seededTalks.forEach((talk: any, t: number) => {
          responders.forEach((responder: any, r: number) => {
            exchanges[`${responder.id}::${talk.talkId}`] = {
              peerId: responder.id,
              peerName: responder.stageName,
              talkId: talk.talkId,
              title: talk.title,
              type: 'flow',
              language: 'en',
              outcome: r === responders.length - 1 || t === 0 ? 'match' : 'mismatch',
              direction: 'sent',
              date: new Date(Date.now() - (t * 3 + r) * 1000).toISOString(),
              answerMode: 'manual',
              responseId: `matrix_resp_${t}_${r}`,
              answers: [{ questionId: 'q1', answerId: 'a1', answerText: r === responders.length - 1 ? 'Yes' : 'No' }],
            };
          });
        });
        localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
      },
      { seededTalks: talks.map((t) => ({ talkId: t.talkId, title: t.title })), responders: RESPONDERS },
    );

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');
    await afterSync();
    await page.click('[data-testid="replies-filter-toggle"]');

    const total = SIZE * SIZE; // 9
    await expect(page.locator('.creator-reply-row')).toHaveCount(total, { timeout: 60_000 });

    // No grouping → flat rows, no group headers.
    await page.locator('#reply-group-order').selectOption('none');
    await afterAction();
    await expect(page.locator('.creator-reply-group')).toHaveCount(0);
    await expect(page.locator('.creator-reply-row')).toHaveCount(total);

    // Group by responder → 3 groups, each a distinct responder name.
    await page.locator('#reply-group-order').selectOption('responder');
    await afterAction();
    await expect(page.locator('.creator-reply-group')).toHaveCount(SIZE, { timeout: 10_000 });
    for (let i = 0; i < SIZE; i++) {
      await expect(page.locator('.creator-reply-group').nth(i)).toContainText('GM User');
    }
    // Every reply is still present under the grouped view.
    await expect(page.locator('.creator-reply-row')).toHaveCount(total);

    // Group by talk → 3 groups.
    await page.locator('#reply-group-order').selectOption('talk');
    await afterAction();
    await expect(page.locator('.creator-reply-group')).toHaveCount(SIZE, { timeout: 10_000 });
    await expect(page.locator('.creator-reply-row')).toHaveCount(total);
  });
});
