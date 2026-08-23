import SEA from 'gun/sea';
import {
  DEVICE_SYNC_CATEGORIES,
  DEVICE_SYNC_DATA_INVENTORY,
  buildDeviceSyncBundle,
  deviceSyncRecordSigningPayload,
  verifyAndAcknowledgeDeviceSyncBundle,
  verifyDeviceSyncAcknowledgement,
  verifyDeviceSyncBundle,
  type DeviceSyncEndpoint,
  type DeviceSyncRecord,
} from '../../shared/device-sync-contract';
import {
  createSeaDeviceSyncCrypto,
  decryptDeviceSyncEnvelope,
  encryptDeviceSyncBundle,
} from '../../web/services/web-device-sync-crypto';
import type { GunPair } from '../../web/sea-gun';

describe('device sync contract', () => {
  let alice: GunPair;
  let bob: GunPair;
  let mallory: GunPair;
  let source: DeviceSyncEndpoint;
  let target: DeviceSyncEndpoint;

  beforeAll(async () => {
    [alice, bob, mallory] = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair()]) as GunPair[];
    source = { devicePub: alice.pub, deviceEpub: alice.epub, identityPub: alice.pub };
    target = { devicePub: bob.pub, deviceEpub: bob.epub, identityPub: bob.pub };
  });

  function record(overrides: Partial<DeviceSyncRecord> = {}): DeviceSyncRecord {
    return {
      category: 'contacts',
      recordId: 'contact-1',
      originPub: alice.pub,
      authorPub: alice.pub,
      createdAt: '2026-08-22T20:00:00.000Z',
      updatedAt: '2026-08-22T20:00:00.000Z',
      version: 1,
      tombstone: false,
      payload: { displayName: 'Bob' },
      ...overrides,
    };
  }

  async function signedRecord(overrides: Partial<DeviceSyncRecord> = {}): Promise<DeviceSyncRecord> {
    const unsigned = record(overrides);
    const value = await createSeaDeviceSyncCrypto(alice).sign(deviceSyncRecordSigningPayload(unsigned));
    return { ...unsigned, signature: { signerPub: alice.pub, value } };
  }

  async function bundle(records: DeviceSyncRecord[] = [record()]) {
    return buildDeviceSyncBundle({
      source,
      target,
      authorizationId: 'authorization-123',
      mode: 'snapshot',
      selectedCategories: ['contacts', 'messages'],
      records,
      crypto: createSeaDeviceSyncCrypto(alice),
      createdAt: '2026-08-22T20:05:00.000Z',
    });
  }

  it('freezes every WP5 data class and excludes installation secrets', () => {
    expect(DEVICE_SYNC_CATEGORIES).toEqual([
      'profileAndQa',
      'contacts',
      'blocks',
      'talks',
      'answerMemory',
      'conversations',
      'messages',
      'attachments',
      'preferences',
      'identityEvents',
      'syncTombstones',
    ]);
    expect(DEVICE_SYNC_DATA_INVENTORY.filter((entry) => !entry.transferable).map((entry) => entry.category)).toEqual([
      'passwords',
      'identityPrivateKeys',
      'custodySecrets',
      'osPermissions',
      'deviceLabels',
      'connectivitySettings',
      'cachesAndDiagnostics',
    ]);
  });

  it('builds a deterministic signed manifest with per-item and per-category hashes', async () => {
    const talk = record({ category: 'messages', recordId: 'message-2', payload: { text: 'encrypted body' } });
    const contact = record();
    const first = await bundle([talk, contact]);
    const second = await bundle([contact, talk]);

    expect(first.manifest.checkpointId).toBe(second.manifest.checkpointId);
    expect(first.manifest.items.map((item) => item.recordId)).toEqual(['contact-1', 'message-2']);
    expect(first.manifest.categorySummaries).toEqual([
      expect.objectContaining({ category: 'contacts', itemCount: 1 }),
      expect.objectContaining({ category: 'messages', itemCount: 1 }),
    ]);
    await expect(verifyDeviceSyncBundle(first, createSeaDeviceSyncCrypto(bob), {
      sourceDevicePub: alice.pub,
      targetDevicePub: bob.pub,
    })).resolves.toEqual({ ok: true });
  });

  it('rejects device-local data even when a caller bypasses TypeScript', async () => {
    await expect(buildDeviceSyncBundle({
      source,
      target,
      authorizationId: 'authorization-123',
      mode: 'snapshot',
      selectedCategories: ['passwords' as any],
      records: [],
      crypto: createSeaDeviceSyncCrypto(alice),
    })).rejects.toThrow('device-local or unknown sync category');
  });

  it('rejects payload tampering and category-count tampering', async () => {
    const original = await bundle();
    const payloadTampered = structuredClone(original);
    payloadTampered.records[0]!.payload = { displayName: 'Mallory' };
    await expect(verifyDeviceSyncBundle(payloadTampered, createSeaDeviceSyncCrypto(bob))).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: 'manifest item metadata or hash mismatch' }),
    );

    const countTampered = structuredClone(original);
    countTampered.manifest.categorySummaries[0]!.itemCount = 99;
    await expect(verifyDeviceSyncBundle(countTampered, createSeaDeviceSyncCrypto(bob))).resolves.toEqual({
      ok: false,
      reason: 'manifest category summary mismatch',
    });
  });

  it('verifies original record signatures without rewriting authorship', async () => {
    const original = await bundle([await signedRecord()]);
    await expect(verifyDeviceSyncBundle(original, createSeaDeviceSyncCrypto(bob))).resolves.toEqual({ ok: true });
    expect(original.records[0]).toMatchObject({
      originPub: alice.pub,
      authorPub: alice.pub,
      signature: { signerPub: alice.pub },
    });

    const forged = structuredClone(original);
    forged.records[0]!.signature!.value = await createSeaDeviceSyncCrypto(mallory).sign(
      deviceSyncRecordSigningPayload(forged.records[0]!),
    );
    await expect(verifyDeviceSyncBundle(forged, createSeaDeviceSyncCrypto(bob))).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid record signature', recordId: 'contact-1' }),
    );
  });

  it('requires deltas to name the checkpoint they extend', async () => {
    await expect(buildDeviceSyncBundle({
      source,
      target,
      authorizationId: 'authorization-123',
      mode: 'delta',
      selectedCategories: ['contacts'],
      records: [record()],
      crypto: createSeaDeviceSyncCrypto(alice),
    })).rejects.toThrow('delta sync requires previousCheckpointId');

    const delta = await buildDeviceSyncBundle({
      source,
      target,
      authorizationId: 'authorization-123',
      mode: 'delta',
      selectedCategories: ['contacts'],
      records: [record({ version: 2 })],
      previousCheckpointId: 'sync_previous',
      crypto: createSeaDeviceSyncCrypto(alice),
      createdAt: '2026-08-22T20:06:00.000Z',
    });
    await expect(verifyDeviceSyncBundle(delta, createSeaDeviceSyncCrypto(bob))).resolves.toEqual({ ok: true });
  });

  it('creates a receiver-signed acknowledgement bound to the verified checkpoint', async () => {
    const original = await bundle();
    const result = await verifyAndAcknowledgeDeviceSyncBundle(
      original,
      createSeaDeviceSyncCrypto(bob),
      bob.pub,
      '2026-08-22T20:10:00.000Z',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const { acknowledgement } = result;
    await expect(verifyDeviceSyncAcknowledgement(
      acknowledgement,
      original.manifest,
      createSeaDeviceSyncCrypto(alice),
    )).resolves.toEqual({ ok: true });

    const wrongCount = { ...acknowledgement, itemCount: acknowledgement.itemCount + 1 };
    await expect(verifyDeviceSyncAcknowledgement(
      wrongCount,
      original.manifest,
      createSeaDeviceSyncCrypto(alice),
    )).resolves.toEqual({ ok: false, reason: 'acknowledgement does not match manifest' });

    const tampered = structuredClone(original);
    tampered.records[0]!.payload = { displayName: 'Mallory' };
    await expect(verifyAndAcknowledgeDeviceSyncBundle(
      tampered,
      createSeaDeviceSyncCrypto(bob),
      bob.pub,
    )).resolves.toEqual(expect.objectContaining({ ok: false, reason: 'manifest item metadata or hash mismatch' }));
  });

  it('encrypts the complete manifest and records specifically for the receiving installation', async () => {
    const original = await bundle([await signedRecord()]);
    const envelope = await encryptDeviceSyncBundle(original, alice);
    expect(envelope.ciphertext).not.toContain('contact-1');
    expect(envelope.ciphertext).not.toContain('contacts');
    await expect(decryptDeviceSyncEnvelope(envelope, bob)).resolves.toEqual(original);
    await expect(decryptDeviceSyncEnvelope(envelope, mallory)).rejects.toThrow('addressed to another device');
  });

  it('rejects an envelope whose visible routing binding was changed', async () => {
    const original = await bundle();
    const envelope = await encryptDeviceSyncBundle(original, alice);
    const rebound = { ...envelope, source: { ...envelope.source, devicePub: mallory.pub } };
    await expect(decryptDeviceSyncEnvelope(rebound, bob)).rejects.toThrow('endpoint binding mismatch');
  });
});
