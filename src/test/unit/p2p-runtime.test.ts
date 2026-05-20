import {
  applyP2PNeighborCacheAction,
  applyLocalNodeAction,
  assertNoPrivateSeaMaterial,
  createConversationTransportDiagnostics,
  createDataMigrationPlan,
  createDataOwnershipPolicy,
  createDataOwnershipRequest,
  createDeviceLocalDataDeletion,
  createDirectP2PMessageEnvelope,
  createLocalNodeSupervisorSnapshot,
  createLinkedDeviceManifest,
  createP2PDiscoveryMessage,
  createP2PNeighborCacheState,
  createP2PNodeProtocolSpec,
  createP2PSignalingEnvelope,
  createRelayOnlyTtlPolicy,
  createTransportDiagnosticEvent,
  getP2PBootstrapCandidates,
  createRelayEnvelope,
  scanRelayStorageForSeaLeaks,
  scoreP2PNeighbor,
  upsertP2PNeighbor,
  resolveP2PRuntimeFlags,
  SEA_IDENTITY_POLICY,
  STAR_GUN_PATH_CLASSIFICATIONS,
  toPublicSeaIdentity,
} from '../../shared/p2p-runtime';

describe('p2p runtime flags', () => {
  it('defaults to durable star mode with local node and direct chat disabled', () => {
    expect(resolveP2PRuntimeFlags({})).toEqual({
      starServerPersistence: 'durable',
      p2pNodeEnabled: false,
      p2pDirectChatEnabled: false,
    });
  });

  it('accepts explicit ephemeral persistence and enabled P2P flags', () => {
    expect(
      resolveP2PRuntimeFlags({
        STAR_SERVER_PERSISTENCE: 'ephemeral',
        P2P_NODE_ENABLED: 'true',
        P2P_DIRECT_CHAT_ENABLED: '1',
      }),
    ).toEqual({
      starServerPersistence: 'ephemeral',
      p2pNodeEnabled: true,
      p2pDirectChatEnabled: true,
    });
  });

  it('classifies representative star Gun paths', () => {
    expect(STAR_GUN_PATH_CLASSIFICATIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'chatrooms/{chatroomId}', category: 'durable-public' }),
        expect.objectContaining({ path: 'incomingTalksByUser/{userId}', category: 'relay-only' }),
        expect.objectContaining({ path: 'conversations/{conversationId}', category: 'removable-legacy' }),
      ]),
    );
  });

  it('models the permissioned local node supervisor lifecycle', () => {
    const initial = createLocalNodeSupervisorSnapshot();

    expect(initial.status).toBe('stopped');
    expect(initial.permissionDisclosures.map((item) => item.key)).toEqual(
      expect.arrayContaining(['storage', 'bandwidth', 'battery', 'background', 'local-port', 'delete-stop']),
    );
    expect(initial.sessionPairing).toEqual(
      expect.objectContaining({
        required: true,
        trustModel: 'signed-session-pairing',
      }),
    );
    expect(initial.persistenceControls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dataClass: 'neighbor-cache', localOnly: true }),
        expect.objectContaining({ dataClass: 'message-history', localOnly: true }),
      ]),
    );

    const running = applyLocalNodeAction(initial, 'start', new Date('2026-05-20T00:00:00.000Z'));
    expect(running.status).toBe('running');
    expect(running.health.ok).toBe(true);

    const bound = applyLocalNodeAction(running, 'bind-identity', new Date('2026-05-20T00:00:01.000Z'), {
      webIdentityId: 'web_pub',
      nodeIdentityId: 'node_pub',
      proof: 'signed-proof',
    });
    expect(bound.identityBinding).toEqual(
      expect.objectContaining({ webIdentityId: 'web_pub', nodeIdentityId: 'node_pub', proof: 'signed-proof' }),
    );

    const wiped = applyLocalNodeAction(bound, 'wipe', new Date('2026-05-20T00:00:02.000Z'));
    expect(wiped.status).toBe('wiped');
    expect(wiped.identityBinding).toBeNull();
  });

  it('publishes only SEA public identity keys and rejects private key material', () => {
    const pair = { pub: 'pub_a', epub: 'epub_a', priv: 'priv_a', epriv: 'epriv_a' };

    expect(toPublicSeaIdentity(pair)).toEqual({ pub: 'pub_a', epub: 'epub_a' });
    expect(() => assertNoPrivateSeaMaterial({ users: { alice: pair } })).toThrow(
      /Private SEA key material is not publishable/,
    );
    expect(SEA_IDENTITY_POLICY.forbiddenPrivateKeys).toEqual(['priv', 'epriv']);
  });

  it('keeps relay envelopes ciphertext-only and signed', () => {
    const envelope = createRelayEnvelope({
      kind: 'p2p-message',
      senderPub: 'pub_sender',
      recipientPub: 'pub_recipient',
      bodyCiphertext: 'SEA{"ct":"cipher"}',
      signature: 'sig_sender',
      nonce: 'nonce_1',
      expiresAt: '2026-05-20T01:00:00.000Z',
    });

    expect(envelope).toEqual(
      expect.objectContaining({
        version: 1,
        senderPub: 'pub_sender',
        bodyCiphertext: 'SEA{"ct":"cipher"}',
        signature: 'sig_sender',
      }),
    );
    expect(() =>
      createRelayEnvelope({
        kind: 'p2p-message',
        senderPub: 'pub_sender',
        bodyPlaintext: 'hello relay',
        signature: 'sig_sender',
        nonce: 'nonce_2',
        expiresAt: '2026-05-20T01:00:00.000Z',
      }),
    ).toThrow(/plaintext/);
  });

  it('stores linked-device manifests as random encrypted records', () => {
    expect(
      createLinkedDeviceManifest({
        randomManifestId: 'manifest_J7Vj66zM8v1',
        encryptedManifest: 'SEA{"ct":"encrypted-manifest"}',
        selectedDataClasses: ['contacts', 'message-history', 'chatbot-memory'],
        groupKeyVersion: 2,
        revokedDevicePubs: ['old_device_pub'],
      }),
    ).toEqual(
      expect.objectContaining({
        randomManifestId: 'manifest_J7Vj66zM8v1',
        selectedDataClasses: ['contacts', 'message-history', 'chatbot-memory'],
      }),
    );
  });

  it('scans relay storage for private SEA keys and plaintext message bodies', () => {
    const clean = scanRelayStorageForSeaLeaks({
      'users/alice': { pub: 'pub_a', epub: 'epub_a' },
      'conversations/1/messages/m1': { text: 'SEA{"ct":"cipher"}' },
    });
    expect(clean.ok).toBe(true);

    const leaking = scanRelayStorageForSeaLeaks({
      'users/alice': { pub: 'pub_a', epub: 'epub_a', priv: 'priv_a' },
      'conversations/1/messages/m1': { text: 'plain hello' },
    });
    expect(leaking.ok).toBe(false);
    expect(leaking.privateKeyPaths).toContain('$.users/alice.priv');
    expect(leaking.plaintextMessagePaths).toContain('$.conversations/1/messages/m1.text');
  });

  it('describes star and direct conversation transport storage boundaries', () => {
    expect(
      createConversationTransportDiagnostics({
        starServerPersistence: 'durable',
        p2pNodeEnabled: false,
        p2pDirectChatEnabled: false,
      }),
    ).toEqual(
      expect.objectContaining({
        activeMode: 'star-gun',
        messageBodyStorage: 'gun-legacy',
        fallback: null,
      }),
    );
    expect(
      createConversationTransportDiagnostics({
        starServerPersistence: 'durable',
        p2pNodeEnabled: true,
        p2pDirectChatEnabled: true,
      }),
    ).toEqual(
      expect.objectContaining({
        activeMode: 'direct-p2p',
        messageBodyStorage: 'local-only',
        fallback: 'server-relay',
      }),
    );
  });

  it('creates short-lived encrypted signaling envelopes for WebRTC setup', () => {
    const envelope = createP2PSignalingEnvelope({
      conversationId: 'conv_1',
      kind: 'offer',
      senderPub: 'pub_a',
      recipientPub: 'pub_b',
      signalCiphertext: 'SEA{"ct":"offer"}',
      signature: 'sig_a',
      nonce: 'nonce_a',
      now: new Date('2026-05-20T00:00:00.000Z'),
      ttlSeconds: 30,
    });

    expect(envelope).toEqual(
      expect.objectContaining({
        version: 1,
        conversationId: 'conv_1',
        kind: 'offer',
        expiresAt: '2026-05-20T00:00:30.000Z',
      }),
    );
    expect(() =>
      createP2PSignalingEnvelope({
        conversationId: 'conv_1',
        kind: 'offer',
        senderPub: 'pub_a',
        recipientPub: 'pub_b',
        signalCiphertext: '{"sdp":"plain"}',
        signature: 'sig_a',
        nonce: 'nonce_a',
      }),
    ).toThrow(/encrypted ciphertext/);
  });

  it('requires direct P2P messages to be signed ciphertext envelopes', () => {
    expect(
      createDirectP2PMessageEnvelope({
        conversationId: 'conv_1',
        messageId: 'msg_1',
        senderPub: 'pub_a',
        recipientPub: 'pub_b',
        bodyCiphertext: 'SEA{"ct":"hello"}',
        signature: 'sig_a',
        nonce: 'nonce_a',
        expiresAt: '2026-05-20T00:02:00.000Z',
      }),
    ).toEqual(
      expect.objectContaining({
        kind: 'p2p-message',
        transport: 'webrtc-datachannel',
        conversationId: 'conv_1',
        messageId: 'msg_1',
      }),
    );
  });

  it('defines a platform-neutral P2P node protocol across web, desktop, and mobile', () => {
    const protocol = createP2PNodeProtocolSpec();

    expect(protocol).toEqual(
      expect.objectContaining({
        version: 1,
        substrate: 'gun-mesh-websocket-webrtc',
        identity: expect.objectContaining({ publicKeys: ['pub', 'epub'] }),
      }),
    );
    expect(protocol.platforms.map((item) => item.platform)).toEqual(['web', 'windows', 'ubuntu', 'android', 'ios']);
    expect(protocol.platforms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: 'windows', nodeAvailability: 'bundled-local-node' }),
        expect.objectContaining({ platform: 'ubuntu', nodeAvailability: 'bundled-local-node' }),
        expect.objectContaining({ platform: 'android', nodeAvailability: 'foreground-service' }),
        expect.objectContaining({ platform: 'ios', nodeAvailability: 'foreground-or-notification-assisted' }),
      ]),
    );
    expect(protocol.capabilities).toEqual(
      expect.arrayContaining(['signed-discovery', 'encrypted-signaling', 'webrtc-datachannel', 'neighbor-cache']),
    );
    expect(protocol.neighborScore.blockedPeerRule).toContain('Blocked peers');
  });

  it('creates signed discovery messages without plaintext or private keys', () => {
    const message = createP2PDiscoveryMessage({
      platform: 'android',
      senderPub: 'pub_android',
      capabilities: ['signed-discovery', 'foreground-service', 'relay-fallback'],
      endpointHints: ['wss://relay.example/discovery/android'],
      signature: 'sig_android',
      nonce: 'nonce_android',
      expiresAt: '2026-05-21T00:01:00.000Z',
    });

    expect(message).toEqual(
      expect.objectContaining({
        kind: 'discovery',
        protocolVersion: 1,
        platform: 'android',
        senderPub: 'pub_android',
      }),
    );
    expect(() =>
      createP2PDiscoveryMessage({
        platform: 'web',
        senderPub: 'pub_web',
        capabilities: ['relay-fallback'],
        endpointHints: ['webrtc:room'],
        signature: 'sig_web',
        nonce: 'nonce_web',
        expiresAt: '2026-05-21T00:01:00.000Z',
      }),
    ).toThrow(/signed-discovery/);
    expect(() =>
      createP2PDiscoveryMessage({
        platform: 'web',
        senderPub: 'pub_web',
        capabilities: ['signed-discovery'],
        endpointHints: ['webrtc:room'],
        signature: 'sig_web',
        nonce: 'nonce_web',
        expiresAt: '2026-05-21T00:01:00.000Z',
        bodyPlaintext: 'plain discovery body',
      }),
    ).toThrow(/plaintext/);
  });

  it('keeps active neighbor memory local, scored, pruned, and block-aware', () => {
    const now = new Date('2026-05-20T00:00:00.000Z');
    let cache = createP2PNeighborCacheState();

    cache = upsertP2PNeighbor(
      cache,
      {
        peerId: 'pub_fast_contact',
        endpointHints: ['webrtc:fast'],
        lastSeenAt: '2026-05-19T23:55:00.000Z',
        successfulSessions: 5,
        latencyMs: 40,
        transportType: 'webrtc-datachannel',
        capabilities: ['signed-discovery', 'webrtc-datachannel'],
        trustStatus: 'trusted',
        endpointStatus: 'active',
        nearbyChatrooms: ['global', 'sf'],
        isContact: true,
      },
      now,
    );
    cache = upsertP2PNeighbor(
      cache,
      {
        peerId: 'pub_stale',
        endpointHints: ['webrtc:stale'],
        lastSeenAt: '2026-05-10T00:00:00.000Z',
        successfulSessions: 10,
        latencyMs: 10,
        transportType: 'webrtc-datachannel',
        capabilities: ['signed-discovery'],
        trustStatus: 'unknown',
        endpointStatus: 'active',
        expiresAt: '2026-05-19T00:00:00.000Z',
        nearbyChatrooms: ['global'],
        isContact: false,
      },
      now,
    );
    cache = upsertP2PNeighbor(
      cache,
      {
        peerId: 'pub_failed_endpoint',
        endpointHints: ['webrtc:failed'],
        lastSeenAt: '2026-05-19T23:59:00.000Z',
        successfulSessions: 7,
        latencyMs: 25,
        transportType: 'webrtc-datachannel',
        capabilities: ['signed-discovery'],
        trustStatus: 'unknown',
        endpointStatus: 'failed',
        nearbyChatrooms: ['global'],
        isContact: false,
      },
      now,
    );

    expect(cache.controls).toEqual(
      expect.objectContaining({ enabled: true, localOnly: true, privateGraphPublishedByDefault: false }),
    );
    expect(cache.neighbors.map((neighbor) => neighbor.peerId)).toEqual(['pub_fast_contact', 'pub_failed_endpoint']);
    expect(scoreP2PNeighbor(cache.neighbors[0], now)).toBeGreaterThan(scoreP2PNeighbor(cache.neighbors[1], now));
    expect(getP2PBootstrapCandidates(cache, now).map((neighbor) => neighbor.peerId)).toEqual(['pub_fast_contact']);

    cache = applyP2PNeighborCacheAction(cache, 'block-peer', { peerId: 'pub_fast_contact' });
    expect(cache.blockedPeerIds).toContain('pub_fast_contact');
    expect(getP2PBootstrapCandidates(cache, now)).toEqual([]);

    cache = applyP2PNeighborCacheAction(cache, 'export-encrypted', {
      encryptedExport: 'SEA{"ct":"encrypted-neighbor-state"}',
    });
    expect(cache.encryptedExport).toBe('SEA{"ct":"encrypted-neighbor-state"}');
    expect(() => applyP2PNeighborCacheAction(cache, 'export-encrypted', { encryptedExport: 'plain export' })).toThrow(
      /encrypted/,
    );
  });

  it('models data ownership deletion, migration, relay TTLs, and telemetry-free diagnostics', () => {
    const policy = createDataOwnershipPolicy();
    expect(policy.deviceLocalDelete.clears).toEqual(
      expect.arrayContaining(['neighbor-cache', 'message-history', 'chatbot-memory']),
    );
    expect(policy.serverHeldDataRequest.supportedRequests).toEqual([
      'export-server-held-data',
      'delete-server-held-data',
    ]);

    expect(createDeviceLocalDataDeletion(new Date('2026-05-20T00:00:00.000Z'))).toEqual(
      expect.objectContaining({
        deletedAt: '2026-05-20T00:00:00.000Z',
        clearedDataClasses: expect.arrayContaining(['contacts', 'talks']),
      }),
    );
    expect(
      createDataOwnershipRequest('delete-server-held-data', 'pub_owner', new Date('2026-05-20T00:00:01.000Z')),
    ).toEqual(
      expect.objectContaining({
        requestType: 'delete-server-held-data',
        userPub: 'pub_owner',
        relayVisibility: 'metadata-only',
      }),
    );
    expect(() => createDataOwnershipRequest('delete-server-held-data', '')).toThrow(/userPub/);

    const migration = createDataMigrationPlan([
      { path: 'users/{userId}/profile', category: 'encrypted-user-owned' },
      { path: 'chatrooms/{chatroomId}', category: 'durable-public' },
      { path: 'conversations/{conversationId}', category: 'removable-legacy' },
    ]);
    expect(migration.movedCount).toBe(2);
    expect(migration.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'users/{userId}/profile', action: 'move-to-local-encrypted' }),
        expect.objectContaining({ path: 'chatrooms/{chatroomId}', action: 'leave-on-relay' }),
      ]),
    );

    expect(createRelayOnlyTtlPolicy()).toEqual(
      expect.objectContaining({
        discovery: expect.objectContaining({ ttlSeconds: 60, storage: 'relay-only' }),
        signaling: expect.objectContaining({ ttlSeconds: 120, storage: 'relay-only' }),
        presence: expect.objectContaining({ ttlSeconds: 45, storage: 'relay-only' }),
        'room-membership': expect.objectContaining({ ttlSeconds: 180, storage: 'relay-only' }),
      }),
    );
    expect(createTransportDiagnosticEvent('server-relay', 'direct peer unavailable')).toEqual(
      expect.objectContaining({
        mode: 'server-relay',
        usedFallback: true,
        fallbackReason: 'direct peer unavailable',
        storedTelemetry: false,
        visibleToUser: true,
      }),
    );
  });
});
