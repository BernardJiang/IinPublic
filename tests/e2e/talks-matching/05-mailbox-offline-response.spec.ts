/**
 * P0 step 6 — Encrypted offline mailbox (two browsers).
 *
 * Flow:
 *   1. Tom and Jerry both join the room and form a mesh overlay.
 *   2. Tom creates + broadcasts a tag talk.
 *   3. Tom's context is CLOSED (simulating Tom going offline).
 *   4. Jerry answers MATCH. Because Tom is offline, the mesh unicast fails.
 *      The response is posted to the server mailbox as a ciphertext-only envelope.
 *   5. Assert mailbox opacity: GET /api/mailbox/:tomId returns 1 envelope whose
 *      `ciphertext` does NOT contain the answer text in plaintext.
 *   6. Tom reconnects (new browser context, same localStorage state via storageState).
 *   7. drainMailbox() runs automatically at boot.
 *   8. Tom sees a conversation-list-item for the Tom↔Jerry pair (durable assertion).
 *   9. Mailbox is empty after drain.
 *
 * Invariants:
 *   - Zero calls to POST /api/talks/:id/response.
 *   - Mailbox ciphertext is opaque (does not contain plaintext answer).
 *   - Envelope is deleted from server after successful drain.
 *
 * See companion 05-mailbox-offline-response.md for a plain-English description.
 */

