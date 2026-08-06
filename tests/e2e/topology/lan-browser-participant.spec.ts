import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { ensureWindowFitsViewport } from '../helpers/browser-window';
import { injectIdbClear, gotoWebApp } from '../helpers/clear-database';
import { clearGunForStage2Spec } from '../helpers/e2e-stage-pipeline';
import { attachE2eBrowserTabLabel } from '../helpers/e2e-tab-title';
import { gunBaseURL, webPort, webAppURLStableChatroom } from '../helpers/ports';
import { afterLoad, afterNav, afterSync, E2E_ASSERT_TIMEOUT_MS, headless } from '../helpers/timing';
import { pinStableE2eLocation } from '../helpers/talks-matching-flow';
import {
  TECHSUPPORT_NETWORK_ROLE,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../../src/shared/techsupport';
import { waitForDirectP2PChannel, warmDirectP2PSession } from '../helpers/p2p-transport-e2e';
import { openSettingsSection, SETTINGS_SECTION } from '../helpers/settings-nav';

const CHROMIUM_TOPOLOGY_FLAGS = [
  '--disable-features=WebRtcHideLocalIpsWithMdns,HttpsUpgrades,OmniboxHttpsUpgrades,HttpsFirstModeV2,HttpsFirstModeV2ForEngagedSites,HttpsFirstBalancedModeAutoEnable',
  '--disable-https-first-mode',
  '--allow-running-insecure-content',
];

const LAN_HOST = process.env.E2E_LAN_HOST || 'iinpublic-lan.localhost';

type BootstrappedUser = {
  context: BrowserContext;
  page: Page;
  userId: string;
  stageName: string;
};

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`${url} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function seedTechSupportGlobalMember(): Promise<void> {
  await fetch(`${gunBaseURL()}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      networkRole: TECHSUPPORT_NETWORK_ROLE,
      languages: ['en'],
      profile: [],
      interests: [],
      location: { region: 'global', chatrooms: ['global'] },
    }),
  });
  await fetch(`${gunBaseURL()}/api/chatrooms/global/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
    }),
  });
}

function lanAppUrl(): string {
  const local = new URL(webAppURLStableChatroom());
  local.hostname = LAN_HOST;
  local.port = String(webPort());
  return local.toString();
}

async function bootstrapUserOnUrl(
  browser: Browser,
  appUrl: string,
  label: string,
  stageName: string,
): Promise<BootstrappedUser> {
  const context = await browser.newContext({
    viewport: { width: 640, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await injectIdbClear(page);
  await gotoWebApp(page, appUrl, 45_000);
  await ensureWindowFitsViewport(page, 640, 1000);
  await afterLoad();
  await page.click('.nav-btn[data-view="settings"]');
  await afterNav();
  await openSettingsSection(page, SETTINGS_SECTION.profile);
  await page.waitForSelector('#settings-stage-name-input', { timeout: 45_000 });
  await page.fill('#settings-stage-name-input', stageName);
  await page.locator('#settings-stage-name-input').blur();
  await afterNav();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? ''),
      { timeout: 45_000 },
    )
    .toBe(stageName);
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  await pinStableE2eLocation(page);
  attachE2eBrowserTabLabel(page, label);
  const userId = await page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
  return { context, page, userId, stageName };
}

async function enterGlobalChatroom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  await page.waitForSelector('#chatroom-list-container', { state: 'visible' });
  await page.click('.chatroom-item[data-chatroom-id="global"]');
  await afterSync();
}

async function publishCurrentPublicUser(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const user = app?.currentUser;
    if (!app || !user?.id) return;
    const pair = app.gunService?.getStoredPair?.();
    if (pair?.pub) user.pub = pair.pub;
    if (pair?.epub) user.epub = pair.epub;
    await app.userService?.syncPublicUserForRelay?.(user);
  });
}

async function createLocalDirectConversation(
  page: Page,
  otherUserId: string,
  otherUserName: string,
): Promise<string> {
  return page.evaluate(
    async ({ id, name }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const currentUser = app?.currentUser;
      if (!currentUser?.id || !app?.conversationService?.createConversation) {
        throw new Error('Conversation service not available');
      }
      const conversationId = await app.conversationService.createConversation({
        userId1: currentUser.id,
        userName1: currentUser.stageName,
        userId2: id,
        userName2: name,
        talkId: 'direct',
      });
      app.uiManager?.addNewConversation?.({
        conversationId,
        otherUserId: id,
        otherUserName: name,
        talkId: 'direct',
        transportMode: 'direct-p2p',
      });
      return String(conversationId);
    },
    { id: otherUserId, name: otherUserName },
  );
}

async function openLocalConversation(page: Page, conversationId: string): Promise<void> {
  await page.evaluate((cid) => {
    (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showConversationDetail?.(cid);
  }, conversationId);
  await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 20_000 });
}

async function ensureDirectP2PConnected(
  page: Page,
  conversationId: string,
  otherUserId: string,
): Promise<void> {
  await page.evaluate(
    async ({ cid, otherId }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const userId = app?.currentUser?.id ?? '';
      const transport = app?.conversationService?.transport;
      if (!userId || !transport?.ensureSessionConnected) {
        throw new Error('Direct P2P transport is not available');
      }
      await transport.ensureSessionConnected(cid, userId, 30_000, otherId);
    },
    { cid: conversationId, otherId: otherUserId },
  );
}

async function sendConversationMessage(page: Page, message: string): Promise<void> {
  await expect(page.locator('#conversation-message-input')).toBeVisible({ timeout: 10_000 });
  await page.locator('#conversation-message-input').fill(message);
  await page.locator('#send-conversation-message').click();
}

test.describe('LAN browser development topology', () => {
  let localBrowser: Browser | undefined;
  let lanBrowser: Browser | undefined;
  const users: BootstrappedUser[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _slot }) => {
    await clearGunForStage2Spec();
    await seedTechSupportGlobalMember();
    localBrowser = await chromium.launch({
      headless,
      args: CHROMIUM_TOPOLOGY_FLAGS,
    });
    lanBrowser = await chromium.launch({
      headless,
      args: CHROMIUM_TOPOLOGY_FLAGS,
    });
  });

  test.afterAll(async () => {
    await Promise.allSettled(users.map((user) => user.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.())));
    await Promise.allSettled(users.map((user) => user.context.close()));
    await localBrowser?.close().catch(() => {});
    await lanBrowser?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('LAN-hostname browser joins Global with local browser users and exchanges a direct message', async () => {
    test.setTimeout(180_000);
    const localA = await bootstrapUserOnUrl(localBrowser!, webAppURLStableChatroom(), 'Local A', 'LocalLANA');
    const localB = await bootstrapUserOnUrl(localBrowser!, webAppURLStableChatroom(), 'Local B', 'LocalLANB');
    const lanUser = await bootstrapUserOnUrl(lanBrowser!, lanAppUrl(), 'LAN browser', 'RemoteLAN');
    users.push(localA, localB, lanUser);

    const lanTopology = await lanUser.page.evaluate(async () => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const apiBase = app?.getBackendApiBase?.();
      const healthOk = apiBase ? await fetch(`${apiBase}/health`).then((res) => res.ok).catch(() => false) : false;
      return {
        locationHost: window.location.hostname,
        apiBase,
        healthOk,
      };
    });
    expect(lanTopology).toEqual({
      locationHost: LAN_HOST,
      apiBase: `http://${LAN_HOST}:${webPort() - 3001 + 8080}`,
      healthOk: true,
    });

    await Promise.all([
      enterGlobalChatroom(localA.page),
      enterGlobalChatroom(localB.page),
      enterGlobalChatroom(lanUser.page),
    ]);
    await Promise.all([
      publishCurrentPublicUser(localA.page),
      publishCurrentPublicUser(localB.page),
      publishCurrentPublicUser(lanUser.page),
    ]);

    await expect
      .poll(
        async () => {
          const members = await fetchJson(`${gunBaseURL()}/api/chatrooms/global/members`);
          const ids = new Set(members.map((member: { userId?: string }) => member.userId));
          return {
            techSupport: ids.has(TECHSUPPORT_ROOT_USER_ID),
            localA: ids.has(localA.userId),
            localB: ids.has(localB.userId),
            lanUser: ids.has(lanUser.userId),
          };
        },
        { timeout: 30_000, intervals: [1000, 1500, 2000] },
      )
      .toEqual({ techSupport: true, localA: true, localB: true, lanUser: true });

    const lanConversationId = await createLocalDirectConversation(
      lanUser.page,
      localA.userId,
      localA.stageName,
    );
    const localConversationId = await createLocalDirectConversation(
      localA.page,
      lanUser.userId,
      lanUser.stageName,
    );
    expect(localConversationId).toBe(lanConversationId);

    await Promise.all([
      openLocalConversation(lanUser.page, lanConversationId),
      openLocalConversation(localA.page, localConversationId),
    ]);
    await Promise.all([
      warmDirectP2PSession(lanUser.page, lanConversationId),
      warmDirectP2PSession(localA.page, localConversationId),
    ]);
    await Promise.all([
      ensureDirectP2PConnected(lanUser.page, lanConversationId, localA.userId),
      ensureDirectP2PConnected(localA.page, localConversationId, lanUser.userId),
    ]);
    await Promise.all([
      waitForDirectP2PChannel(lanUser.page, lanConversationId, 30_000),
      waitForDirectP2PChannel(localA.page, localConversationId, 30_000),
    ]);

    const message = `LAN direct message ${Date.now()}`;
    await sendConversationMessage(lanUser.page, message);
    await expect(localA.page.locator('#conversation-messages')).toContainText(message, { timeout: 30_000 });
  });
});
