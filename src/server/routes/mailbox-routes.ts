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
  type StoreEnvelopeResult,
} from '../services/mailbox-store';
import type { TechSupportDurableStore } from '../services/techsupport-durable-store';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';

export type RegisterMailboxRoutesDeps = {
  mailboxStore: MailboxStore;
  /** TechSupport's mail goes to the durable, radisk-backed store instead of the generic
   * in-memory/TTL one — see techsupport-durable-store.ts's doc comment for why. Every other
   * recipient is unaffected. */
  techSupportStore?: TechSupportDurableStore;
  nodeEnv?: string | undefined;
};

/**
 * MailboxStore's methods are synchronous; TechSupportDurableStore's are async (Gun reads).
 * Union return types let both satisfy this interface, and every call site `await`s the result —
 * awaiting a plain (non-Promise) value is a no-op pass-through, so this costs nothing for the
 * sync store.
 */
type MailboxLike = {
  store(params: { id: string; recipientId: string; ciphertext: string; ttlMs?: number }):
    | StoreEnvelopeResult
    | Promise<StoreEnvelopeResult>;
  list(recipientId: string): MailboxEnvelope[] | Promise<MailboxEnvelope[]>;
  delete(recipientId: string, envelopeId: string): boolean | Promise<boolean>;
  getTotalCount(): number | Promise<number>;
  getQueueSizes(): Record<string, number> | Promise<Record<string, number>>;
};

export function registerMailboxRoutes(
  app: express.Application,
  { mailboxStore, techSupportStore, nodeEnv }: RegisterMailboxRoutesDeps,
): void {
  const storeFor = (recipientId: string): MailboxLike =>
    recipientId === TECHSUPPORT_ROOT_USER_ID && techSupportStore ? techSupportStore : mailboxStore;

  // ── POST /api/mailbox/:recipientId ────────────────────────────────────────
  // Store a ciphertext envelope for an offline recipient.
  // Body: { id: string, ciphertext: string, ttlMs?: number }
  app.post('/api/mailbox/:recipientId', async (req, res) => {
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
      const storeParams: Parameters<MailboxLike['store']>[0] = { id: envelopeId, recipientId, ciphertext };
      if (ttlMs != null) storeParams.ttlMs = ttlMs;
      const result = await storeFor(recipientId).store(storeParams);
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
  app.get('/api/mailbox/:recipientId', async (req, res) => {
    try {
      const recipientId = String(req.params.recipientId || '').trim();
      if (!recipientId) {
        res.status(400).json({ error: 'recipientId is required' });
        return;
      }
      const envelopes = await storeFor(recipientId).list(recipientId);
      res.json({ recipientId, envelopes, count: envelopes.length });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // ── DELETE /api/mailbox/:recipientId/:envelopeId ──────────────────────────
  // Acknowledge and delete a drained envelope.
  app.delete('/api/mailbox/:recipientId/:envelopeId', async (req, res) => {
    try {
      const recipientId = String(req.params.recipientId || '').trim();
      const envelopeId = String(req.params.envelopeId || '').trim();
      if (!recipientId || !envelopeId) {
        res.status(400).json({ error: 'recipientId and envelopeId are required' });
        return;
      }
      const deleted = await storeFor(recipientId).delete(recipientId, envelopeId);
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
