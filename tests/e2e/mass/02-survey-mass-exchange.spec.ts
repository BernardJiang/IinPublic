/** M2 — fifteen real browser users submit deterministic numbered survey vectors. */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { maybeClearGunDatabases } from '../helpers/clear-database';
import { headless } from '../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../helpers/talks-matching-flow';
import { createTalksFromCompanyPage, completeTalksInAppByAnswerIds } from '../helpers/talk-demo-ui';

const vector = (user: number) => Array.from({ length: 5 }, (_, q) => `surveya${q + 1}${((user * 7 + q) % 4) + 1}`);
test.describe('M2 real survey mass exchange', () => {
  test('fifteen browsers submit fourteen golden numbered vectors', async () => {
    test.setTimeout(900_000); await maybeClearGunDatabases();
    const browsers: Browser[] = []; const contexts: BrowserContext[] = []; const pages: Page[] = [];
    try {
      for (let i = 0; i < 15; i += 1) { const b = await chromium.launch({ headless, args: ['--disable-dev-shm-usage'] }); browsers.push(b); const x = await bootstrapUser(b, `M2-${i}`, `M2 User ${i}`); contexts.push(x.context); pages.push(x.page); await x.page.locator('.chatroom-item:has-text("Global")').first().click(); await x.page.evaluate(() => (window as any).__iinpublic_app.getApp().setTalkLedgerQuotaUnlimitedForE2e(true)); }
      const authorId = await pages[0].evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
      const survey = { title: 'survey', authorId, type: 'survey', language: 'en', isAdult: false, tags: [], questions: Array.from({ length: 5 }, (_, q) => ({ id: `surveyq${q + 1}`, text: `surveyq${q + 1}`, answers: [1,2,3,4].map((a) => ({ id: `surveya${q + 1}${a}`, text: `surveya${q + 1}${a}`, isTerminal: q === 4 })) })) };
      const [created] = await createTalksFromCompanyPage(pages[0], [survey]);
      const users = await Promise.all(pages.slice(1).map((p) => p.evaluate(() => { const u = (window as any).__iinpublic_app.getApp().currentUser; return { userId:u.id, stageName:u.stageName }; })));
      const delivery = await pages[0].evaluate(async (receiverUsers) => (window as any).__iinpublic_app.getApp().deliverPendingBroadcastTalksForE2e(0, { skipAudiencePreview:true, skipDeliveryAcks:true, receiverUsers }), users);
      expect(delivery.receivers).toBe(14);
      for (let i=0;i<14;i+=1) { await waitForTabActive(pages[i+1], 'talks'); await completeTalksInAppByAnswerIds(pages[i+1], [{ talkId:created.talkId, talkData:created.talkData, answerIds:vector(i), outcome:'mismatch' }]); }
      await expect.poll(() => pages[0].evaluate((id) => Object.values(JSON.parse(localStorage.getItem('localTalkExchanges') || '{}')).filter((r:any)=>r.talkId===id).length, created.talkId), { timeout:120_000 }).toBe(14);
    } finally { await Promise.all(pages.map((p)=>p.evaluate(()=> (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(()=>{}))); await Promise.all(contexts.map((c)=>c.close().catch(()=>{}))); await Promise.all(browsers.map((b)=>b.close().catch(()=>{}))); await maybeClearGunDatabases(); }
  });
});
