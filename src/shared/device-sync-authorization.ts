import { canonicalSerialize } from './p2p-runtime';
import { DEVICE_SYNC_CATEGORIES, type DeviceSyncCategory, type DeviceSyncCrypto } from './device-sync-contract';

export const DEVICE_SYNC_AUTHORIZATION_VERSION = 1 as const;
export type DeviceSyncAuthorizationMode = 'migration' | 'continuous';

export interface UnsignedDeviceSyncAuthorization {
  schemaVersion: typeof DEVICE_SYNC_AUTHORIZATION_VERSION;
  kind: 'iinpublic-authorize-device-sync';
  authorizationId: string;
  mode: DeviceSyncAuthorizationMode;
  devicePubs: [string, string];
  issuerDevicePub: string;
  selectedCategories: DeviceSyncCategory[];
  issuedAt: string;
  expiresAt?: string;
  sequence: number;
}

export interface DeviceSyncAuthorization extends UnsignedDeviceSyncAuthorization {
  signature: string;
}

export interface UnsignedDeviceSyncRevocation {
  schemaVersion: typeof DEVICE_SYNC_AUTHORIZATION_VERSION;
  kind: 'iinpublic-revoke-device-sync';
  authorizationId: string;
  devicePubs: [string, string];
  issuerDevicePub: string;
  revokedAt: string;
  sequence: number;
}

export interface DeviceSyncRevocation extends UnsignedDeviceSyncRevocation {
  signature: string;
}

export type DeviceSyncAuthorizationResult =
  | { ok: true; authorizationId: string; mode: DeviceSyncAuthorizationMode; selectedCategories: DeviceSyncCategory[] }
  | { ok: false; reason: string };

export async function buildDeviceSyncAuthorization(input: {
  authorizationId: string;
  mode: DeviceSyncAuthorizationMode;
  selfDevicePub: string;
  peerDevicePub: string;
  selectedCategories: readonly DeviceSyncCategory[];
  crypto: DeviceSyncCrypto;
  issuedAt?: string;
  expiresAt?: string;
  sequence?: number;
}): Promise<DeviceSyncAuthorization> {
  const devicePubs = normalizeDevicePubs(input.selfDevicePub, input.peerDevicePub);
  const selectedCategories = normalizeCategories(input.selectedCategories);
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  assertTimestamp(issuedAt, 'authorization issuedAt');
  if (input.expiresAt) {
    assertTimestamp(input.expiresAt, 'authorization expiresAt');
    if (Date.parse(input.expiresAt) <= Date.parse(issuedAt)) throw new Error('authorization expiry must follow issuance');
  }
  if (!input.authorizationId || input.authorizationId.length < 8 || input.authorizationId.length > 256) {
    throw new Error('authorization id must contain 8-256 characters');
  }
  const unsigned: UnsignedDeviceSyncAuthorization = {
    schemaVersion: DEVICE_SYNC_AUTHORIZATION_VERSION,
    kind: 'iinpublic-authorize-device-sync',
    authorizationId: input.authorizationId,
    mode: input.mode,
    devicePubs,
    issuerDevicePub: input.selfDevicePub,
    selectedCategories,
    issuedAt,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    sequence: input.sequence ?? 1,
  };
  assertSequence(unsigned.sequence);
  const signature = await input.crypto.sign(await authorizationSigningPayload(unsigned, input.crypto.hash));
  if (!signature) throw new Error('authorization signer returned an empty signature');
  return { ...unsigned, signature };
}

export async function buildDeviceSyncRevocation(input: {
  authorization: DeviceSyncAuthorization;
  issuerDevicePub: string;
  crypto: DeviceSyncCrypto;
  revokedAt?: string;
  sequence?: number;
}): Promise<DeviceSyncRevocation> {
  if (!input.authorization.devicePubs.includes(input.issuerDevicePub)) throw new Error('revocation issuer is not an authorized device');
  const unsigned: UnsignedDeviceSyncRevocation = {
    schemaVersion: DEVICE_SYNC_AUTHORIZATION_VERSION,
    kind: 'iinpublic-revoke-device-sync',
    authorizationId: input.authorization.authorizationId,
    devicePubs: input.authorization.devicePubs,
    issuerDevicePub: input.issuerDevicePub,
    revokedAt: input.revokedAt ?? new Date().toISOString(),
    sequence: input.sequence ?? input.authorization.sequence + 1,
  };
  assertTimestamp(unsigned.revokedAt, 'revocation revokedAt');
  assertSequence(unsigned.sequence);
  const signature = await input.crypto.sign(await revocationSigningPayload(unsigned, input.crypto.hash));
  if (!signature) throw new Error('revocation signer returned an empty signature');
  return { ...unsigned, signature };
}

