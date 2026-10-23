import { portableSha256Hex } from './portable-sha256';
import {
  createSignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
} from './p2p-runtime';

export const FRIEND_MARK_COUNTS_KEY = 'reputation-friend-marks';

export type FriendMarkContent = {
  version: 1;
  kind: 'iinpublic-friend-mark';
  markerUserId: string;
  markerPub: string;
  targetUserId: string;
  targetPub: string;
  active: boolean;
  updatedAt: string;
};

export type SignedFriendMark = FriendMarkContent & { proof: SignedP2PEnvelopeProof };

export function friendMarkPairHash(markerPub: string, targetPub: string): string {
  return portableSha256Hex(`friend-mark-v1::${String(markerPub)}::${String(targetPub)}`);
}

export function friendMarkSigningPayload(mark: FriendMarkContent): unknown {
  return { type: 'iinpublic-friend-mark-v1', content: mark };
}

export async function createSignedFriendMark(input: {
  markerUserId: string;
  targetUserId: string;
  targetPub: string;
  active: boolean;
  pair: SeaSigningPair;
  updatedAt?: string;
}): Promise<SignedFriendMark> {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const content: FriendMarkContent = {
    version: 1,
    kind: 'iinpublic-friend-mark',
    markerUserId: String(input.markerUserId || '').trim(),
    markerPub: String(input.pair.pub || '').trim(),
    targetUserId: String(input.targetUserId || '').trim(),
    targetPub: String(input.targetPub || '').trim(),
    active: input.active === true,
    updatedAt,
  };
  if (!content.markerUserId || !content.markerPub || !content.targetUserId || !content.targetPub) {
    throw new Error('friend mark identities are required');
  }
  if (content.markerUserId === content.targetUserId || content.markerPub === content.targetPub) {
    throw new Error('an identity cannot mark itself as a friend');
  }
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: friendMarkSigningPayload(content),
    timestamp: updatedAt,
  });
  return { ...content, proof };
}

export async function verifySignedFriendMark(
  value: unknown,
  now = new Date(),
): Promise<{ ok: true; mark: SignedFriendMark } | { ok: false; reason: string }> {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'malformed friend mark' };
  const raw = value as Partial<SignedFriendMark>;
  if (raw.version !== 1 || raw.kind !== 'iinpublic-friend-mark'
    || typeof raw.markerUserId !== 'string' || !raw.markerUserId.trim()
    || typeof raw.markerPub !== 'string' || !raw.markerPub.trim()
    || typeof raw.targetUserId !== 'string' || !raw.targetUserId.trim()
    || typeof raw.targetPub !== 'string' || !raw.targetPub.trim()
    || typeof raw.active !== 'boolean'
    || typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))
    || !raw.proof || raw.proof.pub !== raw.markerPub || raw.proof.timestamp !== raw.updatedAt
    || raw.markerUserId === raw.targetUserId || raw.markerPub === raw.targetPub) {
    return { ok: false, reason: 'malformed friend mark' };
  }
  const mark = raw as SignedFriendMark;
  const verified = await verifySignedP2PEnvelopeProof({
    proof: mark.proof,
    payload: friendMarkSigningPayload({
      version: mark.version,
      kind: mark.kind,
      markerUserId: mark.markerUserId,
      markerPub: mark.markerPub,
      targetUserId: mark.targetUserId,
      targetPub: mark.targetPub,
      active: mark.active,
      updatedAt: mark.updatedAt,
    }),
    now,
    maxSkewMs: 5 * 60 * 1000,
  });
  return verified.ok ? { ok: true, mark } : { ok: false, reason: verified.reason };
}
