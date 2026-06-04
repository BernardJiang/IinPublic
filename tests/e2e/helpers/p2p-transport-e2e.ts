import { expect, type Page } from '@playwright/test';
import {
  getConversationIdBetween,
  openConversationViaServer,
  waitForServerConversationBetween,
} from './conversation-e2e';
import { gunBaseURL } from './ports';

/** Direct P2P should connect quickly on one machine; >10s usually means a setup bug. */
export const P2P_E2E_TIMEOUT_MS = 10_000;

type AppHandle = {
  getApp: () => {
    conversationService?: {
      getTransportMode?: () => string;
      getDirectP2PConnectionState?: (conversationId: string, localUserId: string) => string;
    };
    currentUser?: { id: string };
  };
};

export async function getTransportModeFromPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const app = (window as unknown as { __iinpublic_app?: AppHandle }).__iinpublic_app?.getApp?.();
    return app?.conversationService?.getTransportMode?.() ?? 'unknown';
  });
}

export async function expectActiveTransportMode(
  page: Page,
  mode: 'direct-p2p' | 'star-gun',
  timeoutMs = P2P_E2E_TIMEOUT_MS,
): Promise<void> {
  await expect
    .poll(() => getTransportModeFromPage(page), {
      timeout: timeoutMs,
      message: `Expected transport mode ${mode}`,
    })
    .toBe(mode);
}

/** Match-created row in `myConversations` should record the active transport mode. */
export async function expectConversationTransportModeForPeer(
  page: Page,
  otherUserName: string,
  mode: 'direct-p2p' | 'star-gun',
  timeoutMs = P2P_E2E_TIMEOUT_MS,
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((name) => {
          const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
          const hit = Object.values(conversations).find(
            (c: any) => c?.otherUserName === name && c?.supportChannel !== true,
          ) as { transportMode?: string } | undefined;
          return hit?.transportMode ?? '';
        }, otherUserName),
      { timeout: timeoutMs, message: `myConversations transport for ${otherUserName}` },
    )
    .toBe(mode);
}

/** Start transport subscription without opening the conversation overlay (keeps WebRTC alive). */
export async function warmDirectP2PSession(page: Page, conversationId: string): Promise<void> {
  await page.evaluate((cid) => {
    const app = (window as unknown as { __iinpublic_app?: AppHandle }).__iinpublic_app?.getApp?.();
    const userId = app?.currentUser?.id ?? '';
    if (!userId) return;
    app?.conversationService?.subscribeToMessages?.(cid, () => undefined, userId);
  }, conversationId);
}

export async function waitForDirectP2PChannel(
  page: Page,
  conversationId: string,
  timeoutMs = P2P_E2E_TIMEOUT_MS,
): Promise<void> {
  await expectActiveTransportMode(page, 'direct-p2p', timeoutMs);
  await expect
    .poll(
      async () =>
        page.evaluate(({ cid }) => {
          const app = (window as unknown as { __iinpublic_app?: AppHandle }).__iinpublic_app?.getApp?.();
          const userId = app?.currentUser?.id ?? '';
          return app?.conversationService?.getDirectP2PConnectionState?.(cid, userId) ?? 'idle';
        }, { cid: conversationId }),
      { timeout: timeoutMs, message: `WebRTC channel for ${conversationId}` },
    )
    .toBe('connected');
}

/**
 * After a match: wait for server conversations, open overlays on both peers, connect WebRTC.
 * Use before sending DMs in default `P2P_DIRECT_CHAT_ENABLED=1` e2e runs.
 */
export async function prepareDirectP2PConversation(
  pageA: Page,
  pageB: Page,
  userIdA: string,
  userIdB: string,
  displayNameOnA: string,
  displayNameOnB: string,
): Promise<string> {
  await waitForServerConversationBetween(pageA, userIdA, userIdB);
  await waitForServerConversationBetween(pageB, userIdB, userIdA);
  const conversationId = await getConversationIdBetween(pageA, userIdA, userIdB);
  await expectActiveTransportMode(pageA, 'direct-p2p');
  await expectActiveTransportMode(pageB, 'direct-p2p');
  await openConversationViaServer(pageA, userIdA, displayNameOnB, userIdB);
  await openConversationViaServer(pageB, userIdB, displayNameOnA, userIdA);
  await warmDirectP2PSession(pageA, conversationId);
  await warmDirectP2PSession(pageB, conversationId);
  await waitForDirectP2PChannel(pageA, conversationId);
  await waitForDirectP2PChannel(pageB, conversationId);
  return conversationId;
}

/**
 * P1-7: direct-mode DM bodies persist under pair-private Gun paths as ciphertext.
 */
export async function assertGunStoredMessageBodies(
  page: Page,
  conversationId: string,
  minMessageNodes = 1,
  forbiddenPlaintext: string[] = [],
): Promise<void> {
  const res = await page.request.get(`${gunBaseURL()}/api/test/export-snapshot`);
  expect(res.ok()).toBeTruthy();
  const payload = (await res.json()) as { gunGraph?: Record<string, unknown> };
  const graph = payload.gunGraph ?? {};
  const pairMessageSegment = `/${conversationId}/messages/`;
  const legacyMessagePrefix = `conversations/${conversationId}/messages/`;
  const stored = Object.keys(graph).filter(
    (key) =>
      key.startsWith('pairConversations/') &&
      key.includes(pairMessageSegment) &&
      !key.endsWith('/messages'),
  );
  const legacyStored = Object.keys(graph).filter(
    (key) => key.startsWith(legacyMessagePrefix) && key !== `conversations/${conversationId}/messages`,
  );
  expect(stored.length).toBeGreaterThanOrEqual(minMessageNodes);
  expect(legacyStored.length).toBe(0);
  for (const key of stored) {
    const raw = graph[key] as any;
    expect(raw?.encryption).toBe('sea-ecdh-v1');
    expect(typeof raw?.text).toBe('string');
    const serialized = JSON.stringify(raw);
    for (const snippet of forbiddenPlaintext) {
      expect(serialized.includes(snippet)).toBe(false);
    }
  }
}

/** @deprecated Superseded by assertGunStoredMessageBodies (P2P-H, spec §19.4). */
export async function assertNoGunStoredMessageBodies(
  page: Page,
  conversationId: string,
): Promise<void> {
  return assertGunStoredMessageBodies(page, conversationId, 0);
}
