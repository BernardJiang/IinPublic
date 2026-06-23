/** M1 — real ten-browser flow exchange using numbered golden vectors. */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { maybeClearGunDatabases } from '../helpers/clear-database';
import { headless } from '../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../helpers/talks-matching-flow';
import { createTalksFromCompanyPage, completeTalksInAppByAnswerIds } from '../helpers/talk-demo-ui';

const GOLDEN = [
  ['flowa11', 'flowa22', 'flowa33', 'flowa41'], ['flowa11', 'flowa22', 'flowa33', 'flowa42'],
  ['flowa11', 'flowa22', 'flowa33', 'flowa43'], ['flowa12'], ['flowa13'], ['flowa11', 'flowa21'],
  ['flowa11', 'flowa23'], ['flowa11', 'flowa22', 'flowa31'], ['flowa11', 'flowa22', 'flowa32'],
] as const;

function numberedFlow(authorId: string) {
  return {
    title: 'flow', authorId, type: 'flow', language: 'en', isAdult: false, tags: [],
    questions: [1, 2, 3, 4].map((n) => ({
      id: `flowq${n}`, text: `flowq${n}`,
      answers: [1, 2, 3].map((m) => ({
        id: `flowa${n}${m}`, text: `flowa${n}${m}`,
        isMatch: n === 4 && m === 1, isIgnore: (n === 1 && m !== 1) || (n === 2 && m !== 2) || (n === 3 && m !== 3) || (n === 4 && m !== 1),
        isTerminal: n === 4 || !((n === 1 && m === 1) || (n === 2 && m === 2) || (n === 3 && m === 3)),
      })),
    })),
  };
}

test.describe('M1 real flow mass exchange', () => {
  test('ten browsers produce the nine numbered golden response vectors', async () => {
    test.setTimeout(720_000);
    await maybeClearGunDatabases();
    const browsers: Browser[] = []; const contexts: BrowserContext[] = []; const pages: Page[] = [];
    try {
      for (let i = 0; i < 10; i += 1) {
        const browser = await chromium.launch({ headless, args: ['--disable-dev-shm-usage'] });
        browsers.push(browser);
        const boot = await bootstrapUser(browser, `M1-${i}`, `M1 User ${i}`);
        contexts.push(boot.context); pages.push(boot.page);
        await boot.page.locator('.chatroom-item:has-text("Global")').first().click();
        await boot.page.evaluate(() => (window as any).__iinpublic_app.getApp().setTalkLedgerQuotaUnlimitedForE2e(true));
      }
      const creatorId = await pages[0].evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
      const [created] = await createTalksFromCompanyPage(pages[0], [numberedFlow(creatorId)]);
      const users = await Promise.all(pages.slice(1).map((page) => page.evaluate(() => {
        const user = (window as any).__iinpublic_app.getApp().currentUser; return { userId: user.id, stageName: user.stageName };
      })));
      const delivery = await pages[0].evaluate(async (receiverUsers) => {
        const app = (window as any).__iinpublic_app.getApp();
        return app.deliverPendingBroadcastTalksForE2e(0, { skipAudiencePreview: true, skipDeliveryAcks: true, receiverUsers });
      }, users);
      expect(delivery.receivers).toBe(9);
      for (let i = 0; i < GOLDEN.length; i += 1) {
        await waitForTabActive(pages[i + 1], 'talks');
        await completeTalksInAppByAnswerIds(pages[i + 1], [{ talkId: created.talkId, talkData: created.talkData, answerIds: [...GOLDEN[i]], outcome: GOLDEN[i].at(-1) === 'flowa41' ? 'match' : 'mismatch' }]);
      }
      await expect.poll(() => pages[0].evaluate((talkId) => Object.values(JSON.parse(localStorage.getItem('localTalkExchanges') || '{}')).filter((row: any) => row.talkId === talkId).length, created.talkId), { timeout: 120_000 }).toBe(9);

      // A. Match / ignore split: only the golden path ending 'flowa41' (isMatch:true) is a match.
      const expectedMatchCount = GOLDEN.filter((v) => v.at(-1) === 'flowa41').length;
      await expect.poll(
        () => pages[0].evaluate((tid) => {
          const rows = Object.values(JSON.parse(localStorage.getItem('localTalkExchanges') || '{}')) as any[];
          const forTalk = rows.filter((r: any) => r.talkId === tid);
          return {
            matched: forTalk.filter((r: any) => r.outcome === 'match').length,
            notMatched: forTalk.filter((r: any) => r.outcome !== 'match').length,
          };
        }, created.talkId),
        { timeout: 30_000 },
      ).toEqual({ matched: expectedMatchCount, notMatched: GOLDEN.length - expectedMatchCount });

      // C. Stats: matchRate in local ledger equals matchedCount / totalResponses.
      const matchRateActual = await pages[0].evaluate((tid) => {
        const rows = Object.values(JSON.parse(localStorage.getItem('localTalkExchanges') || '{}')) as any[];
        const forTalk = rows.filter((r: any) => r.talkId === tid);
        const matchedCount = forTalk.filter((r: any) => r.outcome === 'match').length;
        return matchedCount / Math.max(forTalk.length, 1);
      }, created.talkId);
      expect(matchRateActual).toBeCloseTo(expectedMatchCount / GOLDEN.length, 4);
    } finally {
      await Promise.all(pages.map((page) => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
      await Promise.all(contexts.map((context) => context.close().catch(() => {})));
      await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
      await maybeClearGunDatabases();
    }
  });
});
