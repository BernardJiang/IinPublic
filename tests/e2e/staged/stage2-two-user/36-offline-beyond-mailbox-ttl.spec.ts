/**
 * Spec 36 — Offline beyond the mailbox TTL.
 *
 * The encrypted offline mailbox (src/server/services/mailbox-store.ts) is a TTL store.
 * Senders may attach a per-envelope `ttlMs` (WebMailboxClient.postEnvelope → POST
 * /api/mailbox/:recipientId body `ttlMs`), clamped to [1, MAILBOX_MAX_TTL_MS]. The store
 * prunes expired envelopes lazily on every access: `MailboxStore.list()` (backing
 * GET /api/mailbox/:recipientId, which the client's drain loop calls) runs
 * `pruneExpired()` first and therefore never returns — and physically drops — any
 * envelope whose `expiresAt` is in the past.
 *
 * This spec exercises that boundary with a real matched pair:
 *   1. A and B match (fast-dm-setup); both epubs are resolvable so A can encrypt for B.
 *   2. B goes offline (context closed) with its storageState saved.
 *   3. While B is offline, A writes TWO envelopes into B's mailbox, both encrypted with the
 *      exact WebMailboxClient path A's own client uses:
 *        - one EXPIRED envelope (ttlMs: 1 → past `expiresAt` after a short wait), and
 *        - one FRESH control envelope (a real offline DM, default TTL).
 *   4. Assert the DEFINED expiry behavior directly against the server: GET B's mailbox
 *      returns exactly the FRESH envelope; the expired one is neither listed nor
 *      redelivered (it was pruned on read).
 *   5. B reconnects with the SAME identity. Its drain loop runs.
 *   6. Assert: the fresh DM is delivered and visible, the expired item is never delivered,
 *      the mailbox ends empty (drain + prune leave no residue), and B's app is healthy
 *      (matched conversation still present, not wedged on an empty state).
 *
 * The FRESH control proves that pruning the expired envelope did not break normal drain.
 *
 * See companion 36-offline-beyond-mailbox-ttl.md.
 */
import * as fs from 'fs';
import * as path from 'path';
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, gotoAppReady } from '../../helpers/timing';
import { webAppURLStableChatroom, gunBaseURL, e2eTestStorageDir } from '../../helpers/ports';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { setupLeanMatchedPair, LeanMatchedPair } from '../../helpers/fast-match-lean';

const FRESH_TEXT = 'FRESH-control-delivered';
const EXPIRED_TEXT = 'EXPIRED-must-never-arrive';

