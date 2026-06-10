/**
 * Mailbox routes — encrypted offline envelope store (spec §23.6 "Offline delivery").
 *
 * Endpoints:
 *   POST   /api/mailbox/:recipientId          store a ciphertext envelope
 *   GET    /api/mailbox/:recipientId          list non-expired envelopes
 *   DELETE /api/mailbox/:recipientId/:id      ack/delete after successful local processing
 *
 * The server NEVER sees plaintext — ciphertext is an opaque string produced by the sender
 * using SEA ECDH against the recipient's epub key. The server only knows {recipientId,
 * envelopeId, expiresAt}; it does not know the sender or the content type.
 *
 * Drain-then-delete contract:
 *   Clients call GET to drain, process each envelope locally, then DELETE each one.
 *   A crash between GET and DELETE means the envelope is re-delivered on the next boot
 *   (idempotent because handleMeshTalkResponse dedupes on responseId).
 */

import type express from 'express';
import {
  MailboxStore,
  MAILBOX_DEFAULT_TTL_MS,
  MAILBOX_MAX_TTL_MS,
  MAILBOX_MAX_CIPHERTEXT_BYTES,
  type MailboxEnvelope,
} from '../services/mailbox-store';

export type RegisterMailboxRoutesDeps = {
  mailboxStore: MailboxStore;
  nodeEnv?: string | undefined;
};

export function registerMailboxRoutes(
  app: express.Application,
  { mailboxStore, nodeEnv }: RegisterMailboxRoutesDeps,
): void {
  // ── POST /api/mailbox/:recipientId ────────────────────────────────────────
  // Store a ciphertext envelope for an offline recipient.
  // Body: { id: string, ciphertext: string, ttlMs?: number }
  app.post('/api/mailbox/:recipientId', (req, res) => {
    try {
      const recipientId = String(req.params.recipientId || '').trim();
      if (!recipientId) {
        res.status(400).json({ error: 'recipientId is required' });
        return;
      }
      const body = req.body || {};
      const envelopeId = String(body.id || '').trim();
      const ciphertext = String(body.ciphertext || '').trim();
      if (!envelopeId) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      if (!ciphertext) {
        res.status(400).json({ error: 'ciphertext is required' });
        return;
      }
      // Validate ciphertext size before hitting the store (returns 400, not 429).
      if (Buffer.byteLength(ciphertext, 'utf8') > MAILBOX_MAX_CIPHERTEXT_BYTES) {
        res.status(400).json({ error: `ciphertext exceeds ${MAILBOX_MAX_CIPHERTEXT_BYTES} byte limit` });
        return;
      }
      // Optional TTL override — reject values outside [1, MAX_TTL_MS].
      let ttlMs: number | undefined;
      if (body.ttlMs != null) {
        const raw = Number(body.ttlMs);
        if (!Number.isFinite(raw) || raw < 1) {
          res.status(400).json({ error: 'ttlMs must be a positive number' });
          return;
        }
        if (raw > MAILBOX_MAX_TTL_MS) {
          res.status(400).json({ error: `ttlMs exceeds maximum of ${MAILBOX_MAX_TTL_MS} ms` });
          return;
        }
        ttlMs = raw;
      }
      const storeParams: Parameters<typeof mailboxStore.store>[0] = { id: envelopeId, recipientId, ciphertext };
      if (ttlMs != null) storeParams.ttlMs = ttlMs;
      const result = mailboxStore.store(storeParams);
      if (!result.stored) {
        res.status(429).json({ error: result.reason });
        return;
      }
      res.status(201).json({ stored: true, envelope: stripCiphertext(result.envelope) });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // ── GET /api/mailbox/:recipientId ─────────────────────────────────────────
  // List all non-expired envelopes for a recipient (full ciphertext included).
  app.get('/api/mailbox/:recipientId', (req, res) => {
    try {
      const recipientId = String(req.params.recipientId || '').trim();
      if (!recipientId) {
        res.status(400).json({ error: 'recipientId is required' });
        return;
      }
      const envelopes = mailboxStore.list(recipientId);
      res.json({ recipientId, envelopes, count: envelopes.length });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // ── DELETE /api/mailbox/:recipientId/:envelopeId ──────────────────────────
  // Acknowledge and delete a drained envelope.
  app.delete('/api/mailbox/:recipientId/:envelopeId', (req, res) => {
    try {
      const recipientId = String(req.params.recipientId || '').trim();
      const envelopeId = String(req.params.envelopeId || '').trim();
      if (!recipientId || !envelopeId) {
        res.status(400).json({ error: 'recipientId and envelopeId are required' });
        return;
      }
      const deleted = mailboxStore.delete(recipientId, envelopeId);
      // Return 200 even when already gone — idempotent delete.
      res.json({ deleted });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // ── Diagnostics (non-production) ─────────────────────────────────────────
  if (nodeEnv !== 'production') {
    app.get('/api/mailbox-diagnostics', (_req, res) => {
      res.json({
        totalEnvelopes: mailboxStore.getTotalCount(),
        queueSizes: mailboxStore.getQueueSizes(),
        defaultTtlMs: MAILBOX_DEFAULT_TTL_MS,
        maxTtlMs: MAILBOX_MAX_TTL_MS,
      });
    });
  }
}

/** Strip the ciphertext from an envelope for the POST 201 response (avoid echoing it back). */
function stripCiphertext(envelope: MailboxEnvelope): Omit<MailboxEnvelope, 'ciphertext'> {
  const { ciphertext: _ct, ...rest } = envelope;
  return rest;
}
