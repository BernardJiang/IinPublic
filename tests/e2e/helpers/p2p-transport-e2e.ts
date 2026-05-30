import { expect, type Page } from '@playwright/test';
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

/** After DMs in direct mode, conversation message nodes should not appear on the Gun hub. */
export async function assertNoGunStoredMessageBodies(
  page: Page,
  conversationId: string,
): Promise<void> {
  const res = await page.request.get(`${gunBaseURL()}/api/test/export-snapshot`);
  expect(res.ok()).toBeTruthy();
  const payload = (await res.json()) as { gunGraph?: Record<string, unknown> };
  const graph = payload.gunGraph ?? {};
  const messagePrefix = `conversations/${conversationId}/messages/`;
  const leaked = Object.keys(graph).filter(
    (key) => key.startsWith(messagePrefix) && key !== `conversations/${conversationId}/messages`,
  );
  expect(leaked).toEqual([]);
}
