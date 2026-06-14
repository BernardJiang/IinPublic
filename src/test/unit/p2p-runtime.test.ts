import {
  applyP2PNeighborCacheAction,
  applyLocalNodeAction,
  assertNoPrivateSeaMaterial,
  classifyServerConnectorPath,
  createConversationTransportDiagnostics,
  createDataMigrationPlan,
  createDataOwnershipPolicy,
  createDataOwnershipRequest,
  createDeviceLocalDataDeletion,
  createDirectP2PMessageEnvelope,
  createSignedP2PEnvelopeProof,
  createLocalNodeSupervisorSnapshot,
  createLinkedDeviceManifest,
  createP2PDiscoveryMessage,
  createP2PNeighborCacheState,
  createP2PNodeProtocolSpec,
  createOwnershipEnvelope,
  createP2PSignalingEnvelope,
  createRelayOnlyTtlPolicy,
  createTransportDiagnosticEvent,
  derivePeerIdFromPub,
  getP2PBootstrapCandidates,
  p2pDataChannelSigningPayload,
  p2pRelaySigningPayload,
  createRelayEnvelope,
  scanRelayStorageForSeaLeaks,
  scoreP2PNeighbor,
  upsertP2PNeighbor,
  resolveP2PRuntimeFlags,
  shouldSkipServerGunPersist,
  SEA_IDENTITY_POLICY,
  STAR_GUN_PATH_CLASSIFICATIONS,
  toPublicSeaIdentity,
  verifySignedP2PEnvelopeProof,
} from '../../shared/p2p-runtime';
import SEA from 'gun/sea';

const proofFields = {
  peerId: 'peer_static',
  timestamp: '2026-05-20T00:00:00.000Z',
  payloadHash: 'hash_static',
  signature: 'SEA{"m":"static"}',
  nonce: 'nonce_static',
};

