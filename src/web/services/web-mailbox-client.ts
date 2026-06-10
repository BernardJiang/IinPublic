/**
 * WebMailboxClient — encrypted offline mailbox client (spec §23.6).
 *
 * Encryption model (reuses the existing pair-talk-response SEA ECDH pattern):
 *   Sender:    secret = SEA.secret(recipientEpub, senderPair)
 *              ct     = SEA.encrypt(JSON.stringify(payload), secret)
 *              stored = JSON.stringify({ senderEpub: senderPair.epub, ct })
 *
 *   Recipient: wrapper = JSON.parse(stored)     // { senderEpub, ct }
 *              secret  = SEA.secret(wrapper.senderEpub, recipientPair)
 *              payload = SEA.decrypt(wrapper.ct, secret)
 *
 * The server never sees plaintext. It stores {id, recipientId, ciphertext, createdAt, expiresAt}
 * where `ciphertext` is the JSON wrapper above.  The senderEpub in the wrapper is a routing hint
 * that lets the recipient derive the ECDH secret without any server-side metadata beyond recipientId.
 *
 * Drain-then-delete contract:
 *   1. GET /api/mailbox/:recipientId  — fetch all envelopes
 *   2. Decrypt + dispatch each through the appropriate handler.
 *   3. DELETE /api/mailbox/:recipientId/:envelopeId — only after handler succeeds.
 *   A crash between 2 and 3 causes re-delivery on next drain; handlers must be idempotent.
 */

import { getSEA, type GunPair } from '../sea-gun';

export type MailboxEnvelopeRemote = {
  id: string;
  recipientId: string;
  ciphertext: string;
  createdAt: string;
  expiresAt: string;
};

/** The JSON structure stored in the `ciphertext` field of a MailboxEnvelopeRemote. */
export type MailboxCiphertextWrapper = {
  senderEpub: string;
  ct: string;
};

export class WebMailboxClient {
  constructor(private readonly apiBase: string) {}

  // ── Encryption helpers ────────────────────────────────────────────────────

  /**
   * Encrypt a payload for a recipient identified by their epub key.
   * Returns the string to store in the envelope's `ciphertext` field.
   */
  async encryptForRecipient(
    recipientEpub: string,
    senderPair: GunPair,
    payload: unknown,
  ): Promise<string> {
    if (!recipientEpub) throw new Error('recipientEpub is required for mailbox encryption');
    const senderEpub = String((senderPair as any).epub || '');
    if (!senderEpub) throw new Error('senderPair must have an epub key for mailbox encryption');
    const secret = await getSEA().secret(recipientEpub, senderPair);
    if (!secret) throw new Error('SEA.secret returned null — check epub and pair');
    const ct: string = await getSEA().encrypt(JSON.stringify(payload), secret);
    // Thin JSON wrapper: senderEpub is a plaintext routing hint; ct is the encrypted body.
    const wrapper: MailboxCiphertextWrapper = { senderEpub, ct };
    return JSON.stringify(wrapper);
  }

  /**
   * Decrypt an envelope ciphertext field.
   * The senderEpub is stored as a plaintext routing hint in the JSON wrapper so the
   * recipient can derive the ECDH shared secret without extra server metadata.
   */
  async decryptEnvelope<T = unknown>(
    ciphertextField: string,
    recipientPair: GunPair,
  ): Promise<T> {
    let wrapper: MailboxCiphertextWrapper;
    try {
      wrapper = JSON.parse(ciphertextField) as MailboxCiphertextWrapper;
    } catch {
      throw new Error('Mailbox envelope ciphertext is not a valid JSON wrapper');
    }
    if (!wrapper.senderEpub || !wrapper.ct) {
      throw new Error('Mailbox envelope ciphertext wrapper is missing senderEpub or ct');
    }
    const secret = await getSEA().secret(wrapper.senderEpub, recipientPair);
    if (!secret) throw new Error('SEA.secret returned null while decrypting mailbox envelope');
    const decrypted = await getSEA().decrypt(wrapper.ct, secret);
    if (!decrypted) throw new Error('Mailbox envelope decryption failed — wrong key or corrupted ct');
    return (typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted) as T;
  }

  // ── HTTP operations ───────────────────────────────────────────────────────

  /**
   * Post a ciphertext envelope to the server mailbox.
   */
  async postEnvelope(params: {
    id: string;
    recipientId: string;
    ciphertext: string;
    ttlMs?: number;
  }): Promise<{ stored: boolean; error?: string }> {
    try {
      const res = await fetch(
        `${this.apiBase}/api/mailbox/${encodeURIComponent(params.recipientId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: params.id,
            ciphertext: params.ciphertext,
            ...(params.ttlMs != null ? { ttlMs: params.ttlMs } : {}),
          }),
        },
      );
      if (res.status === 201) return { stored: true };
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { stored: false, error: body.error ?? `HTTP ${res.status}` };
    } catch (err) {
      return { stored: false, error: (err as Error).message };
    }
  }

  /**
   * Fetch all non-expired envelopes for a recipient.
   */
  async fetchEnvelopes(recipientId: string): Promise<MailboxEnvelopeRemote[]> {
    try {
      const res = await fetch(
        `${this.apiBase}/api/mailbox/${encodeURIComponent(recipientId)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { envelopes?: MailboxEnvelopeRemote[] };
      return Array.isArray(data.envelopes) ? data.envelopes : [];
    } catch {
      return [];
    }
  }

  /**
   * Delete a drained envelope (ack after successful local processing).
   * Idempotent — returns true even if the envelope was already gone.
   */
  async deleteEnvelope(recipientId: string, envelopeId: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.apiBase}/api/mailbox/${encodeURIComponent(recipientId)}/${encodeURIComponent(envelopeId)}`,
        { method: 'DELETE' },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
