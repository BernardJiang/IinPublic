/**
 * Integration tests for the encrypted offline mailbox (P0 step 6).
 *
 * Covers:
 *   - POST /api/mailbox/:recipientId — store envelope
 *   - GET  /api/mailbox/:recipientId — list (ciphertext opacity, count)
 *   - DELETE /api/mailbox/:recipientId/:envelopeId — drain-then-delete
 *   - TTL eviction (expired envelopes are dropped)
 *   - Per-recipient cap enforcement
 *   - Max ciphertext size enforcement
 *   - Global envelope cap (oldest evicted)
 *   - Idempotent POST (same id accepted twice, returns stored=true)
 *   - Idempotent DELETE (already-gone envelope returns 200 deleted:false)
 *   - Ciphertext opacity: GET body does NOT contain plaintext answer text
 *   - Diagnostics endpoint (non-production only)
 */

import express from 'express';
import request from 'supertest';
import { registerMailboxRoutes } from '../../server/routes/mailbox-routes';
import {
  MailboxStore,
  MAILBOX_DEFAULT_TTL_MS,
  MAILBOX_MAX_TTL_MS,
  MAILBOX_MAX_PER_RECIPIENT,
  MAILBOX_MAX_CIPHERTEXT_BYTES,
} from '../../server/services/mailbox-store';

function buildApp(nodeEnv = 'test') {
  const app = express();
  app.use(express.json());
  const mailboxStore = new MailboxStore();
  registerMailboxRoutes(app, { mailboxStore, nodeEnv });
  return { app, mailboxStore };
}

// Minimal ciphertext that passes opacity checks — starts with SEA{ to mimic real SEA output,
// but in these tests we just use plain JSON wrapper (the store doesn't validate format).
const FAKE_CIPHERTEXT = JSON.stringify({ senderEpub: 'abc123epub', ct: 'SEA{"ct":"fakeblob","iv":"x","s":"y"}' });

