import {
  createSignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
} from './p2p-runtime';

export type SyncScope = 'accepted-talk' | 'pair-response';
export type GunSyncGrant = {
  version: 1;
  grantId: string;
  scope: SyncScope;
  issuerSeaPub: string;
  recipientSeaPub: string;
  soulPrefix: string;
  issuedAt: string;
  expiresAt: string;
  proof: SignedP2PEnvelopeProof;
};
export type GunSyncDelta = {
  version: 1;
  grantId: string;
  soul: string;
  objectId: string;
  valueJson: string;
  head: string;
  previousHead?: string;
  authorSeaPub: string;
  proof: SignedP2PEnvelopeProof;
};
export type GunDeltaStore = { put: (key: string, value: unknown) => Promise<void>; get: (key: string) => Promise<unknown> };

export function isGunSyncDeltaShape(value: unknown): value is GunSyncDelta {
  if (!value || typeof value !== 'object') return false;
  const delta = value as Partial<GunSyncDelta>;
  return delta.version === 1
    && typeof delta.grantId === 'string' && delta.grantId.length > 0 && delta.grantId.length <= 256
    && typeof delta.soul === 'string' && delta.soul.length > 0 && delta.soul.length <= 4096
    && typeof delta.objectId === 'string' && delta.objectId.length <= 256
    && typeof delta.valueJson === 'string' && delta.valueJson.length <= 2 * 1024 * 1024
    && typeof delta.head === 'string' && delta.head.length <= 256
    && typeof delta.authorSeaPub === 'string'
    && !!delta.proof && typeof delta.proof === 'object' && typeof delta.proof.pub === 'string';
}

function grantPayload(value: Omit<GunSyncGrant, 'proof'>): unknown {
  return { type: 'iinpublic-gun-sync-grant', ...value };
}
function deltaPayload(value: Omit<GunSyncDelta, 'proof'>): unknown {
  return { type: 'iinpublic-gun-sync-delta', ...value };
}

export async function issueGunSyncGrant(input: {
  pair: SeaSigningPair; grantId: string; scope: SyncScope; recipientSeaPub: string;
  soulPrefix: string; now?: Date; lifetimeMs?: number;
}): Promise<GunSyncGrant> {
  const now = input.now ?? new Date();
  const unsigned = {
    version: 1 as const, grantId: input.grantId, scope: input.scope, issuerSeaPub: input.pair.pub,
    recipientSeaPub: input.recipientSeaPub, soulPrefix: normalizeSoul(input.soulPrefix),
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + (input.lifetimeMs ?? 5 * 60_000)).toISOString(),
  };
  if (!unsigned.grantId || !unsigned.recipientSeaPub || !unsigned.soulPrefix) throw new Error('invalid sync grant');
  return { ...unsigned, proof: await createSignedP2PEnvelopeProof({ pair: input.pair, payload: grantPayload(unsigned), timestamp: unsigned.issuedAt }) };
}

export async function issueGunSyncDelta(input: {
  pair: SeaSigningPair; grantId: string; soul: string; objectId: string; value: unknown;
  head: string; previousHead?: string;
}): Promise<GunSyncDelta> {
  const unsigned: Omit<GunSyncDelta, 'proof'> = {
    version: 1, grantId: input.grantId, soul: normalizeSoul(input.soul), objectId: input.objectId,
    valueJson: JSON.stringify(input.value), head: input.head, authorSeaPub: input.pair.pub,
    ...(input.previousHead ? { previousHead: input.previousHead } : {}),
  };
  return { ...unsigned, proof: await createSignedP2PEnvelopeProof({ pair: input.pair, payload: deltaPayload(unsigned) }) };
}

export class SelectiveGunSyncReceiver {
  constructor(private readonly localSeaPub: string, private readonly store: GunDeltaStore) {}

  async apply(grant: GunSyncGrant, delta: GunSyncDelta, now = new Date()): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!isGunSyncDeltaShape(delta)) return { ok: false, reason: 'malformed delta' };
    const grantCheck = await verifyGrant(grant, this.localSeaPub, now);
    if (!grantCheck.ok) return grantCheck;
    if (delta.grantId !== grant.grantId) return { ok: false, reason: 'grant mismatch' };
    if (delta.authorSeaPub !== grant.issuerSeaPub || delta.proof.pub !== grant.issuerSeaPub) return { ok: false, reason: 'delta author mismatch' };
    if (!isWithinSoulPrefix(delta.soul, grant.soulPrefix)) return { ok: false, reason: 'soul outside authorization' };
    if (isUserPrivateSoul(delta.soul)) return { ok: false, reason: 'user-private soul cannot be peer-synchronized' };
    const { proof, ...unsigned } = delta;
    const verified = await verifySignedP2PEnvelopeProof({ proof, payload: deltaPayload(unsigned), now });
    if (!verified.ok) return verified;
    const checkpointKey = checkpointSoul(grant.issuerSeaPub, grant.soulPrefix);
    const checkpoint = await this.store.get(checkpointKey) as { head?: string } | null;
    if (delta.previousHead && checkpoint?.head && delta.previousHead !== checkpoint.head) return { ok: false, reason: 'checkpoint gap' };
    let value: unknown;
    try { value = JSON.parse(delta.valueJson); } catch { return { ok: false, reason: 'invalid delta JSON' }; }
    await this.store.put(delta.soul, value);
    await this.store.put(checkpointKey, { version: 1, head: delta.head, objectId: delta.objectId, updatedAt: now.toISOString() });
    return { ok: true };
  }
}

export async function verifyGrant(grant: GunSyncGrant, localSeaPub: string, now = new Date()): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (grant.version !== 1 || grant.recipientSeaPub !== localSeaPub) return { ok: false, reason: 'grant recipient mismatch' };
  if (grant.proof.pub !== grant.issuerSeaPub) return { ok: false, reason: 'grant issuer mismatch' };
  if (Date.parse(grant.expiresAt) <= now.getTime()) return { ok: false, reason: 'expired grant' };
  const { proof, ...unsigned } = grant;
  return verifySignedP2PEnvelopeProof({ proof, payload: grantPayload(unsigned), now, maxSkewMs: 10 * 60_000 });
}

export type VersionedGraphValue = { version: number; changedAt: string; retractedAt?: string };
export function convergeVersionedValue<T extends VersionedGraphValue>(a: T, b: T): T {
  if (!!a.retractedAt !== !!b.retractedAt) return (a.retractedAt ? a : b);
  if (a.version !== b.version) return a.version > b.version ? a : b;
  return a.changedAt >= b.changedAt ? a : b;
}

function normalizeSoul(value: string): string { return String(value || '').replace(/^\/+|\/+$/g, ''); }
function isWithinSoulPrefix(soul: string, prefix: string): boolean { return soul === prefix || soul.startsWith(`${prefix}/`); }
function isUserPrivateSoul(soul: string): boolean {
  return /\/(?:meQa|chatbotMemory|talkFilters|blockedPeers|reputationInputs)(?:\/|$)/.test(soul);
}
function checkpointSoul(sourceSeaPub: string, prefix: string): string {
  return `syncCheckpoints/${encodeURIComponent(sourceSeaPub)}/${encodeURIComponent(prefix)}`;
}
