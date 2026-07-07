import { chromium, type Browser, type Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { waitForDirectP2PChannel, warmDirectP2PSession } from '../helpers/p2p-transport-e2e';
import {
  bootstrapBrowserUserOnOrigin,
  bootstrapNativeWindow,
  forceJoinGlobal,
  launchNativeUser,
  readGlobalMembersFromHub,
  type NativeUser,
} from './helpers/native-app';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
const APP_PORT = 19111;
const WEBRTC_LAUNCH_ARGS = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

async function readCurrentPublicUser(page: { evaluate: <T>(fn: () => T | Promise<T>) => Promise<T> }): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const user = app?.currentUser || {};
    const pair = app?.gunService?.getStoredPair?.();
    return {
      ...user,
      ...(pair?.pub ? { pub: pair.pub } : {}),
      ...(pair?.epub ? { epub: pair.epub } : {}),
    };
  });
}

async function publishPublicUserToHub(user: Record<string, unknown>): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    await fetch(`http://127.0.0.1:${HUB_GUN_PORT}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function createLocalDirectConversation(
  page: Page,
  otherUserId: string,
  otherUserName: string,
): Promise<string> {
  const conversationId = await page.evaluate(
    async ({ id, name }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const currentUser = app?.currentUser;
      if (!currentUser?.id || !app?.conversationService?.createConversation) {
        throw new Error('Conversation service not available');
      }
      const cid = await app.conversationService.createConversation({
        userId1: currentUser.id,
        userName1: currentUser.stageName,
        userId2: id,
        userName2: name,
        talkId: 'direct',
      });
      app.uiManager?.addNewConversation?.({
        conversationId: cid,
        otherUserId: id,
        otherUserName: name,
        talkId: 'direct',
        transportMode: 'direct-p2p',
      });
      return String(cid);
    },
    { id: otherUserId, name: otherUserName },
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ cid, id }) => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return conversations[cid]?.otherUserId === id;
          },
          { cid: conversationId, id: otherUserId },
        ),
      { timeout: 10_000, message: `local direct conversation ${conversationId}` },
    )
    .toBe(true);
  return conversationId;
}

async function openLocalConversation(page: Page, conversationId: string): Promise<void> {
  await page.evaluate((cid) => {
    (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showConversationDetail?.(cid);
  }, conversationId);
  await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 20_000 });
}

async function sendConversationMessage(page: Page, message: string): Promise<void> {
  await expect(page.locator('#conversation-message-input')).toBeVisible({ timeout: 10_000 });
  await page.locator('#conversation-message-input').fill(message);
  await page.locator('#send-conversation-message').click();
}

async function ensureDirectP2PConnected(
  page: Page,
  conversationId: string,
  otherUserId: string,
  timeoutMs: number,
): Promise<void> {
  await page.evaluate(
    async ({ cid, otherId, timeout }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const userId = app?.currentUser?.id ?? '';
      const transport = app?.conversationService?.transport;
      if (!userId || !transport?.ensureSessionConnected) {
        throw new Error('Direct P2P transport is not available');
      }
      await Promise.race([
        transport.ensureSessionConnected(cid, userId, timeout, otherId),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Direct P2P explicit connect timed out')), timeout + 2_000)),
      ]);
    },
    { cid: conversationId, otherId: otherUserId, timeout: timeoutMs },
  );
}

async function fetchRelayFrameSummary(port: number, conversationId: string, recipientPub?: string): Promise<unknown> {
  const params = recipientPub ? `?recipientPub=${encodeURIComponent(recipientPub)}` : '';
  const response = await fetch(
    `http://127.0.0.1:${port}/api/p2p/signaling-relay/${encodeURIComponent(conversationId)}${params}`,
  );
  if (!response.ok) return { status: response.status };
  const body = await response.json() as { frames?: Array<Record<string, unknown>> };
  return {
    count: body.frames?.length ?? 0,
    frames: (body.frames ?? []).map((frame) => ({
      kind: frame.kind,
      senderPub: String(frame.senderPub || '').slice(0, 10),
      recipientPub: String(frame.recipientPub || '').slice(0, 10),
      nonce: String(frame.nonce || '').slice(0, 10),
    })),
  };
}

async function readDirectP2PState(page: Page, conversationId: string): Promise<unknown> {
  return page.evaluate((cid) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const userId = app?.currentUser?.id ?? '';
    return {
      userId,
      state: app?.conversationService?.getDirectP2PConnectionState?.(cid, userId) ?? 'missing',
      diagnostics: app?.conversationService?.getHandshakeDiagnostics?.(cid, userId) ?? null,
    };
  }, conversationId);
}

