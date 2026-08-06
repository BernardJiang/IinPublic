/**
 * P2P roadmap infrastructure (P2–P7), merged from six single-test specs that shared an
 * identical fixture (speed reorg: one boot instead of six).
 *
 * Ordering is deliberate:
 *  - SEA key custody first (asserts freshly-booted localStorage state);
 *  - read-only endpoint/UI checks in the middle;
 *  - neighbor memory (posts neighbors, blocks a peer) and local-node supervisor
 *    (start → bind → wipe, self-cleaning) last, since they mutate server state.
 * Merged from: 00-p2p-sea-key-custody, 00-p2p-conversation-transport,
 * 00-p2p-cross-platform-protocol, 00-p2p-data-ownership, 00-p2p-neighbor-memory,
 * 00-p2p-local-node-supervisor.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

const P2P_DIRECT_ENABLED = true; // Direct P2P is always active — star transport removed.


test.describe('P2P roadmap P2–P7 — infrastructure (merged)', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterAll(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('browser stores encrypted key custody while relay exposes only public identity policy', async ({ request }) => {
    const p = page!;
    const custody = await p.evaluate(() => {
      const rawPair = localStorage.getItem('iinpublic_keypair');
      const rawCustody = localStorage.getItem('iinpublic_key_custody_v1');
      const deviceSecret = localStorage.getItem('iinpublic_key_custody_device_secret_v1');
      return {
        rawPair,
        rawCustody,
        deviceSecret,
        custody: rawCustody ? JSON.parse(rawCustody) : null,
      };
    });

    expect(custody.rawPair).toBeNull();
    expect(custody.deviceSecret).toBeTruthy();
    expect(custody.rawCustody).toBeTruthy();
    expect(custody.rawCustody).not.toContain('"priv"');
    expect(custody.rawCustody).not.toContain('"epriv"');
    expect(custody.custody).toEqual(
      expect.objectContaining({
        version: 1,
        format: 'webcrypto-device-key-v1',
        publicIdentity: expect.objectContaining({
          pub: expect.any(String),
          epub: expect.any(String),
        }),
        ciphertext: expect.any(String),
      }),
    );

    const storage = await request.get(`${gunBaseURL()}/api/debug/storage`);
    expect(storage.ok()).toBeTruthy();
    const payload = await storage.json();
    expect(payload.seaIdentityPolicy.publicKeys).toEqual(['pub', 'epub']);
    expect(payload.seaIdentityPolicy.forbiddenPrivateKeys).toEqual(['priv', 'epriv']);
    expect(payload.seaIdentityPolicy.linkedDeviceRule).toContain('random encrypted manifests');
    expect(payload.seaStorageScan).toEqual(
      expect.objectContaining({
        privateKeyPaths: [],
      }),
    );
    expect(Array.isArray(payload.seaStorageScan.plaintextMessagePaths)).toBe(true);

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.storageInspector);
    await expect(p.locator('#storage-inspector-sea-identity')).toBeVisible();
    await expect(p.locator('#storage-inspector-sea-identity')).toContainText('SEA Identity Custody');
    await expect(p.locator('#storage-inspector-sea-identity')).toContainText('Relay scan');
    await expect(p.locator('#storage-inspector-sea-custody')).toContainText('webcrypto-device-key-v1');
  });

  test('debug storage exposes transport modes and HTTP signaling endpoint is retired', async ({ request }) => {
    const storage = await request.get(`${gunBaseURL()}/api/debug/storage`);
    expect(storage.ok()).toBeTruthy();
    const payload = await storage.json();
    expect(payload.conversationTransport).toEqual(
      expect.objectContaining({
        activeMode: P2P_DIRECT_ENABLED ? 'direct-p2p' : 'star-gun',
        // P2P-messaging Phase 1 (spec §19.4): ordinary DMs are direct-p2p only.
        availableModes: ['direct-p2p'],
        messageBodyStorage: P2P_DIRECT_ENABLED ? 'gun-local' : 'gun-legacy',
      }),
    );

    const retiredGet = await request.get(`${gunBaseURL()}/api/p2p/signaling/conv_e2e_transport`);
    expect(retiredGet.status()).toBe(404);
    const retiredPost = await request.post(`${gunBaseURL()}/api/p2p/signaling/conv_e2e_transport`, { data: {} });
    expect(retiredPost.status()).toBe(404);

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.storageInspector);
    await expect(p.locator('#storage-inspector-conversation-transport')).toBeVisible();
    await expect(p.locator('#storage-inspector-conversation-transport')).toContainText('Conversation Transport');
    await expect(p.locator('#storage-inspector-conversation-transport-modes')).toContainText('direct-p2p');
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

    // L6: discovery endpoint has been deleted
    const discoveryGet = await request.get(`${gunBaseURL()}/api/p2p/discovery`);
    expect(discoveryGet.status()).toBe(404);

    const discoveryPost = await request.post(`${gunBaseURL()}/api/p2p/discovery`, {
      data: {
        platform: 'web',
        senderPub: 'pub_web',
        capabilities: ['signed-discovery'],
        endpointHints: ['webrtc:room'],
      },
    });
    expect(discoveryPost.status()).toBe(404);

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.storageInspector);
    await expect(p.locator('#storage-inspector-p2p-protocol')).toBeVisible();
    await expect(p.locator('#storage-inspector-p2p-protocol')).toContainText('gun-mesh-websocket-webrtc');
    await expect(p.locator('#storage-inspector-p2p-platforms')).toContainText('windows');
    await expect(p.locator('#storage-inspector-p2p-platforms')).toContainText('android');
    await expect(p.locator('#storage-inspector-p2p-platforms')).toContainText('ios');
    await expect(p.locator('#storage-inspector-p2p-capabilities')).toContainText('signed-discovery');
  });

  test('data ownership endpoints expose delete/request, migration, relay TTLs, and diagnostics', async ({ request }) => {
    const ownership = await request.get(`${gunBaseURL()}/api/p2p/data-ownership`);
    expect(ownership.ok()).toBeTruthy();
    const initial = await ownership.json();
    expect(initial.policy.deviceLocalDelete.label).toBe("Delete this device's local data");
    expect(initial.policy.serverHeldDataRequest.label).toBe('Request/delete server-held data');
    expect(initial.relayTtlPolicy).toEqual(
      expect.objectContaining({
        discovery: expect.objectContaining({ ttlSeconds: 60 }),
        signaling: expect.objectContaining({ ttlSeconds: 120 }),
        presence: expect.objectContaining({ ttlSeconds: 45 }),
        'room-membership': expect.objectContaining({ ttlSeconds: 180 }),
      }),
    );

    const deleted = await request.post(`${gunBaseURL()}/api/p2p/data-ownership/delete-device-local`, { data: {} });
    expect(deleted.ok()).toBeTruthy();
    expect((await deleted.json()).localDeletion.clearedDataClasses).toEqual(
      expect.arrayContaining(['neighbor-cache', 'message-history', 'talks']),
    );

    const serverRequest = await request.post(`${gunBaseURL()}/api/p2p/data-ownership/request-server-data`, {
      data: {
        requestType: 'delete-server-held-data',
        userPub: 'pub_owner',
      },
    });
    expect(serverRequest.ok()).toBeTruthy();
    expect((await serverRequest.json()).request).toEqual(
      expect.objectContaining({
        requestType: 'delete-server-held-data',
        relayVisibility: 'metadata-only',
      }),
    );

    const migration = await request.post(`${gunBaseURL()}/api/p2p/data-ownership/migrate`, {
      data: {
        paths: [
          { path: 'users/{userId}/profile', category: 'encrypted-user-owned' },
          { path: 'chatrooms/{chatroomId}', category: 'durable-public' },
        ],
      },
    });
    expect(migration.ok()).toBeTruthy();
    expect((await migration.json()).migrationPlan.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'users/{userId}/profile', action: 'move-to-local-encrypted' }),
        expect.objectContaining({ path: 'chatrooms/{chatroomId}', action: 'leave-on-relay' }),
      ]),
    );

    const diagnostic = await request.post(`${gunBaseURL()}/api/p2p/transport-diagnostics`, {
      data: {
        mode: 'server-relay',
        fallbackReason: 'direct peer unavailable',
      },
    });
    expect(diagnostic.ok()).toBeTruthy();
    expect((await diagnostic.json()).event).toEqual(
      expect.objectContaining({
        mode: 'server-relay',
        storedTelemetry: false,
        visibleToUser: true,
      }),
    );

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.storageInspector);
    await expect(p.locator('#storage-inspector-data-ownership')).toBeVisible();
    await expect(p.locator('#storage-inspector-data-ownership')).toContainText("Delete this device's local data");
    await expect(p.locator('#storage-inspector-data-ownership-server')).toContainText('delete-server-held-data');
    await expect(p.locator('#storage-inspector-data-ownership-migration')).toContainText('Move eligible');
    await expect(p.locator('#storage-inspector-relay-ttl-policy')).toContainText('presence');
    await expect(p.locator('#storage-inspector-transport-diagnostics')).toContainText('local-visible');
  });

  test('remembers active neighbors locally and uses them before star fallback', async ({ request }) => {
    const futureExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const storage = await request.get(`${gunBaseURL()}/api/debug/storage`);
    expect(storage.ok()).toBeTruthy();
    const debug = await storage.json();
    expect(debug.neighborMemory.controls).toEqual(
      expect.objectContaining({
        enabled: true,
        localOnly: true,
        privateGraphPublishedByDefault: false,
      }),
    );

    const remembered = await request.post(`${gunBaseURL()}/api/p2p/neighbors`, {
      data: {
        peerId: 'pub_fast_contact',
        endpointHints: ['webrtc:fast-contact'],
        lastSeenAt: '2026-05-20T00:00:00.000Z',
        successfulSessions: 5,
        latencyMs: 25,
        transportType: 'webrtc-datachannel',
        capabilities: ['signed-discovery', 'webrtc-datachannel'],
        trustStatus: 'trusted',
        endpointStatus: 'active',
        nearbyChatrooms: ['global', 'sf'],
        isContact: true,
        expiresAt: futureExpiresAt,
      },
    });
    expect(remembered.ok()).toBeTruthy();
    const rememberedBody = await remembered.json();
    expect(rememberedBody.bootstrapCandidates).toEqual([
      expect.objectContaining({ peerId: 'pub_fast_contact', endpointHints: ['webrtc:fast-contact'] }),
    ]);

    const failed = await request.post(`${gunBaseURL()}/api/p2p/neighbors`, {
      data: {
        peerId: 'pub_failed_endpoint',
        endpointHints: ['webrtc:failed'],
        lastSeenAt: '2026-05-20T00:01:00.000Z',
        successfulSessions: 8,
        latencyMs: 1,
        transportType: 'webrtc-datachannel',
        capabilities: ['signed-discovery'],
        trustStatus: 'unknown',
        endpointStatus: 'failed',
        nearbyChatrooms: ['global'],
        isContact: false,
        expiresAt: futureExpiresAt,
      },
    });
    expect(failed.ok()).toBeTruthy();
    const failedBody = await failed.json();
    expect(failedBody.neighbors).toEqual(expect.arrayContaining([expect.objectContaining({ peerId: 'pub_failed_endpoint' })]));
    expect(failedBody.bootstrapCandidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ peerId: 'pub_failed_endpoint' })]),
    );

    const blocked = await request.post(`${gunBaseURL()}/api/p2p/neighbors/block-peer`, {
      data: { peerId: 'pub_fast_contact' },
    });
    expect(blocked.ok()).toBeTruthy();
    const blockedBody = await blocked.json();
    expect(blockedBody.blockedPeerIds).toContain('pub_fast_contact');
    expect(blockedBody.bootstrapCandidates).toEqual([]);

    const exported = await request.post(`${gunBaseURL()}/api/p2p/neighbors/export-encrypted`, {
      data: { encryptedExport: 'SEA{"ct":"neighbor-cache"}' },
    });
    expect(exported.ok()).toBeTruthy();
    expect((await exported.json()).encryptedExport).toBe('SEA{"ct":"neighbor-cache"}');

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.storageInspector);
    await expect(p.locator('#storage-inspector-p2p-neighbor-memory')).toBeVisible();
    await expect(p.locator('#storage-inspector-p2p-neighbor-memory')).toContainText('local-only');
    await expect(p.locator('#storage-inspector-p2p-neighbor-controls')).toContainText('Export encrypted');
    await expect(p.locator('#storage-inspector-p2p-neighbor-controls')).toContainText('1 blocked');
    await expect(p.locator('#storage-inspector-p2p-neighbor-candidates')).toContainText('star fallback');
  });

  test('local node requires explicit permission, signed pairing, identity binding, and wipe controls', async ({ request }) => {
    const initial = await request.get(`${gunBaseURL()}/api/p2p/local-node`);
    expect(initial.ok()).toBeTruthy();
    const initialPayload = await initial.json();
    expect(initialPayload.status).toBe('stopped');
    expect(initialPayload.permissionDisclosures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'storage' }),
        expect.objectContaining({ key: 'bandwidth' }),
        expect.objectContaining({ key: 'battery' }),
        expect.objectContaining({ key: 'background' }),
        expect.objectContaining({ key: 'local-port' }),
        expect.objectContaining({ key: 'delete-stop' }),
      ]),
    );
    expect(initialPayload.sessionPairing.trustModel).toBe('signed-session-pairing');
    expect(initialPayload.persistenceControls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dataClass: 'neighbor-cache', localOnly: true }),
        expect.objectContaining({ dataClass: 'message-history', localOnly: true }),
      ]),
    );

    const started = await request.post(`${gunBaseURL()}/api/p2p/local-node/start`, { data: {} });
    expect(started.ok()).toBeTruthy();
    expect((await started.json()).status).toBe('running');

    const bound = await request.post(`${gunBaseURL()}/api/p2p/local-node/bind-identity`, {
      data: { webIdentityId: 'web_pub_e2e', nodeIdentityId: 'node_pub_e2e', proof: 'signed-proof-e2e' },
    });
    expect(bound.ok()).toBeTruthy();
    expect((await bound.json()).identityBinding).toEqual(
      expect.objectContaining({ webIdentityId: 'web_pub_e2e', nodeIdentityId: 'node_pub_e2e' }),
    );

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.storageInspector);
    await expect(p.locator('#storage-inspector-local-node')).toBeVisible();
    await expect(p.locator('#storage-inspector-local-node')).toContainText('Local Node Supervisor');
    await expect(p.locator('#storage-inspector-local-node')).toContainText('signed-session-pairing');
    await expect(p.locator('#storage-inspector-local-node-disclosures')).toContainText('Storage');
    await expect(p.locator('#storage-inspector-local-node-disclosures')).toContainText('Local port');
    await expect(p.locator('#storage-inspector-local-node-controls')).toContainText('neighbor-cache');

    const wiped = await request.post(`${gunBaseURL()}/api/p2p/local-node/wipe`, { data: {} });
    expect(wiped.ok()).toBeTruthy();
    expect((await wiped.json()).status).toBe('wiped');
  });
});