test.describe('Mailbox: an envelope announced while the recipient is offline past TTL is pruned, never delivered', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: LeanMatchedPair | undefined;
  let contextBReconnect: BrowserContext | undefined;
  let pageBReconnect: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    const args = ['--window-size=640,1100', ...WEBRTC_CHROMIUM_ARGS];
    browserA = await chromium.launch({ headless, args: ['--window-position=0,0', ...args] });
    browserB = await chromium.launch({ headless, args: ['--window-position=640,0', ...args] });
  });

  test.afterAll(async () => {
    await pageBReconnect?.close().catch(() => {});
    await contextBReconnect?.close().catch(() => {});
    await pair?.pageA?.close().catch(() => {});
    await pair?.contextA?.close().catch(() => {});
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('expired mailbox item is pruned and never delivered; a fresh control item still drains', async () => {
    test.setTimeout(120_000);
    const T0 = Date.now();
    const mark = (s: string) => console.log(`[T+${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}`);

    pair = await setupLeanMatchedPair(browserA, browserB, 'TtlA', 'TtlB');
    mark('setup done');
    const { pageA, contextB, conversationId, userIdA, userIdB } = pair;

    const apiBase = gunBaseURL();

    // ── 1. Save B's identity storageState, then take B offline ────────────────
    const storageDir = e2eTestStorageDir();
    fs.mkdirSync(storageDir, { recursive: true });
    const bStoragePath = path.join(storageDir, 'ttl-b-state.json');
    await contextB.storageState({ path: bStoragePath });
    await contextB.close().catch(() => {});

    // ── 2. From A, write an EXPIRED envelope (ttlMs: 1) and a FRESH control ────
    //     Both go through the exact WebMailboxClient encrypt+post path A uses live.
    const postResult = await pageA.evaluate(
      async ({ recipientId, convId, senderId, freshText, expiredText }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        // Use the app's own mailbox client instance (already wired to the right apiBase).
        const client = app?.ensureMailboxClient?.();
        if (!client) throw new Error('no mailbox client available on A');

        const pair = app.gunService.getStoredPair();
        // Resolve B's epub the same way the app does before posting.
        const recipientEpub = await app.resolvePeerEpub(recipientId);
        if (!recipientEpub) throw new Error('could not resolve recipient epub');

        const mkPayload = (id: string, text: string) => ({
          kind: 'conversation-message-v1',
          conversationId: convId,
          senderId,
          recipientUserId: recipientId,
          wire: {
            id,
            senderId,
            text,
            timestamp: new Date().toISOString(),
            channel: 'public',
            transport: 'direct-p2p',
          },
        });

        // EXPIRED envelope: ttlMs of 1ms → expiresAt is essentially "now".
        const expiredId = `mbx_ttl_expired_${convId}`;
        const expiredCt = await client.encryptForRecipient(recipientEpub, pair, mkPayload(expiredId, expiredText));
        const expiredRes = await client.postEnvelope({ id: expiredId, recipientId, ciphertext: expiredCt, ttlMs: 1 });

        // FRESH control envelope: default TTL (48h).
        const freshId = `mbx_ttl_fresh_${convId}`;
        const freshCt = await client.encryptForRecipient(recipientEpub, pair, mkPayload(freshId, freshText));
        const freshRes = await client.postEnvelope({ id: freshId, recipientId, ciphertext: freshCt });

        return { expiredRes, freshRes, expiredId, freshId };
      },
      {
        recipientId: userIdB,
        convId: conversationId,
        senderId: userIdA,
        freshText: FRESH_TEXT,
        expiredText: EXPIRED_TEXT,
      },
    );

    expect(postResult.expiredRes.stored, 'expired envelope was accepted by server').toBe(true);
    expect(postResult.freshRes.stored, 'fresh envelope was accepted by server').toBe(true);

    // ── 3. Let the 1ms TTL lapse, then assert the server pruned the expired one ─
    await pageA.waitForTimeout(50);

    const listAfterExpiry = await pageA.evaluate(
      async ({ base, recipientId }) => {
        const r = await fetch(`${base}/api/mailbox/${encodeURIComponent(recipientId)}`, { cache: 'no-store' });
        return r.ok ? await r.json() : null;
      },
      { base: apiBase, recipientId: userIdB },
    );

    expect(listAfterExpiry, 'mailbox list response').not.toBeNull();
    const listedIds: string[] = (listAfterExpiry.envelopes ?? []).map((e: any) => e.id);
    expect(listedIds, 'expired envelope is pruned (not listed / not redelivered)').not.toContain(postResult.expiredId);
    expect(listedIds, 'fresh control envelope is still present').toContain(postResult.freshId);
    expect(listAfterExpiry.count, 'exactly one (fresh) envelope remains').toBe(1);

    // ── 4. B reconnects with the SAME identity ────────────────────────────────
    contextBReconnect = await browserB.newContext({
      viewport: { width: 640, height: 1000 },
      storageState: bStoragePath,
    });
    pageBReconnect = await contextBReconnect.newPage();
    mark('reconnect boot start');
    await gotoAppReady(pageBReconnect, webAppURLStableChatroom());
    await pageBReconnect.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.drainMailbox?.());
    mark('reconnect app ready');

    const bIdReconnect = await pageBReconnect.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    expect(bIdReconnect, 'B reconnects as the same user').toBe(userIdB);

    // ── 5. Fresh DM drains into B's message store; expired never arrives ───────
    // Read from the durable message store (Gun is authoritative — CLAUDE.md §19.4)
    // via a bounded subscribeToMessages snapshot, rather than the ephemeral overlay DOM.
    const readMessageTexts = () =>
      pageBReconnect!.evaluate(
        ({ cid, otherId, myId }) =>
          new Promise<string[]>((resolve) => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            const texts: string[] = [];
            let done = false;
            const unsub = app.conversationService.subscribeToMessages(
              cid,
              (msgs: any[]) => {
                for (const m of msgs) if (m?.text) texts.push(String(m.text));
              },
              myId,
              otherId,
            );
            setTimeout(() => {
              if (done) return;
              done = true;
              try { unsub?.(); } catch { /* ignore */ }
              resolve(Array.from(new Set(texts)));
            }, 900);
          }),
        { cid: conversationId, otherId: userIdA, myId: userIdB },
      );

    let seenTexts: string[] = [];
    await expect
      .poll(
        async () => {
          seenTexts = await readMessageTexts();
          return seenTexts.includes(FRESH_TEXT);
        },
        { timeout: 15_000, intervals: [500, 1000], message: 'fresh (non-expired) DM must drain into B\'s store' },
      )
      .toBe(true);
    mark('fresh DM present in store');

    // The expired item's text must never appear in B's message store.
    expect(seenTexts, 'expired DM text must never be delivered').not.toContain(EXPIRED_TEXT);

    // ── 6. Mailbox is empty after drain (fresh drained, expired pruned) ────────
    await expect
      .poll(
        async () =>
          pageBReconnect!.evaluate(
            async ({ base, recipientId }) => {
              const r = await fetch(`${base}/api/mailbox/${encodeURIComponent(recipientId)}`, { cache: 'no-store' });
              return r.ok ? (await r.json() as { count: number }).count : -1;
            },
            { base: apiBase, recipientId: userIdB },
          ),
        { timeout: 20_000, intervals: [500, 1000], message: 'mailbox should be empty after drain + prune' },
      )
      .toBe(0);

    // ── 7. B's app is healthy: the matched conversation is still present ───────
    const hasConversation = await pageBReconnect.evaluate(({ aId }) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
      return Object.values(conversations).some((c: any) => c?.otherUserId === aId);
    }, { aId: userIdA });
    expect(hasConversation, 'B still has the matched conversation with A after recovery').toBe(true);
  });
});
