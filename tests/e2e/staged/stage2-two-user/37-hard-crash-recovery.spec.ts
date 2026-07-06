/**
 * Spec 37 — Hard browser-process crash + recovery.
 *
 * A and B are matched. B is then killed by SIGKILL on its browser process (a genuine
 * hard crash — NOT `context.close()`, which is a graceful shutdown that flushes/persists).
 * While B is dead, A sends 2 DMs: WebRTC delivery fails (peer gone), so each message is
 * persisted to A's local Gun (authoritative) and queued to B's encrypted offline mailbox.
 * B is then relaunched from the SAME on-disk profile and must recover as the SAME user,
 * with the conversation intact and both offline messages delivered — with a clean boot
 * (no wedged empty state).
 *
 * Kill mechanism (documented in the .md): B runs in a persistent chromium context
 * (`chromium.launchPersistentContext(userDataDir)`), and the crash is
 * `context.browser()?.process()?.kill('SIGKILL')`. `storageState` alone is insufficient
 * because it does not capture the Web Worker IndexedDB where Gun-on-device persists;
 * a fixed `userDataDir` reused across the kill preserves localStorage AND IndexedDB, so
 * the relaunched profile boots with the same `iinpublic_user_id`, SEA keypair, and local
 * Gun graph.
 *
 * See companion 37-hard-crash-recovery.md.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, Browser, expect, type Page } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, gotoAppReady } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import {
  getConversationIdBetween,
  waitForServerConversationBetween,
} from '../../helpers/conversation-e2e';
import { sendConversationMessage } from '../../helpers/fast-dm-setup';
import { launchPersistentUser, bootstrapOnPage } from '../../helpers/crash-recovery';

const MSG_1 = 'CRASH-recovery-msg-1';
const MSG_2 = 'CRASH-recovery-msg-2';
const MSG_3 = 'CRASH-recovery-post-reconnect-reply';

test.describe('Hard crash recovery: SIGKILL B, A sends offline, B relaunches from same profile and recovers', () => {
  let browserA: Browser;
  let contextB: import('@playwright/test').BrowserContext | undefined;
  let contextBRelaunch: import('@playwright/test').BrowserContext | undefined;
  let userDataDirB: string;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=640,1100', ...WEBRTC_CHROMIUM_ARGS],
    });
    userDataDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpub-crashB-'));
  });

  test.afterAll(async () => {
    await contextBRelaunch?.close().catch(() => {});
    await contextB?.close().catch(() => {});
    await browserA?.close().catch(() => {});
    try { fs.rmSync(userDataDirB, { recursive: true, force: true }); } catch { /* ignore */ }
    await clearGunForStage2Spec();
  });

  test('B survives SIGKILL: relaunched profile is the same user and receives the 2 offline messages', async () => {
    test.setTimeout(120_000);
    const T0 = Date.now();
    const mark = (s: string) => console.log(`[T+${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}`);

    // ── 1. Bootstrap A (normal) and B (persistent context) in parallel ────────
    const b1 = await launchPersistentUser(userDataDirB, 660);
    contextB = b1.context;
    const killB = b1.kill;
    const pageB = b1.page;

    const [a, userIdB] = await Promise.all([
      bootstrapUser(browserA, 'CrashA', 'CrashA'),
      bootstrapOnPage(pageB, 'CrashB'),
    ]);
    const pageA = a.page;
    const userIdA = await pageA.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    expect(userIdA, 'A user id').toBeTruthy();
    expect(userIdB, 'B user id').toBeTruthy();
    mark('both bootstrapped');

    // Capture B's persisted identity fingerprint for the post-crash comparison.
    const bStageNameBefore = await pageB.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName || ''),
    );

    // ── 2. Match A↔B via the pair-direct response path (no UI, no overlay) ─────
    const talkId = `crash-dm-${Date.now()}`;
    const authorEpub = await pageA.evaluate(
      ({ tid, authorId }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        const talkDef = {
          id: tid, authorId, title: `Crash Talk ${tid}`, type: 'flow',
          questions: [{
            id: 'q1', text: 'Want to chat?',
            answers: [
              { id: 'a-match', text: 'Yes, lets chat.', isMatch: true },
              { id: 'a-ignore', text: 'No thanks.', isMatch: false, isIgnore: true },
            ],
          }],
        };
        app?.peerMeshService?.cacheTalkBody?.(tid, talkDef);
        const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        myTalks[tid] = { role: 'created', fullTalk: talkDef };
        localStorage.setItem('myTalks', JSON.stringify(myTalks));
        return String(app?.gunService?.getStoredPair?.()?.epub ?? '');
      },
      { tid: talkId, authorId: userIdA },
    );

    await pageB.evaluate(
      async ({ tid, authorId, authorName, epub }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        const talkDef = {
          id: tid, authorId, authorName, authorEpub: epub, title: `Crash Talk ${tid}`, type: 'flow',
          questions: [{
            id: 'q1', text: 'Want to chat?',
            answers: [
              { id: 'a-match', text: 'Yes, lets chat.', isMatch: true },
              { id: 'a-ignore', text: 'No thanks.', isMatch: false, isIgnore: true },
            ],
          }],
        };
        app?.peerMeshService?.cacheTalkBody?.(tid, talkDef);
        await app.submitTalkResponsePairDirect({
          talkId: tid,
          talkData: talkDef,
          answers: [{ questionId: 'q1', answerId: 'a-match', answerText: 'Yes, lets chat.', mode: 'manual', isMatch: true }],
          isChatbotResponse: false,
          authorId,
          authorName,
          isAutoResponse: false,
        });
      },
      { tid: talkId, authorId: userIdA, authorName: 'CrashA', epub: authorEpub },
    );

    await Promise.all([
      waitForServerConversationBetween(pageA, userIdA, userIdB),
      waitForServerConversationBetween(pageB, userIdB, userIdA),
    ]);
    const conversationId = await getConversationIdBetween(pageA, userIdA, userIdB);
    expect(conversationId, 'A↔B conversation id').toBeTruthy();
    mark('matched');

    // ── 3. HARD CRASH: SIGKILL B's browser process ────────────────────────────
    let bClosed = false;
    contextB.on('close', () => { bClosed = true; });
    killB(); // sends SIGKILL to B's chromium process
    // Wait for Playwright to observe the process death (context close event fires on crash).
    await expect
      .poll(() => bClosed, { timeout: 15_000, message: 'B context should close after SIGKILL' })
      .toBe(true);
    contextB = undefined; // its process is dead
    mark('B SIGKILLed');

    // ── 4. While B is dead, A sends 2 DMs (→ local Gun + offline mailbox) ──────
    // Fire both without serializing: each `sendMessage` first tries WebRTC `ensureConnected`
    // (10s timeout when the peer is dead) before falling back to the mailbox. Running them
    // concurrently overlaps the two connect attempts instead of paying ~20s back-to-back.
    await Promise.all([
      sendConversationMessage(pageA, conversationId, userIdA, MSG_1),
      sendConversationMessage(pageA, conversationId, userIdA, MSG_2),
    ]);
    mark('A sent 2 offline messages');

    // ── 5. Relaunch B from the SAME on-disk profile (userDataDir) ─────────────
    const b2 = await launchPersistentUser(userDataDirB, 660);
    contextBRelaunch = b2.context;
    const pageBReborn = b2.page;
    await gotoAppReady(pageBReborn, webAppURLStableChatroom());
    mark('B relaunched + app ready');

    // ── 6. Same identity survived the crash ───────────────────────────────────
    const bIdAfter = await pageBReborn.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    const bStageNameAfter = await pageBReborn.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName || ''),
    );
    expect(bIdAfter, 'relaunched B is the SAME user id').toBe(userIdB);
    expect(bStageNameAfter, 'relaunched B keeps the same stage name').toBe(bStageNameBefore);

    // ── 7. Conversation with A is present after recovery ──────────────────────
    // Durable check: the conversation is rehydrated from the persisted local Gun graph
    // (IndexedDB survived the crash via the reused user-data-dir). We do NOT read raw
    // localStorage `myConversations` here — a SIGKILL 200ms after match creation may
    // predate chromium flushing that localStorage key to disk, whereas the Gun graph
    // (authoritative) is restored and the app rehydrates the conversation list from it.
    await waitForServerConversationBetween(pageBReborn, userIdB, userIdA);
    const convIdAfter = await getConversationIdBetween(pageBReborn, userIdB, userIdA);
    expect(convIdAfter, 'B recovered the SAME A↔B conversation id after the crash').toBe(conversationId);

    // ── 8. Both offline messages arrive (mailbox drains ≤3s poll) ─────────────
    const readTextsFor = (page: Page, myId: string, otherId: string) =>
      page.evaluate(
        ({ cid, otherId, myId }) =>
          new Promise<string[]>((resolve) => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            const texts: string[] = [];
            let done = false;
            const unsub = app.conversationService.subscribeToMessages(
              cid,
              (msgs: any[]) => { for (const m of msgs) if (m?.text) texts.push(String(m.text)); },
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
        { cid: conversationId, otherId, myId },
      );

    let seen: string[] = [];
    await expect
      .poll(
        async () => {
          seen = await readTextsFor(pageBReborn, userIdB, userIdA);
          return seen.includes(MSG_1) && seen.includes(MSG_2);
        },
        { timeout: 25_000, intervals: [1000, 1500, 2000], message: 'both offline messages must arrive after B recovers' },
      )
      .toBe(true);
    mark('both offline messages delivered');

    // ── 9. Recovered B can continue the SAME canonical pair conversation ──────
    await pageBReborn.evaluate(
      async ({ cid, sid, body, otherId }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        await app.conversationService.sendMessage(cid, sid, body, { otherUserId: otherId });
      },
      { cid: conversationId, sid: userIdB, body: MSG_3, otherId: userIdA },
    );
    await expect
      .poll(
        async () => (await readTextsFor(pageA, userIdA, userIdB)).includes(MSG_3),
        { timeout: 25_000, intervals: [1000, 1500, 2000], message: 'A must receive B reply after B reconnects' },
      )
      .toBe(true);
    mark('post-reconnect reply delivered');

    // ── 10. App booted cleanly (not stuck on an empty state) ──────────────────
    const chatroomsVisible = await pageBReborn.locator('.nav-btn[data-view="chatrooms"]').isVisible();
    expect(chatroomsVisible, 'B app rendered its shell (clean boot)').toBe(true);
  });
});
