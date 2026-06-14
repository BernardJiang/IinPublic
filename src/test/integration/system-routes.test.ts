import express from 'express';
import request from 'supertest';
import SEA from 'gun/sea';
import { registerSystemRoutes } from '../../server/routes/system-routes';
import {
  createSignedP2PEnvelopeProof,
  p2pRelaySigningPayload,
  p2pSignalingSigningPayload,
  type SeaSigningPair,
} from '../../shared/p2p-runtime';
import { peerAckSigningPayload } from '../../shared/p2p-presence';

function buildApp(nodeEnv = 'test') {
  const app = express();
  app.use(express.json());
  const gun = {
    _: {
      graph: {
        'chatrooms/global': {},
        'users/user_1/publicProfile': {},
        'incomingTalksByUser/user_2': {},
      },
      opt: { radisk: true },
    },
  };
  registerSystemRoutes(app, {
    gun,
    clearForTesting: jest.fn(),
    nodeEnv,
  });
  return { app, gun };
}

async function signedProofFields(pair: SeaSigningPair, payload: unknown, nonce: string) {
  const proof = await createSignedP2PEnvelopeProof({
    pair,
    payload,
    timestamp: new Date().toISOString(),
    nonce,
  });
  return {
    peerId: proof.peerId,
    senderPeerId: proof.peerId,
    fromPeerId: proof.peerId,
    timestamp: proof.timestamp,
    payloadHash: proof.payloadHash,
    signature: proof.signature,
    nonce: proof.nonce,
  };
}

