/**
 * P1 pair-private isolation:
 * Bob broadcasts one talk to Alice and Tom. Alice answers and sends Bob a DM.
 * Tom may learn public routing metadata, but must not recover Alice<->Bob payloads.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, E2E_ASSERT_TIMEOUT_MS } from '../../helpers/timing';
import { launchThreeBrowsers, shutdownThreeBrowsers, type ThreeBrowsers } from '../../helpers/talks-matching-browsers';
import {
  bootstrapUser,
  finalCleanupPages,
  resetTalksMatchingSession,
  waitForIncomingTalkClusterOnLocalGun,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import { createSimpleFlowTalk, goToChatrooms } from '../../helpers/broadcast-cancellation-helpers';
import {
  clickBroadcastUntilBulkAck,
  completeTalkInAppByAnswerIds,
  findIncomingTalkIdByTitle,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { prepareDirectP2PConversation, assertGunStoredMessageBodies } from '../../helpers/p2p-transport-e2e';
import { gunBaseURL, isMeshTalkDeliveryE2e } from '../../helpers/ports';

type UserIdentity = { id: string; stageName: string; epub?: string };

async function currentUser(page: Page): Promise<UserIdentity> {
  return page.evaluate(() => {
    const user = (window as any).__iinpublic_app?.getApp?.()?.currentUser || {};
    return {
      id: String(user.id || ''),
      stageName: String(user.stageName || ''),
      epub: user.epub ? String(user.epub) : undefined,
    };
  });
}

async function collectRawPairResponses(page: Page, pairId: string, talkId: string): Promise<any[]> {
  return page.evaluate(
    async ({ p, t }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const gun = app?.gunService?.getGun?.();
      if (!gun) return [];
      return new Promise<any[]>((resolve) => {
        const rows: any[] = [];
        const ref = gun.get('pairTalkResponses').get(p).get(t).map();
        ref.once((raw: unknown, key: string) => {
          if (raw && key && !key.startsWith('_')) rows.push(raw);
        });
        setTimeout(() => {
          try {
            ref.off();
          } catch {
            /* ignore */
          }
          resolve(rows);
        }, 600);
      });
    },
    { p: pairId, t: talkId },
  );
}

async function thirdPartyDecryptPairResponses(
  page: Page,
  pairId: string,
  talkId: string,
  peerIds: string[],
): Promise<{ visible: number; decrypted: string[]; errors: number }> {
  return page.evaluate(
    async ({ p, t, ids }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const gun = app?.gunService?.getGun?.();
      const SEA = (window as any).SEA || (window as any).Gun?.SEA;
      const pair = app?.gunService?.getStoredPair?.();
      if (!gun || !SEA || !pair) return { visible: 0, decrypted: [], errors: 0 };
      const rows: any[] = await new Promise((resolve) => {
        const found: any[] = [];
        const ref = gun.get('pairTalkResponses').get(p).get(t).map();
        ref.once((raw: unknown, key: string) => {
          if (raw && key && !key.startsWith('_')) found.push(raw);
        });
        setTimeout(() => {
          try {
            ref.off();
          } catch {
            /* ignore */
          }
          resolve(found);
        }, 600);
      });
      const decrypted: string[] = [];
      let errors = 0;
      for (const row of rows) {
        const ciphertext = String(row?.payloadCiphertext || '');
        if (!ciphertext) continue;
        for (const peerId of ids) {
          try {
            const peer = await app.userService?.getUser?.(peerId);
            if (!peer?.epub) continue;
            const secret = await SEA.secret(peer.epub, pair);
            const plain = await SEA.decrypt(ciphertext, secret);
            if (plain) decrypted.push(String(plain));
          } catch {
            errors += 1;
          }
        }
      }
      return { visible: rows.length, decrypted, errors };
    },
    { p: pairId, t: talkId, ids: peerIds },
  );
}

