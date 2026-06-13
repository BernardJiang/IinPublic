/**
 * L5 -- matched-talk IPFS attachment auto-share.
 *
 * Tom publishes an encrypted attachment and broadcasts the carrying talk.
 * Jerry matches while Bob ignores. Jerry receives one deterministic share
 * message and fetches/decrypts the bytes; Bob never receives the link.
 * Jerry's mailbox drain is held until reconnect so the queued fallback proves
 * idempotent materialization of the same message.
 */

import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { maybeClearGunDatabases, gotoWebApp } from '../helpers/clear-database';
import { afterAction, afterLoad, afterSync } from '../helpers/timing';
import {
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../helpers/talks-matching-browsers';
import {
  bootstrapUser,
  ensureMeshNeighbors,
  finalCleanupPages,
} from '../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { gunBaseURL, webAppURLStableChatroom } from '../helpers/ports';

const MESH_E2E_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 300_000;

type ShareSnapshot = {
  ids: string[];
  payloads: Array<{ cid: string; link: string; keyCiphertext: string }>;
};

async function getConversationIdForPeer(page: Page, peerId: string): Promise<string> {
  return page.evaluate((otherUserId) => {
    const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
    const hit = Object.entries(conversations).find(([, value]: [string, any]) =>
      value?.otherUserId === otherUserId && value?.supportChannel !== true,
    );
    return String(hit?.[0] || '');
  }, peerId);
}

async function subscribeToShareMessages(
  page: Page,
  conversationId: string,
  otherUserId: string,
): Promise<void> {
  await page.evaluate(
    ({ cid, peerId }) => {
      const root = window as any;
      const app = root.__iinpublic_app?.getApp?.() as any;
      if (!app?.currentUser?.id) throw new Error('App user unavailable');
      root.__l5ShareMessages = [];
      app.conversationService.subscribeToMessages(
        cid,
        (messages: any[]) => {
          root.__l5ShareMessages = messages.filter((message) =>
            String(message?.text || '').startsWith('IPFS_SHARE:'),
          );
        },
        app.currentUser.id,
        peerId,
      );
    },
    { cid: conversationId, peerId: otherUserId },
  );
}

async function getShareSnapshot(page: Page): Promise<ShareSnapshot> {
  return page.evaluate(() => {
    const messages = Array.isArray((window as any).__l5ShareMessages)
      ? (window as any).__l5ShareMessages
      : [];
    const payloads = messages.map((message: any) =>
      JSON.parse(String(message.text).slice('IPFS_SHARE:'.length)),
    );
    return {
      ids: messages.map((message: any) => String(message.id || '')),
      payloads: payloads.map((payload: any) => ({
        cid: String(payload.cid || ''),
        link: String(payload.link || ''),
        keyCiphertext: String(payload.keyCiphertext || ''),
      })),
    };
  });
}

test.describe('L5 matched-talk IPFS auto-share', () => {
  let browsers: ThreeBrowsers;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async () => {
    test.setTimeout(TEST_TIMEOUT_MS);
    await maybeClearGunDatabases();
    const launch = (x: number) => chromium.launch({
      headless: !!process.env.CI,
      args: [
        `--window-position=${x},40`,
        '--window-size=640,1200',
        '--force-device-scale-factor=1',
        ...WEBRTC_CHROMIUM_ARGS,
      ],
    });
    const [tom, jerry, bob] = await Promise.all([launch(0), launch(640), launch(1280)]);
    browsers = { tom, jerry, bob };
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
    );
    await shutdownThreeBrowsers(browsers);
    await maybeClearGunDatabases();
  });

  test('shares once, decrypts for the match only, and redrains idempotently', async () => {
    test.setTimeout(TEST_TIMEOUT_MS);
    void webAppURLStableChatroom();
    const [tomResult, jerryResult, bobResult] = await Promise.all([
      bootstrapUser(browsers.tom, 'Tom', 'Tom L5'),
      bootstrapUser(browsers.jerry, 'Jerry', 'Jerry L5'),
      bootstrapUser(browsers.bob, 'Bob', 'Bob L5'),
    ]);
    contextTom = tomResult.context;
    contextJerry = jerryResult.context;
    contextBob = bobResult.context;
    pageTom = tomResult.page;
    pageJerry = jerryResult.page;
    pageBob = bobResult.page;
    await afterLoad();

    const [tomId, jerryId, bobId] = await Promise.all([
      pageTom.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
      pageJerry.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
      pageBob.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
    ]);
    expect(tomId).toBeTruthy();
    expect(jerryId).toBeTruthy();
    expect(bobId).toBeTruthy();

    await pageJerry.route('**/api/mailbox/*', (route) => {
      if (route.request().method() === 'GET') void route.fulfill({ status: 200, json: { envelopes: [] } });
      else void route.continue();
    });

    await ensureMeshNeighbors([
      { label: 'Tom', page: pageTom, otherIds: [jerryId, bobId] },
      { label: 'Jerry', page: pageJerry, otherIds: [tomId, bobId] },
      { label: 'Bob', page: pageBob, otherIds: [tomId, jerryId] },
    ]);

    const talkId = `l5-ipfs-${Date.now()}`;
    const attachmentText = `private L5 bytes ${Date.now()}`;
    const [tomPair, jerryEpub] = await Promise.all([
      pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()),
      pageJerry.evaluate(() => String(
        (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.epub || '',
      )),
    ]);
    expect(tomPair?.epub).toBeTruthy();
    expect(jerryEpub).toBeTruthy();

    const published = await pageTom.evaluate(
      async ({ id, text, recipientEpub }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const service = app.contentNodeService;
        const node = await service.ensureNode();
        let storedBytes: number[] = [];
        const originalPut = node.blockstore.put.bind(node.blockstore);
        node.blockstore.put = async (cid: unknown, bytes: Uint8Array) => {
          storedBytes = Array.from(bytes);
          await originalPut(cid, bytes);
        };
        const attachment = await service.publishAttachmentBytes({
          talkId: id,
          attachment: {
            cid: 'pending',
            name: 'l5-private.txt',
            sizeBytes: new TextEncoder().encode(text).length,
            mimeType: 'text/plain',
            enc: 'sea-pair',
          },
          bytes: text,
          senderPair: app.gunService.getStoredPair(),
          recipientEpub,
        });
        node.blockstore.put = originalPut;
        return { attachment, storedBytes };
      },
      { id: talkId, text: attachmentText, recipientEpub: jerryEpub },
    );
    const attachment = published.attachment;

    // The normal parallel suite has no external relay/bootstrap peer, so seed
    // the encrypted CID block that bitswap would place in Jerry's blockstore.
    // The production receiver still performs the real CID lookup + SEA decrypt.
    const encryptedBlock = published.storedBytes;
    expect(encryptedBlock.length).toBeGreaterThan(0);
    await pageJerry.evaluate(async ({ cid, bytes }) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      const service = app.contentNodeService;
      const node = await service.ensureNode();
      await node.blockstore.put(await service.cidParser(cid), Uint8Array.from(bytes));
    }, { cid: attachment.cid, bytes: encryptedBlock });

    const tomTalk = {
      id: talkId,
      type: 'tag',
      title: 'L5 private attachment',
      authorId: tomId,
      authorName: 'Tom L5',
      authorEpub: tomPair.epub,
      ipfsAttachments: [attachment],
      questions: [{
        id: 'q1',
        text: 'Share the attachment?',
        answers: [
          { id: 'a-match', text: 'Yes', isMatch: true },
          { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true },
        ],
      }],
    };
    await pageTom.evaluate(async ({ talk, recipients }) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      app.peerMeshService.cacheTalkBody(talk.id, talk);
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      myTalks[talk.id] = { role: 'created', fullTalk: talk };
      localStorage.setItem('myTalks', JSON.stringify(myTalks));
      await app.peerMeshService.broadcastTalk(talk, {
        recipientUserIds: recipients,
        roomBroadcast: true,
      });
    }, { talk: tomTalk, recipients: [jerryId, bobId] });

    for (const [label, page] of [['Jerry', pageJerry], ['Bob', pageBob]] as const) {
      await expect.poll(
        () => page.evaluate(({ id, authorId }) => {
          const app = (window as any).__iinpublic_app?.getApp?.() as any;
          return !!app.peerMeshService?.getCachedTalkBody?.(id, authorId);
        }, { id: talkId, authorId: tomId }),
        { timeout: MESH_E2E_TIMEOUT_MS, message: `${label}: talk body not received` },
      ).toBe(true);
    }

    const matchAnswers = [
      { questionId: 'q1', answerId: 'a-match', answerText: 'Yes', mode: 'manual', isMatch: true },
    ];
    const ignoreAnswers = [
      { questionId: 'q1', answerId: 'a-ignore', answerText: 'No', mode: 'manual', isIgnore: true },
    ];
    const expectedConversationId = `conv_${[tomId, jerryId].sort().join('_')}_${talkId}`;
    await Promise.all([
      subscribeToShareMessages(pageTom, expectedConversationId, jerryId),
      subscribeToShareMessages(pageJerry, expectedConversationId, tomId),
    ]);
    await Promise.all([
      pageJerry.evaluate(async ({ talk, authorId, answers }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        await app.submitTalkResponsePairDirect({
          talkId: talk.id,
          talkData: talk,
          answers,
          isChatbotResponse: false,
          authorId,
          authorName: talk.authorName,
          isAutoResponse: false,
        });
      }, { talk: tomTalk, authorId: tomId, answers: matchAnswers }),
      pageBob.evaluate(async ({ talk, authorId, answers }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        await app.submitTalkResponsePairDirect({
          talkId: talk.id,
          talkData: talk,
          answers,
          isChatbotResponse: false,
          authorId,
          authorName: talk.authorName,
          isAutoResponse: false,
        });
      }, { talk: tomTalk, authorId: tomId, answers: ignoreAnswers }),
    ]);
    await afterAction();
    await afterSync();

    await expect.poll(
      () => getConversationIdForPeer(pageTom!, jerryId),
      { timeout: MESH_E2E_TIMEOUT_MS, message: 'Tom: Jerry match conversation missing' },
    ).not.toBe('');
    await expect.poll(
      () => getConversationIdForPeer(pageJerry!, tomId),
      { timeout: MESH_E2E_TIMEOUT_MS, message: 'Jerry: Tom match conversation missing' },
    ).not.toBe('');
    await expect.poll(
      () => getConversationIdForPeer(pageBob!, tomId),
      { timeout: 5_000, message: 'Bob must not receive a conversation for ignored talk' },
    ).toBe('');

    const conversationId = await getConversationIdForPeer(pageTom, jerryId);
    expect(await getConversationIdForPeer(pageJerry, tomId)).toBe(conversationId);
    expect(conversationId).toBe(expectedConversationId);

    for (const [label, page] of [['Tom', pageTom], ['Jerry', pageJerry]] as const) {
      await expect.poll(
        async () => (await getShareSnapshot(page)).ids.length,
        { timeout: MESH_E2E_TIMEOUT_MS, message: `${label}: expected one share message` },
      ).toBe(1);
      const snapshot = await getShareSnapshot(page);
      expect(new Set(snapshot.ids).size).toBe(1);
      expect(snapshot.payloads[0]).toMatchObject({
        cid: attachment.cid,
        link: `ipfs://${attachment.cid}`,
      });
      expect(snapshot.payloads[0].keyCiphertext).toBeTruthy();
    }

    const fetchResult = await pageJerry.evaluate(async (senderId) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      const message = ((window as any).__l5ShareMessages || [])[0];
      const payload = JSON.parse(String(message.text).slice('IPFS_SHARE:'.length));
      try {
        await app.maybeFetchSharedAttachmentBytes(payload, senderId);
        return { error: '', length: app.getFetchedAttachmentBytesLengthForE2e(payload.cid) };
      } catch (error) {
        return { error: String((error as Error)?.message || error), length: 0 };
      }
    }, tomId);
    expect(fetchResult.error).toBe('');
    await expect.poll(
      () => pageJerry!.evaluate((cid) =>
        (window as any).__iinpublic_app?.getApp?.()?.getFetchedAttachmentBytesLengthForE2e?.(cid) || 0,
      attachment.cid),
      { timeout: MESH_E2E_TIMEOUT_MS, message: 'Jerry: attachment was not fetched and decrypted' },
    ).toBe(new TextEncoder().encode(attachmentText).length);

    const bobLinkCount = await pageBob.evaluate((cid) => {
      const gun = (window as any).__iinpublic_app?.getApp?.()?.gunService?.getGun?.();
      if (!gun) return -1;
      return new Promise<number>((resolve) => {
        let count = 0;
        gun.get(`users/${(window as any).__iinpublic_app.getApp().currentUser.id}`)
          .get('conversations').map().once((conversation: any) => {
            if (String(conversation?.lastMessage || '').includes(cid)) count += 1;
          });
        setTimeout(() => resolve(count), 500);
      });
    }, attachment.cid);
    expect(bobLinkCount).toBe(0);

    const liveSnapshot = await getShareSnapshot(pageJerry);
    const shareMessageId = liveSnapshot.ids[0];
    expect(shareMessageId).toBeTruthy();
    await expect.poll(
      async () => {
        const response = await fetch(`${gunBaseURL()}/api/mailbox/${encodeURIComponent(jerryId)}`);
        const body = response.ok ? await response.json() as { envelopes?: any[] } : {};
        const envelopes = Array.isArray(body.envelopes) ? body.envelopes : [];
        return Array.isArray(envelopes)
          && envelopes.some((envelope: any) => envelope?.id === `mbx_share_${shareMessageId}`);
      },
      { timeout: MESH_E2E_TIMEOUT_MS, message: 'Jerry: durable share envelope was not queued' },
    ).toBe(true);

    await pageJerry.evaluate(({ cid, messageId, userA, userB }) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      const pairId = [userA, userB].sort().join('__');
      app.gunService.getGun()
        .get('pairConversations')
        .get(pairId)
        .get(cid)
        .get('messages')
        .get(messageId)
        .put(null);
    }, { cid: conversationId, messageId: shareMessageId, userA: tomId, userB: jerryId });
    await afterAction();

    await pageJerry.close();
    pageJerry = undefined;
    pageJerry = await contextJerry.newPage();
    await gotoWebApp(pageJerry, webAppURLStableChatroom());
    await afterLoad();
    await pageJerry.evaluate(async () => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      await app.drainMailbox();
    });

    await expect.poll(
      () => pageJerry!.evaluate(({ cid, messageId, userA, userB }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const pairId = [userA, userB].sort().join('__');
        return new Promise<string>((resolve) => {
          app.gunService.getGun()
            .get('pairConversations')
            .get(pairId)
            .get(cid)
            .get('messages')
            .get(messageId)
            .once((message: any) => resolve(String(message?.text || '')));
        });
      }, { cid: conversationId, messageId: shareMessageId, userA: tomId, userB: jerryId }),
      { timeout: MESH_E2E_TIMEOUT_MS, message: 'Jerry: mailbox share not materialized after reconnect' },
    ).toContain(`\"cid\":\"${attachment.cid}\"`);
    await expect.poll(
      async () => {
        const response = await fetch(`${gunBaseURL()}/api/mailbox/${encodeURIComponent(jerryId)}`);
        if (!response.ok) return -1;
        const body = await response.json() as { envelopes?: any[] };
        return Array.isArray(body.envelopes) ? body.envelopes.length : -1;
      },
      { timeout: MESH_E2E_TIMEOUT_MS, message: 'Jerry: mailbox did not drain' },
    ).toBe(0);
  });
});
