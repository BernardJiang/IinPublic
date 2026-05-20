import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';

test.describe('P2P roadmap P5 — cross-platform node protocol', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await page.goto(webBaseURL());
    await page.waitForLoadState('load');
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('debug storage and discovery endpoint define signed platform compatibility', async ({ request }) => {
    const storage = await request.get(`${gunBaseURL()}/api/debug/storage`);
    expect(storage.ok()).toBeTruthy();
    const payload = await storage.json();
    expect(payload.p2pNetworkProtocol).toEqual(
      expect.objectContaining({
        version: 1,
        substrate: 'gun-mesh-websocket-webrtc',
        capabilities: expect.arrayContaining(['signed-discovery', 'encrypted-signaling', 'webrtc-datachannel']),
      }),
    );
    expect(payload.p2pNetworkProtocol.platforms.map((item: { platform: string }) => item.platform)).toEqual([
      'web',
      'windows',
      'ubuntu',
      'android',
      'ios',
    ]);

    for (const peer of [
      { platform: 'windows', senderPub: 'pub_windows', capability: 'local-node-supervisor' },
      { platform: 'android', senderPub: 'pub_android', capability: 'foreground-service' },
      { platform: 'ios', senderPub: 'pub_ios', capability: 'notification-assisted-wakeup' },
    ]) {
      const posted = await request.post(`${gunBaseURL()}/api/p2p/discovery`, {
        data: {
          platform: peer.platform,
          senderPub: peer.senderPub,
          capabilities: ['signed-discovery', 'relay-fallback', peer.capability],
          endpointHints: [`wss://relay.local/discovery/${peer.platform}`],
          signature: `sig_${peer.platform}`,
          nonce: `nonce_${peer.platform}`,
          expiresAt: '2026-05-21T00:01:00.000Z',
        },
      });
      expect(posted.ok()).toBeTruthy();
    }

    const listed = await request.get(`${gunBaseURL()}/api/p2p/discovery`);
    expect(listed.ok()).toBeTruthy();
    const discovery = await listed.json();
    expect(discovery.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: 'windows', senderPub: 'pub_windows' }),
        expect.objectContaining({ platform: 'android', senderPub: 'pub_android' }),
        expect.objectContaining({ platform: 'ios', senderPub: 'pub_ios' }),
      ]),
    );

    const unsigned = await request.post(`${gunBaseURL()}/api/p2p/discovery`, {
      data: {
        platform: 'web',
        senderPub: 'pub_web',
        capabilities: ['relay-fallback'],
        endpointHints: ['webrtc:room'],
        signature: 'sig_web',
        nonce: 'nonce_web',
        expiresAt: '2026-05-21T00:01:00.000Z',
      },
    });
    expect(unsigned.status()).toBe(400);

    const plaintext = await request.post(`${gunBaseURL()}/api/p2p/discovery`, {
      data: {
        platform: 'web',
        senderPub: 'pub_web',
        capabilities: ['signed-discovery'],
        endpointHints: ['webrtc:room'],
        signature: 'sig_web',
        nonce: 'nonce_web',
        expiresAt: '2026-05-21T00:01:00.000Z',
        bodyPlaintext: 'plain discovery',
      },
    });
    expect(plaintext.status()).toBe(400);

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#storage-inspector-p2p-protocol')).toBeVisible();
    await expect(p.locator('#storage-inspector-p2p-protocol')).toContainText('gun-mesh-websocket-webrtc');
    await expect(p.locator('#storage-inspector-p2p-platforms')).toContainText('windows');
    await expect(p.locator('#storage-inspector-p2p-platforms')).toContainText('android');
    await expect(p.locator('#storage-inspector-p2p-platforms')).toContainText('ios');
    await expect(p.locator('#storage-inspector-p2p-capabilities')).toContainText('signed-discovery');
  });
});
