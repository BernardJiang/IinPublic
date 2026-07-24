/**
 * 72 — Dog tag talk, two matches, and a full DM mesh verified on both ends.
 *
 * Adam broadcasts a `dog` tag talk. Bob and Carol both answer MATCH, giving Adam two
 * pair conversations (Adam↔Bob, Adam↔Carol). Bob and Carol also open a direct pair
 * conversation with each other. Then every ordered pair exchanges a DM — each of the
 * three users is both sender and receiver to the other two (six directed messages):
 *
 *   Adam → Bob : "What kind of dog do you like?"
 *   Bob  → Adam: "Only big ones."
 *   Carol→ Adam: "How many dogs do you have?"
 *   Adam → Carol: "only one."
 *   Bob  → Carol: "Carol, do you like big dogs?"
 *   Carol→ Bob : "Yes Bob, I love them."
 *
 * Every message is asserted on BOTH the sender's and the receiver's #conversation-messages.
 * Each send happens in a freshly-opened conversation, so this also guards send-routing when
 * a user holds two conversations at once, and a final pass checks the three pair threads
 * stay isolated (no message leaks across pairs).
 *
 * See companion 72-dog-talk-cross-dms.md for a plain-English description.
 */

import { chromium, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterLoad, afterSync, afterAction } from '../../helpers/timing';
import {
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';
import {
  bootstrapUser,
  ensureMeshNeighbors,
  finalCleanupPages,
} from '../../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { webAppURLStableChatroom } from '../../helpers/ports';

/** WebRTC overlay + DM delivery budget under parallel-suite load. */
const DM_E2E_TIMEOUT_MS = 30_000;

/** Watch a conversation for IPFS_SHARE auto-share messages (L5). */
async function subscribeToShareMessages(page: Page, conversationId: string, otherUserId: string): Promise<void> {
  await page.evaluate(({ cid, peerId }) => {
    const app = (window as any).__iinpublic_app.getApp();
    (window as any).__shareMessages = [];
    app.conversationService.subscribeToMessages(
      cid,
      (messages: any[]) => {
        (window as any).__shareMessages = messages.filter((m) =>
          String(m?.text || '').startsWith('IPFS_SHARE:'));
      },
      app.currentUser.id,
      peerId,
    );
  }, { cid: conversationId, peerId: otherUserId });
}

/** Snapshot the IPFS_SHARE messages seen on a page. */
async function getShareSnapshot(page: Page): Promise<Array<{ cid: string; link: string }>> {
  return page.evaluate(() => {
    const messages = Array.isArray((window as any).__shareMessages) ? (window as any).__shareMessages : [];
    return messages.map((m: any) => {
      const p = JSON.parse(String(m.text).slice('IPFS_SHARE:'.length));
      return { cid: String(p.cid || ''), link: String(p.link || '') };
    });
  });
}

test.describe('Three-user dog talk + full DM mesh (both ends)', () => {
  let browsers: ThreeBrowsers;
  let contextAdam: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let contextCarol: BrowserContext | undefined;
  let pageAdam: Page | undefined;
  let pageBob: Page | undefined;
  let pageCarol: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    test.setTimeout(240_000);
    await maybeClearGunDatabases();
    const mk = (x: number) => ({
      headless: !!process.env.CI,
      args: [
        `--window-position=${x},40`,
        '--window-size=640,1200',
        '--force-device-scale-factor=1',
        ...WEBRTC_CHROMIUM_ARGS,
      ],
    });
    const [adam, bob, carol] = await Promise.all([
      chromium.launch(mk(0)),
      chromium.launch(mk(640)),
      chromium.launch(mk(1280)),
    ]);
    browsers = { tom: adam, jerry: bob, bob: carol };
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageAdam, jerry: pageBob, bob: pageCarol },
      { tom: contextAdam, jerry: contextBob, bob: contextCarol },
    );
    await shutdownThreeBrowsers(browsers);
    await maybeClearGunDatabases();
  });

  /** Deterministic pair conversation id for a peer, read from myConversations. */
  async function convIdFor(page: Page, peerId: string): Promise<string> {
    return page.evaluate(({ pid }) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
      const entry = Object.entries(conversations).find(
        ([, c]: [string, any]) => c?.otherUserId === pid,
      );
      return entry ? entry[0] : '';
    }, { pid: peerId });
  }

  /** Wait until a conversation with the peer exists locally. */
  function awaitConversationWith(page: Page, peerId: string) {
    return expect
      .poll(
        () => page.evaluate(({ pid }) => {
          const conversations = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
          return Object.values(conversations).some((c: any) => c?.otherUserId === pid);
        }, { pid: peerId }),
        { timeout: DM_E2E_TIMEOUT_MS, intervals: [300, 600, 1000] },
      )
      .toBe(true);
  }

  /** Open a specific pair conversation in the real UI (sets currentConversationId). */
  async function openConversation(page: Page, conversationId: string): Promise<void> {
    await page.evaluate((id) => {
      (window as any).__iinpublic_app.getApp().uiManager.showConversationDetail(id);
    }, conversationId);
    await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#conversation-message-input')).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Send `text` from `sender` in conversation `senderConv`, then verify it lands on both
   * the sender's and the receiver's #conversation-messages. Opening the conversation right
   * before sending guards routing when the sender holds more than one conversation.
   */
  async function dm(
    sender: Page,
    senderConv: string,
    receiver: Page,
    receiverConv: string,
    text: string,
  ): Promise<void> {
    await openConversation(sender, senderConv);
    await sender.locator('#conversation-message-input').fill(text);
    await sender.locator('#send-conversation-message').click();
    // Sender's own thread shows it (local echo).
    await expect(sender.locator('#conversation-messages')).toContainText(text, {
      timeout: DM_E2E_TIMEOUT_MS,
    });
    // Receiver's matching pair thread shows it (delivered end-to-end).
    await openConversation(receiver, receiverConv);
    await expect(receiver.locator('#conversation-messages')).toContainText(text, {
      timeout: DM_E2E_TIMEOUT_MS,
    });
  }

  test('dog talk matches Bob & Carol; every user DMs the other two, verified both ends', async () => {
    test.setTimeout(240_000);

    // ── 1. Bootstrap all three users in the same stable chatroom ────────────
    void webAppURLStableChatroom(); // ensures e2e_mesh_talks=1 is in URL
    const [adamResult, bobResult, carolResult] = await Promise.all([
      bootstrapUser(browsers.tom, 'Adam', 'Adam'),
      bootstrapUser(browsers.jerry, 'Bob', 'Bob'),
      bootstrapUser(browsers.bob, 'Carol', 'Carol'),
    ]);
    contextAdam = adamResult.context;
    contextBob = bobResult.context;
    contextCarol = carolResult.context;
    pageAdam = adamResult.page;
    pageBob = bobResult.page;
    pageCarol = carolResult.page;
    await afterLoad();

    const idOf = (p: Page) => p.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
    const [adamId, bobId, carolId] = await Promise.all([idOf(pageAdam), idOf(pageBob), idOf(pageCarol)]);
    expect(adamId && bobId && carolId).toBeTruthy();

    // ── 2. Verify mesh delivery is enabled on all three ─────────────────────
    for (const [label, page] of [['Adam', pageAdam], ['Bob', pageBob], ['Carol', pageCarol]] as const) {
      await expect
        .poll(
          () => page.evaluate(() =>
            !!(window as any).__iinpublic_app?.getApp?.()?.isMeshTalkDeliveryEnabled?.()),
          { timeout: DM_E2E_TIMEOUT_MS, message: `${label}: mesh delivery not enabled` },
        )
        .toBe(true);
    }
    await afterSync();

    // ── 3. Warm the fully-connected WebRTC mesh ─────────────────────────────
    await ensureMeshNeighbors([
      { label: 'Adam', page: pageAdam, otherIds: [bobId, carolId] },
      { label: 'Bob', page: pageBob, otherIds: [adamId, carolId] },
      { label: 'Carol', page: pageCarol, otherIds: [adamId, bobId] },
    ]);

    // ── 4. Adam creates and broadcasts a `dog` tag talk ─────────────────────
    const TALK_ID = `dog-tag-e2e-${Date.now()}`;
    const TALK_TITLE = 'dog';
    const adamEpub = await pageAdam.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.epub ?? '');
    const talkDef = {
      id: TALK_ID,
      authorId: adamId,
      title: TALK_TITLE,
      type: 'tag',
      authorEpub: adamEpub,
      questions: [
        {
          id: 'q1',
          text: 'Do you like dogs?',
          answers: [
            { id: 'a-match', text: 'Yes', isMatch: true },
            { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true },
          ],
        },
      ],
    };

    await pageAdam.evaluate(async ({ def }) => {
      const a = (window as any).__iinpublic_app.getApp();
      const mesh = a.peerMeshService;
      if (!mesh) throw new Error('peerMeshService not available on Adam');
      mesh.cacheTalkBody(def.id, def);
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      myTalks[def.id] = { role: 'created', title: def.title, fullTalk: def };
      localStorage.setItem('myTalks', JSON.stringify(myTalks));
      await mesh.broadcastTalk(def, { roomBroadcast: true });
    }, { def: talkDef });
    await afterAction();

    // ── 5. Bob and Carol both answer MATCH ──────────────────────────────────
    const submitMatch = (page: Page) => page.evaluate(async ({ def }) => {
      const a = (window as any).__iinpublic_app.getApp();
      a.peerMeshService?.cacheTalkBody?.(def.id, def);
      await a.submitTalkResponsePairDirect({
        talkId: def.id,
        talkData: { ...def, authorName: 'Adam' },
        answers: [{ questionId: 'q1', answerId: 'a-match', answerText: 'Yes', mode: 'manual', isMatch: true }],
        isChatbotResponse: false,
        authorId: def.authorId,
        authorName: 'Adam',
        isAutoResponse: false,
      });
    }, { def: talkDef });

    await submitMatch(pageBob);
    await submitMatch(pageCarol);
    await afterAction();

    // ── 6. Establish the Bob↔Carol pair conversation (no shared talk) ───────
    const openDirect = (page: Page, peerId: string, peerName: string) =>
      page.evaluate(({ pid, pn }) =>
        (window as any).__iinpublic_app.getApp().findOrCreateDirectConversation(pid, pn),
      { pid: peerId, pn: peerName });
    await openDirect(pageBob, carolId, 'Carol');
    await openDirect(pageCarol, bobId, 'Bob');
    await afterAction();

    // ── 7. All three pair conversations exist on both sides ─────────────────
    await awaitConversationWith(pageAdam, bobId);
    await awaitConversationWith(pageAdam, carolId);
    await awaitConversationWith(pageBob, adamId);
    await awaitConversationWith(pageBob, carolId);
    await awaitConversationWith(pageCarol, adamId);
    await awaitConversationWith(pageCarol, bobId);

    // Deterministic pair conversation ids — must be identical on both sides.
    const adamBob = await convIdFor(pageAdam, bobId);
    const bobAdam = await convIdFor(pageBob, adamId);
    const adamCarol = await convIdFor(pageAdam, carolId);
    const carolAdam = await convIdFor(pageCarol, adamId);
    const bobCarol = await convIdFor(pageBob, carolId);
    const carolBob = await convIdFor(pageCarol, bobId);
    for (const id of [adamBob, adamCarol, bobCarol]) expect(id).toBeTruthy();
    expect(bobAdam).toBe(adamBob);
    expect(carolAdam).toBe(adamCarol);
    expect(carolBob).toBe(bobCarol);
    // The three pair threads are distinct.
    expect(new Set([adamBob, adamCarol, bobCarol]).size).toBe(3);

    const MSG = {
      adamToBob: 'What kind of dog do you like?',
      bobToAdam: 'Only big ones.',
      carolToAdam: 'How many dogs do you have?',
      adamToCarol: 'only one.',
      bobToCarol: 'Carol, do you like big dogs?',
      carolToBob: 'Yes Bob, I love them.',
    };

    // ── 8. Full DM mesh — each user sends to the other two, verified both ends ─
    await dm(pageAdam, adamBob, pageBob, bobAdam, MSG.adamToBob);
    await dm(pageBob, bobAdam, pageAdam, adamBob, MSG.bobToAdam);
    await dm(pageCarol, carolAdam, pageAdam, adamCarol, MSG.carolToAdam);
    await dm(pageAdam, adamCarol, pageCarol, carolAdam, MSG.adamToCarol);
    await dm(pageBob, bobCarol, pageCarol, carolBob, MSG.bobToCarol);
    await dm(pageCarol, carolBob, pageBob, bobCarol, MSG.carolToBob);

    // ── 9. Thread isolation — no message leaks across the three pair threads ─
    // Adam↔Bob thread: only the Adam/Bob exchange.
    await openConversation(pageAdam, adamBob);
    await expect(pageAdam.locator('#conversation-messages')).toContainText(MSG.adamToBob);
    await expect(pageAdam.locator('#conversation-messages')).toContainText(MSG.bobToAdam);
    for (const leak of [MSG.carolToAdam, MSG.adamToCarol, MSG.bobToCarol, MSG.carolToBob]) {
      await expect(pageAdam.locator('#conversation-messages')).not.toContainText(leak);
    }
    // Adam↔Carol thread: only the Adam/Carol exchange.
    await openConversation(pageAdam, adamCarol);
    await expect(pageAdam.locator('#conversation-messages')).toContainText(MSG.carolToAdam);
    await expect(pageAdam.locator('#conversation-messages')).toContainText(MSG.adamToCarol);
    for (const leak of [MSG.adamToBob, MSG.bobToAdam, MSG.bobToCarol, MSG.carolToBob]) {
      await expect(pageAdam.locator('#conversation-messages')).not.toContainText(leak);
    }
    // Bob↔Carol thread: only the Bob/Carol exchange.
    await openConversation(pageBob, bobCarol);
    await expect(pageBob.locator('#conversation-messages')).toContainText(MSG.bobToCarol);
    await expect(pageBob.locator('#conversation-messages')).toContainText(MSG.carolToBob);
    for (const leak of [MSG.adamToBob, MSG.bobToAdam, MSG.carolToAdam, MSG.adamToCarol]) {
      await expect(pageBob.locator('#conversation-messages')).not.toContainText(leak);
    }

    // ── 10. German-Shepherd-gated photo: Adam auto-shares his dog photo (IPFS) ──
    //        to the matcher only. Bob likes German Shepherds → MATCH → receives the
    //        ipfs:// link in the Adam↔Bob thread. Carol answers No → IGNORE → her
    //        Adam thread never gets the share.
    const GS_TALK_ID = `gs-dog-photo-e2e-${Date.now()}`;
    const dogPhotoBytes = `fake-dog-photo-bytes ${Date.now()}`;
    const bobEpub = await pageBob.evaluate(() =>
      String((window as any).__iinpublic_app.getApp().gunService.getStoredPair()?.epub || ''));
    expect(bobEpub).toBeTruthy();

    // Adam publishes the photo encrypted for Bob (the intended matcher), capturing the
    // encrypted block so we can seed Bob's blockstore (the parallel suite has no relay).
    const published = await pageAdam.evaluate(
      async ({ talkId, text, recipientEpub }) => {
        const service = (window as any).__iinpublic_app.getApp().contentNodeService;
        const node = await service.ensureNode();
        let storedBytes: number[] = [];
        const originalPut = node.blockstore.put.bind(node.blockstore);
        node.blockstore.put = async (cid: unknown, bytes: Uint8Array) => {
          storedBytes = Array.from(bytes);
          await originalPut(cid, bytes);
        };
        const attachment = await service.publishAttachmentBytes({
          talkId,
          attachment: { cid: 'pending', name: 'adam-dog.png', sizeBytes: new TextEncoder().encode(text).length, mimeType: 'image/png', enc: 'sea-pair' },
          bytes: text,
          senderPair: (window as any).__iinpublic_app.getApp().gunService.getStoredPair(),
          recipientEpub,
        });
        node.blockstore.put = originalPut;
        return { attachment, storedBytes };
      },
      { talkId: GS_TALK_ID, text: dogPhotoBytes, recipientEpub: bobEpub },
    );
    const photo = published.attachment;
    expect(published.storedBytes.length).toBeGreaterThan(0);
    await pageBob.evaluate(async ({ cid, bytes }) => {
      const service = (window as any).__iinpublic_app.getApp().contentNodeService;
      const node = await service.ensureNode();
      await node.blockstore.put(await service.cidParser(cid), Uint8Array.from(bytes));
    }, { cid: photo.cid, bytes: published.storedBytes });

    // Adam builds the German-Shepherd talk carrying the photo, and broadcasts it.
    const gsTalk = {
      id: GS_TALK_ID,
      type: 'tag',
      title: 'German Shepherd fans',
      authorId: adamId,
      authorName: 'Adam',
      authorEpub: adamEpub,
      ipfsAttachments: [photo],
      questions: [{
        id: 'q1',
        text: 'Do you like German Shepherds?',
        answers: [
          { id: 'a-match', text: 'Yes', isMatch: true },
          { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true },
        ],
      }],
    };
    await pageAdam.evaluate(async ({ talk, recipients }) => {
      const a = (window as any).__iinpublic_app.getApp();
      a.peerMeshService.cacheTalkBody(talk.id, talk);
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      myTalks[talk.id] = { role: 'created', title: talk.title, fullTalk: talk };
      localStorage.setItem('myTalks', JSON.stringify(myTalks));
      await a.peerMeshService.broadcastTalk(talk, { recipientUserIds: recipients, roomBroadcast: true });
    }, { talk: gsTalk, recipients: [bobId, carolId] });

    for (const [label, page] of [['Bob', pageBob], ['Carol', pageCarol]] as const) {
      await expect
        .poll(
          () => page.evaluate(({ id, authorId }) =>
            !!(window as any).__iinpublic_app.getApp().peerMeshService?.getCachedTalkBody?.(id, authorId),
          { id: GS_TALK_ID, authorId: adamId }),
          { timeout: DM_E2E_TIMEOUT_MS, message: `${label}: German Shepherd talk body not received` },
        )
        .toBe(true);
    }

    // Watch the share stream in the Adam↔Bob thread (both ends) and Carol's Adam thread.
    await subscribeToShareMessages(pageAdam, adamBob, bobId);
    await subscribeToShareMessages(pageBob, bobAdam, adamId);
    await subscribeToShareMessages(pageCarol, carolAdam, adamId);

    // Bob likes German Shepherds (MATCH); Carol does not (IGNORE).
    await pageBob.evaluate(async ({ talk }) => {
      const a = (window as any).__iinpublic_app.getApp();
      a.peerMeshService?.cacheTalkBody?.(talk.id, talk);
      await a.submitTalkResponsePairDirect({
        talkId: talk.id, talkData: talk,
        answers: [{ questionId: 'q1', answerId: 'a-match', answerText: 'Yes', mode: 'manual', isMatch: true }],
        isChatbotResponse: false, authorId: talk.authorId, authorName: 'Adam', isAutoResponse: false,
      });
    }, { talk: gsTalk });
    await pageCarol.evaluate(async ({ talk }) => {
      const a = (window as any).__iinpublic_app.getApp();
      a.peerMeshService?.cacheTalkBody?.(talk.id, talk);
      await a.submitTalkResponsePairDirect({
        talkId: talk.id, talkData: talk,
        answers: [{ questionId: 'q1', answerId: 'a-ignore', answerText: 'No', mode: 'manual', isIgnore: true }],
        isChatbotResponse: false, authorId: talk.authorId, authorName: 'Adam', isAutoResponse: false,
      });
    }, { talk: gsTalk });
    await afterAction();
    await afterSync();

    // Adam and Bob each see exactly one share carrying the photo cid + ipfs:// link.
    for (const [label, page] of [['Adam', pageAdam], ['Bob', pageBob]] as const) {
      await expect
        .poll(async () => (await getShareSnapshot(page)).length,
          { timeout: DM_E2E_TIMEOUT_MS, message: `${label}: expected the dog photo share` })
        .toBe(1);
      const snap = await getShareSnapshot(page);
      expect(snap[0]).toMatchObject({ cid: photo.cid, link: `ipfs://${photo.cid}` });
    }

    // Bob can fetch + decrypt the photo bytes.
    await pageBob.evaluate(async (senderId) => {
      const a = (window as any).__iinpublic_app.getApp();
      const message = ((window as any).__shareMessages || [])[0];
      const payload = JSON.parse(String(message.text).slice('IPFS_SHARE:'.length));
      await a.maybeFetchSharedAttachmentBytes(payload, senderId);
    }, adamId);
    await expect
      .poll(() => pageBob.evaluate((cid) =>
        (window as any).__iinpublic_app.getApp().getFetchedAttachmentBytesLengthForE2e?.(cid) || 0, photo.cid),
        { timeout: DM_E2E_TIMEOUT_MS, message: 'Bob: dog photo bytes were not fetched/decrypted' })
      .toBe(new TextEncoder().encode(dogPhotoBytes).length);

    // ── 11. The shared photo is actually VISIBLE in the conversation UI ──────
    // Bob's Adam thread renders the attachment card, and (once bytes are decrypted)
    // an <img> preview with a blob: source — not the raw IPFS_SHARE JSON.
    await openConversation(pageBob, bobAdam);
    await expect(pageBob.locator('#conversation-messages [data-testid="ipfs-attachment"]'))
      .toBeVisible({ timeout: DM_E2E_TIMEOUT_MS });
    await expect(pageBob.locator('#conversation-messages .ipfs-attachment-name'))
      .toContainText('adam-dog.png');
    await expect
      .poll(() => pageBob.evaluate(() => {
        const img = document.querySelector('#conversation-messages img.ipfs-attachment-img') as HTMLImageElement | null;
        return img?.getAttribute('src') || '';
      }), { timeout: DM_E2E_TIMEOUT_MS, message: 'Bob: photo preview <img> never got a blob source' })
      .toContain('blob:');
    // The raw share payload must never be shown as plain text.
    await expect(pageBob.locator('#conversation-messages')).not.toContainText('IPFS_SHARE:');

    // Adam (author) sees the attachment card for what he shared.
    await openConversation(pageAdam, adamBob);
    await expect(pageAdam.locator('#conversation-messages [data-testid="ipfs-attachment"]'))
      .toBeVisible({ timeout: DM_E2E_TIMEOUT_MS });

    // ── 12. Carol ignored → her Adam thread never receives the photo share ──
    await pageCarol.waitForTimeout(2_000);
    expect((await getShareSnapshot(pageCarol)).length,
      'Carol (ignore) must not receive the dog photo share').toBe(0);
    await openConversation(pageCarol, carolAdam);
    await expect(pageCarol.locator('#conversation-messages [data-testid="ipfs-attachment"]'))
      .toHaveCount(0);
  });
});