describe('system routes', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reports storage policy and path classifications in non-production', async () => {
    process.env.P2P_NODE_ENABLED = 'false';

    const { app } = buildApp();
    const res = await request(app).get('/api/debug/storage');

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('star');
    expect(res.body.topology).toEqual({
      browser: 'Gun client',
      hub: 'Node Gun hub',
      routes: 'HTTP/Socket API',
    });
    expect(res.body.flags).toEqual({
      starServerPersistence: 'ephemeral',
      p2pNodeEnabled: false,
      relayOnlyHub: false,
      p2pClientTalkMirror: true,
      p2pDirectTalkDelivery: true,
    });
    expect(res.body.localNode).toEqual(
      expect.objectContaining({
        status: 'stopped',
        sessionPairing: expect.objectContaining({ trustModel: 'signed-session-pairing' }),
        permissionDisclosures: expect.arrayContaining([
          expect.objectContaining({ key: 'storage' }),
          expect.objectContaining({ key: 'local-port' }),
        ]),
      }),
    );
    expect(res.body.neighborMemory).toEqual(
      expect.objectContaining({
        version: 1,
        controls: expect.objectContaining({
          enabled: true,
          localOnly: true,
          privateGraphPublishedByDefault: false,
        }),
        publicStarFallback: 'gun-star-server',
        bootstrapCandidates: [],
      }),
    );
    expect(res.body.dataOwnership).toEqual(
      expect.objectContaining({
        policy: expect.objectContaining({
          deviceLocalDelete: expect.objectContaining({ label: "Delete this device's local data" }),
          serverHeldDataRequest: expect.objectContaining({ label: 'Request/delete server-held data' }),
        }),
        migrationPlan: expect.objectContaining({ movedCount: expect.any(Number) }),
      }),
    );
    expect(res.body.relayTtlPolicy).toEqual(
      expect.objectContaining({
        discovery: expect.objectContaining({ ttlSeconds: 60, storage: 'relay-only' }),
        signaling: expect.objectContaining({ ttlSeconds: 120, storage: 'relay-only' }),
        presence: expect.objectContaining({ ttlSeconds: 45, storage: 'relay-only' }),
        'room-membership': expect.objectContaining({ ttlSeconds: 180, storage: 'relay-only' }),
      }),
    );
    expect(res.body.conversationTransport).toEqual(
      expect.objectContaining({
        activeMode: 'direct-p2p',
        availableModes: ['direct-p2p'],
        messageBodyStorage: 'gun-local',
        fallback: null,
      }),
    );
    expect(res.body.p2pNetworkProtocol).toEqual(
      expect.objectContaining({
        version: 1,
        substrate: 'gun-mesh-websocket-webrtc',
        platforms: expect.arrayContaining([
          expect.objectContaining({ platform: 'web' }),
          expect.objectContaining({ platform: 'windows' }),
          expect.objectContaining({ platform: 'ubuntu' }),
          expect.objectContaining({ platform: 'android' }),
          expect.objectContaining({ platform: 'ios' }),
        ]),
        capabilities: expect.arrayContaining(['signed-discovery', 'encrypted-signaling', 'webrtc-datachannel']),
      }),
    );
    expect(res.body.seaIdentityPolicy).toEqual(
      expect.objectContaining({
        publicKeys: ['pub', 'epub'],
        forbiddenPrivateKeys: ['priv', 'epriv'],
        relayEnvelopeRule: expect.stringContaining('ciphertext only'),
      }),
    );
    expect(res.body.seaStorageScan).toEqual(
      expect.objectContaining({
        ok: true,
        privateKeyPaths: [],
        plaintextMessagePaths: [],
      }),
    );
    expect(res.body.serverPersistence).toEqual(
      expect.objectContaining({
        radisk: true,
        policy: 'ephemeral',
        graphSouls: 3,
      }),
    );
    expect(res.body.serverPersistence.topLevelCounts).toEqual({
      chatrooms: 1,
      users: 1,
      incomingTalksByUser: 1,
    });
    expect(res.body.pathClassifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'chatrooms/{chatroomId}', category: 'durable-public' }),
        expect.objectContaining({ path: 'incomingTalksByUser/{userId}', category: 'relay-only' }),
        expect.objectContaining({ path: 'conversations/{conversationId}', category: 'removable-legacy' }),
      ]),
    );
  });

  it('reports SEA private-key and plaintext relay leaks in debug storage', async () => {
    const { app, gun } = buildApp();
    const graph = gun._.graph as Record<string, unknown>;
    graph['users/leaky'] = { pub: 'pub_leaky', epub: 'epub_leaky', priv: 'priv_leaky' };
    graph['conversations/1/messages/m1'] = { text: 'hello in plaintext' };

    const res = await request(app).get('/api/debug/storage');

    expect(res.status).toBe(200);
    expect(res.body.seaStorageScan.ok).toBe(false);
    expect(res.body.seaStorageScan.privateKeyPaths).toContain('$.users/leaky.priv');
    expect(res.body.seaStorageScan.plaintextMessagePaths).toContain('$.conversations/1/messages/m1.text');
  });

  it('does not expose debug storage in production', async () => {
    const { app } = buildApp('production');
    const res = await request(app).get('/api/debug/storage');

    expect(res.status).toBe(404);
  });

  it('supervises local node start, health-check, identity binding, and wipe in non-production', async () => {
    const { app } = buildApp();

    const started = await request(app).post('/api/p2p/local-node/start').send({});
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('running');
    expect(started.body.health.ok).toBe(true);

    const bound = await request(app).post('/api/p2p/local-node/bind-identity').send({
      webIdentityId: 'web_pub',
      nodeIdentityId: 'node_pub',
      proof: 'signed-proof',
    });
    expect(bound.status).toBe(200);
    expect(bound.body.identityBinding).toEqual(
      expect.objectContaining({ webIdentityId: 'web_pub', nodeIdentityId: 'node_pub' }),
    );

    const health = await request(app).post('/api/p2p/local-node/health-check').send({});
    expect(health.status).toBe(200);
    expect(health.body.health.reason).toBe('Local node health check passed.');

    const wiped = await request(app).post('/api/p2p/local-node/wipe').send({});
    expect(wiped.status).toBe(200);
    expect(wiped.body.status).toBe('wiped');
    expect(wiped.body.identityBinding).toBeNull();
  });

  it('stores only encrypted short-lived P2P signaling envelopes in non-production', async () => {
    const { app } = buildApp();
    const pair = await SEA.pair();
    const signalBody = {
      conversationId: 'conv_1',
      kind: 'offer' as const,
      senderPub: pair.pub,
      recipientPub: 'pub_b',
      signalCiphertext: 'SEA{"ct":"offer"}',
    };

    const posted = await request(app).post('/api/p2p/signaling/conv_1').send({
      kind: signalBody.kind,
      senderPub: signalBody.senderPub,
      recipientPub: signalBody.recipientPub,
      signalCiphertext: signalBody.signalCiphertext,
      ...(await signedProofFields(pair, p2pSignalingSigningPayload(signalBody), 'nonce_a')),
    });
    expect(posted.status).toBe(200);
    expect(posted.body.envelope).toEqual(
      expect.objectContaining({
        version: 1,
        conversationId: 'conv_1',
        kind: 'offer',
        signalCiphertext: 'SEA{"ct":"offer"}',
      }),
    );
    expect(posted.body.envelope.expiresAt).toBeTruthy();

    const listed = await request(app).get('/api/p2p/signaling/conv_1');
    expect(listed.status).toBe(200);
    expect(listed.body.envelopes).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain('"sdp"');

    const plaintext = await request(app).post('/api/p2p/signaling/conv_1').send({
      kind: 'offer',
      senderPub: pair.pub,
      recipientPub: 'pub_b',
      signalCiphertext: '{"sdp":"plain"}',
      ...(await signedProofFields(
        pair,
        p2pSignalingSigningPayload({
          ...signalBody,
          signalCiphertext: '{"sdp":"plain"}',
        }),
        'nonce_plain',
      )),
    });
    expect(plaintext.status).toBe(400);
  });

  it('two logical peers complete signaling offer and answer exchange', async () => {
    const { app } = buildApp();
    const alice = await SEA.pair();
    const bob = await SEA.pair();
    const offerBody = {
      conversationId: 'conv_peer',
      kind: 'offer' as const,
      senderPub: alice.pub,
      recipientPub: bob.pub,
      signalCiphertext: 'SEA{"type":"offer","sdp":{"type":"offer","sdp":"v=0"}}',
    };
    const answerBody = {
      conversationId: 'conv_peer',
      kind: 'answer' as const,
      senderPub: bob.pub,
      recipientPub: alice.pub,
      signalCiphertext: 'SEA{"type":"answer","sdp":{"type":"answer","sdp":"v=0"}}',
    };

    await request(app).post('/api/p2p/signaling/conv_peer').send({
      kind: offerBody.kind,
      senderPub: offerBody.senderPub,
      recipientPub: offerBody.recipientPub,
      signalCiphertext: offerBody.signalCiphertext,
      ...(await signedProofFields(alice, p2pSignalingSigningPayload(offerBody), 'nonce_offer')),
    });
    await request(app).post('/api/p2p/signaling/conv_peer').send({
      kind: answerBody.kind,
      senderPub: answerBody.senderPub,
      recipientPub: answerBody.recipientPub,
      signalCiphertext: answerBody.signalCiphertext,
      ...(await signedProofFields(bob, p2pSignalingSigningPayload(answerBody), 'nonce_answer')),
    });

    const listed = await request(app).get('/api/p2p/signaling/conv_peer');
    expect(listed.status).toBe(200);
    expect(listed.body.envelopes).toHaveLength(2);
    expect(listed.body.envelopes.map((item: { kind: string }) => item.kind)).toEqual(
      expect.arrayContaining(['offer', 'answer']),
    );
  });

  it('stores encrypted short-lived conversation relay envelopes for two peers', async () => {
    const { app } = buildApp();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const pair = await SEA.pair();
    const relayBody = {
      conversationId: 'conv_relay',
      messageId: 'msg_1',
      senderPub: pair.pub,
      recipientPub: 'pub_b',
      bodyCiphertext: 'SEA{"id":"msg_1","senderId":"user_a","text":"hello"}',
    };

    const posted = await request(app).post('/api/p2p/conversation-relay/conv_relay').send({
      conversationId: relayBody.conversationId,
      messageId: relayBody.messageId,
      senderPub: relayBody.senderPub,
      recipientPub: relayBody.recipientPub,
      bodyCiphertext: relayBody.bodyCiphertext,
      ...(await signedProofFields(pair, p2pRelaySigningPayload(relayBody), 'nonce_relay_1')),
      expiresAt,
    });
    expect(posted.status).toBe(200);
    expect(posted.body.envelope).toEqual(
      expect.objectContaining({
        kind: 'p2p-message',
        conversationId: 'conv_relay',
        messageId: 'msg_1',
      }),
    );

    const listed = await request(app).get('/api/p2p/conversation-relay/conv_relay?recipientPub=pub_b');
    expect(listed.status).toBe(200);
    expect(listed.body.envelopes).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain('"hello"');
  });


  it('keeps active neighbor memory local-first and excludes expired, failed, or blocked peers', async () => {
    const { app } = buildApp();
    const futureExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const expiredAt = new Date(Date.now() - 60_000).toISOString();

    const fast = await request(app).post('/api/p2p/neighbors').send({
      peerId: 'pub_fast_contact',
      endpointHints: ['webrtc:fast'],
      lastSeenAt: '2026-05-20T00:00:00.000Z',
      successfulSessions: 4,
      latencyMs: 30,
      transportType: 'webrtc-datachannel',
      capabilities: ['signed-discovery', 'webrtc-datachannel'],
      trustStatus: 'trusted',
      endpointStatus: 'active',
      nearbyChatrooms: ['global', 'sf'],
      isContact: true,
      expiresAt: futureExpiresAt,
    });
    expect(fast.status).toBe(200);
    expect(fast.body.bootstrapCandidates).toEqual([
      expect.objectContaining({ peerId: 'pub_fast_contact', endpointHints: ['webrtc:fast'] }),
    ]);

    const failed = await request(app).post('/api/p2p/neighbors').send({
      peerId: 'pub_failed',
      endpointHints: ['webrtc:failed'],
      lastSeenAt: '2026-05-20T00:01:00.000Z',
      successfulSessions: 9,
      latencyMs: 5,
      transportType: 'webrtc-datachannel',
      capabilities: ['signed-discovery'],
      trustStatus: 'unknown',
      endpointStatus: 'failed',
      nearbyChatrooms: ['global'],
      isContact: false,
      expiresAt: futureExpiresAt,
    });
    expect(failed.status).toBe(200);
    expect(failed.body.neighbors.map((neighbor: { peerId: string }) => neighbor.peerId)).toContain('pub_failed');
    expect(failed.body.bootstrapCandidates.map((neighbor: { peerId: string }) => neighbor.peerId)).not.toContain(
      'pub_failed',
    );

    const expired = await request(app).post('/api/p2p/neighbors').send({
      peerId: 'pub_expired',
      endpointHints: ['webrtc:expired'],
      lastSeenAt: '2026-05-10T00:00:00.000Z',
      successfulSessions: 10,
      latencyMs: 1,
      transportType: 'webrtc-datachannel',
      capabilities: ['signed-discovery'],
      trustStatus: 'unknown',
      endpointStatus: 'active',
      nearbyChatrooms: ['global'],
      isContact: false,
      expiresAt: expiredAt,
    });
    expect(expired.status).toBe(200);
    expect(expired.body.neighbors.map((neighbor: { peerId: string }) => neighbor.peerId)).not.toContain('pub_expired');

    const blocked = await request(app).post('/api/p2p/neighbors/block-peer').send({ peerId: 'pub_fast_contact' });
    expect(blocked.status).toBe(200);
    expect(blocked.body.blockedPeerIds).toContain('pub_fast_contact');
    expect(blocked.body.bootstrapCandidates).toEqual([]);

    const exported = await request(app).post('/api/p2p/neighbors/export-encrypted').send({
      encryptedExport: 'SEA{"ct":"neighbor-cache"}',
    });
    expect(exported.status).toBe(200);
    expect(exported.body.encryptedExport).toBe('SEA{"ct":"neighbor-cache"}');

    const disabled = await request(app).post('/api/p2p/neighbors/disable').send({});
    expect(disabled.status).toBe(200);
    expect(disabled.body.controls.enabled).toBe(false);
    expect(disabled.body.neighbors).toEqual([]);
  });

  it('exposes data ownership flows, migration planning, relay TTLs, and telemetry-free diagnostics', async () => {
    const { app } = buildApp();

    const ownership = await request(app).get('/api/p2p/data-ownership');
    expect(ownership.status).toBe(200);
    expect(ownership.body.policy.deviceLocalDelete.clears).toEqual(expect.arrayContaining(['neighbor-cache']));
    expect(ownership.body.relayTtlPolicy.presence.ttlSeconds).toBe(45);

    const deletion = await request(app).post('/api/p2p/data-ownership/delete-device-local').send({});
    expect(deletion.status).toBe(200);
    expect(deletion.body.localDeletion.clearedDataClasses).toEqual(expect.arrayContaining(['contacts', 'talks']));

    const requestExport = await request(app).post('/api/p2p/data-ownership/request-server-data').send({
      requestType: 'export-server-held-data',
      userPub: 'pub_owner',
    });
    expect(requestExport.status).toBe(200);
    expect(requestExport.body.request).toEqual(
      expect.objectContaining({
        requestType: 'export-server-held-data',
        userPub: 'pub_owner',
        relayVisibility: 'metadata-only',
      }),
    );

    const migration = await request(app).post('/api/p2p/data-ownership/migrate').send({
      paths: [
        { path: 'users/{userId}/profile', category: 'encrypted-user-owned' },
        { path: 'incomingTalksByUser/{userId}', category: 'relay-only' },
      ],
    });
    expect(migration.status).toBe(200);
    expect(migration.body.migrationPlan.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'users/{userId}/profile', action: 'move-to-local-encrypted' }),
        expect.objectContaining({ path: 'incomingTalksByUser/{userId}', action: 'leave-on-relay' }),
      ]),
    );

    const diagnostic = await request(app).post('/api/p2p/transport-diagnostics').send({
      mode: 'server-relay',
      fallbackReason: 'direct peer unavailable',
    });
    expect(diagnostic.status).toBe(200);
    expect(diagnostic.body.event).toEqual(
      expect.objectContaining({
        mode: 'server-relay',
        usedFallback: true,
        storedTelemetry: false,
        visibleToUser: true,
      }),
    );
  });

  it('registers presence and stores TechSupport messages (P2P-I / P2P-N)', async () => {
    const { app } = buildApp('production');
    const alice = await SEA.pair();
    const bob = await SEA.pair();

    const reg = await request(app)
      .post('/api/presence/register')
      .send({ userId: 'alice', pub: alice.pub, epub: alice.epub });
    expect(reg.status).toBe(200);
    expect(reg.body.record.userId).toBe('alice');

    const nearby = await request(app).get('/api/presence/nearby?excludeUserId=alice');
    expect(nearby.status).toBe(200);
    expect(nearby.body.count).toBe(0);

    await request(app)
      .post('/api/presence/register')
      .send({ userId: 'bob', pub: bob.pub });
    const nearbyBob = await request(app).get('/api/presence/nearby?excludeUserId=alice');
    expect(nearbyBob.body.peers).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: 'bob', pub: bob.pub })]),
    );
    const ackCore = {
      fromUserId: 'alice',
      fromPub: alice.pub,
      toUserId: 'bob',
      toPub: bob.pub,
    };

    const ack = await request(app)
      .post('/api/presence/ack')
      .send({
        ...ackCore,
        ...(await signedProofFields(alice, peerAckSigningPayload(ackCore), 'nonce_presence_ack')),
      });
    expect(ack.status).toBe(200);

    const convId = 'conv_support_root_alice';
    const postMsg = await request(app)
      .post(`/api/support/messages/${convId}`)
      .send({
        id: 'support_1',
        senderId: 'iinpublic-root-techsupport',
        text: 'Welcome',
        channel: 'public',
      });
    expect(postMsg.status).toBe(200);

    const list = await request(app).get(`/api/support/messages/${convId}`);
    expect(list.status).toBe(200);
    expect(list.body.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'support_1', text: 'Welcome' })]),
    );
  });
});
