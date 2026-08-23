import SEA from 'gun/sea';
import { buildDeviceSyncAuthorization, buildDeviceSyncRevocation } from '../../shared/device-sync-authorization';
import { buildDeviceSyncBundle, type DeviceSyncEndpoint, type DeviceSyncRecord } from '../../shared/device-sync-contract';
import { importAuthorizedDeviceSyncBundle } from '../../shared/device-sync-importer';
import {
  enqueueDeviceSyncChange,
  flushDeviceSyncOutbox,
  initializeDeviceSyncOutbox,
} from '../../shared/device-sync-outbox';
import { WebDeviceSyncCustodyStore } from '../../web/services/web-device-sync-custody-store';
import {
  createSeaDeviceSyncCrypto,
  decryptDeviceSyncEnvelope,
  encryptDeviceSyncBundle,
  type EncryptedDeviceSyncEnvelope,
} from '../../web/services/web-device-sync-crypto';
import { WebDeviceSyncOutboxStore } from '../../web/services/web-device-sync-outbox-store';
import type { GunPair } from '../../web/sea-gun';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  raw(): string { return [...this.values.entries()].flat().join(' '); }
}

describe('continuous device sync outbox', () => {
  let alice: GunPair;
  let bob: GunPair;
  let source: DeviceSyncEndpoint;
  let target: DeviceSyncEndpoint;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([SEA.pair(), SEA.pair()]) as GunPair[];
    source = { devicePub: alice.pub, deviceEpub: alice.epub, identityPub: alice.pub };
    target = { devicePub: bob.pub, deviceEpub: bob.epub, identityPub: bob.pub };
  });

  function record(id: string, version = 1): DeviceSyncRecord {
    return {
      category: 'contacts',
      recordId: id,
      originPub: alice.pub,
      authorPub: alice.pub,
      createdAt: '2026-08-22T21:00:00.000Z',
      updatedAt: `2026-08-22T21:0${version}:00.000Z`,
      version,
      tombstone: false,
      payload: { privateName: `${id}-v${version}` },
    };
  }

  async function fixture() {
    const authorizationId = 'continuous-auth-123';
    const aliceAuthorization = await buildDeviceSyncAuthorization({
      authorizationId,
      mode: 'continuous',
      selfDevicePub: alice.pub,
      peerDevicePub: bob.pub,
      selectedCategories: ['contacts'],
      crypto: createSeaDeviceSyncCrypto(alice),
    });
    const bobAuthorization = await buildDeviceSyncAuthorization({
      authorizationId,
      mode: 'continuous',
      selfDevicePub: bob.pub,
      peerDevicePub: alice.pub,
      selectedCategories: ['contacts'],
      crypto: createSeaDeviceSyncCrypto(bob),
    });
    const authorizations = [aliceAuthorization, bobAuthorization] as const;
    const snapshot = await buildDeviceSyncBundle({
      source,
      target,
      authorizationId,
      mode: 'snapshot',
      selectedCategories: ['contacts'],
      records: [],
      crypto: createSeaDeviceSyncCrypto(alice),
      createdAt: '2026-08-22T21:00:00.000Z',
    });
    const receiverStorage = new MemoryStorage();
    const receiverStore = new WebDeviceSyncCustodyStore(receiverStorage, bob, 'receiver-sync');
    const initial = await importAuthorizedDeviceSyncBundle({
      bundle: snapshot,
      authorizations,
      targetDevicePub: bob.pub,
      targetCrypto: createSeaDeviceSyncCrypto(bob),
      store: receiverStore,
    });
    if (!initial.ok) throw new Error(initial.status === 'conflicted' ? 'initial snapshot conflicted' : initial.reason);

    const outboxStorage = new MemoryStorage();
    const outboxStore = new WebDeviceSyncOutboxStore(outboxStorage, alice, 'alice-to-bob-outbox');
    await initializeDeviceSyncOutbox({
      store: outboxStore,
      authorizationId,
      source,
      target,
      selectedCategories: ['contacts'],
      baseCheckpointId: snapshot.manifest.checkpointId,
    });
    const receive = async (sealed: string) => {
      const envelope = JSON.parse(sealed) as EncryptedDeviceSyncEnvelope;
      const bundle = await decryptDeviceSyncEnvelope(envelope, bob);
      const result = await importAuthorizedDeviceSyncBundle({
        bundle,
        authorizations,
        targetDevicePub: bob.pub,
        targetCrypto: createSeaDeviceSyncCrypto(bob),
        store: receiverStore,
      });
      if (!result.ok) throw new Error(result.status === 'conflicted' ? 'delta import conflicted' : result.reason);
      return result.acknowledgement;
    };
    const seal = async (bundle: Parameters<typeof encryptDeviceSyncBundle>[0]) => JSON.stringify(await encryptDeviceSyncBundle(bundle, alice));
    return { authorizations, aliceAuthorization, receiverStore, outboxStorage, outboxStore, receive, seal };
  }

  it('keeps edits encrypted and queued while the receiving device is offline', async () => {
    const f = await fixture();
    await enqueueDeviceSyncChange({ store: f.outboxStore, record: record('private-contact') });
    expect(f.outboxStorage.raw()).not.toContain('private-contact');
    expect(f.outboxStorage.raw()).not.toContain('privateName');

    await expect(flushDeviceSyncOutbox({
      store: f.outboxStore,
      authorizations: f.authorizations,
      sourceCrypto: createSeaDeviceSyncCrypto(alice),
      seal: f.seal,
      deliver: async () => { throw new Error('peer offline'); },
    })).resolves.toEqual({ ok: false, status: 'offline', reason: 'peer offline', pendingCount: 1 });
    expect((await f.outboxStore.load())?.entries).toHaveLength(1);
    expect((await f.outboxStore.load())?.inFlight).toBeDefined();
  });

  it('retries a lost acknowledgement with the identical checkpoint and deduplicates receiver import', async () => {
    const f = await fixture();
    await enqueueDeviceSyncChange({ store: f.outboxStore, record: record('contact-1') });
    let loseFirstAcknowledgement = true;
    const lossyDeliver = async (sealed: string) => {
      const acknowledgement = await f.receive(sealed);
      if (loseFirstAcknowledgement) {
        loseFirstAcknowledgement = false;
        throw new Error('route dropped acknowledgement');
      }
      return acknowledgement;
    };
    await expect(flushDeviceSyncOutbox({
      store: f.outboxStore,
      authorizations: f.authorizations,
      sourceCrypto: createSeaDeviceSyncCrypto(alice),
      seal: f.seal,
      deliver: lossyDeliver,
    })).resolves.toMatchObject({ ok: false, status: 'offline' });
    const checkpoint = (await f.outboxStore.load())?.inFlight?.bundle.manifest.checkpointId;

    await expect(flushDeviceSyncOutbox({
      store: f.outboxStore,
      authorizations: f.authorizations,
      sourceCrypto: createSeaDeviceSyncCrypto(alice),
      seal: f.seal,
      deliver: lossyDeliver,
    })).resolves.toEqual({ ok: true, status: 'converged', checkpointId: checkpoint, deliveredDeltas: 1 });
    expect(await f.receiverStore.readRecord('contacts', 'contact-1')).toEqual(record('contact-1'));
    expect((await f.outboxStore.load())?.entries).toHaveLength(0);
  });

  it('sends changes queued during transfer as an ordered follow-up delta until heads agree', async () => {
    const f = await fixture();
    await enqueueDeviceSyncChange({ store: f.outboxStore, record: record('contact-1') });
    const deliveredCheckpoints: string[] = [];
    let queuedDuringTransfer = false;
    const deliver = async (sealed: string) => {
      const envelope = JSON.parse(sealed) as EncryptedDeviceSyncEnvelope;
      const bundle = await decryptDeviceSyncEnvelope(envelope, bob);
      deliveredCheckpoints.push(bundle.manifest.checkpointId);
      if (!queuedDuringTransfer) {
        queuedDuringTransfer = true;
        await enqueueDeviceSyncChange({ store: f.outboxStore, record: record('contact-2') });
      }
      return f.receive(sealed);
    };
    const result = await flushDeviceSyncOutbox({
      store: f.outboxStore,
      authorizations: f.authorizations,
      sourceCrypto: createSeaDeviceSyncCrypto(alice),
      seal: f.seal,
      deliver,
    });
    expect(result).toMatchObject({ ok: true, status: 'converged', deliveredDeltas: 2 });
    expect(deliveredCheckpoints).toHaveLength(2);
    const sourceHead = (await f.outboxStore.load())?.lastAcknowledgedCheckpointId;
    const receiverHead = await f.receiverStore.readHead(alice.pub);
    expect(sourceHead).toBe(deliveredCheckpoints[1]);
    expect(receiverHead).toBe(sourceHead);
    expect(await f.receiverStore.readRecord('contacts', 'contact-2')).toEqual(record('contact-2'));
  });

  it('collapses repeated queued versions of one record into one latest delta item', async () => {
    const f = await fixture();
    await enqueueDeviceSyncChange({ store: f.outboxStore, record: record('contact-1', 1) });
    await enqueueDeviceSyncChange({ store: f.outboxStore, record: record('contact-1', 2) });
    let itemCount = 0;
    await flushDeviceSyncOutbox({
      store: f.outboxStore,
      authorizations: f.authorizations,
      sourceCrypto: createSeaDeviceSyncCrypto(alice),
      seal: f.seal,
      deliver: async (sealed) => {
        const bundle = await decryptDeviceSyncEnvelope(JSON.parse(sealed) as EncryptedDeviceSyncEnvelope, bob);
        itemCount = bundle.manifest.itemCount;
        return f.receive(sealed);
      },
    });
    expect(itemCount).toBe(1);
    expect(await f.receiverStore.readRecord('contacts', 'contact-1')).toEqual(record('contact-1', 2));
  });

  it('stops before delivery after either device revokes continuous sync', async () => {
    const f = await fixture();
    await enqueueDeviceSyncChange({ store: f.outboxStore, record: record('contact-1') });
    const revocation = await buildDeviceSyncRevocation({
      authorization: f.aliceAuthorization,
      issuerDevicePub: alice.pub,
      crypto: createSeaDeviceSyncCrypto(alice),
    });
    let delivered = false;
    await expect(flushDeviceSyncOutbox({
      store: f.outboxStore,
      authorizations: f.authorizations,
      revocations: [revocation],
      sourceCrypto: createSeaDeviceSyncCrypto(alice),
      seal: f.seal,
      deliver: async (sealed) => { delivered = true; return f.receive(sealed); },
    })).resolves.toMatchObject({ ok: false, status: 'rejected', reason: 'sync authorization revoked' });
    expect(delivered).toBe(false);
    expect((await f.outboxStore.load())?.entries).toHaveLength(1);
  });
});
