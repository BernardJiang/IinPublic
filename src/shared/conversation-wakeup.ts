import {
  createSignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
} from './p2p-runtime';

export const CONVERSATION_WAKEUP_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * Minimal public control record used to break the first-message WebRTC discovery cycle.
 * Conversation titles, Talk ids, match scores, names, and deal state stay inside ciphertext.
 */
export type ConversationWakeupRecord = {
  version: 1;
  kind: 'conversation-wakeup';
  conversationId: string;
  senderUserId: string;
  recipientUserId: string;
  senderPub: string;
  senderEpub: string;
  recipientPub: string;
  ciphertext: string;
  createdAt: string;
  expiresAt: string;
  proof: SignedP2PEnvelopeProof;
};

export function conversationWakeupSigningPayload(
  record: Omit<ConversationWakeupRecord, 'proof'>,
): unknown {
  return {
    type: 'iinpublic-conversation-wakeup-v1',
    version: record.version,
    kind: record.kind,
    conversationId: record.conversationId,
    senderUserId: record.senderUserId,
    recipientUserId: record.recipientUserId,
    senderPub: record.senderPub,
    senderEpub: record.senderEpub,
    recipientPub: record.recipientPub,
    ciphertext: record.ciphertext,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export async function createConversationWakeup(input: {
  conversationId: string;
  senderUserId: string;
  recipientUserId: string;
  recipientPub: string;
  ciphertext: string;
  pair: SeaSigningPair & { epub?: string };
  now?: Date;
}): Promise<ConversationWakeupRecord> {
  const now = input.now ?? new Date();
  const senderPub = String(input.pair.pub || '').trim();
  const senderEpub = String(input.pair.epub || '').trim();
  const unsigned: Omit<ConversationWakeupRecord, 'proof'> = {
    version: 1,
    kind: 'conversation-wakeup',
    conversationId: String(input.conversationId || '').trim(),
    senderUserId: String(input.senderUserId || '').trim(),
    recipientUserId: String(input.recipientUserId || '').trim(),
    senderPub,
    senderEpub,
    recipientPub: String(input.recipientPub || '').trim(),
    ciphertext: String(input.ciphertext || ''),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CONVERSATION_WAKEUP_TTL_MS).toISOString(),
  };
  if (!unsigned.conversationId || unsigned.conversationId.length > 512) throw new Error('Conversation wake-up id is invalid');
  if (!unsigned.senderUserId || !unsigned.recipientUserId) throw new Error('Conversation wake-up users are required');
  if (!unsigned.senderPub || !unsigned.senderEpub || !unsigned.recipientPub) throw new Error('Conversation wake-up keys are required');
  if (!unsigned.ciphertext || unsigned.ciphertext.length > 128_000) throw new Error('Conversation wake-up ciphertext is invalid');
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: conversationWakeupSigningPayload(unsigned),
    timestamp: unsigned.createdAt,
  });
  return { ...unsigned, proof };
}

export function parseConversationWakeup(value: unknown): ConversationWakeupRecord | null {
  if (!value || typeof value !== 'object') return null;
  const wire = value as Record<string, unknown>;
  let candidate: unknown = wire;
  if (typeof wire.data === 'string') {
    try {
      candidate = JSON.parse(wire.data);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== 'object') return null;
  const record = candidate as Partial<ConversationWakeupRecord>;
  if (record.version !== 1
    || record.kind !== 'conversation-wakeup'
    || typeof record.conversationId !== 'string' || !record.conversationId || record.conversationId.length > 512
    || typeof record.senderUserId !== 'string' || !record.senderUserId || record.senderUserId.length > 256
    || typeof record.recipientUserId !== 'string' || !record.recipientUserId || record.recipientUserId.length > 256
    || typeof record.senderPub !== 'string' || !record.senderPub || record.senderPub.length > 2_048
    || typeof record.senderEpub !== 'string' || !record.senderEpub || record.senderEpub.length > 2_048
    || typeof record.recipientPub !== 'string' || !record.recipientPub || record.recipientPub.length > 2_048
    || typeof record.ciphertext !== 'string' || !record.ciphertext || record.ciphertext.length > 128_000
    || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
    || typeof record.expiresAt !== 'string' || !Number.isFinite(Date.parse(record.expiresAt))
    || !record.proof || record.proof.pub !== record.senderPub) return null;
  return record as ConversationWakeupRecord;
}

export async function verifyConversationWakeup(
  value: unknown,
  input: { recipientUserId: string; recipientPub: string; now?: Date },
): Promise<{ ok: true; record: ConversationWakeupRecord } | { ok: false; reason: string }> {
  const record = parseConversationWakeup(value);
  if (!record) return { ok: false, reason: 'malformed conversation wake-up' };
  if (record.recipientUserId !== input.recipientUserId || record.recipientPub !== input.recipientPub) {
    return { ok: false, reason: 'wrong conversation wake-up recipient' };
  }
  const now = input.now ?? new Date();
  if (Date.parse(record.expiresAt) <= now.getTime()) return { ok: false, reason: 'expired conversation wake-up' };
  if (Date.parse(record.expiresAt) - Date.parse(record.createdAt) > CONVERSATION_WAKEUP_TTL_MS + 1_000) {
    return { ok: false, reason: 'conversation wake-up lifetime is invalid' };
  }
  const proof = await verifySignedP2PEnvelopeProof({
    proof: record.proof,
    payload: conversationWakeupSigningPayload({
      version: record.version,
      kind: record.kind,
      conversationId: record.conversationId,
      senderUserId: record.senderUserId,
      recipientUserId: record.recipientUserId,
      senderPub: record.senderPub,
      senderEpub: record.senderEpub,
      recipientPub: record.recipientPub,
      ciphertext: record.ciphertext,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    }),
    now,
    maxSkewMs: CONVERSATION_WAKEUP_TTL_MS,
  });
  return proof.ok ? { ok: true, record } : { ok: false, reason: proof.reason };
}
