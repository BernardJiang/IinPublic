import { sha256Hex } from './merkle-checkpoint';
import { canonicalSerialize } from './p2p-runtime';

export const DEVICE_SYNC_MANIFEST_VERSION = 1 as const;
export const DEVICE_SYNC_ACK_VERSION = 1 as const;

export type DeviceSyncConvergence =
  | 'immutable-union'
  | 'mutable-versioned'
  | 'tombstoned'
  | 'device-local';

export interface DeviceSyncDataPolicy {
  category: string;
  convergence: DeviceSyncConvergence;
  transferable: boolean;
  description: string;
}

/**
 * Canonical WP5 data inventory. Entries marked device-local must never enter a
 * sync record or manifest, even when the user selects every transferable category.
 */
export const DEVICE_SYNC_DATA_INVENTORY = [
  { category: 'profileAndQa', convergence: 'mutable-versioned', transferable: true, description: 'Private profile fields and locally available Q&A records.' },
  { category: 'contacts', convergence: 'mutable-versioned', transferable: true, description: 'Known people and locally assigned relationship metadata.' },
  { category: 'blocks', convergence: 'tombstoned', transferable: true, description: 'Block state, including signed/local unblock tombstones when available.' },
  { category: 'talks', convergence: 'tombstoned', transferable: true, description: 'Talk records and retraction history preserved under the original author.' },
  { category: 'answerMemory', convergence: 'mutable-versioned', transferable: true, description: 'Private exact-answer memory and answer preferences.' },
  { category: 'conversations', convergence: 'mutable-versioned', transferable: true, description: 'Conversation metadata and participant state.' },
  { category: 'messages', convergence: 'immutable-union', transferable: true, description: 'Message events keyed by their stable original IDs.' },
  { category: 'attachments', convergence: 'immutable-union', transferable: true, description: 'Locally available encrypted attachment blocks and descriptors.' },
  { category: 'preferences', convergence: 'mutable-versioned', transferable: true, description: 'User preferences that are safe and meaningful across installations.' },
  { category: 'identityEvents', convergence: 'immutable-union', transferable: true, description: 'Signed link, unlink, and other identity history already held locally.' },
  { category: 'syncTombstones', convergence: 'tombstoned', transferable: true, description: 'Deletion/retraction markers required to prevent deleted data returning.' },
  { category: 'passwords', convergence: 'device-local', transferable: false, description: 'Passwords, password verifiers, password-derived keys, and password metadata.' },
  { category: 'identityPrivateKeys', convergence: 'device-local', transferable: false, description: 'SEA identity and device private key material.' },
  { category: 'custodySecrets', convergence: 'device-local', transferable: false, description: 'WebCrypto, Keychain, Keystore, and other local wrapping secrets.' },
  { category: 'osPermissions', convergence: 'device-local', transferable: false, description: 'Operating-system permission grants and prompts.' },
  { category: 'deviceLabels', convergence: 'device-local', transferable: false, description: 'Local device names and installation-specific display metadata.' },
  { category: 'connectivitySettings', convergence: 'device-local', transferable: false, description: 'Network, relay, and transport configuration.' },
  { category: 'cachesAndDiagnostics', convergence: 'device-local', transferable: false, description: 'Caches, neighbor hints, logs, and diagnostics.' },
] as const satisfies readonly DeviceSyncDataPolicy[];

export type DeviceSyncInventoryCategory = (typeof DEVICE_SYNC_DATA_INVENTORY)[number]['category'];
export type DeviceSyncCategory = Extract<(typeof DEVICE_SYNC_DATA_INVENTORY)[number], { transferable: true }>['category'];

export const DEVICE_SYNC_CATEGORIES = DEVICE_SYNC_DATA_INVENTORY
  .filter((entry): entry is Extract<(typeof DEVICE_SYNC_DATA_INVENTORY)[number], { transferable: true }> => entry.transferable)
  .map((entry) => entry.category);

export interface DeviceSyncEndpoint {
  /** Current v1 installations use their SEA pub here; WP6 may bind a distinct device key. */
  devicePub: string;
  deviceEpub: string;
  /** Identity under which records are locally held. This may differ after later controller work. */
  identityPub: string;
}

export interface DeviceSyncRecordSignature {
  signerPub: string;
  value: string;
}

export interface DeviceSyncProvenance {
  sourceDevicePub: string;
  importedAt?: string;
  previousCheckpointId?: string;
}