describe('p2p runtime flags', () => {
  it('defaults to ephemeral persistence with P2P always active', () => {
    expect(resolveP2PRuntimeFlags({})).toEqual({
      starServerPersistence: 'ephemeral',
      p2pNodeEnabled: false,
      relayOnlyHub: false,
      p2pClientTalkMirror: true,
      p2pDirectTalkDelivery: true,
    });
  });

  it('p2pDirectTalkDelivery is always true regardless of env', () => {
    expect(resolveP2PRuntimeFlags({}).p2pDirectTalkDelivery).toBe(true);
  });

  it('accepts P2P_NODE_ENABLED flag', () => {
    expect(
      resolveP2PRuntimeFlags({
        P2P_NODE_ENABLED: 'true',
      }),
    ).toEqual({
      starServerPersistence: 'ephemeral',
      p2pNodeEnabled: true,
      relayOnlyHub: false,
      p2pClientTalkMirror: true,
      p2pDirectTalkDelivery: true,
    });
  });

  it('relay-only hub is reflected in the flags', () => {
    expect(resolveP2PRuntimeFlags({ RELAY_ONLY_HUB: '1' })).toEqual({
      starServerPersistence: 'ephemeral',
      p2pNodeEnabled: false,
      relayOnlyHub: true,
      p2pClientTalkMirror: true,
      p2pDirectTalkDelivery: true,
    });
  });

  it('skips server Gun persist for peer conversation messages when ephemeral', () => {
    const flags = resolveP2PRuntimeFlags({ STAR_SERVER_PERSISTENCE: 'ephemeral' });
    expect(
      shouldSkipServerGunPersist(['conversations', 'conv_1', 'messages', 'msg_1'], flags),
    ).toBe(true);
    expect(
      shouldSkipServerGunPersist(['conversations', 'conv_support_a_b', 'messages', 'm1'], flags, {
        supportChannel: true,
      }),
    ).toBe(false);
  });

  it('classifies representative star Gun paths', () => {
    expect(STAR_GUN_PATH_CLASSIFICATIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'chatrooms/{chatroomId}', category: 'durable-public' }),
        expect.objectContaining({ path: 'incomingTalksByUser/{userId}', category: 'relay-only' }),
        expect.objectContaining({ path: 'ownerIncomingTalkIndex/{userId}', category: 'encrypted-user-owned' }),
        expect.objectContaining({ path: 'conversations/{conversationId}', category: 'removable-legacy' }),
        expect.objectContaining({ path: 'talks/{talkId}', category: 'encrypted-user-owned' }),
      ]),
    );
  });

  it('classifies P1 server connector paths as metadata-only or owner/pair-owned', () => {
    expect(classifyServerConnectorPath(['chatrooms', 'room1', 'members'])).toEqual(
      expect.objectContaining({
        kind: 'relay-metadata',
        serverCanPersistBody: false,
        deprecatedPublicPath: false,
      }),
    );
    expect(classifyServerConnectorPath(['talks', 'talk1'])).toEqual(
      expect.objectContaining({
        kind: 'author-owned-talk-body',
        serverCanPersistBody: false,
        deprecatedPublicPath: false,
      }),
    );
    expect(classifyServerConnectorPath(['talks', 'talk1', 'responses', 'resp1'])).toEqual(
      expect.objectContaining({
        kind: 'legacy-public-talk-response',
        serverCanPersistBody: false,
        deprecatedPublicPath: true,
      }),
    );
    expect(classifyServerConnectorPath('incomingTalksByUser/bob/talk1')).toEqual(
      expect.objectContaining({
        kind: 'legacy-public-incoming-talk',
        serverCanPersistBody: false,
        deprecatedPublicPath: true,
      }),
    );
    expect(classifyServerConnectorPath('ownerIncomingTalkIndex/bob/talk1')).toEqual(
      expect.objectContaining({
        kind: 'owner-private-incoming-talk-index',
        serverCanPersistBody: false,
        deprecatedPublicPath: false,
      }),
    );
    expect(classifyServerConnectorPath(['pairTalkResponses', 'alice__bob', 'talk1'])).toEqual(
      expect.objectContaining({
        kind: 'pair-private-talk-response',
        serverCanPersistBody: false,
        deprecatedPublicPath: false,
      }),
    );
  });

  it('creates ownership envelopes for room, user, and pair graph writes', () => {
    expect(
      createOwnershipEnvelope({
        visibility: 'room',
        path: ['chatrooms', 'global', 'announcements', 'talk1__alice'],
        roomId: 'global',
        encrypted: false,
      }),
    ).toEqual(
      expect.objectContaining({
        version: 1,
        visibility: 'room',
        roomId: 'global',
        encrypted: false,
        classification: expect.objectContaining({ kind: 'relay-metadata' }),
      }),
    );

    expect(
      createOwnershipEnvelope({
        visibility: 'user',
        path: ['ownerIncomingTalkIndex', 'bob', 'talk1'],
        ownerPub: 'bob',
      }),
    ).toEqual(
      expect.objectContaining({
        visibility: 'user',
        ownerPub: 'bob',
        encrypted: true,
        classification: expect.objectContaining({ kind: 'owner-private-incoming-talk-index' }),
      }),
    );

    expect(
      createOwnershipEnvelope({
        visibility: 'pair',
        path: ['pairTalkResponses', 'alice__bob', 'talk1', 'resp1'],
        pairId: 'alice__bob',
      }),
    ).toEqual(
      expect.objectContaining({
        visibility: 'pair',
        pairId: 'alice__bob',
        encrypted: true,
        classification: expect.objectContaining({ kind: 'pair-private-talk-response' }),
      }),
    );
  });

  it('rejects raw/deprecated writes and missing ownership metadata', () => {
    expect(() =>
      createOwnershipEnvelope({
        visibility: 'pair',
        path: ['talks', 'talk1', 'responses', 'resp1'],
        pairId: 'alice__bob',
      }),
    ).toThrow(/deprecated connector path/);
    expect(() =>
      createOwnershipEnvelope({
        visibility: 'pair',
        path: ['pairTalkResponses', 'alice__bob', 'talk1'],
        pairId: 'alice__tom',
      }),
    ).toThrow(/pair ownership path/);
    expect(() =>
      createOwnershipEnvelope({
        visibility: 'user',
        path: ['ownerIncomingTalkIndex', 'bob', 'talk1'],
      }),
    ).toThrow(/ownerPub/);
    expect(() =>
      createOwnershipEnvelope({
        visibility: 'room',
        path: ['chatrooms', 'global', 'announcements', 'talk1__alice'],
        roomId: 'global',
        encrypted: true,
      }),
    ).toThrow(/metadata-only/);
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
      ...proofFields,
      senderPub: 'pub_sender',
      recipientPub: 'pub_recipient',
      bodyCiphertext: 'SEA{"ct":"cipher"}',
      expiresAt: '2026-05-20T01:00:00.000Z',
    });

    expect(envelope).toEqual(
      expect.objectContaining({
        version: 1,
        senderPub: 'pub_sender',
        bodyCiphertext: 'SEA{"ct":"cipher"}',
        signature: proofFields.signature,
      }),
    );
    expect(() =>
      createRelayEnvelope({
        kind: 'p2p-message',
        ...proofFields,
        nonce: 'nonce_2',
        senderPub: 'pub_sender',
        bodyPlaintext: 'hello relay',
        expiresAt: '2026-05-20T01:00:00.000Z',
      }),
    ).toThrow(/plaintext/);
  });

  it('derives canonical peer IDs and verifies real SEA envelope signatures', async () => {
    const pair = await SEA.pair();
    const payload = p2pRelaySigningPayload({
      conversationId: 'conv_signed',
      messageId: 'msg_signed',
      senderPub: pair.pub,
      recipientPub: 'pub_b',
      bodyCiphertext: 'SEA{"ct":"hello"}',
    });
    const proof = await createSignedP2PEnvelopeProof({
      pair,
      payload,
      timestamp: '2026-05-20T00:00:00.000Z',
      nonce: 'nonce_signed',
    });

    expect(proof.peerId).toBe(await derivePeerIdFromPub(pair.pub));
    await expect(SEA.verify(proof.signature, pair.pub)).resolves.toBeTruthy();
    await expect(
      verifySignedP2PEnvelopeProof({
        proof,
        payload,
        now: new Date('2026-05-20T00:00:01.000Z'),
      }),
    ).resolves.toEqual({ ok: true });

    await expect(
      verifySignedP2PEnvelopeProof({
        proof,
        payload: { ...(payload as Record<string, unknown>), bodyCiphertext: 'SEA{"ct":"tampered"}' },
        now: new Date('2026-05-20T00:00:01.000Z'),
      }),
    ).resolves.toEqual({ ok: false, reason: 'payload hash mismatch' });

    await expect(
      verifySignedP2PEnvelopeProof({
        proof,
        payload,
        now: new Date('2026-05-20T00:03:00.000Z'),
        maxSkewMs: 1_000,
      }),
    ).resolves.toEqual({ ok: false, reason: 'stale timestamp' });

    await expect(
      verifySignedP2PEnvelopeProof({
        proof: { ...proof, peerId: 'peer_wrong' },
        payload,
        now: new Date('2026-05-20T00:00:01.000Z'),
      }),
    ).resolves.toEqual({ ok: false, reason: 'wrong peerId' });

    const nonceCache = new Set<string>();
    await expect(
      verifySignedP2PEnvelopeProof({
        proof,
        payload,
        now: new Date('2026-05-20T00:00:01.000Z'),
        nonceCache,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      verifySignedP2PEnvelopeProof({
        proof,
        payload,
        now: new Date('2026-05-20T00:00:01.000Z'),
        nonceCache,
      }),
    ).resolves.toEqual({ ok: false, reason: 'duplicate nonce' });

    const framePayload = p2pDataChannelSigningPayload({
      conversationId: 'conv_signed',
      frame: { type: 'ledger-state', feeds: { [pair.pub]: 1 } },
    });
    const frameProof = await createSignedP2PEnvelopeProof({
      pair,
      payload: framePayload,
      timestamp: '2026-05-20T00:00:00.000Z',
      nonce: 'nonce_frame',
    });
    await expect(
      verifySignedP2PEnvelopeProof({
        proof: frameProof,
        payload: framePayload,
        now: new Date('2026-05-20T00:00:01.000Z'),
      }),
    ).resolves.toEqual({ ok: true });
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

  it('describes direct-p2p-only conversation transport (no star/relay fallback)', () => {
    expect(
      createConversationTransportDiagnostics(resolveP2PRuntimeFlags({})),
    ).toEqual(
      expect.objectContaining({
        activeMode: 'direct-p2p',
        availableModes: ['direct-p2p'],
        messageBodyStorage: 'gun-local',
        fallback: null,
      }),
    );
  });

  it('creates short-lived encrypted signaling envelopes for WebRTC setup', () => {
    const envelope = createP2PSignalingEnvelope({
      conversationId: 'conv_1',
      kind: 'offer',
      senderPeerId: proofFields.peerId,
      senderPub: 'pub_a',
      recipientPub: 'pub_b',
      signalCiphertext: 'SEA{"ct":"offer"}',
      timestamp: proofFields.timestamp,
      payloadHash: proofFields.payloadHash,
      signature: proofFields.signature,
      nonce: proofFields.nonce,
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
        senderPeerId: proofFields.peerId,
        senderPub: 'pub_a',
        recipientPub: 'pub_b',
        signalCiphertext: '{"sdp":"plain"}',
        timestamp: proofFields.timestamp,
        payloadHash: proofFields.payloadHash,
        signature: proofFields.signature,
        nonce: proofFields.nonce,
      }),
    ).toThrow(/encrypted ciphertext/);
  });

  it('requires direct P2P messages to be signed ciphertext envelopes', () => {
    expect(
      createDirectP2PMessageEnvelope({
        conversationId: 'conv_1',
        messageId: 'msg_1',
        peerId: proofFields.peerId,
        senderPub: 'pub_a',
        recipientPub: 'pub_b',
        bodyCiphertext: 'SEA{"ct":"hello"}',
        timestamp: proofFields.timestamp,
        payloadHash: proofFields.payloadHash,
        signature: proofFields.signature,
        nonce: proofFields.nonce,
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
      ...proofFields,
      senderPub: 'pub_android',
      capabilities: ['signed-discovery', 'foreground-service', 'relay-fallback'],
      endpointHints: ['wss://relay.example/discovery/android'],
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
        ...proofFields,
        senderPub: 'pub_web',
        capabilities: ['relay-fallback'],
        endpointHints: ['webrtc:room'],
        expiresAt: '2026-05-21T00:01:00.000Z',
      }),
    ).toThrow(/signed-discovery/);
    expect(() =>
      createP2PDiscoveryMessage({
        platform: 'web',
        ...proofFields,
        senderPub: 'pub_web',
        capabilities: ['signed-discovery'],
        endpointHints: ['webrtc:room'],
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
