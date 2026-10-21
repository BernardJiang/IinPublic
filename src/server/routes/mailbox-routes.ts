/**
 * Mailbox routes — encrypted offline envelope store (spec §23.6 "Offline delivery").
 *
 * Endpoints:
 *   POST   /api/mailbox/:recipientId          store a ciphertext envelope
 *   GET    /api/mailbox/:recipientId          list non-expired envelopes
 *   DELETE /api/mailbox/:recipientId/:id      ack/delete after successful local processing
 *   GET    /api/mailbox/:recipientId/wait     long-poll: ids only, answered when an envelope newer
 *                                             than `since` exists/arrives or after `timeoutMs`
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
import type { EmbeddedHubRelayClientLike } from '../../node-app/embedded-hub-relay-client';

export type RegisterMailboxRoutesDeps = {
  mailboxStore: MailboxStore;
  /** TechSupport's mail goes to the durable, radisk-backed store instead of the generic
   * in-memory/TTL one — see techsupport-durable-store.ts's doc comment for why. Every other
   * recipient is unaffected. */
  techSupportStore?: TechSupportDurableStore;
  /**
   * docs/TODO.md K7 follow-on: found via a real-hardware test
   * (09-android-techsupport-delegate-answers) — a TechSupport DELEGATE is an ORDINARY user id,
   * so mail addressed to one lands in the generic `mailboxStore` below, which (unlike
   * `techSupportStore`) has no durability or hub-visibility story of its own. An embedded node
   * dials the hub "for discovery only" (embedded-node.ts), so without this relay a delegate's
   * own separate device/process never sees mail a sender's embedded node stored only locally.
   */
  hubRelayClient?: EmbeddedHubRelayClientLike;
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

/** OPEN-44 long-poll bounds. Below common proxy/idle limits; one network wake per window. */
export const MAILBOX_WAIT_DEFAULT_MS = 4 * 60_000;
export const MAILBOX_WAIT_MAX_MS = 9 * 60_000;
const MAILBOX_WAITERS_PER_RECIPIENT = 8;

export type MailboxWaitResult = { changed: boolean; ids: string[]; latest: string };

/** Envelopes stored after `since` (ISO), and the newest createdAt overall. */
export function mailboxWaitSnapshot(envelopes: readonly MailboxEnvelope[], since: string): MailboxWaitResult {
  const sinceMs = Date.parse(since);
  const ids = envelopes.map((envelope) => envelope.id).filter(Boolean);
  const latest = envelopes.reduce((max, envelope) => (envelope.createdAt > max ? envelope.createdAt : max), since || '');
  const changed = envelopes.some((envelope) =>
    !Number.isFinite(sinceMs) || Date.parse(envelope.createdAt) > sinceMs);
  return { changed: since === '' ? ids.length > 0 : changed, ids, latest };
}

export function registerMailboxRoutes(
  app: express.Application,
  { mailboxStore, techSupportStore, hubRelayClient, nodeEnv }: RegisterMailboxRoutesDeps,
): void {
  const storeFor = (recipientId: string): MailboxLike =>
    recipientId === TECHSUPPORT_ROOT_USER_ID && techSupportStore ? techSupportStore : mailboxStore;
  // OPEN-44: open long-polls per recipient, woken by a store for that recipient.
  const waiters = new Map<string, Set<() => void>>();
  const wakeWaiters = (recipientId: string): void => {
    const set = waiters.get(recipientId);
    if (!set) return;
    waiters.delete(recipientId);
    for (const wake of set) wake();
  };

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
      wakeWaiters(recipientId);
      // docs/TODO.md K7 follow-on: an embedded node's local store (generic or TechSupport's own
      // durable one) is invisible to every other device/process without this — found via a real
      // Honor-phone-as-delegate test where her fan-out envelope never reached the shared hub.
      if (hubRelayClient) {
        const relayParams: { id: string; ciphertext: string; ttlMs?: number } = { id: envelopeId, ciphertext };
        if (ttlMs != null) relayParams.ttlMs = ttlMs;
        void hubRelayClient.postMailboxEnvelope(recipientId, relayParams).catch(() => undefined);
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
      let envelopes = await storeFor(recipientId).list(recipientId);
      if (hubRelayClient) {
        try {
          const remote = await hubRelayClient.listMailboxEnvelopes(recipientId);
          const byId = new Map<string, MailboxEnvelope>();
          for (const envelope of [...envelopes, ...remote]) {
            if (envelope?.id) byId.set(envelope.id, envelope);
          }
          envelopes = Array.from(byId.values());
        } catch {
          // Embedded nodes remain usable offline; local/already-cached envelopes still return.
        }
      }
      res.json({ recipientId, envelopes, count: envelopes.length });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // ── GET /api/mailbox/:recipientId/wait ────────────────────────────────────
  // OPEN-44: a phone whose vendor power layer withholds every background timer can still be woken
  // by incoming network data. Its always-on service keeps this request open; the response (ids
  // only, never ciphertext) arrives the moment an envelope is stored for it, or at the timeout,
  // when it simply re-asks. An embedded node forwards the wait to the hub, where senders post.
  app.get('/api/mailbox/:recipientId/wait', async (req, res) => {
    try {
      const recipientId = String(req.params.recipientId || '').trim();
      if (!recipientId) {
        res.status(400).json({ error: 'recipientId is required' });
        return;
      }
      const since = typeof req.query.since === 'string' ? req.query.since.slice(0, 40) : '';
      const requested = Number(req.query.timeoutMs);
      const timeoutMs = Number.isFinite(requested) && requested > 0
        ? Math.min(MAILBOX_WAIT_MAX_MS, requested)
        : MAILBOX_WAIT_DEFAULT_MS;
      const snapshot = async (): Promise<MailboxWaitResult> =>
        mailboxWaitSnapshot(await storeFor(recipientId).list(recipientId), since);
      const now = await snapshot();
      if (now.changed) {
        res.json(now);
        return;
      }
      const set = waiters.get(recipientId) ?? new Set<() => void>();
      if (set.size >= MAILBOX_WAITERS_PER_RECIPIENT) {
        res.status(429).json({ error: 'too many waiters for this recipient' });
        return;
      }
      const hubAbort = new AbortController();
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = async (fromHub?: MailboxWaitResult): Promise<void> => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        set.delete(wake);
        hubAbort.abort();
        const local = await snapshot().catch(() => now);
        const result: MailboxWaitResult = fromHub
          ? {
              changed: local.changed || fromHub.changed,
              ids: [...new Set([...local.ids, ...fromHub.ids])],
              latest: fromHub.latest > local.latest ? fromHub.latest : local.latest,
            }
          : local;
        if (!res.headersSent) res.json(result);
      };
      const wake = (): void => { void finish(); };
      set.add(wake);
      waiters.set(recipientId, set);
      timer = setTimeout(() => { void finish(); }, timeoutMs);
      (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
      req.on('close', () => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        set.delete(wake);
        hubAbort.abort();
      });
      if (hubRelayClient?.waitMailbox) {
        void hubRelayClient.waitMailbox(recipientId, since, timeoutMs, hubAbort.signal)
          .then((remote) => finish(remote))
          .catch(() => undefined);
      }
    } catch (error) {
      if (!res.headersSent) res.status(400).json({ error: (error as Error).message });
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
