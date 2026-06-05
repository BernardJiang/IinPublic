/**
 * P2P-V integration tests — abuse defense wired into relay routes.
 *
 * Verifies:
 * 1. Nonce-replay rejection (400) on signaling and relay POST routes.
 * 2. Rate-limit rejection (429) on signaling POST when a peer exceeds the limit.
 * 3. GET /api/debug/p2p-abuse returns non-secret diagnostics.
 */
import express from 'express';
import request from 'supertest';
import SEA from 'gun/sea';
import { registerSystemRoutes } from '../../server/routes/system-routes';
import {
  createSignedP2PEnvelopeProof,
  p2pSignalingSigningPayload,
  p2pRelaySigningPayload,
  type SeaSigningPair,
} from '../../shared/p2p-runtime';

function buildApp(rateLimitMaxEvents = 200) {
  const app = express();
  app.use(express.json());
  const gun = { _: { graph: {}, opt: { radisk: false } } };
  const statsIdx = {
    byDay: new Map<string, Set<string>>(),
    byRegion: new Map<string, Set<string>>(),
    byTalkAnswer: new Map<string, Set<string>>(),
  };
  registerSystemRoutes(app, {
    gun,
    incomingTalksMap: new Map(),
    conversationsMap: new Map(),
    talkResponsesMap: new Map(),
    statsIdx,
    clearTalkResponseStats: jest.fn(),
    nodeEnv: 'test',
    abuseDefenseConfig: {
      rateLimitWindowMs: 60_000,
      rateLimitMaxEvents,
    },
  });
  return app;
}

async function makeSignalingBody(
  pair: SeaSigningPair,
  conversationId: string,
  nonce: string,
) {
  const senderPub = pair.pub;
  const recipientPub = 'pub_recipient';
  const signalCiphertext = 'SEA{"ct":"test","iv":"iv","s":"s"}';
  const kind = 'offer' as const;
  const proof = await createSignedP2PEnvelopeProof({
    pair,
    payload: p2pSignalingSigningPayload({ conversationId, kind, senderPub, recipientPub, signalCiphertext }),
    nonce,
  });
  return {
    kind,
    senderPub,
    senderPeerId: proof.peerId,
    recipientPub,
    signalCiphertext,
    timestamp: proof.timestamp,
    payloadHash: proof.payloadHash,
    signature: proof.signature,
    nonce: proof.nonce,
  };
}

async function makeRelayBody(
  pair: SeaSigningPair,
  conversationId: string,
  nonce: string,
) {
  const senderPub = pair.pub;
  const messageId = `msg_${nonce}`;
  const bodyCiphertext = 'SEA{"ct":"msg","iv":"iv","s":"s"}';
  const proof = await createSignedP2PEnvelopeProof({
    pair,
    payload: p2pRelaySigningPayload({ conversationId, messageId, senderPub, bodyCiphertext }),
    nonce,
  });
  return {
    messageId,
    senderPub,
    peerId: proof.peerId,
    bodyCiphertext,
    timestamp: proof.timestamp,
    payloadHash: proof.payloadHash,
    signature: proof.signature,
    nonce: proof.nonce,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  };
}

describe('P2P-V: abuse defense on relay routes', () => {
  let pair: SeaSigningPair;

  beforeAll(async () => {
    pair = (await SEA.pair()) as SeaSigningPair;
  });

  it('accepts a valid signaling POST and stores the envelope', async () => {
    const app = buildApp();
    const body = await makeSignalingBody(pair, 'conv_1', `nonce_${Date.now()}_a`);
    const res = await request(app).post('/api/p2p/signaling/conv_1').send(body);
    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(true);
  });

  it('rejects a duplicate nonce on the signaling route (400)', async () => {
    const app = buildApp();
    const nonce = `nonce_${Date.now()}_dup`;
    const body = await makeSignalingBody(pair, 'conv_dup', nonce);
    await request(app).post('/api/p2p/signaling/conv_dup').send(body);
    // Same nonce → replay
    const res = await request(app).post('/api/p2p/signaling/conv_dup').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/duplicate nonce/);
  });

  it('rejects a duplicate nonce on the relay route (400)', async () => {
    const app = buildApp();
    const nonce = `nonce_${Date.now()}_relaydup`;
    const body = await makeRelayBody(pair, 'conv_relay_dup', nonce);
    await request(app).post('/api/p2p/conversation-relay/conv_relay_dup').send(body);
    const res = await request(app)
      .post('/api/p2p/conversation-relay/conv_relay_dup')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/duplicate nonce/);
  });

  it('returns 429 when a peer exceeds the rate limit on signaling', async () => {
    // Use a very low limit to make the test fast
    const app = buildApp(2);
    const conv = 'conv_ratelimit';
    for (let i = 0; i < 2; i++) {
      const body = await makeSignalingBody(pair, conv, `nonce_rl_${Date.now()}_${i}`);
      const res = await request(app).post(`/api/p2p/signaling/${conv}`).send(body);
      expect(res.status).toBe(200);
    }
    // Third request should be rate-limited
    const body = await makeSignalingBody(pair, conv, `nonce_rl_${Date.now()}_over`);
    const res = await request(app).post(`/api/p2p/signaling/${conv}`).send(body);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/rate limit/);
  });

  it('exposes non-secret diagnostics on GET /api/debug/p2p-abuse', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/debug/p2p-abuse');
    expect(res.status).toBe(200);
    expect(typeof res.body.nonceCacheSize).toBe('number');
    expect(typeof res.body.trackedRateLimitKeys).toBe('number');
    expect(typeof res.body.suspiciousPeers).toBe('object');
  });
});