import * as fs from 'fs';
import * as path from 'path';
import { chromium, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { maybeClearGunDatabases } from '../helpers/clear-database';
import { afterLoad, afterSync, afterAction } from '../helpers/timing';
import {
  bootstrapUser,
  waitForTabActive,
  finalCleanupPages,
} from '../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { webAppURLStableChatroom, gunBaseURL, e2eTestStorageDir } from '../helpers/ports';

const MESH_E2E_TIMEOUT_MS = 30_000;

const MATCH_ANSWER_TEXT = 'Yes — mailbox test';

test.describe('Mailbox offline response — two browsers, ciphertext-only envelope', () => {
  let browserTom: import('@playwright/test').Browser | undefined;
  let browserJerry: import('@playwright/test').Browser | undefined;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    test.setTimeout(300_000);
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
    [browserTom, browserJerry] = await Promise.all([
      chromium.launch(mk(0)),
      chromium.launch(mk(660)),
    ]);
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await maybeClearGunDatabases();
  });

  test('Jerry mailboxes a match response while Tom is offline — Tom drains on reconnect', async () => {
    test.setTimeout(300_000);

    // ── 1. Bootstrap both users ─────────────────────────────────────────────
    const [tomResult, jerryResult] = await Promise.all([
      bootstrapUser(browserTom!, 'Tom', 'Tom Mailbox'),
      bootstrapUser(browserJerry!, 'Jerry', 'Jerry Mailbox'),
    ]);
    contextTom = tomResult.context;
    contextJerry = jerryResult.context;
    pageTom = tomResult.page;
    pageJerry = jerryResult.page;

    await afterLoad();

    // Resolve user IDs
    const tomId = await pageTom.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    const jerryId = await pageJerry.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    expect(tomId, 'Tom user id').toBeTruthy();
    expect(jerryId, 'Jerry user id').toBeTruthy();

    // ── 2. Install response-endpoint intercept on Jerry's page ───────────────
    let jerryServerResponseCalls = 0;
    await pageJerry.route('**/api/talks/*/response', (route) => {
      jerryServerResponseCalls++;
      void route.continue();
    });

    // Allow presence to settle
    await afterSync();
    await afterSync();

    // ── 3. Warm mesh and wait for neighbor connection ────────────────────────
    await Promise.all([
      pageTom.evaluate(async (peerId: string) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        await app?.warmMeshConnectionToPeer?.(peerId).catch(() => {});
      }, jerryId),
      pageJerry.evaluate(async (peerId: string) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        await app?.warmMeshConnectionToPeer?.(peerId).catch(() => {});
      }, tomId),
    ]);

    for (const [label, page] of [
      ['Tom', pageTom],
      ['Jerry', pageJerry],
    ] as [string, Page][]) {
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                ((window as any).__iinpublic_app?.getApp?.() as any)
                  ?.peerMeshService?.getDiagnostics?.()?.connectedNeighborCount ?? 0,
            ),
          { timeout: MESH_E2E_TIMEOUT_MS, message: `${label}: no connected mesh neighbors` },
        )
        .toBeGreaterThan(0);
    }

    // ── 4. Tom creates + broadcasts a tag talk ───────────────────────────────
    const TEST_TALK_ID = `mailbox-e2e-${Date.now()}`;
    const TEST_TALK_TITLE = 'Mailbox E2E Offline Talk';

    // Capture Tom's epub for later use in Jerry's encryption
    const tomEpub = await pageTom.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.epub ?? ''),
    );

    await pageTom.evaluate(
      async ({ talkId, authorId, title }: { talkId: string; authorId: string; title: string }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const mesh = app?.peerMeshService;
        if (!mesh) throw new Error('peerMeshService not available on Tom');
        const talkDef = {
          id: talkId,
          authorId,
          title,
          type: 'tag',
          questions: [
            {
              id: 'q1',
              text: 'Are you testing the mailbox?',
              answers: [
                { id: 'a-match', text: 'Yes — mailbox test', isMatch: true },
                { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true },
              ],
            },
          ],
        };
        mesh.cacheTalkBody(talkId, talkDef);
        const gun = app?.gunService?.getGun?.();
        if (gun) {
          gun.get(`talks/${talkId}`).put({ data: JSON.stringify(talkDef) });
        }
        const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        myTalks[talkId] = { role: 'created', fullTalk: talkDef };
        localStorage.setItem('myTalks', JSON.stringify(myTalks));
        await mesh.broadcastTalk(talkDef, { roomBroadcast: true });
      },
      { talkId: TEST_TALK_ID, authorId: tomId, title: TEST_TALK_TITLE },
    );

    await afterAction();

    // Wait for Jerry to receive the announce
    await expect
      .poll(
        () =>
          pageJerry.evaluate(
            ({ tId, aId }: { tId: string; aId: string }) => {
              const diag = (window as any).__iinpublic_app?.getApp?.()
                ?.meshAnnounceDiagnostics as { received: Array<{ talkId: string; authorId: string }> } | undefined;
              return (diag?.received ?? []).some((r) => r.talkId === tId && r.authorId === aId);
            },
            { tId: TEST_TALK_ID, aId: tomId },
          ),
        {
          timeout: MESH_E2E_TIMEOUT_MS,
          message: 'Jerry did not receive Tom\'s talk-announce',
        },
      )
      .toBe(true);

    await afterSync();

    // ── 5. Save Tom's localStorage state before going offline ────────────────
    const storageDir = e2eTestStorageDir();
    fs.mkdirSync(storageDir, { recursive: true });
    const tomStoragePath = path.join(storageDir, 'tom-mailbox-state.json');
    await contextTom.storageState({ path: tomStoragePath });

    // ── 6. Tom goes OFFLINE (close context) ──────────────────────────────────
    await contextTom.close().catch(() => {});
    pageTom = undefined;
    contextTom = undefined;

    await afterAction();

    // ── 7. Jerry answers MATCH while Tom is offline ──────────────────────────
    // submitTalkResponsePairDirect will fail to deliver via mesh (Tom is gone)
    // and will post to the mailbox instead.

    const talkDefForJerry = {
      id: TEST_TALK_ID,
      authorId: tomId,
      title: TEST_TALK_TITLE,
      authorEpub: tomEpub,
      type: 'tag',
      questions: [
        {
          id: 'q1',
          text: 'Are you testing the mailbox?',
          answers: [
            { id: 'a-match', text: 'Yes — mailbox test', isMatch: true },
            { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true },
          ],
        },
      ],
    };

    await pageJerry.evaluate(
      async ({ talkId, talkDef, authorId, authorName }: {
        talkId: string;
        talkDef: any;
        authorId: string;
        authorName: string;
      }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (!app) throw new Error('app not available on Jerry');
        app.peerMeshService?.cacheTalkBody?.(talkId, talkDef);
        const matchAnswers = [
          { questionId: 'q1', answerId: 'a-match', answerText: 'Yes — mailbox test', mode: 'manual', isMatch: true },
        ];
        await (app as any).submitTalkResponsePairDirect({
          talkId,
          talkData: { ...talkDef, authorId, authorName },
          answers: matchAnswers,
          isChatbotResponse: false,
          authorId,
          authorName,
          isAutoResponse: false,
        });
      },
      { talkId: TEST_TALK_ID, talkDef: talkDefForJerry, authorId: tomId, authorName: 'Tom Mailbox' },
    );

    await afterAction();
    // Give the async postToMailbox call time to complete
    await afterSync();

    // ── 8. Assert mailbox has exactly 1 envelope for Tom ────────────────────
    const apiBase = gunBaseURL();
    const mailboxRes = await pageJerry.evaluate(
      async ({ base, tId }: { base: string; tId: string }) => {
        const res = await fetch(`${base}/api/mailbox/${encodeURIComponent(tId)}`, { cache: 'no-store' });
        return res.ok ? await res.json() : null;
      },
      { base: apiBase, tId: tomId },
    );

    expect(mailboxRes, 'mailbox response must not be null').not.toBeNull();
    expect(mailboxRes.count, 'exactly 1 mailbox envelope for Tom').toBe(1);
    const envelope = mailboxRes.envelopes[0];
    expect(envelope.id, 'envelope id starts with mbx_').toMatch(/^mbx_/);

    // ── 9. Ciphertext opacity assertion ──────────────────────────────────────
    // The ciphertext stored on the server must NOT contain the plaintext answer.
    const ciphertextField: string = envelope.ciphertext;
    expect(
      ciphertextField,
      'ciphertext must not contain plaintext answer text',
    ).not.toContain(MATCH_ANSWER_TEXT);
    // The ciphertext should be a JSON wrapper with senderEpub + ct fields.
    const wrapper = JSON.parse(ciphertextField) as { senderEpub?: string; ct?: string };
    expect(wrapper.senderEpub, 'wrapper has senderEpub').toBeTruthy();
    expect(wrapper.ct, 'wrapper has ct (inner ciphertext)').toBeTruthy();
    expect(wrapper.ct, 'inner ct does not contain plaintext').not.toContain(MATCH_ANSWER_TEXT);

    // ── 10. Zero server response endpoint calls on Jerry's side ──────────────
    expect(jerryServerResponseCalls, 'zero POST /api/talks/*/response calls').toBe(0);

    // ── 11. Tom reconnects with same identity ────────────────────────────────
    const tomContextReconnect = await browserTom!.newContext({
      viewport: { width: 640, height: 1000 },
      deviceScaleFactor: 1,
      storageState: tomStoragePath,
    });
    contextTom = tomContextReconnect;
    pageTom = await tomContextReconnect.newPage();

    await pageTom.goto(webAppURLStableChatroom(), { waitUntil: 'domcontentloaded' });
    await afterLoad();

    // Verify Tom reconnected with the same user id
    const tomIdReconnect = await pageTom.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    expect(tomIdReconnect, 'Tom reconnects with same userId').toBe(tomId);

    // drainMailbox is called automatically at boot (after initP2PPresenceAndBridge).
    // Also triggered when syncPeerMeshRoom fires on room join.
    // Poll for the conversation to appear.

    // Navigate to Me tab for durable assertion
    await waitForTabActive(pageTom, 'me');

    // ── 12. Durable match assertion on Tom's side ────────────────────────────
    await expect
      .poll(
        () =>
          pageTom!.evaluate(({ jId }: { jId: string }) => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
            return Object.values(conversations).some(
              (c: any) => c?.otherUserId === jId,
            );
          }, { jId: jerryId }),
        {
          timeout: MESH_E2E_TIMEOUT_MS,
          intervals: [500, 1000, 2000],
          message: 'Tom: no conversation with Jerry after mailbox drain',
        },
      )
      .toBe(true);

    // ── 13. Mailbox is empty after drain ─────────────────────────────────────
    await expect
      .poll(
        async () => {
          const res = await pageTom!.evaluate(
            async ({ base, tId }: { base: string; tId: string }) => {
              const r = await fetch(`${base}/api/mailbox/${encodeURIComponent(tId)}`, { cache: 'no-store' });
              return r.ok ? (await r.json() as { count: number }).count : -1;
            },
            { base: apiBase, tId: tomId },
          );
          return res;
        },
        {
          timeout: MESH_E2E_TIMEOUT_MS,
          intervals: [500, 1000],
          message: 'Mailbox should be empty after Tom drains it',
        },
      )
      .toBe(0);

    // ── 14. Conversation id matches on both sides ─────────────────────────────
    const tomConvId = await pageTom.evaluate(({ jId }: { jId: string }) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
      const conv = Object.values(conversations).find((c: any) => c?.otherUserId === jId) as any;
      return conv?.conversationId ?? null;
    }, { jId: jerryId });

    const jerryConvId = await pageJerry.evaluate(({ tId }: { tId: string }) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
      const conv = Object.values(conversations).find((c: any) => c?.otherUserId === tId) as any;
      return conv?.conversationId ?? null;
    }, { tId: tomId });

    expect(tomConvId, 'Tom has a conversation id').toBeTruthy();
    expect(jerryConvId, 'Jerry has a conversation id').toBeTruthy();
    expect(tomConvId, 'conversation id is the same on both sides').toBe(jerryConvId);
  });
});
