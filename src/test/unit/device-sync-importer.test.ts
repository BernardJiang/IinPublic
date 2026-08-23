import SEA from 'gun/sea';
import {
  buildDeviceSyncBundle,
  type DeviceSyncAcknowledgement,
  type DeviceSyncCategory,
  type DeviceSyncEndpoint,
  type DeviceSyncRecord,
} from '../../shared/device-sync-contract';
import {
  chooseConvergedRecord,
  importAuthorizedDeviceSyncBundle,
  importDeviceSyncBundle,
  type DeviceSyncCustodyStore,
  type DeviceSyncImportProgress,
} from '../../shared/device-sync-importer';
import { buildDeviceSyncAuthorization, buildDeviceSyncRevocation } from '../../shared/device-sync-authorization';
import { WebDeviceSyncCustodyStore } from '../../web/services/web-device-sync-custody-store';
import { createSeaDeviceSyncCrypto } from '../../web/services/web-device-sync-crypto';
import type { GunPair } from '../../web/sea-gun';

class MemoryCustodyStore implements DeviceSyncCustodyStore {
  readonly protection = 'receiving-device-local-custody' as const;
  readonly records = new Map<string, DeviceSyncRecord>();
  readonly progress = new Map<string, DeviceSyncImportProgress>();
  readonly acknowledgements = new Map<string, DeviceSyncAcknowledgement>();
  readonly heads = new Map<string, string>();
  readonly recordWrites = new Map<string, number>();
  failRecordId: string | null = null;
  failHead = false;

  async readRecord(category: DeviceSyncCategory, recordId: string): Promise<DeviceSyncRecord | null> {
    return this.records.get(`${category}\u0000${recordId}`) ?? null;
  }
  async writeRecord(record: DeviceSyncRecord): Promise<void> {
    if (record.recordId === this.failRecordId) throw new Error('simulated storage interruption');
    const key = `${record.category}\u0000${record.recordId}`;
    this.records.set(key, structuredClone(record));
    this.recordWrites.set(key, (this.recordWrites.get(key) ?? 0) + 1);
  }
  async readProgress(checkpointId: string): Promise<DeviceSyncImportProgress | null> {
    return this.progress.get(checkpointId) ?? null;
  }
  async writeProgress(progress: DeviceSyncImportProgress): Promise<void> {
    this.progress.set(progress.checkpointId, structuredClone(progress));
  }
  async readAcknowledgement(checkpointId: string): Promise<DeviceSyncAcknowledgement | null> {
    return this.acknowledgements.get(checkpointId) ?? null;
  }
  async writeAcknowledgement(acknowledgement: DeviceSyncAcknowledgement): Promise<void> {
    this.acknowledgements.set(acknowledgement.checkpointId, acknowledgement);
  }
  async readHead(sourceDevicePub: string): Promise<string | null> {
    return this.heads.get(sourceDevicePub) ?? null;
  }
  async writeHead(sourceDevicePub: string, checkpointId: string): Promise<void> {
    if (this.failHead) throw new Error('simulated head interruption');
    this.heads.set(sourceDevicePub, checkpointId);
  }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  rawValues(): string[] { return [...this.values.values()]; }
  rawKeys(): string[] { return [...this.values.keys()]; }
}

