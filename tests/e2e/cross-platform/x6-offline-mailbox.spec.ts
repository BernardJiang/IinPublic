/**
 * X6 (nightly) — offline/mailbox across platforms, both directions.
 *
 * Standing in for a real platform boundary the same way X1/X2/X4 do (browser
 * context = platform): two matched clients (`setupLeanMatchedPair`, the same
 * overlay-free helper `staged/stage2-two-user/36-offline-beyond-mailbox-ttl`
 * uses) on the shared per-worker hub. "Offline" is simulated the same way
 * `talks-matching/05-mailbox-offline-response` and spec 36 already do: close
 * the browser context (saving its storageState first), then later reopen a new
 * context with that same storageState so the reconnecting client is the same
 * identity, not a new one.
 *
 * Both existing mailbox specs (05, 36) only ever take ONE side offline. This
 * spec's own contribution is proving the SAME mechanism works in the other
 * direction too, in one continuous run: B offline while A sends and B drains on
 * reconnect, then — reusing the same matched pair and conversation — A offline
 * while B (now reconnected) sends and A drains on reconnect. Uses the ordinary
 * `sendConversationMessage`/`postConversationMessageToMailbox` production path
 * (src/web/app/app.ts) rather than 36's manual envelope construction, since X6
 * isn't testing TTL edge cases — just that both directions actually deliver.
 */
import * as fs from 'fs';
import * as path from 'path';
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage2Spec } from '../helpers/e2e-stage-pipeline';
import { headless, gotoAppReady } from '../helpers/timing';
import { webAppURLStableChatroom, gunBaseURL, e2eTestStorageDir } from '../helpers/ports';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { setupLeanMatchedPair, LeanMatchedPair } from '../helpers/fast-match-lean';
import { sendConversationMessage } from '../helpers/fast-dm-setup';

const MAILBOX_DRAIN_TIMEOUT_MS = 30_000;

/**
 * Durable read of the pair-private message store (Gun is authoritative — CLAUDE.md
 * §19.4), not the ephemeral overlay DOM. Mirrors spec 36's own `readMessageTexts`.
 */
async function waitForMessageInStore(
  page: Page,
  conversationId: string,
  myId: string,
  otherId: string,
  text: string,
): Promise<void> {
  const readTexts = () =>
    page.evaluate(
      ({ cid, otherUserId, currentUserId }) =>
        new Promise<string[]>((resolve) => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          const texts: string[] = [];
          let done = false;
          const unsub = app.conversationService.subscribeToMessages(
            cid,
            (msgs: any[]) => {
              for (const m of msgs) if (m?.text) texts.push(String(m.text));
            },
            currentUserId,
            otherUserId,
          );
          setTimeout(() => {
            if (done) return;
            done = true;
            try { unsub?.(); } catch { /* ignore */ }
            resolve(Array.from(new Set(texts)));
          }, 900);
        }),
      { cid: conversationId, otherUserId: otherId, currentUserId: myId },
    );

  await expect
    .poll(async () => (await readTexts()).includes(text), {
      timeout: MAILBOX_DRAIN_TIMEOUT_MS,
      intervals: [500, 1000, 2000],
      message: `"${text}" should drain into the message store`,
    })
    .toBe(true);
}

test.describe('X6: offline mailbox across platforms', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: LeanMatchedPair | undefined;
  let liveContextA: BrowserContext | undefined;
  let livePageA: Page | undefined;
  let liveContextB: BrowserContext | undefined;
  let livePageB: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    const args = ['--window-size=640,1100', ...WEBRTC_CHROMIUM_ARGS];
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', ...args] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', ...args] });
  });

  test.afterAll(async () => {
    await livePageA?.close().catch(() => {});
    await liveContextA?.close().catch(() => {});
    await livePageB?.close().catch(() => {});
    await liveContextB?.close().catch(() => {});
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('messages drain from the encrypted mailbox on reconnect, both directions', async () => {
    test.setTimeout(180_000);

    pair = await setupLeanMatchedPair(browserA, browserB, 'X6-A', 'X6-B');
    const { conversationId, userIdA, userIdB } = pair;
    liveContextA = pair.contextA;
    livePageA = pair.pageA;
    liveContextB = pair.contextB;
    livePageB = pair.pageB;

    const storageDir = e2eTestStorageDir();
    fs.mkdirSync(storageDir, { recursive: true });
    const aStoragePath = path.join(storageDir, 'x6-a-state.json');
    const bStoragePath = path.join(storageDir, 'x6-b-state.json');

    // Capture A's identity up front — needed for A's own offline leg (direction 2)
    // later, before A's context has been touched at all.
    await liveContextA.storageState({ path: aStoragePath });

    // ── Direction 1: B offline, A sends, B reconnects and drains ──────────────
    await liveContextB.storageState({ path: bStoragePath });
    await liveContextB.close().catch(() => {});
    liveContextB = undefined;
    livePageB = undefined;

    const aToB = `a-to-b-${Date.now()}`;
    await sendConversationMessage(livePageA, conversationId, userIdA, aToB);

    liveContextB = await browserB.newContext({ viewport: { width: 640, height: 1000 }, storageState: bStoragePath });
    livePageB = await liveContextB.newPage();
    await gotoAppReady(livePageB, webAppURLStableChatroom());
    const bIdReconnect = await livePageB.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    expect(bIdReconnect, 'B reconnects as the same user').toBe(userIdB);
    await livePageB.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.drainMailbox?.());
    await waitForMessageInStore(livePageB, conversationId, userIdB, userIdA, aToB);

    // ── Direction 2: A offline, B (now reconnected) sends, A reconnects and drains ──
    await livePageA.close().catch(() => {});
    await liveContextA.close().catch(() => {});
    liveContextA = undefined;
    livePageA = undefined;

    const bToA = `b-to-a-${Date.now()}`;
    await sendConversationMessage(livePageB, conversationId, userIdB, bToA);

    liveContextA = await browserA.newContext({ viewport: { width: 640, height: 1000 }, storageState: aStoragePath });
    livePageA = await liveContextA.newPage();
    await gotoAppReady(livePageA, webAppURLStableChatroom());
    const aIdReconnect = await livePageA.evaluate(
      () => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    expect(aIdReconnect, 'A reconnects as the same user').toBe(userIdA);
    await livePageA.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.drainMailbox?.());
    await waitForMessageInStore(livePageA, conversationId, userIdA, userIdB, bToA);

    // Both directions delivered; both mailboxes end empty (drain leaves no residue).
    const apiBase = gunBaseURL();
    for (const recipientId of [userIdA, userIdB]) {
      await expect
        .poll(
          async () => {
            const res = await livePageA!.evaluate(
              async ({ base, id }) => {
                const r = await fetch(`${base}/api/mailbox/${encodeURIComponent(id)}`, { cache: 'no-store' });
                return r.ok ? (await r.json() as { count: number }).count : -1;
              },
              { base: apiBase, id: recipientId },
            );
            return res;
          },
          { timeout: 15_000, intervals: [500, 1000], message: `mailbox for ${recipientId} should be empty after drain` },
        )
        .toBe(0);
    }
  });
});
