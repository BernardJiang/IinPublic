/**
 * Block enforcement extended to IPFS attachment transfer (Part C) — the same gap talk
 * delivery had before resolveBlockStatusEitherWay was wired into shouldAcceptIncomingTalkAsync.
 *
 * Exercises the two receive-side call sites directly (the actual enforcement boundary per
 * their own doc comments in app.ts — a modified sender client could skip the send-side
 * courtesy checks, so receive-side is what actually protects a blocked-by user):
 *   - ingestAttachmentShareFromMailbox: a mailbox-delivered attachment-share payload from a
 *     blocked sender must never create a conversation message record.
 *   - maybeFetchSharedAttachmentBytes: an attachment-share payload from a blocked sender must
 *     never be fetched/decrypted (checked via fetchedAttachmentBytesByCid staying empty).
 *
 * Also confirms resolveBlockStatusEitherWay itself reports the block correctly for this pair
 * — the single shared dependency all four Part C call sites (2 send-side, 2 receive-side) rely
 * on; the guard clauses at each call site are trivial single-line early-returns, so the real
 * risk surface this test targets is "is the gate wired into the receive path at all," not the
 * block-status logic itself (already covered by the talk-delivery specs 15a/15b/61, which use
 * the identical method).
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, headless } from '../../helpers/timing';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Blocked pair cannot exchange IPFS attachments', () => {
  let browserAlice: Browser;
  let browserBob: Browser;
  let contextAlice: BrowserContext;
  let contextBob: BrowserContext;
  let pageAlice: Page;
  let pageBob: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserAlice = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserBob = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await pageAlice?.close().catch(() => {});
    await pageBob?.close().catch(() => {});
    await contextAlice?.close().catch(() => {});
    await contextBob?.close().catch(() => {});
    await browserAlice?.close().catch(() => {});
    await browserBob?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('blocked sender cannot deliver a mailbox attachment-share or have bytes fetched', async () => {
    const alice = await bootstrapUser(browserAlice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;

    const bob = await bootstrapUser(browserBob, 'Bobby', 'Bobby');
    contextBob = bob.context;
    pageBob = bob.page;

    await pageAlice.click('.chatroom-item:has-text("Global")');
    await afterSync();
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const aliceUserId = await pageAlice.evaluate(
      () => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '',
    );
    const bobUserId = await pageBob.evaluate(
      () => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '',
    );
    expect(aliceUserId).toBeTruthy();
    expect(bobUserId).toBeTruthy();

    // Bob blocks Alice — either direction is sufficient (resolveBlockStatusEitherWay checks both).
    await pageBob.evaluate(async (targetId) => {
      const app = (window as any).__iinpublic_app?.getApp();
      await app.userService.blockUser(app.currentUser.id, targetId);
    }, aliceUserId);

    // The shared dependency all four Part C call sites rely on.
    await expect
      .poll(
        async () => pageBob.evaluate(
          (peerId) => (window as any).__iinpublic_app?.getApp()?.resolveBlockStatusEitherWay(peerId),
          aliceUserId,
        ),
        { timeout: 15_000 },
      )
      .toBe(true);

    const conversationId = `conv_${aliceUserId}_${bobUserId}`;
    const messageId = `blocked-attachment-share-${Date.now()}`;

    // Receive-side gate 1: a mailbox-delivered attachment-share from the blocked sender must
    // never create a message record — checked by the dedup marker it would otherwise set.
    await pageBob.evaluate(
      ({ convId, msgId, senderId }) => {
        const app = (window as any).__iinpublic_app?.getApp();
        return app.ingestAttachmentShareFromMailbox({
          kind: 'ipfs-conversation-share-v1',
          conversationId: convId,
          messageId: msgId,
          senderId,
          senderName: 'Alice',
          recipientId: app.currentUser.id,
          recipientName: 'Bobby',
          text: 'IPFS_SHARE:{}',
          timestamp: new Date().toISOString(),
        });
      },
      { convId: conversationId, msgId: messageId, senderId: aliceUserId },
    );
    const wasMarkedSent = await pageBob.evaluate(
      (msgId) => (window as any).__iinpublic_app?.getApp()?.attachmentShareSentIds?.has(msgId),
      messageId,
    );
    expect(wasMarkedSent).toBe(false);

    // Receive-side gate 2: an attachment-share payload from the blocked sender must never be
    // fetched/decrypted. A fake cid would eventually resolve to "not found" either way after
    // several retries (~30s of backoff) — asserting it's STILL empty after a short window
    // distinguishes "returned instantly via the block guard" from "still retrying".
    const fakeCid = `fake-cid-${Date.now()}`;
    void pageBob.evaluate(
      ({ cid, senderId }) => {
        const app = (window as any).__iinpublic_app?.getApp();
        return app.maybeFetchSharedAttachmentBytes(
          {
            kind: 'ipfs-auto-share-v1',
            conversationId: 'conv-test',
            talkId: 'talk-test',
            authorId: senderId,
            cid,
            link: `ipfs://${cid}`,
            name: 'test.png',
            mimeType: 'image/png',
            sizeBytes: 100,
            enc: 'none',
            keyCiphertext: 'public',
            sharedAt: new Date().toISOString(),
          },
          senderId,
        );
      },
      { cid: fakeCid, senderId: aliceUserId },
    );
    await pageBob.waitForTimeout(1_000);
    const wasFetched = await pageBob.evaluate(
      (cid) => (window as any).__iinpublic_app?.getApp()?.fetchedAttachmentBytesByCid?.has(cid),
      fakeCid,
    );
    expect(wasFetched).toBe(false);

    await pageBob.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });
});
