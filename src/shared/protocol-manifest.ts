import { canonicalSerialize } from './cid';
import { portableEcdsaSign, portableEcdsaVerify } from './portable-ecdsa';
import { portableSha256Hex } from './portable-sha256';

export const PROTOCOL_MANIFEST_KIND = 'iinpublic-protocol-manifest' as const;
export const PROTOCOL_MANIFEST_FORMAT_VERSION = 1 as const;
export const PROTOCOL_MANIFEST_SIGNATURE_ALGORITHM = 'p256-sha256' as const;
export const PROTOCOL_MANIFEST_SIGNING_DOMAIN = 'iinpublic:protocol-manifest:v1:';
export const PROTOCOL_MANIFEST_HASH_DOMAIN = 'iinpublic:protocol-manifest-hash:v1:';
export const MAX_PROTOCOL_MANIFEST_BYTES = 64 * 1024;
export const MAX_PROTOCOL_MANIFEST_CHAIN_LENGTH = 128;

type JsonPrimitive = string | number | boolean;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ProtocolReleaseKey = {
  keyId: string;
  algorithm: typeof PROTOCOL_MANIFEST_SIGNATURE_ALGORITHM;
  publicKey: string;
};

export type ProtocolRecoveryPolicy = {
  threshold: number;
  keys: ProtocolReleaseKey[];
};

export type ProtocolManifestBody = {
  kind: typeof PROTOCOL_MANIFEST_KIND;
  formatVersion: typeof PROTOCOL_MANIFEST_FORMAT_VERSION;
  networkId: string;
  sequence: number;
  previousManifestHash: string;
  protocolEpoch: number;
  effectiveAt: string;
  minimumManifestEngine: number;
  minimumRoomProtocol: number;
  chatroomCapacity: number;
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  legacyEpochAllowedUntil?: string;
  retirementMode: 'none' | 'network-only';
  nextReleaseKeys: ProtocolReleaseKey[];
  recoveryPolicy: ProtocolRecoveryPolicy;
  signatureAlgorithm: typeof PROTOCOL_MANIFEST_SIGNATURE_ALGORITHM;
  extensions?: Record<string, JsonValue>;
  criticalExtensions?: string[];
};

export type SignedProtocolManifest = {
  body: ProtocolManifestBody;
  signerKeyId: string;
  signature: string;
  /**
   * Emergency authorization by the recovery policy from the previous checkpoint. Recovery
   * signatures never replace the ordinary signature silently: verification enters this path only
   * when the ordinary one-time next-release key is unavailable or unauthorized, and requires the
   * previously pinned threshold of distinct recovery keys.
   */
  recoverySignatures?: ProtocolManifestRecoverySignature[];
};

export type ProtocolManifestRecoverySignature = {
  signerKeyId: string;
  signature: string;
};

export type ProtocolManifestTrustState = {
  networkId: string;
  sequence: number;
  manifestHash: string;
  nextReleaseKeys: ProtocolReleaseKey[];
  recoveryPolicy: ProtocolRecoveryPolicy;
  latestManifest?: ProtocolManifestBody;
};

export type ProtocolManifestRuntimePolicy = {
  manifestEngineVersion: number;
  roomProtocolVersion: number;
  capabilities: readonly string[];
  supportedExtensions?: readonly string[];
  minimumChatroomCapacity: number;
  maximumChatroomCapacity: number;
};

export type ProtocolManifestCompatibility = {
  status: 'pending-activation' | 'compatible' | 'update-required' | 'retired';
  reasons: string[];
  activeChatroomCapacity?: number;
};

export type ProtocolManifestChainResult =
  | {
      ok: true;
      state: ProtocolManifestTrustState;
      accepted: Array<{ manifest: SignedProtocolManifest; manifestHash: string }>;
      compatibility?: ProtocolManifestCompatibility;
    }
  | {
      ok: false;
      reason: string;
      acceptedPrefix: Array<{ manifest: SignedProtocolManifest; manifestHash: string }>;
    };

type SeaSigningPair = {
  pub: string;
  priv: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSafeIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 20
    && value.length <= 40
    && Number.isFinite(Date.parse(value));
}

function isUniqueStringList(value: unknown, maximumItems: number): value is string[] {
  if (!Array.isArray(value) || value.length > maximumItems) return false;
  const normalized = value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 128);
  return normalized.length === value.length && new Set(normalized).size === normalized.length;
}