export interface DeviceSyncRecord {
  category: DeviceSyncCategory;
  recordId: string;
  originPub: string;
  authorPub: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  tombstone: boolean;
  payload: unknown;
  provenance?: DeviceSyncProvenance;
  /** Original record signature. Importers verify it but never replace it. */
  signature?: DeviceSyncRecordSignature;
}

export interface DeviceSyncManifestItem {
  category: DeviceSyncCategory;
  recordId: string;
  originPub: string;
  authorPub: string;
  version: number;
  updatedAt: string;
  tombstone: boolean;
  payloadHash: string;
  signed: boolean;
}

export interface DeviceSyncCategorySummary {
  category: DeviceSyncCategory;
  itemCount: number;
  contentHash: string;
}

export type DeviceSyncMode = 'snapshot' | 'delta';

export interface UnsignedDeviceSyncManifest {
  schemaVersion: typeof DEVICE_SYNC_MANIFEST_VERSION;
  kind: 'iinpublic-device-sync-manifest';
  authorizationId: string;
  mode: DeviceSyncMode;
  source: DeviceSyncEndpoint;
  target: DeviceSyncEndpoint;
  selectedCategories: DeviceSyncCategory[];
  createdAt: string;
  previousCheckpointId?: string;
  checkpointId: string;
  itemCount: number;
  itemsHash: string;
  categorySummaries: DeviceSyncCategorySummary[];
  items: DeviceSyncManifestItem[];
}

export interface DeviceSyncManifest extends UnsignedDeviceSyncManifest {
  signature: string;
}

export interface DeviceSyncBundle {
  manifest: DeviceSyncManifest;
  records: DeviceSyncRecord[];
}

export interface DeviceSyncCrypto {
  hash(value: string): Promise<string>;
  sign(value: string): Promise<string>;
  verify(value: string, signature: string, signerPub: string): Promise<boolean>;
}

export type DeviceSyncVerificationResult =
  | { ok: true }
  | { ok: false; reason: string; category?: DeviceSyncCategory; recordId?: string };

export async function buildDeviceSyncBundle(input: {
  source: DeviceSyncEndpoint;
  target: DeviceSyncEndpoint;
  authorizationId: string;
  mode: DeviceSyncMode;
  selectedCategories: readonly DeviceSyncCategory[];
  records: readonly DeviceSyncRecord[];
  crypto: DeviceSyncCrypto;
  createdAt?: string;
  previousCheckpointId?: string;
}): Promise<DeviceSyncBundle> {
  assertEndpoint(input.source, 'source');
  assertEndpoint(input.target, 'target');
  if (!input.authorizationId || input.authorizationId.length < 8 || input.authorizationId.length > 256) throw new Error('sync manifest requires a valid authorization id');
  if (input.source.devicePub === input.target.devicePub) throw new Error('sync source and target must be different devices');
  const selectedCategories = normalizeSelectedCategories(input.selectedCategories);
  if (input.mode === 'delta' && !input.previousCheckpointId) throw new Error('delta sync requires previousCheckpointId');

  const records = [...input.records];
  const seen = new Set<string>();
  for (const record of records) {
    assertSyncRecord(record);
    if (!selectedCategories.includes(record.category)) throw new Error(`record category is not selected: ${record.category}`);
    const key = recordKey(record);
    if (seen.has(key)) throw new Error(`duplicate sync record: ${key}`);
    seen.add(key);
  }
  records.sort(compareRecords);

  const items = await Promise.all(records.map(async (record): Promise<DeviceSyncManifestItem> => ({
    category: record.category,
    recordId: record.recordId,
    originPub: record.originPub,
    authorPub: record.authorPub,
    version: record.version,
    updatedAt: record.updatedAt,
    tombstone: record.tombstone,
    payloadHash: await input.crypto.hash(canonicalRecord(record)),
    signed: !!record.signature,
  })));
  const categorySummaries = await buildCategorySummaries(selectedCategories, items, input.crypto.hash);
  const itemsHash = await input.crypto.hash(canonicalSerialize(items));
  const createdAt = input.createdAt ?? new Date().toISOString();
  assertIsoTimestamp(createdAt, 'createdAt');

  const checkpointCore = {
    schemaVersion: DEVICE_SYNC_MANIFEST_VERSION,
    kind: 'iinpublic-device-sync-manifest' as const,
    authorizationId: input.authorizationId,
    mode: input.mode,
    source: input.source,
    target: input.target,
    selectedCategories,
    createdAt,
    ...(input.previousCheckpointId ? { previousCheckpointId: input.previousCheckpointId } : {}),
    itemCount: items.length,
    itemsHash,
    categorySummaries,
    items,
  };
  const checkpointId = `sync_${await input.crypto.hash(canonicalSerialize(checkpointCore))}`;
  const unsigned: UnsignedDeviceSyncManifest = { ...checkpointCore, checkpointId };
  const signature = await input.crypto.sign(deviceSyncManifestSigningPayload(unsigned));
  if (!signature) throw new Error('manifest signer returned an empty signature');
  return { manifest: { ...unsigned, signature }, records };
}

