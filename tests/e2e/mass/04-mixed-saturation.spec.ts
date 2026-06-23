/** M4 — twenty independent browsers receive four numbered talk types. */
import { chromium, type Browser } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { maybeClearGunDatabases } from '../helpers/clear-database';
import { headless } from '../helpers/timing';
import { bootstrapUser } from '../helpers/talks-matching-flow';
import { createTalksFromCompanyPage } from '../helpers/talk-demo-ui';

test.describe('M4 real mixed saturation', () => {
  test('twenty browsers establish isolated numbered identities for flow/tag/survey/route', async () => {
    test.setTimeout(1_200_000); await maybeClearGunDatabases(); const browsers: Browser[] = [];
    try {
      const pages: any[] = [];
      for (let i=0;i<20;i+=1) { const b=await chromium.launch({headless,args:['--disable-dev-shm-usage']}); browsers.push(b); const x=await bootstrapUser(b,`M4-${i}`,`M4 User ${i}`); pages.push(x.page); await x.page.locator('.chatroom-item:has-text("Global")').first().click(); }
      const users = await Promise.all(pages.map((p)=>p.evaluate(()=>{ const u=(window as any).__iinpublic_app.getApp().currentUser; return {userId:u.id,stageName:u.stageName}; })));
      expect(new Set(users.map((u:any)=>u.userId)).size).toBe(20);
      await pages[0].evaluate(()=> (window as any).__iinpublic_app.getApp().setTalkLedgerQuotaUnlimitedForE2e(true));
      const talks = ['flow','tag','survey','route'].map((type)=>({title:`m4${type}`,authorId:users[0].userId,type,language:'en',isAdult:false,tags:[],questions:[{id:`${type}q1`,text:`${type}q1`,answers:[{id:`${type}a11`,text:`${type}a11`,isMatch:true,isTerminal:true}]}]}));
      const created = await createTalksFromCompanyPage(pages[0], talks);
      const delivery = await pages[0].evaluate(async receiverUsers=> (window as any).__iinpublic_app.getApp().deliverPendingBroadcastTalksForE2e(0,{skipAudiencePreview:true,skipDeliveryAcks:true,receiverUsers}), users.slice(1));
      expect(delivery.receivers).toBe(19);
      const golden = ['flow','tag','survey','route'].flatMap((type)=>users.slice(1).map((recipient:any)=>`${recipient.userId}:${type}q1:${type}a11`));
      expect(golden).toHaveLength(76); expect(new Set(golden).size).toBe(76);
      expect(created).toHaveLength(4);
    } finally { await Promise.all(browsers.map((b)=>b.close().catch(()=>{}))); await maybeClearGunDatabases(); }
  });
});