function hasOnlyJsonValues(value: unknown, depth = 0): value is JsonValue {
  if (depth > 16) return false;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 256 && value.every((item) => hasOnlyJsonValues(item, depth + 1));
  if (!isRecord(value) || Object.keys(value).length > 256) return false;
  return Object.entries(value).every(([key, item]) => key.length > 0 && key.length <= 128 && hasOnlyJsonValues(item, depth + 1));
}

function protocolReleaseKeyValidationError(value: unknown): string | null {
  if (!isRecord(value)) return 'release key must be an object';
  if (value.algorithm !== PROTOCOL_MANIFEST_SIGNATURE_ALGORITHM) return 'unsupported release-key algorithm';
  if (typeof value.publicKey !== 'string' || value.publicKey.length < 20 || value.publicKey.length > 256) {
    return 'invalid release public key';
  }
  if (value.keyId !== protocolReleaseKeyId(value.publicKey)) return 'release key id does not match its public key';
  return null;
}

function recoveryPolicyValidationError(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.keys)) return 'recovery policy must contain keys';
  if (value.keys.length < 1 || value.keys.length > 8) return 'recovery policy key count is out of bounds';
  if (!isSafeIntegerInRange(value.threshold, 1, value.keys.length)) return 'invalid recovery threshold';
  for (const key of value.keys) {
    const error = protocolReleaseKeyValidationError(key);
    if (error) return `invalid recovery key: ${error}`;
  }
  const ids = value.keys.map((key) => String((key as Record<string, unknown>).keyId));
  if (new Set(ids).size !== ids.length) return 'duplicate recovery key';
  return null;
}

export function protocolReleaseKeyId(publicKey: string): string {
  return portableSha256Hex(`iinpublic:protocol-release-key:v1:${String(publicKey || '').trim()}`);
}

export function createProtocolReleaseKey(publicKey: string): ProtocolReleaseKey {
  const normalized = String(publicKey || '').trim();
  return {
    keyId: protocolReleaseKeyId(normalized),
    algorithm: PROTOCOL_MANIFEST_SIGNATURE_ALGORITHM,
    publicKey: normalized,
  };
}

export function protocolManifestSigningPayload(body: ProtocolManifestBody): string {
  return `${PROTOCOL_MANIFEST_SIGNING_DOMAIN}${canonicalSerialize(body)}`;
}

export function protocolManifestHash(manifest: SignedProtocolManifest): string {
  return portableSha256Hex(`${PROTOCOL_MANIFEST_HASH_DOMAIN}${canonicalSerialize(manifest)}`);
}

export function validateProtocolManifestBody(body: unknown): body is ProtocolManifestBody {
  return protocolManifestBodyValidationError(body) === null;
}

export function isSignedProtocolManifest(value: unknown): value is SignedProtocolManifest {
  if (!isRecord(value)) return false;
  return protocolManifestBodyValidationError(value.body) === null
    && typeof value.signerKeyId === 'string'
    && isSha256Hex(value.signerKeyId)
    && typeof value.signature === 'string'
    && value.signature.length >= 64
    && value.signature.length <= 256
    && (value.recoverySignatures === undefined
      || (Array.isArray(value.recoverySignatures)
        && value.recoverySignatures.length <= 8
        && value.recoverySignatures.every((entry) => isRecord(entry)
          && typeof entry.signerKeyId === 'string'
          && isSha256Hex(entry.signerKeyId)
          && typeof entry.signature === 'string'
          && entry.signature.length >= 64
          && entry.signature.length <= 256)));
}

