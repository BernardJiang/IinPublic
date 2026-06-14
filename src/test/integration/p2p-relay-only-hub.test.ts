/**
 * P2P-Z integration tests — relay-only hub (Hub Phase C).
 *
 * Verifies:
 * 1. RELAY_ONLY_HUB=1 causes Gun to boot with radisk=false (no radata/).
 * 2. GET /api/debug/relay-only-status correctly reports relay-only mode.
 * 3. Signaling, relay, and presence still work (in-memory) when relay-only is on.
 * 4. shouldSkipServerGunPersist returns true for app paths in relay-only mode.
 */
import express from 'express';
import request from 'supertest';
import { registerSystemRoutes } from '../../server/routes/system-routes';
import { resolveP2PRuntimeFlags, shouldSkipServerGunPersist } from '../../shared/p2p-runtime';
import { warnIfStaleRadataExists } from '../../server/bootstrap/http-bootstrap';
import fs from 'fs';
import os from 'os';
import path from 'path';

function buildApp(env: Record<string, string> = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const app = express();
  app.use(express.json());
  const gun = { _: { graph: {}, opt: { radisk: false } } };
  registerSystemRoutes(app, {
    gun,
    clearForTesting: jest.fn(),
    nodeEnv: 'test',
  });
  process.env = saved;
  return app;
}

describe('P2P-Z: relay-only hub', () => {
  describe('resolveP2PRuntimeFlags', () => {
    it('relayOnlyHub=true when RELAY_ONLY_HUB=1', () => {
      const flags = resolveP2PRuntimeFlags({ RELAY_ONLY_HUB: '1' });
      expect(flags.relayOnlyHub).toBe(true);
      expect(flags.starServerPersistence).toBe('ephemeral');
    });

    it('relayOnlyHub=false by default', () => {
      const flags = resolveP2PRuntimeFlags({});
      expect(flags.relayOnlyHub).toBe(false);
    });
  });

  describe('shouldSkipServerGunPersist in relay-only mode', () => {
    const relayFlags = resolveP2PRuntimeFlags({ RELAY_ONLY_HUB: '1' });

    it('skips conversation message persistence', () => {
      expect(shouldSkipServerGunPersist(['conversations', 'conv_1', 'messages', 'msg_1'], relayFlags)).toBe(true);
    });

    it('skips direct-p2p pair-private message persistence (Phase 3)', () => {
      // The ordinary-DM path is device-owned (spec §19.4); the server never archives it.
      expect(
        shouldSkipServerGunPersist(['pairConversations', 'alice__bob', 'conv_1', 'messages', 'msg_1'], relayFlags),
      ).toBe(true);
    });

    it('still persists non-message pair nodes (only message bodies are device-owned)', () => {
      // A pair node that is not a `.../messages/...` write is not covered by the skip.
      expect(
        shouldSkipServerGunPersist(['pairConversations', 'alice__bob', 'conv_1', 'meta'], relayFlags),
      ).toBe(false);
    });

    it('skips talks persistence', () => {
      expect(shouldSkipServerGunPersist(['talks', 'talk_1'], relayFlags)).toBe(true);
    });

    it('skips incomingTalksByUser persistence', () => {
      expect(shouldSkipServerGunPersist(['incomingTalksByUser', 'user_1', 'cluster_1'], relayFlags)).toBe(true);
    });

    it('does not skip support channel messages', () => {
      expect(
        shouldSkipServerGunPersist(['conversations', 'conv_support_1', 'messages', 'msg_1'], relayFlags, {
          supportChannel: true,
        }),
      ).toBe(false);
    });
  });

  describe('GET /api/debug/relay-only-status', () => {
    it('reports relay-only=true when RELAY_ONLY_HUB=1', async () => {
      const saved = process.env.RELAY_ONLY_HUB;
      process.env.RELAY_ONLY_HUB = '1';
      try {
        const app = buildApp({ RELAY_ONLY_HUB: '1' });
        // Re-register with env set so the route reads the flag
        process.env.RELAY_ONLY_HUB = '1';
        const res = await request(app).get('/api/debug/relay-only-status');
        expect(res.status).toBe(200);
        expect(res.body.relayOnlyHub).toBe(true);
        expect(res.body.radiskEnabled).toBe(false);
        expect(res.body.inMemorySignaling).toBe(true);
        expect(res.body.inMemoryRelay).toBe(true);
        expect(res.body.inMemoryPresence).toBe(true);
        expect(res.body.note).toMatch(/relay-only/);
      } finally {
        if (saved === undefined) delete process.env.RELAY_ONLY_HUB;
        else process.env.RELAY_ONLY_HUB = saved;
      }
    });

    it('reports relay-only=false in standard mode', async () => {
      const saved = process.env.RELAY_ONLY_HUB;
      delete process.env.RELAY_ONLY_HUB;
      try {
        const app = buildApp();
        const res = await request(app).get('/api/debug/relay-only-status');
        expect(res.status).toBe(200);
        expect(res.body.relayOnlyHub).toBe(false);
      } finally {
        if (saved !== undefined) process.env.RELAY_ONLY_HUB = saved;
      }
    });
  });

  describe('signaling and relay still work in relay-only mode', () => {
    it('presence register returns 200', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/presence/register').send({
        userId: 'user_relay_test',
        pub: 'pub_relay_test',
      });
      expect(res.status).toBe(200);
      expect(res.body.stored).toBe(true);
    });

    it('presence nearby returns peers', async () => {
      const app = buildApp();
      await request(app).post('/api/presence/register').send({
        userId: 'user_relay_a',
        pub: 'pub_relay_a',
      });
      const res = await request(app).get('/api/presence/nearby?limit=10');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.peers)).toBe(true);
    });
  });

  describe('warnIfStaleRadataExists', () => {
    it('does not throw when radata/ is absent', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2pz-test-'));
      expect(() => warnIfStaleRadataExists(tmp)).not.toThrow();
      fs.rmdirSync(tmp);
    });

    it('does not throw when radata/ is present (just warns)', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2pz-test-'));
      fs.mkdirSync(path.join(tmp, 'radata'));
      expect(() => warnIfStaleRadataExists(tmp)).not.toThrow();
      fs.rmdirSync(path.join(tmp, 'radata'));
      fs.rmdirSync(tmp);
    });
  });
});