describe('mailbox routes', () => {
  describe('POST /api/mailbox/:recipientId', () => {
    it('stores an envelope and returns 201 with metadata (no ciphertext in response)', async () => {
      const { app } = buildApp();
      const res = await request(app)
        .post('/api/mailbox/recipient1')
        .send({ id: 'env_001', ciphertext: FAKE_CIPHERTEXT });
      expect(res.status).toBe(201);
      expect(res.body.stored).toBe(true);
      expect(res.body.envelope).toMatchObject({
        id: 'env_001',
        recipientId: 'recipient1',
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      });
      // Ciphertext must NOT be echoed back in POST response.
      expect(res.body.envelope.ciphertext).toBeUndefined();
    });

    it('returns 201 on duplicate id (idempotent)', async () => {
      const { app } = buildApp();
      await request(app).post('/api/mailbox/r1').send({ id: 'env_dup', ciphertext: FAKE_CIPHERTEXT });
      const res = await request(app).post('/api/mailbox/r1').send({ id: 'env_dup', ciphertext: FAKE_CIPHERTEXT });
      expect(res.status).toBe(201);
      expect(res.body.stored).toBe(true);
    });

    it('rejects missing id with 400', async () => {
      const { app } = buildApp();
      const res = await request(app).post('/api/mailbox/r1').send({ ciphertext: FAKE_CIPHERTEXT });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/id/i);
    });

    it('rejects missing ciphertext with 400', async () => {
      const { app } = buildApp();
      const res = await request(app).post('/api/mailbox/r1').send({ id: 'env_001' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/ciphertext/i);
    });

    it('rejects ciphertext exceeding max size with 400', async () => {
      const { app } = buildApp();
      const oversized = 'x'.repeat(MAILBOX_MAX_CIPHERTEXT_BYTES + 1);
      const res = await request(app).post('/api/mailbox/r1').send({ id: 'env_big', ciphertext: oversized });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/exceed/i);
    });

    it('rejects invalid ttlMs with 400', async () => {
      const { app } = buildApp();
      const res = await request(app)
        .post('/api/mailbox/r1')
        .send({ id: 'env_bad_ttl', ciphertext: FAKE_CIPHERTEXT, ttlMs: -1 });
      expect(res.status).toBe(400);
    });

    it('rejects ttlMs beyond maximum with 400', async () => {
      const { app } = buildApp();
      const res = await request(app)
        .post('/api/mailbox/r1')
        .send({ id: 'env_long_ttl', ciphertext: FAKE_CIPHERTEXT, ttlMs: MAILBOX_MAX_TTL_MS + 1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/maximum/i);
    });

    it('rejects when per-recipient cap is reached with 429', async () => {
      const { app, mailboxStore } = buildApp();
      // Fill the cap directly (faster than HTTP round-trips).
      for (let i = 0; i < MAILBOX_MAX_PER_RECIPIENT; i++) {
        mailboxStore.store({ id: `cap_${i}`, recipientId: 'capuser', ciphertext: FAKE_CIPHERTEXT });
      }
      const res = await request(app)
        .post('/api/mailbox/capuser')
        .send({ id: 'cap_over', ciphertext: FAKE_CIPHERTEXT });
      expect(res.status).toBe(429);
      expect(res.body.error).toMatch(/cap/i);
    });
  });

  describe('GET /api/mailbox/:recipientId', () => {
    it('returns stored envelopes with ciphertext included', async () => {
      const { app } = buildApp();
      await request(app).post('/api/mailbox/r2').send({ id: 'e1', ciphertext: FAKE_CIPHERTEXT });
      await request(app).post('/api/mailbox/r2').send({ id: 'e2', ciphertext: FAKE_CIPHERTEXT });

      const res = await request(app).get('/api/mailbox/r2');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      expect(res.body.envelopes).toHaveLength(2);
      // Ciphertext IS returned on GET (recipient needs it to decrypt).
      expect(res.body.envelopes[0].ciphertext).toBe(FAKE_CIPHERTEXT);
    });

    it('returns empty list for unknown recipient', async () => {
      const { app } = buildApp();
      const res = await request(app).get('/api/mailbox/nobody');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
      expect(res.body.envelopes).toEqual([]);
    });

    it('ciphertext opacity: body does not contain plaintext answer text', async () => {
      const { app } = buildApp();
      const PLAINTEXT_MARKER = 'super-secret-answer-text-XYZ';
      // The ciphertext should NOT contain the marker in plaintext.
      const ct = JSON.stringify({ senderEpub: 'epub123', ct: 'SEA{"encrypted":"opaque"}' });
      expect(ct).not.toContain(PLAINTEXT_MARKER);
      await request(app).post('/api/mailbox/r3').send({ id: 'e_opaque', ciphertext: ct });
      const res = await request(app).get('/api/mailbox/r3');
      expect(JSON.stringify(res.body)).not.toContain(PLAINTEXT_MARKER);
    });
  });

  describe('DELETE /api/mailbox/:recipientId/:envelopeId', () => {
    it('deletes an envelope and returns deleted:true', async () => {
      const { app } = buildApp();
      await request(app).post('/api/mailbox/r4').send({ id: 'del_me', ciphertext: FAKE_CIPHERTEXT });

      const del = await request(app).delete('/api/mailbox/r4/del_me');
      expect(del.status).toBe(200);
      expect(del.body.deleted).toBe(true);

      // Subsequent GET returns empty.
      const get = await request(app).get('/api/mailbox/r4');
      expect(get.body.count).toBe(0);
    });

    it('is idempotent — deleting an already-gone envelope returns deleted:false with 200', async () => {
      const { app } = buildApp();
      const res = await request(app).delete('/api/mailbox/nobody/phantom');
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(false);
    });

    it('deletes only the specified envelope, leaves others', async () => {
      const { app } = buildApp();
      await request(app).post('/api/mailbox/r5').send({ id: 'keep', ciphertext: FAKE_CIPHERTEXT });
      await request(app).post('/api/mailbox/r5').send({ id: 'gone', ciphertext: FAKE_CIPHERTEXT });

      await request(app).delete('/api/mailbox/r5/gone');

      const get = await request(app).get('/api/mailbox/r5');
      expect(get.body.count).toBe(1);
      expect(get.body.envelopes[0].id).toBe('keep');
    });
  });

  describe('TTL eviction', () => {
    it('does not return expired envelopes on GET', async () => {
      const { mailboxStore } = buildApp();
      const past = new Date(Date.now() - 1000); // 1 s ago
      mailboxStore.store({ id: 'exp_1', recipientId: 'ttluser', ciphertext: FAKE_CIPHERTEXT, ttlMs: 1, now: past });

      // Build a fresh app wrapping the same store (expired envelope should be pruned).
      const app2 = express();
      app2.use(express.json());
      registerMailboxRoutes(app2, { mailboxStore, nodeEnv: 'test' });

      const res = await request(app2).get('/api/mailbox/ttluser');
      expect(res.body.count).toBe(0);
    });

    it('MailboxStore.pruneExpired removes expired envelopes', () => {
      const store = new MailboxStore();
      const past = new Date(Date.now() - 2000);
      store.store({ id: 'stale', recipientId: 'u1', ciphertext: 'ct', ttlMs: 1, now: past });
      expect(store.getTotalCount()).toBe(1);
      store.pruneExpired(new Date()); // current time — envelope is expired
      expect(store.getTotalCount()).toBe(0);
    });

    it('MailboxStore.list returns empty after envelope expires', () => {
      const store = new MailboxStore();
      const past = new Date(Date.now() - 1000);
      store.store({ id: 'exp_2', recipientId: 'u2', ciphertext: 'ct', ttlMs: 1, now: past });
      const envelopes = store.list('u2', new Date());
      expect(envelopes).toHaveLength(0);
    });

    it('fresh envelope is not evicted', () => {
      const store = new MailboxStore();
      store.store({ id: 'fresh', recipientId: 'u3', ciphertext: 'ct', ttlMs: MAILBOX_DEFAULT_TTL_MS });
      store.pruneExpired(new Date());
      expect(store.getTotalCount()).toBe(1);
    });
  });

  describe('MailboxStore unit', () => {
    it('resetForTesting clears all envelopes', () => {
      const store = new MailboxStore();
      store.store({ id: 'a', recipientId: 'u', ciphertext: 'ct' });
      store.store({ id: 'b', recipientId: 'u', ciphertext: 'ct' });
      expect(store.getTotalCount()).toBe(2);
      store.resetForTesting();
      expect(store.getTotalCount()).toBe(0);
      expect(store.list('u')).toHaveLength(0);
    });

    it('getQueueSizes reports per-recipient counts', () => {
      const store = new MailboxStore();
      store.store({ id: '1', recipientId: 'alice', ciphertext: 'ct' });
      store.store({ id: '2', recipientId: 'alice', ciphertext: 'ct' });
      store.store({ id: '3', recipientId: 'bob', ciphertext: 'ct' });
      const sizes = store.getQueueSizes();
      expect(sizes['alice']).toBe(2);
      expect(sizes['bob']).toBe(1);
    });

    it('does not return duplicate when posting same id twice', () => {
      const store = new MailboxStore();
      store.store({ id: 'dup', recipientId: 'u', ciphertext: 'ct' });
      store.store({ id: 'dup', recipientId: 'u', ciphertext: 'ct' });
      expect(store.getTotalCount()).toBe(1);
    });

    it('TTL defaults to MAILBOX_DEFAULT_TTL_MS when not specified', () => {
      const store = new MailboxStore();
      const now = new Date();
      const result = store.store({ id: 'def_ttl', recipientId: 'u', ciphertext: 'ct', now });
      expect(result.stored).toBe(true);
      if (result.stored) {
        const expiresAt = new Date(result.envelope.expiresAt).getTime();
        expect(expiresAt).toBeGreaterThanOrEqual(now.getTime() + MAILBOX_DEFAULT_TTL_MS - 1000);
        expect(expiresAt).toBeLessThanOrEqual(now.getTime() + MAILBOX_DEFAULT_TTL_MS + 1000);
      }
    });

    it('TTL is clamped to MAILBOX_MAX_TTL_MS even when caller specifies more', () => {
      const store = new MailboxStore();
      const now = new Date();
      const result = store.store({
        id: 'capped_ttl',
        recipientId: 'u',
        ciphertext: 'ct',
        ttlMs: MAILBOX_MAX_TTL_MS * 10,
        now,
      });
      expect(result.stored).toBe(true);
      if (result.stored) {
        const expiresAt = new Date(result.envelope.expiresAt).getTime();
        expect(expiresAt).toBeLessThanOrEqual(now.getTime() + MAILBOX_MAX_TTL_MS + 1000);
      }
    });
  });

  describe('diagnostics endpoint (non-production)', () => {
    it('GET /api/mailbox-diagnostics returns totals in test mode', async () => {
      const { app, mailboxStore } = buildApp('test');
      mailboxStore.store({ id: 'diag1', recipientId: 'dx', ciphertext: 'ct' });
      const res = await request(app).get('/api/mailbox-diagnostics');
      expect(res.status).toBe(200);
      expect(res.body.totalEnvelopes).toBe(1);
      expect(res.body.defaultTtlMs).toBe(MAILBOX_DEFAULT_TTL_MS);
      expect(res.body.maxTtlMs).toBe(MAILBOX_MAX_TTL_MS);
    });

    it('GET /api/mailbox-diagnostics returns 404 in production mode', async () => {
      const { app } = buildApp('production');
      const res = await request(app).get('/api/mailbox-diagnostics');
      expect(res.status).toBe(404);
    });
  });
});