export function protocolManifestBodyValidationError(body: unknown): string | null {
  if (!isRecord(body)) return 'manifest body must be an object';
  if (body.kind !== PROTOCOL_MANIFEST_KIND) return 'wrong manifest kind';
  if (body.formatVersion !== PROTOCOL_MANIFEST_FORMAT_VERSION) return 'unsupported manifest format';
  if (typeof body.networkId !== 'string' || body.networkId.length < 1 || body.networkId.length > 128) return 'invalid network id';
  if (!isSafeIntegerInRange(body.sequence, 1, Number.MAX_SAFE_INTEGER)) return 'invalid manifest sequence';
  if (!isSha256Hex(body.previousManifestHash)) return 'invalid previous manifest hash';
  if (!isSafeIntegerInRange(body.protocolEpoch, 1, Number.MAX_SAFE_INTEGER)) return 'invalid protocol epoch';
  if (!isIsoTimestamp(body.effectiveAt)) return 'invalid effective time';
  if (!isSafeIntegerInRange(body.minimumManifestEngine, 1, Number.MAX_SAFE_INTEGER)) return 'invalid minimum manifest engine';
  if (!isSafeIntegerInRange(body.minimumRoomProtocol, 1, Number.MAX_SAFE_INTEGER)) return 'invalid minimum room protocol';
  if (!isSafeIntegerInRange(body.chatroomCapacity, 1, 1_000_000)) return 'invalid chatroom capacity';
  if (!isUniqueStringList(body.requiredCapabilities, 64)) return 'invalid required capabilities';
  if (!isUniqueStringList(body.optionalCapabilities, 64)) return 'invalid optional capabilities';
  if (body.legacyEpochAllowedUntil !== undefined && !isIsoTimestamp(body.legacyEpochAllowedUntil)) return 'invalid legacy cutoff';
  if (body.retirementMode !== 'none' && body.retirementMode !== 'network-only') return 'invalid retirement mode';
  if (body.signatureAlgorithm !== PROTOCOL_MANIFEST_SIGNATURE_ALGORITHM) return 'unsupported manifest signature algorithm';
  if (!Array.isArray(body.nextReleaseKeys) || body.nextReleaseKeys.length < 1 || body.nextReleaseKeys.length > 4) {
    return 'next release key count is out of bounds';
  }
  for (const key of body.nextReleaseKeys) {
    const error = protocolReleaseKeyValidationError(key);
    if (error) return `invalid next release key: ${error}`;
  }
  if (new Set(body.nextReleaseKeys.map((key) => key.keyId)).size !== body.nextReleaseKeys.length) return 'duplicate next release key';
  const recoveryError = recoveryPolicyValidationError(body.recoveryPolicy);
  if (recoveryError) return recoveryError;
  if (body.extensions !== undefined && (!isRecord(body.extensions) || !hasOnlyJsonValues(body.extensions))) return 'invalid manifest extensions';
  if (body.criticalExtensions !== undefined && !isUniqueStringList(body.criticalExtensions, 64)) return 'invalid critical extensions';
  if ((body.criticalExtensions || []).some((name) => !Object.prototype.hasOwnProperty.call(body.extensions || {}, name))) {
    return 'critical extension is missing from extensions';
  }
  if (canonicalSerialize(body).length > MAX_PROTOCOL_MANIFEST_BYTES) return 'manifest is too large';
  return null;
}

export async function signProtocolManifest(
  body: ProtocolManifestBody,
  signer: SeaSigningPair,
): Promise<SignedProtocolManifest> {
  const validationError = protocolManifestBodyValidationError(body);
  if (validationError) throw new Error(validationError);
  const signerKeyId = protocolReleaseKeyId(signer.pub);
  const signature = await portableEcdsaSign(protocolManifestSigningPayload(body), signer.priv);
  return { body, signerKeyId, signature };
}

/**
 * Produce a threshold-recovery manifest. The first recovery signature remains in the legacy
 * signer fields so older parsers fail closed on an unauthorized signer instead of accepting an
 * unsigned extension; every signature is also carried in the explicit threshold list.
 */
export async function signProtocolManifestWithRecovery(
  body: ProtocolManifestBody,
  signers: readonly SeaSigningPair[],
): Promise<SignedProtocolManifest> {
  const validationError = protocolManifestBodyValidationError(body);
  if (validationError) throw new Error(validationError);
  if (signers.length < 1 || signers.length > 8) throw new Error('recovery signer count is out of bounds');
  const payload = protocolManifestSigningPayload(body);
  const recoverySignatures = await Promise.all(signers.map(async (signer) => ({
    signerKeyId: protocolReleaseKeyId(signer.pub),
    signature: await portableEcdsaSign(payload, signer.priv),
  })));
  if (new Set(recoverySignatures.map((entry) => entry.signerKeyId)).size !== recoverySignatures.length) {
    throw new Error('duplicate recovery signer');
  }
  return {
    body,
    signerKeyId: recoverySignatures[0]!.signerKeyId,
    signature: recoverySignatures[0]!.signature,
    recoverySignatures,
  };
}