async function readDirectP2PPrereqs(
  page: Page,
  conversationId: string,
  otherUserId: string,
): Promise<unknown> {
  return page.evaluate(
    async ({ cid, otherId }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      const publicUser = await Promise.race([
        app?.gunService?.getPublicUser?.(otherId).catch((err: Error) => ({ error: err.message })),
        new Promise((resolve) => setTimeout(() => resolve({ error: 'public user lookup timed out' }), 5_000)),
      ]);
      return {
        hasApp: !!app,
        currentUserId: app?.currentUser?.id ?? '',
        transportMode: app?.conversationService?.getTransportMode?.() ?? 'missing',
        hasTransport: !!app?.conversationService?.transport?.ensureSessionConnected,
        localConversation: conversations[cid] ?? null,
        publicUser,
      };
    },
    { cid: conversationId, otherId: otherUserId },
  );
}

test.describe('Native app: browser + Electron app shared hub presence', () => {
  let browser: Browser | undefined;
  let native: NativeUser | undefined;
  let closeBrowserUser: (() => Promise<void>) | undefined;
  let userDataDir = '';

  test.afterEach(async () => {
    await closeBrowserUser?.().catch(() => {});
    closeBrowserUser = undefined;
    await browser?.close().catch(() => {});
    browser = undefined;
    await native?.app.close().catch(() => {});
    native = undefined;
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('browser user and desktop app user appear together in Global through the shared hub', async () => {
    browser = await chromium.launch({ headless: true, args: WEBRTC_LAUNCH_ARGS });
    const browserUser = await bootstrapBrowserUserOnOrigin(
      browser,
      `http://127.0.0.1:${WEB_PORT}`,
      'Native browser peer',
      'NativeBrowser',
      { waitForSupportGreeting: false },
    );
    closeBrowserUser = browserUser.close;

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-native-e2e-'));
    native = await launchNativeUser({
      localPort: APP_PORT,
      hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`,
      userDataDir,
    });
    const appUserId = await bootstrapNativeWindow(native.window, 'NativeDesktop', { waitForSupportGreeting: false });
    expect(appUserId).toBeTruthy();
    expect(appUserId).not.toBe(browserUser.userId);

    await forceJoinGlobal(browserUser.page);
    await forceJoinGlobal(native.window);
    await publishPublicUserToHub(await readCurrentPublicUser(browserUser.page));
    await publishPublicUserToHub(await readCurrentPublicUser(native.window));

    await expect
      .poll(
        async () => {
          const userIds = (await readGlobalMembersFromHub(HUB_GUN_PORT)).map((member) => member.userId);
          return {
            browser: userIds.includes(browserUser.userId),
            desktop: userIds.includes(appUserId),
          };
        },
        { timeout: 30_000, intervals: [1000, 1500, 2000] },
      )
      .toEqual({ browser: true, desktop: true });

    await expect
      .poll(
        () =>
          native!.window.evaluate(
            (uid) =>
              (window as any).__iinpublic_app
                ?.getApp?.()
                ?.uiManager?.getCurrentChatroomMembers?.()
                ?.some((member: { userId?: string }) => member.userId === uid) === true,
            browserUser.userId,
          ),
        { timeout: 30_000, intervals: [1000, 1500, 2000] },
      )
      .toBe(true);

    await expect
      .poll(
        () =>
          browserUser.page.evaluate(
            (uid) =>
              (window as any).__iinpublic_app
                ?.getApp?.()
                ?.uiManager?.getCurrentChatroomMembers?.()
                ?.some((member: { userId?: string }) => member.userId === uid) === true,
            appUserId,
          ),
        { timeout: 30_000, intervals: [1000, 1500, 2000] },
      )
      .toBe(true);
  });

  test('browser user and desktop app user exchange a direct message through explicit relay signaling', async () => {
    browser = await chromium.launch({ headless: true, args: WEBRTC_LAUNCH_ARGS });
    const browserUser = await bootstrapBrowserUserOnOrigin(
      browser,
      `http://127.0.0.1:${WEB_PORT}`,
      'Relay DM browser peer',
      'RelayBrowser',
      { waitForSupportGreeting: false },
    );
    closeBrowserUser = browserUser.close;

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-native-e2e-'));
    native = await launchNativeUser({
      localPort: APP_PORT,
      hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`,
      userDataDir,
    });
    const appUserId = await bootstrapNativeWindow(native.window, 'RelayDesktop', { waitForSupportGreeting: false });
    expect(appUserId).toBeTruthy();
    expect(appUserId).not.toBe(browserUser.userId);

    await forceJoinGlobal(browserUser.page);
    await forceJoinGlobal(native.window);
    await publishPublicUserToHub(await readCurrentPublicUser(browserUser.page));
    await publishPublicUserToHub(await readCurrentPublicUser(native.window));

    await expect
      .poll(
        async () => {
          const [browserSeesNative, nativeSeesBrowser] = await Promise.all([
            browserUser.page.evaluate(async (uid) => {
              const app = (window as any).__iinpublic_app?.getApp?.();
              const user = await app?.gunService?.getPublicUser?.(uid).catch(() => null);
              return !!user?.pub && !!user?.epub;
            }, appUserId),
            native.window.evaluate(async (uid) => {
              const app = (window as any).__iinpublic_app?.getApp?.();
              const user = await app?.gunService?.getPublicUser?.(uid).catch(() => null);
              return !!user?.pub && !!user?.epub;
            }, browserUser.userId),
          ]);
          return { browserSeesNative, nativeSeesBrowser };
        },
        { timeout: 45_000, intervals: [1000, 1500, 2000] },
      )
      .toEqual({ browserSeesNative: true, nativeSeesBrowser: true });

    const browserConversationId = await createLocalDirectConversation(
      browserUser.page,
      appUserId,
      'RelayDesktop',
    );
    const nativeConversationId = await createLocalDirectConversation(
      native.window,
      browserUser.userId,
      'RelayBrowser',
    );
    expect(nativeConversationId).toBe(browserConversationId);

    await openLocalConversation(browserUser.page, browserConversationId);
    await openLocalConversation(native.window, nativeConversationId);
    await warmDirectP2PSession(browserUser.page, browserConversationId);
    await warmDirectP2PSession(native.window, nativeConversationId);
    const connectResults = await Promise.allSettled([
      ensureDirectP2PConnected(browserUser.page, browserConversationId, appUserId, 30_000),
      ensureDirectP2PConnected(native.window, nativeConversationId, browserUser.userId, 30_000),
    ]);
    if (connectResults.some((result) => result.status === 'rejected')) {
      const browserPublic = await readCurrentPublicUser(browserUser.page);
      const nativePublic = await readCurrentPublicUser(native.window);
      const diagnostics = {
        connectResults: connectResults.map((result) =>
          result.status === 'fulfilled'
            ? { status: result.status }
            : { status: result.status, reason: result.reason instanceof Error ? result.reason.message : String(result.reason) },
        ),
        browserPrereqs: await readDirectP2PPrereqs(browserUser.page, browserConversationId, appUserId).catch((err) => String(err)),
        nativePrereqs: await readDirectP2PPrereqs(native.window, nativeConversationId, browserUser.userId).catch((err) => String(err)),
        browser: await readDirectP2PState(browserUser.page, browserConversationId).catch((err) => String(err)),
        native: await readDirectP2PState(native.window, nativeConversationId).catch((err) => String(err)),
        hubForBrowser: await fetchRelayFrameSummary(HUB_GUN_PORT, browserConversationId, String(browserPublic.pub || '')).catch((err) => String(err)),
        hubForNative: await fetchRelayFrameSummary(HUB_GUN_PORT, browserConversationId, String(nativePublic.pub || '')).catch((err) => String(err)),
        nativeLocalForBrowser: await fetchRelayFrameSummary(APP_PORT, browserConversationId, String(browserPublic.pub || '')).catch((err) => String(err)),
        nativeLocalForNative: await fetchRelayFrameSummary(APP_PORT, browserConversationId, String(nativePublic.pub || '')).catch((err) => String(err)),
      };
      throw new Error(`Direct P2P connect failed\n${JSON.stringify(diagnostics, null, 2)}`);
    }
    await waitForDirectP2PChannel(browserUser.page, browserConversationId, 30_000);
    await waitForDirectP2PChannel(native.window, nativeConversationId, 30_000);

    const message = `Explicit relay DM ${Date.now()}`;
    await sendConversationMessage(browserUser.page, message);
    await expect(native.window.locator('#conversation-messages')).toContainText(message, { timeout: 30_000 });
  });
});