async function assertCanonicalTalkBodyDedup(
  page: Page,
  authorId: string,
  talkId: string,
  receiverIds: string[],
): Promise<void> {
  const res = await page.request.get(`${gunBaseURL()}/api/test/export-snapshot`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { gunGraph?: Record<string, any> };
  const graph = body.gunGraph ?? {};
  expect(graph[`peerTalkCatalog/${authorId}/${talkId}`]).toBeTruthy();
  for (const receiverId of receiverIds) {
    const offerNodes = Object.entries(graph).filter(([soul]) => soul.startsWith(`peerTalkOffers/${receiverId}/`));
    expect(offerNodes.length).toBeGreaterThan(0);
    for (const [, raw] of offerNodes) {
      expect((raw as any)?.talkData).toBeFalsy();
      expect(JSON.stringify((raw as any)?.talkRef || raw)).toContain(talkId);
    }
  }
}

async function assertNoLegacyTalkDeliveryGraph(
  page: Page,
  authorId: string,
  talkId: string,
  receiverIds: string[],
): Promise<void> {
  const res = await page.request.get(`${gunBaseURL()}/api/test/export-snapshot`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { gunGraph?: Record<string, any> };
  const graph = body.gunGraph ?? {};
  expect(graph[`peerTalkCatalog/${authorId}/${talkId}`]).toBeFalsy();
  for (const receiverId of receiverIds) {
    const offerNodes = Object.keys(graph).filter((soul) => soul.startsWith(`peerTalkOffers/${receiverId}/`));
    expect(offerNodes).toHaveLength(0);
  }
}

async function waitForLocalTalkExchange(
  page: Page,
  peerId: string,
  talkId: string,
  outcome: 'match' | 'mismatch' | 'ignore',
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ pid, tid, expected }) => {
            const raw = localStorage.getItem('localTalkExchanges');
            const rows = raw ? JSON.parse(raw) : {};
            const row = rows[`${pid}::${tid}`];
            return row?.outcome === expected;
          },
          { pid: peerId, tid: talkId, expected: outcome },
        ),
      { timeout: 30_000, intervals: [300, 600, 1000] },
    )
    .toBe(true);
}

