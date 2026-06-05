import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';
import SEA from 'gun/sea';
import {
  createSignedP2PEnvelopeProof,
  p2pDiscoverySigningPayload,
  type P2PNodeCapability,
} from '../../../../src/shared/p2p-runtime';

test.describe('P2P roadmap P5 — cross-platform node protocol', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('debug storage and discovery endpoint define signed platform compatibility', async ({ request }) => {
    const futureExpiresAt = new Date(Date.now() + 60_000).toISOString();
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

    const postedPeers: Array<{ platform: string; senderPub: string }> = [];
    for (const peer of [
      { platform: 'windows' as const, capability: 'local-node-supervisor' as P2PNodeCapability },
      { platform: 'android' as const, capability: 'foreground-service' as P2PNodeCapability },
      { platform: 'ios' as const, capability: 'notification-assisted-wakeup' as P2PNodeCapability },
    ]) {
      const pair = await SEA.pair();
      const discoveryBody = {
        platform: peer.platform,
        senderPub: pair.pub,
        capabilities: ['signed-discovery', 'relay-fallback', peer.capability] as P2PNodeCapability[],
        endpointHints: [`wss://relay.local/discovery/${peer.platform}`],
      };
      const proof = await createSignedP2PEnvelopeProof({
        pair,
        payload: p2pDiscoverySigningPayload(discoveryBody),
        nonce: `nonce_${peer.platform}`,
      });
      postedPeers.push({ platform: peer.platform, senderPub: pair.pub });
      const posted = await request.post(`${gunBaseURL()}/api/p2p/discovery`, {
        data: {
          ...discoveryBody,
          peerId: proof.peerId,
          timestamp: proof.timestamp,
          payloadHash: proof.payloadHash,
          signature: proof.signature,
          nonce: proof.nonce,
          expiresAt: futureExpiresAt,
        },
      });
      expect(posted.ok()).toBeTruthy();
    }

    const listed = await request.get(`${gunBaseURL()}/api/p2p/discovery`);
    expect(listed.ok()).toBeTruthy();
    const discovery = await listed.json();
    expect(discovery.messages).toEqual(
      expect.arrayContaining([
        ...postedPeers.map((peer) => expect.objectContaining(peer)),
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
        expiresAt: futureExpiresAt,
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
        expiresAt: futureExpiresAt,
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