describe('device sync resumable importer', () => {
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

  function record(recordId: string, overrides: Partial<DeviceSyncRecord> = {}): DeviceSyncRecord {
    return {
      category: 'contacts',
      recordId,
      originPub: alice.pub,
      authorPub: alice.pub,
      createdAt: '2026-08-22T20:00:00.000Z',
      updatedAt: '2026-08-22T20:00:00.000Z',
      version: 1,
      tombstone: false,
      payload: { displayName: recordId },
      ...overrides,
    };
  }

  async function makeBundle(records: DeviceSyncRecord[], options: { mode?: 'snapshot' | 'delta'; previousCheckpointId?: string } = {}) {
    return buildDeviceSyncBundle({
      source,
      target,
      authorizationId: 'authorization-123',
      mode: options.mode ?? 'snapshot',
      selectedCategories: [...new Set(records.map((item) => item.category))],
      records,
      crypto: createSeaDeviceSyncCrypto(alice),
      createdAt: options.mode === 'delta' ? '2026-08-22T20:10:00.000Z' : '2026-08-22T20:05:00.000Z',
      ...(options.previousCheckpointId ? { previousCheckpointId: options.previousCheckpointId } : {}),
    });
  }

  it('persists all records before issuing a receiver acknowledgement and checkpoint', async () => {
    const store = new MemoryCustodyStore();
    const bundle = await makeBundle([record('contact-1'), record('contact-2')]);
    const result = await importDeviceSyncBundle({
      bundle,
      targetDevicePub: bob.pub,
      targetCrypto: createSeaDeviceSyncCrypto(bob),
      store,
      now: () => new Date('2026-08-22T20:20:00.000Z'),
    });
    expect(result).toMatchObject({ ok: true, status: 'complete', progress: { appliedCount: 2, status: 'complete' } });
    expect(store.records.size).toBe(2);
    expect(store.acknowledgements.has(bundle.manifest.checkpointId)).toBe(true);
    expect(store.heads.get(alice.pub)).toBe(bundle.manifest.checkpointId);
  });

  it('requires mutual category-scoped consent at the public import boundary', async () => {
    const store = new MemoryCustodyStore();
    const bundle = await makeBundle([record('contact-1')]);
    const aliceConsent = await buildDeviceSyncAuthorization({
      authorizationId: bundle.manifest.authorizationId,
      mode: 'migration',
      selfDevicePub: alice.pub,
      peerDevicePub: bob.pub,
      selectedCategories: bundle.manifest.selectedCategories,
      crypto: createSeaDeviceSyncCrypto(alice),
    });
    const bobConsent = await buildDeviceSyncAuthorization({
      authorizationId: bundle.manifest.authorizationId,
      mode: 'migration',
      selfDevicePub: bob.pub,
      peerDevicePub: alice.pub,
      selectedCategories: bundle.manifest.selectedCategories,
      crypto: createSeaDeviceSyncCrypto(bob),
    });
    await expect(importAuthorizedDeviceSyncBundle({
      bundle,
      authorizations: [aliceConsent, bobConsent],
      targetDevicePub: bob.pub,
      targetCrypto: createSeaDeviceSyncCrypto(bob),
      store,
    })).resolves.toMatchObject({ ok: true, status: 'complete' });

    const revokedStore = new MemoryCustodyStore();
    const revocation = await buildDeviceSyncRevocation({
      authorization: bobConsent,
      issuerDevicePub: bob.pub,
      crypto: createSeaDeviceSyncCrypto(bob),
    });
    await expect(importAuthorizedDeviceSyncBundle({
      bundle,
      authorizations: [aliceConsent, bobConsent],
      revocations: [revocation],
      targetDevicePub: bob.pub,
      targetCrypto: createSeaDeviceSyncCrypto(bob),
      store: revokedStore,
    })).resolves.toEqual({ ok: false, status: 'rejected', reason: 'sync authorization revoked' });
    expect(revokedStore.records.size).toBe(0);
  });

  it('resumes after a simulated app/storage interruption without duplicating completed records', async () => {
    const store = new MemoryCustodyStore();
    const bundle = await makeBundle([record('contact-1'), record('contact-2')]);
    store.failRecordId = 'contact-2';
    const interrupted = await importDeviceSyncBundle({
      bundle,
      targetDevicePub: bob.pub,
      targetCrypto: createSeaDeviceSyncCrypto(bob),
      store,
    });
    expect(interrupted).toMatchObject({ ok: false, status: 'interrupted', reason: 'simulated storage interruption' });
    expect(store.recordWrites.get('contacts\u0000contact-1')).toBe(1);

    store.failRecordId = null;
    const resumed = await importDeviceSyncBundle({
      bundle,
      targetDevicePub: bob.pub,
      targetCrypto: createSeaDeviceSyncCrypto(bob),
      store,
    });
    expect(resumed).toMatchObject({ ok: true, status: 'complete', progress: { appliedCount: 2 } });
    expect(store.recordWrites.get('contacts\u0000contact-1')).toBe(1);
    expect(store.recordWrites.get('contacts\u0000contact-2')).toBe(1);
  });

  it('makes a repeated completed import idempotent', async () => {
    const store = new MemoryCustodyStore();
    const bundle = await makeBundle([record('contact-1')]);
    const input = { bundle, targetDevicePub: bob.pub, targetCrypto: createSeaDeviceSyncCrypto(bob), store };
    const first = await importDeviceSyncBundle(input);
    const second = await importDeviceSyncBundle(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(store.recordWrites.get('contacts\u0000contact-1')).toBe(1);
    if (first.ok && second.ok) expect(second.acknowledgement).toEqual(first.acknowledgement);
  });

  it('repairs an interrupted checkpoint-head write from the already verified acknowledgement', async () => {
    const store = new MemoryCustodyStore();
    const bundle = await makeBundle([record('contact-1')]);
    store.failHead = true;
    await expect(importDeviceSyncBundle({
      bundle,
      targetDevicePub: bob.pub,
      targetCrypto: createSeaDeviceSyncCrypto(bob),
      store,
    })).resolves.toMatchObject({ ok: false, status: 'interrupted', reason: 'simulated head interruption' });
    expect(store.acknowledgements.has(bundle.manifest.checkpointId)).toBe(true);
    expect(store.heads.has(alice.pub)).toBe(false);

    store.failHead = false;
    await expect(importDeviceSyncBundle({
      bundle,
      targetDevicePub: bob.pub,
      targetCrypto: createSeaDeviceSyncCrypto(bob),
      store,
    })).resolves.toMatchObject({ ok: true, status: 'complete' });
    expect(store.heads.get(alice.pub)).toBe(bundle.manifest.checkpointId);
  });

  it('rejects an out-of-order delta, then accepts the delta extending the stored head', async () => {
    const store = new MemoryCustodyStore();
    const snapshot = await makeBundle([record('contact-1')]);
    await importDeviceSyncBundle({ bundle: snapshot, targetDevicePub: bob.pub, targetCrypto: createSeaDeviceSyncCrypto(bob), store });

    const gap = await makeBundle([record('contact-2')], { mode: 'delta', previousCheckpointId: 'sync_missing' });
    await expect(importDeviceSyncBundle({
      bundle: gap,
      targetDevicePub: bob.pub,
      targetCrypto: createSeaDeviceSyncCrypto(bob),
      store,
    })).resolves.toEqual({ ok: false, status: 'rejected', reason: 'delta predecessor does not match imported checkpoint' });

    const next = await makeBundle([record('contact-2')], { mode: 'delta', previousCheckpointId: snapshot.manifest.checkpointId });
    await expect(importDeviceSyncBundle({
      bundle: next,
      targetDevicePub: bob.pub,
      targetCrypto: createSeaDeviceSyncCrypto(bob),
      store,
    })).resolves.toMatchObject({ ok: true, status: 'complete' });
    expect(store.heads.get(alice.pub)).toBe(next.manifest.checkpointId);

    const later = await makeBundle([record('contact-3')], { mode: 'delta', previousCheckpointId: next.manifest.checkpointId });
    await importDeviceSyncBundle({ bundle: later, targetDevicePub: bob.pub, targetCrypto: createSeaDeviceSyncCrypto(bob), store });
    await expect(importDeviceSyncBundle({
      bundle: next,
      targetDevicePub: bob.pub,
      targetCrypto: createSeaDeviceSyncCrypto(bob),
      store,
    })).resolves.toMatchObject({ ok: true, status: 'complete' });
    expect(store.heads.get(alice.pub)).toBe(later.manifest.checkpointId);
  });

  it('uses deterministic version and tombstone rules, while surfacing ambiguous edits', () => {
    const local = record('contact-1', { version: 2, updatedAt: '2026-08-22T20:02:00.000Z', payload: { name: 'local' } });
    expect(chooseConvergedRecord(local, record('contact-1', { version: 3 }))).toEqual({ kind: 'apply' });
    expect(chooseConvergedRecord(local, record('contact-1', { version: 1 }))).toEqual({ kind: 'retain-local' });
    expect(chooseConvergedRecord(
      record('talk-1', { category: 'talks', version: 5 }),
      record('talk-1', { category: 'talks', version: 1, tombstone: true }),
    )).toEqual({ kind: 'apply' });
    expect(chooseConvergedRecord(local, record('contact-1', {
      version: 2,
      updatedAt: local.updatedAt,
      payload: { name: 'incoming' },
    }))).toMatchObject({ kind: 'conflict', conflict: { reason: 'ambiguous-concurrent-edit' } });
    expect(chooseConvergedRecord(
      record('message-1', { category: 'messages', payload: { text: 'one' } }),
      record('message-1', { category: 'messages', payload: { text: 'two' } }),
    )).toMatchObject({ kind: 'conflict', conflict: { reason: 'immutable-id-collision' } });
  });

  it('withholds acknowledgement when an existing record needs user conflict resolution', async () => {
    const store = new MemoryCustodyStore();
    const local = record('message-1', { category: 'messages', payload: { text: 'local' } });
    store.records.set('messages\u0000message-1', local);
    const bundle = await makeBundle([record('message-1', { category: 'messages', payload: { text: 'incoming' } })]);
    const result = await importDeviceSyncBundle({
      bundle,
      targetDevicePub: bob.pub,
      targetCrypto: createSeaDeviceSyncCrypto(bob),
      store,
    });
    expect(result).toMatchObject({ ok: false, status: 'conflicted', conflicts: [{ reason: 'immutable-id-collision' }] });
    expect(store.acknowledgements.size).toBe(0);
  });

  it('re-encrypts imported records under the receiving pair in browser storage', async () => {
    const storage = new MemoryStorage();
    const store = new WebDeviceSyncCustodyStore(storage, bob);
    const imported = record('private-contact', { payload: { secretNote: 'only Bob can read this' } });
    await store.writeRecord(imported);

    expect(storage.rawValues().join(' ')).not.toContain('only Bob can read this');
    expect(storage.rawKeys().join(' ')).not.toContain('private-contact');
    await expect(store.readRecord('contacts', 'private-contact')).resolves.toEqual(imported);

    const wrongCustody = new WebDeviceSyncCustodyStore(storage, mallory);
    await expect(wrongCustody.readRecord('contacts', 'private-contact')).rejects.toThrow('custody decryption failed');
  });
});
