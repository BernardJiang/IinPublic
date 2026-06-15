/**
 * T3 -- conversation transport fallback (direct-p2p -> server-relay -> star-gun).
 *
 * The ResilientConversationTransport tries direct WebRTC first, then encrypted
 * server-relay, then star-gun. The fallback chain is unit-tested in
 * src/test/unit/resilient-conversation-transport-fallback.test.ts; this spec proves
 * it end to end with two real browsers, using the deterministic fault-injection seam
 * (conversationService.setTransportFailModesForE2e) instead of trying to flake real
 * WebRTC/STUN timing.
 *
 * Legs:
 *   1. Force direct-p2p to fail -> sender switches to server-relay and Jerry still
 *      receives the message (his subscription falls back to relay too).
 *   2. Force direct-p2p AND server-relay to fail -> sender switches to star-gun and
 *      the body is persisted on the star-gun Gun path (transport-layer delivery proof;
 *      receiver-side star subscription is a documented CI follow-up below).
 *
 * NOTE: no asterisk-slash sequences inside block comments per CLAUDE.md.
 */

import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { gunBaseURL, webAppURLStableChatroom } from '../../helpers/ports';
import { openIncomingTalkModal, waitForResponseModalClosed, getIncomingClusterTitlesForUser } from '../../helpers/talks-matching-flow';
import {
  clickBroadcastUntilBulkAck,
  waitForBroadcastableTalkIds,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import {
  getConversationIdBetween,
  openConversationViaServer,
  waitForServerConversationBetween,
} from '../../helpers/conversation-e2e';
import { getTransportModeFromPage, warmDirectP2PSession } from '../../helpers/p2p-transport-e2e';

type TransportMode = 'direct-p2p' | 'server-relay' | 'star-gun';

async function activateResilientTransport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    app?.conversationService?.activateResilientTransportForE2e?.();
  });
}

async function setFailModes(page: Page, modes: TransportMode[]): Promise<void> {
  await page.evaluate((m) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    app?.conversationService?.setTransportFailModesForE2e?.(m);
  }, modes);
}

async function expectTransportMode(page: Page, mode: TransportMode, timeoutMs = 30_000): Promise<void> {
  await expect
    .poll(() => getTransportModeFromPage(page), { timeout: timeoutMs, message: `transport mode -> ${mode}` })
    .toBe(mode);
}