export function evaluateProtocolManifestCompatibility(
  body: ProtocolManifestBody,
  policy: ProtocolManifestRuntimePolicy,
  now: Date = new Date(),
): ProtocolManifestCompatibility {
  const reasons: string[] = [];
  if (body.minimumManifestEngine > policy.manifestEngineVersion) reasons.push('manifest engine update required');
  if (body.minimumRoomProtocol > policy.roomProtocolVersion) reasons.push('room protocol update required');
  const supportedCapabilities = new Set(policy.capabilities);
  const missingCapabilities = body.requiredCapabilities.filter((capability) => !supportedCapabilities.has(capability));
  if (missingCapabilities.length > 0) reasons.push(`missing required capabilities: ${missingCapabilities.join(', ')}`);
  if (body.chatroomCapacity < policy.minimumChatroomCapacity || body.chatroomCapacity > policy.maximumChatroomCapacity) {
    reasons.push('chatroom capacity is outside local safety bounds');
  }
  const supportedExtensions = new Set(policy.supportedExtensions || []);
  const unsupportedCritical = (body.criticalExtensions || []).filter((name) => !supportedExtensions.has(name));
  if (unsupportedCritical.length > 0) reasons.push(`unsupported critical extensions: ${unsupportedCritical.join(', ')}`);

  const effectiveAt = Date.parse(body.effectiveAt);
  if (now.getTime() < effectiveAt) {
    return { status: 'pending-activation', reasons };
  }
  if (reasons.length > 0) {
    const cutoff = body.legacyEpochAllowedUntil ? Date.parse(body.legacyEpochAllowedUntil) : Number.POSITIVE_INFINITY;
    const retired = body.retirementMode === 'network-only' && now.getTime() >= cutoff;
    return { status: retired ? 'retired' : 'update-required', reasons };
  }
  return { status: 'compatible', reasons, activeChatroomCapacity: body.chatroomCapacity };
}

export async function verifyProtocolManifestChain(params: {
  state: ProtocolManifestTrustState;
  manifests: readonly SignedProtocolManifest[];
  runtimePolicy?: ProtocolManifestRuntimePolicy;
  now?: Date;
}): Promise<ProtocolManifestChainResult> {
  if (params.manifests.length > MAX_PROTOCOL_MANIFEST_CHAIN_LENGTH) {
    return { ok: false, reason: 'manifest chain is too long', acceptedPrefix: [] };
  }

  let state = cloneProtocolManifestTrustState(params.state);
  const accepted: Array<{ manifest: SignedProtocolManifest; manifestHash: string }> = [];
  for (const manifest of params.manifests) {
    const manifestHash = protocolManifestHash(manifest);
    if (manifest.body.sequence < state.sequence) {
      return { ok: false, reason: 'manifest rollback attempted', acceptedPrefix: accepted };
    }
    if (manifest.body.sequence === state.sequence) {
      if (manifestHash !== state.manifestHash) {
        return { ok: false, reason: 'same-sequence manifest fork detected', acceptedPrefix: accepted };
      }
      continue;
    }

    const validationError = protocolManifestBodyValidationError(manifest.body);
    if (validationError) return { ok: false, reason: validationError, acceptedPrefix: accepted };
    if (manifest.body.networkId !== state.networkId) return { ok: false, reason: 'manifest network mismatch', acceptedPrefix: accepted };
    if (manifest.body.sequence !== state.sequence + 1) return { ok: false, reason: 'manifest sequence gap', acceptedPrefix: accepted };
    if (manifest.body.previousManifestHash !== state.manifestHash) return { ok: false, reason: 'previous manifest hash mismatch', acceptedPrefix: accepted };

    const signingPayload = protocolManifestSigningPayload(manifest.body);
    const signer = state.nextReleaseKeys.find((key) => key.keyId === manifest.signerKeyId);
    const ordinarySignatureValid = !!signer
      && signer.algorithm === PROTOCOL_MANIFEST_SIGNATURE_ALGORITHM
      && await portableEcdsaVerify(manifest.signature, signingPayload, signer.publicKey);
    const recoveryPolicyChanges = canonicalSerialize(manifest.body.recoveryPolicy)
      !== canonicalSerialize(state.recoveryPolicy);
    if (!ordinarySignatureValid || recoveryPolicyChanges) {
      const recovery = await verifyRecoveryAuthorization(manifest, state.recoveryPolicy, signingPayload);
      if (!recovery.ok) {
        const reason = recoveryPolicyChanges && ordinarySignatureValid
          ? 'recovery policy rotation requires the previous recovery threshold'
          : signer && !manifest.recoverySignatures?.length
          ? 'invalid manifest signature'
          : recovery.reason;
        return { ok: false, reason, acceptedPrefix: accepted };
      }
    }

    state = {
      networkId: state.networkId,
      sequence: manifest.body.sequence,
      manifestHash,
      nextReleaseKeys: manifest.body.nextReleaseKeys.map((key) => ({ ...key })),
      recoveryPolicy: cloneRecoveryPolicy(manifest.body.recoveryPolicy),
      latestManifest: cloneProtocolManifestBody(manifest.body),
    };
    accepted.push({ manifest, manifestHash });
  }

  const compatibility = state.latestManifest && params.runtimePolicy
    ? evaluateProtocolManifestCompatibility(state.latestManifest, params.runtimePolicy, params.now)
    : undefined;
  return {
    ok: true,
    state,
    accepted,
    ...(compatibility ? { compatibility } : {}),
  };
}

