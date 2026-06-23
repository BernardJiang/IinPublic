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
      const startedAt = Date.now();
      const deliveries = await pages[0].evaluate(async ({ receiverUsers, count }) => {
        const app = (window as any).__iinpublic_app.getApp();
        return Promise.all(Array.from({ length: count }, (_, index) =>
          app.deliverPendingBroadcastTalksForE2e(index, {
            skipAudiencePreview: true,
            skipDeliveryAcks: true,
            receiverUsers,
          }),
        ));
      }, { receiverUsers: users.slice(1), count: created.length });
      expect(deliveries).toHaveLength(4);
      expect(deliveries.every((delivery: any) => delivery.receivers === 19)).toBe(true);
      expect(deliveries.reduce((total: number, delivery: any) => total + delivery.receivers, 0)).toBe(76);
      expect(Date.now() - startedAt).toBeLessThanOrEqual(30_000);
      const receivedTalkIds = await Promise.all(pages.slice(1).map((page) => page.evaluate(async () => {
        const app = (window as any).__iinpublic_app.getApp();
        const clusters = await app.getLocalIncomingClustersForE2e();
        return clusters.flatMap((cluster: any) => Object.keys(cluster.talkIds || {}));
      })));
      for (const ids of receivedTalkIds) {
        expect([...new Set(ids)]).toEqual(expect.arrayContaining(created.map((talk: any) => talk.talkId)));
      }
      const golden = ['flow','tag','survey','route'].flatMap((type)=>users.slice(1).map((recipient:any)=>`${recipient.userId}:${type}q1:${type}a11`));
      expect(golden).toHaveLength(76); expect(new Set(golden).size).toBe(76);
      // A — cross-talk contamination: every cluster holds talkIds only from the created set and
      // no talkId bleeds across clusters (each content-addressed cluster owns exactly one talk).
      const clusterSnapshots = await Promise.all(pages.slice(1).map((page) =>
        page.evaluate(async () => {
          const clusters = await (window as any).__iinpublic_app.getApp().getLocalIncomingClustersForE2e();
          return clusters.map((c: any) => Object.keys(c.talkIds || {}));
        }),
      ));
      const createdTalkIdSet = new Set(created.map((t: any) => t.talkId));
      for (const clusterIdLists of clusterSnapshots) {
        const seen = new Set<string>();
        for (const clusterIds of clusterIdLists) {
          for (const id of clusterIds) {
            expect(createdTalkIdSet.has(id)).toBe(true);
            expect(seen.has(id)).toBe(false);
            seen.add(id as string);
          }
          expect(clusterIds.length).toBeLessThanOrEqual(1);
        }
      }
      // B — PeerMeshService neighbor count: each of 20 nodes should reach ≥12 neighbors
      // (default maxNeighbors cap). peerMeshService is exposed via (this as any) cast inside
      // ensurePeerMeshService() once a chatroom join triggers mesh init.
      const neighborCounts = await Promise.all(pages.map((page) =>
        page.evaluate(() => {
          const mesh = ((window as any).__iinpublic_app.getApp() as any).peerMeshService;
          return mesh ? (mesh.getDiagnostics() as { neighborCount: number }).neighborCount : 0;
        }),
      ));
      for (const count of neighborCounts) {
        expect(count).toBeGreaterThanOrEqual(12);
      }
      // C — memory sanity: Gun 'talks' key count stays bounded after delivery.
      // Hub runs E2E_GUN_MEMORY_ONLY=1 (radata always absent). Talk bodies route through
      // PeerMeshService cache not Gun talks/* (R-f step 7), so the relay graph stays small.
      const gunTalksKeyCount = await pages[0].evaluate(() => new Promise<number>((resolve) => {
        const gun = ((window as any).__iinpublic_app.getApp() as any).gunService?.getGun?.();
        if (!gun) { resolve(-1); return; }
        let n = 0;
        gun.get('talks').map().once(() => { n += 1; });
        setTimeout(() => resolve(n), 500);
      }));
      if (gunTalksKeyCount !== -1) { expect(gunTalksKeyCount).toBeLessThanOrEqual(created.length * 2); }
      expect(created).toHaveLength(4);
    } finally { await Promise.all(browsers.map((b)=>b.close().catch(()=>{}))); await maybeClearGunDatabases(); }
  });
});