test.describe('Conversation transport fallback (T3)', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;

  const MATCH_ANSWER = 'Yes, lets play.';
  const IGNORE_ANSWER = 'No thanks.';
  const RELAY_MESSAGE = 'Relay leg: meet at the courts at 9am?';
  const STAR_MESSAGE = 'Star leg: bring an extra racket.';

  test.setTimeout(420_000);

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    const mk = (x: number) => ({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${x},0`, '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserTom = await chromium.launch(mk(0));
    browserJerry = await chromium.launch(mk(640));
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch { /* best-effort */ }
    };
    await cleanup(pageTom);
    await cleanup(pageJerry);
    await pageTom?.close();
    await pageJerry?.close();
    await contextTom?.close();
    await contextJerry?.close();
    await browserTom?.close();
    await browserJerry?.close();
    await clearGunForStage2Spec();
  });

  async function bootstrapUser(browser: Browser, label: string, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => console.log(`[${label}]:`, m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, label);
    return { context, page };
  }

  // PARKED (test.fixme) pending live-CI iteration only. Status:
  //   - Fallback ROUTING (send side) proven deterministically in
  //     src/test/unit/resilient-conversation-transport-fallback.test.ts.
  //   - Gap (b) CLOSED: the resilient SUBSCRIBE path now falls back direct->relay->star
  //     (advanceSubscription in resilient-conversation-transport.ts), unit-tested in the
  //     same file ("subscribe-side fallback" describe). The star-leg receiver render is
  //     now asserted below (no longer transport-layer only).
  //   - Remaining (a): confirm cross-browser server-relay + star delivery in the standard
  //     E2E hub on browser-capable CI (this sandbox cannot launch Playwright Chromium).
  // Un-fixme once (a) is validated in CI. See docs/TODO.md T3.
  test('forced WebRTC failure falls back to server-relay, then to star-gun', async () => {
    const talkTitle = `Fallback Tennis ${Date.now()}`;

    // ── Bootstrap + match (reuse the standard direct-message setup) ──────────
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    const tomUserId = await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '');
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', talkTitle);
    await selectTalkEditorType(pageTom, 'flow');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Want a tennis partner?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterNav();
    await waitForBroadcastableTalkIds(pageTom, 120_000);
    await waitForDistinctGunPeersExcludingSelf(pageTom, 1, 240_000);
    await clickBroadcastUntilBulkAck(pageTom);
    await afterSync();

    const jerryUserId = await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '');

    await expect
      .poll(async () => (await getIncomingClusterTitlesForUser(pageJerry, jerryUserId)).length, {
        message: 'Jerry should have incoming talks after broadcast',
        timeout: 120_000,
      })
      .toBeGreaterThanOrEqual(1);

    await openIncomingTalkModal(pageJerry, talkTitle);
    await pageJerry.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`).first().click();
    await waitForResponseModalClosed(pageJerry);
    await afterSync();

    // Conversation exists on both sides; capture id.
    await waitForServerConversationBetween(pageTom, tomUserId, jerryUserId);
    await waitForServerConversationBetween(pageJerry, jerryUserId, tomUserId);
    const conversationId = await getConversationIdBetween(pageTom, tomUserId, jerryUserId);

    // Swap onto ResilientConversationTransport BEFORE opening conversation overlays so
    // that showConversationDetail's subscribeToMessages call goes through the resilient
    // transport (not the DirectP2P default which has no relay/star legs).
    await activateResilientTransport(pageTom);
    await activateResilientTransport(pageJerry);

    // Open overlays — subscriptions now route through ResilientConversationTransport.
    await openConversationViaServer(pageTom, tomUserId, 'Jerry', jerryUserId);
    await openConversationViaServer(pageJerry, jerryUserId, 'Tom', tomUserId);

    // ── Leg 1: force direct-p2p to fail -> server-relay carries the message ──
    await setFailModes(pageTom, ['direct-p2p']);
    await setFailModes(pageJerry, ['direct-p2p']);
    // Warm subscriptions so the receiver's resilient transport runs its own
    // direct->relay fallback timer (direct can never connect under the fault).
    await warmDirectP2PSession(pageTom, conversationId);
    await warmDirectP2PSession(pageJerry, conversationId);

    const tomInput = pageTom.locator('#conversation-message-input');
    await expect(tomInput).toBeVisible({ timeout: 10_000 });
    await tomInput.fill(RELAY_MESSAGE);
    await afterAction();
    await pageTom.click('#send-conversation-message');
    await afterSync();

    // Sender switched to server-relay (the routing decision).
    await expectTransportMode(pageTom, 'server-relay');

    // Tom sees his own message, and Jerry receives it over relay.
    await expect(
      pageTom.locator('#conversation-messages .message-text').filter({ hasText: RELAY_MESSAGE }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () =>
          pageJerry.locator('#conversation-messages .message-text').filter({ hasText: RELAY_MESSAGE }).first().isVisible().catch(() => false),
        { message: 'Jerry should receive the relay-leg message', timeout: 40_000 },
      )
      .toBe(true);

    // ── Leg 2: force direct AND relay to fail -> star-gun carries the message ──
    await setFailModes(pageTom, ['direct-p2p', 'server-relay']);
    await setFailModes(pageJerry, ['direct-p2p', 'server-relay']);

    await tomInput.fill(STAR_MESSAGE);
    await afterAction();
    await pageTom.click('#send-conversation-message');
    await afterSync();

    // Sender advanced all the way to star-gun.
    await expectTransportMode(pageTom, 'star-gun');

    // Transport-layer delivery proof: star-gun mirrors the body to the legacy
    // conversations/<id>/messages path. Assert it persisted (independent of the
    // receiver's UI subscription).
    await expect
      .poll(
        async () => {
          const res = await pageTom.request.get(`${gunBaseURL()}/api/test/export-snapshot`);
          if (!res.ok()) return 0;
          const payload = (await res.json()) as { gunGraph?: Record<string, unknown> };
          const graph = payload.gunGraph ?? {};
          const prefix = `conversations/${conversationId}/messages/`;
          return Object.entries(graph).filter(
            ([key, val]) => key.startsWith(prefix) && key !== `conversations/${conversationId}/messages` && val != null,
          ).length;
        },
        { message: 'star-gun should persist the message body on the legacy Gun path', timeout: 40_000 },
      )
      .toBeGreaterThanOrEqual(1);

    // Receiver-side render of the star leg: the resilient subscribe path now advances
    // direct->relay->star (gap (b) closed), so Jerry renders the star message, not just
    // the persisted body asserted above.
    await expectTransportMode(pageJerry, 'star-gun');
    await expect
      .poll(
        async () =>
          pageJerry.locator('#conversation-messages .message-text').filter({ hasText: STAR_MESSAGE }).first().isVisible().catch(() => false),
        { message: 'Jerry should render the star-leg message', timeout: 40_000 },
      )
      .toBe(true);
  });
});