async function verifyRecoveryAuthorization(
  manifest: SignedProtocolManifest,
  policy: ProtocolRecoveryPolicy,
  signingPayload: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const signatures = manifest.recoverySignatures;
  if (!signatures?.length) {
    return { ok: false, reason: 'manifest signer is not authorized by the previous checkpoint' };
  }
  const unique = new Map(signatures.map((entry) => [entry.signerKeyId, entry]));
  if (unique.size !== signatures.length) return { ok: false, reason: 'duplicate recovery signature' };
  let valid = 0;
  for (const [keyId, entry] of unique) {
    const key = policy.keys.find((candidate) => candidate.keyId === keyId);
    if (!key) continue;
    if (await portableEcdsaVerify(entry.signature, signingPayload, key.publicKey)) valid += 1;
  }
  return valid >= policy.threshold
    ? { ok: true }
    : { ok: false, reason: 'recovery signature threshold not met' };
}

export function serializeProtocolManifestTrustState(state: ProtocolManifestTrustState): string {
  return canonicalSerialize(cloneProtocolManifestTrustState(state));
}

export function parseProtocolManifestTrustState(serialized: string): ProtocolManifestTrustState | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)) return null;
    if (typeof value.networkId !== 'string' || value.networkId.length < 1 || value.networkId.length > 128) return null;
    if (!isSafeIntegerInRange(value.sequence, 1, Number.MAX_SAFE_INTEGER)) return null;
    if (!isSha256Hex(value.manifestHash)) return null;
    if (!Array.isArray(value.nextReleaseKeys) || value.nextReleaseKeys.length < 1 || value.nextReleaseKeys.length > 4) return null;
    for (const key of value.nextReleaseKeys) if (protocolReleaseKeyValidationError(key)) return null;
    if (recoveryPolicyValidationError(value.recoveryPolicy)) return null;
    if (value.latestManifest !== undefined && protocolManifestBodyValidationError(value.latestManifest)) return null;
    const parsed: ProtocolManifestTrustState = {
      networkId: value.networkId,
      sequence: value.sequence,
      manifestHash: value.manifestHash,
      nextReleaseKeys: value.nextReleaseKeys as ProtocolReleaseKey[],
      recoveryPolicy: value.recoveryPolicy as ProtocolRecoveryPolicy,
      ...(value.latestManifest ? { latestManifest: value.latestManifest as ProtocolManifestBody } : {}),
    };
    return cloneProtocolManifestTrustState(parsed);
  } catch {
    return null;
  }
}

function cloneRecoveryPolicy(policy: ProtocolRecoveryPolicy): ProtocolRecoveryPolicy {
  return { threshold: policy.threshold, keys: policy.keys.map((key) => ({ ...key })) };
}

function cloneProtocolManifestBody(body: ProtocolManifestBody): ProtocolManifestBody {
  return JSON.parse(JSON.stringify(body)) as ProtocolManifestBody;
}

function cloneProtocolManifestTrustState(state: ProtocolManifestTrustState): ProtocolManifestTrustState {
  return {
    networkId: state.networkId,
    sequence: state.sequence,
    manifestHash: state.manifestHash,
    nextReleaseKeys: state.nextReleaseKeys.map((key) => ({ ...key })),
    recoveryPolicy: cloneRecoveryPolicy(state.recoveryPolicy),
    ...(state.latestManifest ? { latestManifest: cloneProtocolManifestBody(state.latestManifest) } : {}),
  };
}
