import { portableSha256Hex } from './portable-sha256';
import {
  createSignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
} from './p2p-runtime';
import { parseNearbyCard, type NearbyCard } from './nearby-v3-card';

/**
 * A Nearby v3 knock (§3.7 "Implementation plan", phase 2): "please open our pair's link". Lists are
 * one-sided, so Adam may have Eve on his list while Eve does not have Adam; Eve's phone would never
 * open the session on its own. Adam writes a signed knock to Eve's own signalling channel; Eve's
 * phone checks it (signature, freshness, block list, incoming limit) and opens her side.
 *
 * A knock carries the knocker's card, so the receiver also learns where they are. It carries nothing
 * else and is valid for one minute.
 */
export type NearbyKnock = {
  version: 1;
  kind: 'nearby-knock';
  fromUserId: string;
  fromPub: string;
  toPub: string;
  card: NearbyCard | null;
  issuedAt: string;
  proof: SignedP2PEnvelopeProof;
};

export const NEARBY_KNOCK_LIFETIME_MS = 60_000;

/** Where knocks for `pub` are written: a channel only the holder of `pub` listens to. */
export function nearbyKnockChannel(pub: string): string {
  return portableSha256Hex(`iinpublic:nearby-knock:v1:${pub}`);
}

function signingPayload(knock: Omit<NearbyKnock, 'proof'>): unknown {
  return {
    type: 'iinpublic-nearby-knock-v1',
    version: knock.version,
    kind: knock.kind,
    fromUserId: knock.fromUserId,
    fromPub: knock.fromPub,
    toPub: knock.toPub,
    card: knock.card,
    issuedAt: knock.issuedAt,
  };
}

export async function createNearbyKnock(input: {
  fromUserId: string;
  pair: SeaSigningPair;
  toPub: string;
  card: NearbyCard | null;
  now?: Date;
}): Promise<NearbyKnock> {
  const issuedAt = (input.now ?? new Date()).toISOString();
  const unsigned: Omit<NearbyKnock, 'proof'> = {
    version: 1,
    kind: 'nearby-knock',
    fromUserId: input.fromUserId,
    fromPub: input.pair.pub,
    toPub: input.toPub,
    card: input.card,
    issuedAt,
  };
  const proof = await createSignedP2PEnvelopeProof({ pair: input.pair, payload: signingPayload(unsigned), timestamp: issuedAt });
  return { ...unsigned, proof };
}

export async function verifyNearbyKnock(
  value: unknown,
  input: { localPub: string; now?: Date },
): Promise<{ ok: true; knock: NearbyKnock } | { ok: false; reason: string }> {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'malformed knock' };
  const knock = value as Partial<NearbyKnock>;
  if (knock.version !== 1 || knock.kind !== 'nearby-knock'
    || typeof knock.fromUserId !== 'string' || !knock.fromUserId || knock.fromUserId.length > 256
    || typeof knock.fromPub !== 'string' || !knock.fromPub || knock.fromPub.length > 2_048
    || typeof knock.toPub !== 'string' || typeof knock.issuedAt !== 'string'
    || !knock.proof || knock.proof.pub !== knock.fromPub || knock.proof.timestamp !== knock.issuedAt) {
    return { ok: false, reason: 'malformed knock' };
  }
  if (knock.toPub !== input.localPub) return { ok: false, reason: 'knock is for someone else' };
  const card = knock.card === null ? null : parseNearbyCard(knock.card);
  if (knock.card !== null && (!card || card.pub !== knock.fromPub || card.userId !== knock.fromUserId)) {
    return { ok: false, reason: 'knock card does not belong to the knocker' };
  }
  const now = input.now ?? new Date();
  const issuedAt = Date.parse(knock.issuedAt);
  if (!Number.isFinite(issuedAt) || Math.abs(now.getTime() - issuedAt) > NEARBY_KNOCK_LIFETIME_MS) {
    return { ok: false, reason: 'stale knock' };
  }
  const verification = await verifySignedP2PEnvelopeProof({
    proof: knock.proof,
    payload: signingPayload(knock as NearbyKnock),
    now,
    maxSkewMs: NEARBY_KNOCK_LIFETIME_MS,
  });
  return verification.ok ? { ok: true, knock: knock as NearbyKnock } : verification;
}
