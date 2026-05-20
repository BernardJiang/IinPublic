import {
  applyLocalNodeAction,
  assertNoPrivateSeaMaterial,
  createConversationTransportDiagnostics,
  createDirectP2PMessageEnvelope,
  createLocalNodeSupervisorSnapshot,
  createLinkedDeviceManifest,
  createP2PSignalingEnvelope,
  createRelayEnvelope,
  scanRelayStorageForSeaLeaks,
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
});
