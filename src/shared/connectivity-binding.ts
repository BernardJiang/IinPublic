import {
  createSignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
  type P2PReplayNonceCache,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
} from './p2p-runtime';
import type { ConnectivityAddress } from './peer-discovery-provider';

export type ConnectivityKind = 'libp2p-peer' | 'webrtc-peer' | 'wifi-aware' | 'wifi-direct' | 'ble' | 'nearby';

export type ConnectivityBinding = {
  version: 1;
  seaPub: string;
  connectivityKind: ConnectivityKind;
  connectivityId: string;
  addresses: readonly ConnectivityAddress[];
  capabilities: readonly string[];
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  proof: SignedP2PEnvelopeProof;
};

export type UnsignedConnectivityBinding = Omit<ConnectivityBinding, 'proof'>;
export type ConnectivityControlVerifier = (
  kind: ConnectivityKind,
  connectivityId: string,
) => boolean | Promise<boolean>;

export function connectivityBindingSigningPayload(binding: UnsignedConnectivityBinding): unknown {
  return { type: 'iinpublic-connectivity-binding', ...binding };
}

export async function issueConnectivityBinding(input: {
  pair: SeaSigningPair;
  connectivityKind: ConnectivityKind;
  connectivityId: string;
  addresses?: readonly ConnectivityAddress[];
  capabilities?: readonly string[];
  sequence: number;
  issuedAt?: Date;
  lifetimeMs?: number;
}): Promise<ConnectivityBinding> {
  const issuedAt = input.issuedAt ?? new Date();
  const seaPub = String(input.pair.pub || '').trim();
  const connectivityId = String(input.connectivityId || '').trim();
  if (!seaPub || !connectivityId) throw new Error('seaPub and connectivityId are required');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) throw new Error('sequence must be a positive integer');
  const lifetimeMs = input.lifetimeMs ?? 5 * 60_000;
  if (lifetimeMs <= 0 || lifetimeMs > 24 * 60 * 60_000) throw new Error('binding lifetime is out of bounds');
  const unsigned: UnsignedConnectivityBinding = {
    version: 1,
    seaPub,
    connectivityKind: input.connectivityKind,
    connectivityId,
    addresses: input.addresses ?? [],
    capabilities: input.capabilities ?? [],
    sequence: input.sequence,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + lifetimeMs).toISOString(),
  };
  const proof = await createSignedP2PEnvelopeProof({ pair: input.pair, payload: connectivityBindingSigningPayload(unsigned), timestamp: unsigned.issuedAt });
  return { ...unsigned, proof };
}

export class ConnectivityBindingVerifier {
  private readonly highestSequence = new Map<string, number>();

  constructor(
    private readonly verifyControl: ConnectivityControlVerifier,
    private readonly nonceCache?: P2PReplayNonceCache,
  ) {}

  async verify(binding: ConnectivityBinding, now = new Date()): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (binding.version !== 1 || !binding.seaPub || !binding.connectivityId) return { ok: false, reason: 'missing binding fields' };
    if (binding.proof.pub !== binding.seaPub) return { ok: false, reason: 'SEA pub mismatch' };
    const issued = Date.parse(binding.issuedAt);
    const expires = Date.parse(binding.expiresAt);
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= now.getTime()) return { ok: false, reason: 'expired binding' };
    if (issued > now.getTime() + 30_000 || expires <= issued || expires - issued > 24 * 60 * 60_000) return { ok: false, reason: 'invalid binding lifetime' };
    if (!Number.isSafeInteger(binding.sequence) || binding.sequence < 1) return { ok: false, reason: 'invalid sequence' };
    const key = `${binding.seaPub}:${binding.connectivityKind}`;
    if (binding.sequence <= (this.highestSequence.get(key) ?? 0)) return { ok: false, reason: 'stale sequence' };
    const { proof, ...unsigned } = binding;
    const signature = await verifySignedP2PEnvelopeProof({
      proof,
      payload: connectivityBindingSigningPayload(unsigned),
      now,
      maxSkewMs: 24 * 60 * 60_000,
      ...(this.nonceCache ? { nonceCache: this.nonceCache } : {}),
    });
    if (!signature.ok) return signature;
    if (!await this.verifyControl(binding.connectivityKind, binding.connectivityId)) return { ok: false, reason: 'connectivity ID control failed' };
    this.highestSequence.set(key, binding.sequence);
    return { ok: true };
  }

  revoke(seaPub: string, kind: ConnectivityKind, sequence: number): void {
    const key = `${seaPub}:${kind}`;
    this.highestSequence.set(key, Math.max(sequence, this.highestSequence.get(key) ?? 0));
  }
}

