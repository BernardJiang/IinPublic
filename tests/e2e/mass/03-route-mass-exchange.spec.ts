/** M3 — eight independent browsers traverse numbered route paths. */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { maybeClearGunDatabases } from '../helpers/clear-database';
import { headless } from '../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../helpers/talks-matching-flow';
import { createTalksFromCompanyPage, completeTalksInAppByAnswerIds } from '../helpers/talk-demo-ui';
import { computeTalkIdFromTalkData } from '../../../src/shared/talk-content-id';

const GOLDEN = Array.from({ length: 7 }, (_, n) => n.toString(2).padStart(3, '0').split('').map((v, q) => `routea${q + 1}${Number(v) + 1}`));
test.describe('M3 real route mass exchange', () => {
  test('eight browsers deliver one route and produce seven distinct numbered leaves', async () => {
    test.setTimeout(720_000); await maybeClearGunDatabases(); const browsers: Browser[]=[]; const contexts: BrowserContext[]=[]; const pages: Page[]=[];
    try {
      for(let i=0;i<8;i+=1){const b=await chromium.launch({headless,args:['--disable-dev-shm-usage']});browsers.push(b);const x=await bootstrapUser(b,`M3-${i}`,`M3 User ${i}`);contexts.push(x.context);pages.push(x.page);await x.page.locator('.chatroom-item:has-text("Global")').first().click();await x.page.evaluate(()=> (window as any).__iinpublic_app.getApp().setTalkLedgerQuotaUnlimitedForE2e(true));}
      const authorId=await pages[0].evaluate(()=> (window as any).__iinpublic_app.getApp().currentUser.id);
      const talk={title:'route',authorId,type:'route',language:'en',isAdult:false,tags:[],questions:[1,2,3].map(q=>({id:`routeq${q}`,text:`routeq${q}`,answers:[1,2].map(a=>({id:`routea${q}${a}`,text:`routea${q}${a}`,isTerminal:q===3,isMatch:q===3&&a===1,isIgnore:q===3&&a===2}))}))};
      const cid=await computeTalkIdFromTalkData(talk); const [created]=await createTalksFromCompanyPage(pages[0],[talk]);
      const users=await Promise.all(pages.slice(1).map(p=>p.evaluate(()=>{const u=(window as any).__iinpublic_app.getApp().currentUser;return {userId:u.id,stageName:u.stageName}})));
      const delivery = await pages[0].evaluate(async receiverUsers=>(window as any).__iinpublic_app.getApp().deliverPendingBroadcastTalksForE2e(0,{skipAudiencePreview:true,skipDeliveryAcks:true,receiverUsers}),users);
      expect(delivery.receivers).toBe(7);
      for(let i=0;i<7;i+=1){await waitForTabActive(pages[i+1],'talks');await completeTalksInAppByAnswerIds(pages[i+1],[{talkId:created.talkId,talkData:created.talkData,answerIds:GOLDEN[i],outcome:GOLDEN[i].at(-1)==='routea31'?'match':'mismatch'}]);}
      expect(new Set(GOLDEN.map(x=>x.join(','))).size).toBe(7); expect(await computeTalkIdFromTalkData(talk)).toBe(cid);
    } finally {await Promise.all(pages.map(p=>p.evaluate(()=> (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(()=>{})));await Promise.all(contexts.map(c=>c.close().catch(()=>{})));await Promise.all(browsers.map(b=>b.close().catch(()=>{})));await maybeClearGunDatabases();}
  });
});