test.describe('Pair-private graph isolation', () => {
  let browsers: ThreeBrowsers;
  let browserBob: Browser;
  let browserAlice: Browser;
  let browserTom: Browser;
  let contextBob: BrowserContext | undefined;
  let contextAlice: BrowserContext | undefined;
  let contextTom: BrowserContext | undefined;
  let pageBob: Page | undefined;
  let pageAlice: Page | undefined;
  let pageTom: Page | undefined;

  test.beforeAll(async () => {
    await clearGunForStage3Spec();
    browsers = await launchThreeBrowsers();
    browserBob = browsers.tom;
    browserAlice = browsers.jerry;
    browserTom = browsers.bob;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { bob: pageBob, alice: pageAlice, tom: pageTom },
      { bob: contextBob, alice: contextAlice, tom: contextTom },
      clearGunForStage3Spec,
    );
    pageBob = pageAlice = pageTom = undefined;
    contextBob = contextAlice = contextTom = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { bob: pageBob, alice: pageAlice, tom: pageTom },
      { bob: contextBob, alice: contextAlice, tom: contextTom },
    );
    await shutdownThreeBrowsers(browsers);
    await clearGunForStage3Spec();
  });

  test('same talk to Alice and Tom keeps Alice/Bob answer and DM ciphertext pair-private', async () => {
    test.setTimeout(180_000);
    const title = `P1 pair-private isolation ${Date.now()}`;
    const aliceAnswerText = 'Yes';
    const dmText = `Alice private DM ${Date.now()}`;

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob P1');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');

    const alice = await bootstrapUser(browserAlice, 'Alice', 'Alice P1');
    contextAlice = alice.context;
    pageAlice = alice.page;
    await pageAlice.click('.chatroom-item:has-text("Global")');

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom P1');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const bobUser = await currentUser(pageBob);
    const aliceUser = await currentUser(pageAlice);
    const tomUser = await currentUser(pageTom);
    expect(bobUser.id).toBeTruthy();
    expect(aliceUser.id).toBeTruthy();
    expect(tomUser.id).toBeTruthy();

    await expect.poll(() => pageBob!.evaluate(() => !!(window as any).__iinpublic_app?.getApp?.()?.isDirectTalkDeliveryEnabled?.())).toBe(true);
    await expect.poll(() => pageAlice!.evaluate(() => !!(window as any).__iinpublic_app?.getApp?.()?.isDirectTalkDeliveryEnabled?.())).toBe(true);
    await expect.poll(() => pageTom!.evaluate(() => !!(window as any).__iinpublic_app?.getApp?.()?.isDirectTalkDeliveryEnabled?.())).toBe(true);

    await createSimpleFlowTalk(pageBob, title, aliceAnswerText, 'No', { sendToChatroom: false });
    await goToChatrooms(pageBob);
    await pageBob.click('.chatroom-item:has-text("Global")');
    await waitForDistinctGunPeersExcludingSelf(pageBob, 2, 120_000);
    await clickBroadcastUntilBulkAck(pageBob, { minGunPeers: 2, minSent: 1 });

    await waitForIncomingTalkClusterOnLocalGun(pageAlice, title, { timeout: 60_000, polling: 500 });
    await waitForIncomingTalkClusterOnLocalGun(pageTom, title, { timeout: 60_000, polling: 500 });

    const talkId = await findIncomingTalkIdByTitle(pageAlice, title);
    const talkData = await pageAlice.evaluate(async (id) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      return app?.talkService?.getTalkWithRetry?.(id, { attempts: 30, gapMs: 250 }) ?? null;
    }, talkId);
    expect(talkData).toBeTruthy();
    const matchAnswerId = String(talkData.questions?.[0]?.answers?.[0]?.id || '');
    expect(matchAnswerId).toBeTruthy();

    await completeTalkInAppByAnswerIds(pageAlice, talkId, talkData, [matchAnswerId], 'match');

    const bobAlicePairId = [bobUser.id, aliceUser.id].sort().join('__');
    if (isMeshTalkDeliveryE2e()) {
      await waitForLocalTalkExchange(pageBob, aliceUser.id, talkId, 'match');
      expect(await collectRawPairResponses(pageBob, bobAlicePairId, talkId)).toHaveLength(0);
      const tomDecryption = await thirdPartyDecryptPairResponses(pageTom, bobAlicePairId, talkId, [
        bobUser.id,
        aliceUser.id,
      ]);
      expect(tomDecryption.visible).toBe(0);
      expect(tomDecryption.decrypted).toHaveLength(0);
    } else {
      await expect
        .poll(async () => collectRawPairResponses(pageBob!, bobAlicePairId, talkId), {
          timeout: 20_000,
          intervals: [500, 1000],
        })
        .toHaveLength(1);

      const rawResponses = await collectRawPairResponses(pageBob, bobAlicePairId, talkId);
      const rawResponseJson = JSON.stringify(rawResponses);
      expect(rawResponses[0]?.encryption).toBe('sea-ecdh-v1');
      expect(typeof rawResponses[0]?.payloadCiphertext).toBe('string');
      expect(rawResponseJson.includes(aliceAnswerText)).toBe(false);
      expect(rawResponseJson.includes('Alice P1')).toBe(false);
      expect(rawResponseJson.includes('Bob P1')).toBe(false);

      const tomDecryption = await thirdPartyDecryptPairResponses(pageTom, bobAlicePairId, talkId, [
        bobUser.id,
        aliceUser.id,
      ]);
      expect(tomDecryption.decrypted).toHaveLength(0);
    }

    const conversationId = await prepareDirectP2PConversation(
      pageBob,
      pageAlice,
      bobUser.id,
      aliceUser.id,
      'Bob P1',
      'Alice P1',
    );
    await pageAlice.evaluate(
      async ({ cid, text }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        const userId = String(app?.currentUser?.id || '');
        if (!userId) throw new Error('no current user');
        await app?.conversationService?.sendMessage?.(cid, userId, text);
      },
      { cid: conversationId, text: dmText },
    );

    await assertGunStoredMessageBodies(pageBob, conversationId, 1, [dmText]);
    if (isMeshTalkDeliveryE2e()) {
      await assertNoLegacyTalkDeliveryGraph(pageBob, bobUser.id, talkId, [aliceUser.id, tomUser.id]);
    } else {
      await assertCanonicalTalkBodyDedup(pageBob, bobUser.id, talkId, [aliceUser.id, tomUser.id]);
    }

    const snapshot = await pageTom.request.get(`${gunBaseURL()}/api/test/export-snapshot`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    expect(snapshot.ok()).toBeTruthy();
    const graph = ((await snapshot.json()) as { gunGraph?: Record<string, any> }).gunGraph ?? {};
    const pairConversationRaw = Object.entries(graph)
      .filter(([soul]) => soul.startsWith(`pairConversations/${bobAlicePairId}/${conversationId}/messages/`))
      .map(([, raw]) => raw);
    expect(pairConversationRaw.length).toBeGreaterThanOrEqual(1);
    for (const raw of pairConversationRaw) {
      expect((raw as any)?.encryption).toBe('sea-ecdh-v1');
      expect(JSON.stringify(raw).includes(dmText)).toBe(false);
    }

    await pageTom.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageTom, 'talks');
    await expect(pageTom.locator('.talk-list-item[data-role="incoming"]', { hasText: title })).toBeVisible({
      timeout: E2E_ASSERT_TIMEOUT_MS,
    });
  });
});