export async function verifyMutualDeviceSyncAuthorization(input: {
  authorizations: readonly [DeviceSyncAuthorization, DeviceSyncAuthorization];
  revocations?: readonly DeviceSyncRevocation[];
  sourceDevicePub: string;
  targetDevicePub: string;
  selectedCategories: readonly DeviceSyncCategory[];
  crypto: Pick<DeviceSyncCrypto, 'hash' | 'verify'>;
  now?: Date;
}): Promise<DeviceSyncAuthorizationResult> {
  const [first, second] = input.authorizations;
  if (
    !first || !second
    || first.schemaVersion !== DEVICE_SYNC_AUTHORIZATION_VERSION
    || second.schemaVersion !== DEVICE_SYNC_AUTHORIZATION_VERSION
    || first.kind !== 'iinpublic-authorize-device-sync'
    || second.kind !== 'iinpublic-authorize-device-sync'
  ) {
    return { ok: false, reason: 'unsupported or malformed sync authorization' };
  }
  let expectedDevices: [string, string];
  let expectedCategories: DeviceSyncCategory[];
  try {
    expectedDevices = normalizeDevicePubs(input.sourceDevicePub, input.targetDevicePub);
    expectedCategories = normalizeCategories(input.selectedCategories);
    for (const authorization of [first, second]) {
      if (!authorization.authorizationId || authorization.authorizationId.length < 8 || authorization.authorizationId.length > 256) throw new Error('bad id');
      if (authorization.mode !== 'migration' && authorization.mode !== 'continuous') throw new Error('bad mode');
      assertTimestamp(authorization.issuedAt, 'authorization issuedAt');
      assertSequence(authorization.sequence);
      normalizeCategories(authorization.selectedCategories);
    }
  } catch {
    return { ok: false, reason: 'malformed sync authorization fields' };
  }
  if (canonicalSerialize(first.devicePubs) !== canonicalSerialize(expectedDevices) || canonicalSerialize(second.devicePubs) !== canonicalSerialize(expectedDevices)) {
    return { ok: false, reason: 'authorization device binding mismatch' };
  }
  if (first.authorizationId !== second.authorizationId || first.mode !== second.mode) return { ok: false, reason: 'authorization peers did not approve the same scope' };
  if (new Set([first.issuerDevicePub, second.issuerDevicePub]).size !== 2 || !expectedDevices.includes(first.issuerDevicePub) || !expectedDevices.includes(second.issuerDevicePub)) {
    return { ok: false, reason: 'authorization requires one signature from each device' };
  }
  if (
    canonicalSerialize(first.selectedCategories) !== canonicalSerialize(expectedCategories)
    || canonicalSerialize(second.selectedCategories) !== canonicalSerialize(expectedCategories)
  ) return { ok: false, reason: 'authorization category scope mismatch' };
  const now = input.now ?? new Date();
  for (const authorization of [first, second]) {
    if (authorization.expiresAt && Date.parse(authorization.expiresAt) <= now.getTime()) return { ok: false, reason: 'sync authorization expired' };
    const { signature, ...unsigned } = authorization;
    if (!await input.crypto.verify(
      await authorizationSigningPayload(unsigned, input.crypto.hash),
      signature,
      authorization.issuerDevicePub,
    )) return { ok: false, reason: 'invalid sync authorization signature' };
  }
  for (const revocation of input.revocations ?? []) {
    if (revocation.authorizationId !== first.authorizationId) continue;
    try {
      if (revocation.schemaVersion !== DEVICE_SYNC_AUTHORIZATION_VERSION || revocation.kind !== 'iinpublic-revoke-device-sync') throw new Error('bad schema');
      assertTimestamp(revocation.revokedAt, 'revocation revokedAt');
      assertSequence(revocation.sequence);
    } catch {
      return { ok: false, reason: 'malformed sync revocation fields' };
    }
    if (!expectedDevices.includes(revocation.issuerDevicePub) || canonicalSerialize(revocation.devicePubs) !== canonicalSerialize(expectedDevices)) {
      return { ok: false, reason: 'invalid sync revocation binding' };
    }
    const { signature, ...unsigned } = revocation;
    const signatureOk = await input.crypto.verify(
      await revocationSigningPayload(unsigned, input.crypto.hash),
      signature,
      revocation.issuerDevicePub,
    );
    if (!signatureOk) return { ok: false, reason: 'invalid sync revocation signature' };
    if (revocation.sequence > Math.min(first.sequence, second.sequence)) return { ok: false, reason: 'sync authorization revoked' };
  }
  return { ok: true, authorizationId: first.authorizationId, mode: first.mode, selectedCategories: expectedCategories };
}

async function authorizationSigningPayload(
  authorization: UnsignedDeviceSyncAuthorization,
  hash: DeviceSyncCrypto['hash'],
): Promise<string> {
  return `iinpublic-authorize-device-sync|${await hash(canonicalSerialize(authorization))}`;
}

async function revocationSigningPayload(
  revocation: UnsignedDeviceSyncRevocation,
  hash: DeviceSyncCrypto['hash'],
): Promise<string> {
  return `iinpublic-revoke-device-sync|${await hash(canonicalSerialize(revocation))}`;
}

function normalizeDevicePubs(a: string, b: string): [string, string] {
  if (!a || !b || a === b) throw new Error('sync authorization requires two different devices');
  return [a, b].sort() as [string, string];
}

function normalizeCategories(categories: readonly DeviceSyncCategory[]): DeviceSyncCategory[] {
  if (!categories.length) throw new Error('sync authorization requires at least one category');
  const unique = [...new Set(categories)].sort();
  if (unique.length !== categories.length) throw new Error('sync authorization categories must be unique');
  if (unique.some((category) => !DEVICE_SYNC_CATEGORIES.includes(category))) throw new Error('sync authorization contains a device-local or unknown category');
  return unique;
}

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a timestamp`);
}

function assertSequence(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('sync authorization sequence must be a positive integer');
}