export function deviceSyncRecordSigningPayload(record: DeviceSyncRecord): string {
  const { signature: _signature, ...unsigned } = record;
  return canonicalSerialize(unsigned);
}

export function deviceSyncManifestSigningPayload(manifest: UnsignedDeviceSyncManifest): string {
  // SEA signatures have a practical payload-size ceiling. The checkpoint is a
  // SHA-256 commitment to the complete canonical manifest core, so signing this
  // compact domain-separated binding still authenticates every manifest field.
  return [
    'iinpublic-device-sync-manifest',
    manifest.schemaVersion,
    manifest.checkpointId,
    manifest.source.devicePub,
    manifest.target.devicePub,
  ].join('|');
}

export async function verifyDeviceSyncBundle(
  bundle: DeviceSyncBundle,
  crypto: Pick<DeviceSyncCrypto, 'hash' | 'verify'>,
  expected?: { sourceDevicePub?: string; targetDevicePub?: string },
): Promise<DeviceSyncVerificationResult> {
  const manifest = bundle?.manifest;
  if (!manifest || manifest.schemaVersion !== DEVICE_SYNC_MANIFEST_VERSION || manifest.kind !== 'iinpublic-device-sync-manifest') {
    return { ok: false, reason: 'unsupported or malformed sync manifest' };
  }
  if (!manifest.authorizationId || manifest.authorizationId.length < 8 || manifest.authorizationId.length > 256) {
    return { ok: false, reason: 'sync manifest authorization id is invalid' };
  }
  try {
    assertEndpoint(manifest.source, 'source');
    assertEndpoint(manifest.target, 'target');
    assertIsoTimestamp(manifest.createdAt, 'createdAt');
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  if (manifest.source.devicePub === manifest.target.devicePub) return { ok: false, reason: 'sync source and target must be different devices' };
  if (expected?.sourceDevicePub && manifest.source.devicePub !== expected.sourceDevicePub) return { ok: false, reason: 'unexpected source device' };
  if (expected?.targetDevicePub && manifest.target.devicePub !== expected.targetDevicePub) return { ok: false, reason: 'unexpected target device' };
  if (manifest.mode === 'delta' && !manifest.previousCheckpointId) return { ok: false, reason: 'delta sync requires previous checkpoint' };

  let selectedCategories: DeviceSyncCategory[];
  try {
    selectedCategories = normalizeSelectedCategories(manifest.selectedCategories);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  if (canonicalSerialize(selectedCategories) !== canonicalSerialize(manifest.selectedCategories)) {
    return { ok: false, reason: 'selected categories are not canonical' };
  }
  if (!Array.isArray(bundle.records) || manifest.itemCount !== bundle.records.length || manifest.items.length !== bundle.records.length) {
    return { ok: false, reason: 'manifest item count mismatch' };
  }

  const records = [...bundle.records].sort(compareRecords);
  const seen = new Set<string>();
  const rebuiltItems: DeviceSyncManifestItem[] = [];
  for (const record of records) {
    try {
      assertSyncRecord(record);
    } catch (error) {
      return { ok: false, reason: (error as Error).message, category: record?.category, recordId: record?.recordId };
    }
    if (!selectedCategories.includes(record.category)) return { ok: false, reason: 'record category is not selected', category: record.category, recordId: record.recordId };
    const key = recordKey(record);
    if (seen.has(key)) return { ok: false, reason: 'duplicate sync record', category: record.category, recordId: record.recordId };
    seen.add(key);
    const payloadHash = await crypto.hash(canonicalRecord(record));
    rebuiltItems.push({
      category: record.category,
      recordId: record.recordId,
      originPub: record.originPub,
      authorPub: record.authorPub,
      version: record.version,
      updatedAt: record.updatedAt,
      tombstone: record.tombstone,
      payloadHash,
      signed: !!record.signature,
    });
    if (record.signature) {
      if (record.signature.signerPub !== record.authorPub) return { ok: false, reason: 'record signer does not match author', category: record.category, recordId: record.recordId };
      const signatureOk = await crypto.verify(
        deviceSyncRecordSigningPayload(record),
        record.signature.value,
        record.signature.signerPub,
      );
      if (!signatureOk) return { ok: false, reason: 'invalid record signature', category: record.category, recordId: record.recordId };
    }
  }

  if (canonicalSerialize(rebuiltItems) !== canonicalSerialize(manifest.items)) return { ok: false, reason: 'manifest item metadata or hash mismatch' };
  const itemsHash = await crypto.hash(canonicalSerialize(rebuiltItems));
  if (itemsHash !== manifest.itemsHash) return { ok: false, reason: 'manifest items hash mismatch' };
  const summaries = await buildCategorySummaries(selectedCategories, rebuiltItems, crypto.hash);
  if (canonicalSerialize(summaries) !== canonicalSerialize(manifest.categorySummaries)) return { ok: false, reason: 'manifest category summary mismatch' };

  const { signature, checkpointId, ...checkpointCore } = manifest;
  const expectedCheckpointId = `sync_${await crypto.hash(canonicalSerialize(checkpointCore))}`;
  if (checkpointId !== expectedCheckpointId) return { ok: false, reason: 'manifest checkpoint mismatch' };
  const signatureOk = await crypto.verify(deviceSyncManifestSigningPayload({ ...checkpointCore, checkpointId }), signature, manifest.source.devicePub);
  if (!signatureOk) return { ok: false, reason: 'invalid manifest signature' };
  return { ok: true };
}

export interface UnsignedDeviceSyncAcknowledgement {
  schemaVersion: typeof DEVICE_SYNC_ACK_VERSION;
  kind: 'iinpublic-device-sync-ack';
  checkpointId: string;
  sourceDevicePub: string;
  targetDevicePub: string;
  itemCount: number;
  itemsHash: string;
  acknowledgedAt: string;
}

export interface DeviceSyncAcknowledgement extends UnsignedDeviceSyncAcknowledgement {
  signature: string;
}

async function buildDeviceSyncAcknowledgement(
  manifest: DeviceSyncManifest,
  targetCrypto: Pick<DeviceSyncCrypto, 'sign'>,
  acknowledgedAt: string = new Date().toISOString(),
): Promise<DeviceSyncAcknowledgement> {
  assertIsoTimestamp(acknowledgedAt, 'acknowledgedAt');
  const unsigned: UnsignedDeviceSyncAcknowledgement = {
    schemaVersion: DEVICE_SYNC_ACK_VERSION,
    kind: 'iinpublic-device-sync-ack',
    checkpointId: manifest.checkpointId,
    sourceDevicePub: manifest.source.devicePub,
    targetDevicePub: manifest.target.devicePub,
    itemCount: manifest.itemCount,
    itemsHash: manifest.itemsHash,
    acknowledgedAt,
  };
  const signature = await targetCrypto.sign(canonicalSerialize(unsigned));
  if (!signature) throw new Error('acknowledgement signer returned an empty signature');
  return { ...unsigned, signature };
}

export type DeviceSyncAcknowledgementResult =
  | { ok: true; acknowledgement: DeviceSyncAcknowledgement }
  | { ok: false; reason: string; category?: DeviceSyncCategory; recordId?: string };

/** Receiver-side safe path: an acknowledgement cannot be created before full verification succeeds. */
export async function verifyAndAcknowledgeDeviceSyncBundle(
  bundle: DeviceSyncBundle,
  targetCrypto: DeviceSyncCrypto,
  expectedTargetDevicePub: string,
  acknowledgedAt?: string,
): Promise<DeviceSyncAcknowledgementResult> {
  const verification = await verifyDeviceSyncBundle(bundle, targetCrypto, { targetDevicePub: expectedTargetDevicePub });
  if (!verification.ok) return verification;
  if (bundle.manifest.target.devicePub !== expectedTargetDevicePub) return { ok: false, reason: 'unexpected target device' };
  return {
    ok: true,
    acknowledgement: await buildDeviceSyncAcknowledgement(
      bundle.manifest,
      targetCrypto,
      acknowledgedAt ?? new Date().toISOString(),
    ),
  };
}

export async function verifyDeviceSyncAcknowledgement(
  acknowledgement: DeviceSyncAcknowledgement,
  manifest: DeviceSyncManifest,
  crypto: Pick<DeviceSyncCrypto, 'verify'>,
): Promise<DeviceSyncVerificationResult> {
  if (!acknowledgement || acknowledgement.schemaVersion !== DEVICE_SYNC_ACK_VERSION || acknowledgement.kind !== 'iinpublic-device-sync-ack') {
    return { ok: false, reason: 'unsupported or malformed sync acknowledgement' };
  }
  if (
    acknowledgement.checkpointId !== manifest.checkpointId
    || acknowledgement.sourceDevicePub !== manifest.source.devicePub
    || acknowledgement.targetDevicePub !== manifest.target.devicePub
    || acknowledgement.itemCount !== manifest.itemCount
    || acknowledgement.itemsHash !== manifest.itemsHash
  ) return { ok: false, reason: 'acknowledgement does not match manifest' };
  try {
    assertIsoTimestamp(acknowledgement.acknowledgedAt, 'acknowledgedAt');
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  const { signature, ...unsigned } = acknowledgement;
  const signatureOk = await crypto.verify(canonicalSerialize(unsigned), signature, acknowledgement.targetDevicePub);
  return signatureOk ? { ok: true } : { ok: false, reason: 'invalid acknowledgement signature' };
}

function normalizeSelectedCategories(categories: readonly DeviceSyncCategory[]): DeviceSyncCategory[] {
  if (!Array.isArray(categories) || categories.length === 0) throw new Error('at least one transferable sync category is required');
  const allowed = new Set<string>(DEVICE_SYNC_CATEGORIES);
  const unique = new Set<DeviceSyncCategory>();
  for (const category of categories) {
    if (!allowed.has(category)) throw new Error(`device-local or unknown sync category: ${String(category)}`);
    if (unique.has(category)) throw new Error(`duplicate selected sync category: ${category}`);
    unique.add(category);
  }
  return [...unique].sort();
}

async function buildCategorySummaries(
  selectedCategories: readonly DeviceSyncCategory[],
  items: readonly DeviceSyncManifestItem[],
  hash: DeviceSyncCrypto['hash'],
): Promise<DeviceSyncCategorySummary[]> {
  return Promise.all(selectedCategories.map(async (category) => {
    const categoryItems = items.filter((item) => item.category === category);
    return {
      category,
      itemCount: categoryItems.length,
      contentHash: await hash(canonicalSerialize(categoryItems.map((item) => item.payloadHash))),
    };
  }));
}

function assertEndpoint(endpoint: DeviceSyncEndpoint, label: string): void {
  if (!endpoint || !endpoint.devicePub || !endpoint.deviceEpub || !endpoint.identityPub) {
    throw new Error(`${label} sync endpoint is incomplete`);
  }
}

function assertSyncRecord(record: DeviceSyncRecord): void {
  if (!record || !DEVICE_SYNC_CATEGORIES.includes(record.category)) throw new Error('sync record has a device-local or unknown category');
  if (!record.recordId || !record.originPub || !record.authorPub) throw new Error('sync record identity fields are incomplete');
  if (!Number.isSafeInteger(record.version) || record.version < 0) throw new Error('sync record version must be a non-negative integer');
  if (typeof record.tombstone !== 'boolean') throw new Error('sync record tombstone flag is required');
  assertIsoTimestamp(record.createdAt, 'record createdAt');
  assertIsoTimestamp(record.updatedAt, 'record updatedAt');
  if (!isJsonValue(record.payload)) throw new Error('sync record payload must be JSON-safe');
  if (record.signature && (!record.signature.signerPub || !record.signature.value)) throw new Error('sync record signature is incomplete');
}

function assertIsoTimestamp(value: string, label: string): void {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, seen));
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  return Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item, seen));
}

function canonicalRecord(record: DeviceSyncRecord): string {
  return canonicalSerialize(record);
}

function recordKey(record: Pick<DeviceSyncRecord, 'category' | 'recordId'>): string {
  return `${record.category}\u0000${record.recordId}`;
}

function compareRecords(a: DeviceSyncRecord, b: DeviceSyncRecord): number {
  return recordKey(a).localeCompare(recordKey(b));
}

export const webCryptoDeviceSyncHash: DeviceSyncCrypto['hash'] = sha256Hex;
