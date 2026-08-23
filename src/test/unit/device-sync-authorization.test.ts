import SEA from 'gun/sea';
import {
  buildDeviceSyncAuthorization,
  buildDeviceSyncRevocation,
  verifyMutualDeviceSyncAuthorization,
  type DeviceSyncAuthorization,
} from '../../shared/device-sync-authorization';
import { createSeaDeviceSyncCrypto } from '../../web/services/web-device-sync-crypto';
import type { GunPair } from '../../web/sea-gun';

describe('mutual device sync authorization', () => {
  let alice: GunPair;
  let bob: GunPair;
  let mallory: GunPair;
  let aliceAuthorization: DeviceSyncAuthorization;
  let bobAuthorization: DeviceSyncAuthorization;

  beforeAll(async () => {
    [alice, bob, mallory] = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair()]) as GunPair[];
    aliceAuthorization = await buildDeviceSyncAuthorization({
      authorizationId: 'authorization-123',
      mode: 'continuous',
      selfDevicePub: alice.pub,
      peerDevicePub: bob.pub,
      selectedCategories: ['contacts', 'messages'],
      crypto: createSeaDeviceSyncCrypto(alice),
      issuedAt: '2026-08-22T20:00:00.000Z',
      sequence: 1,
    });
    bobAuthorization = await buildDeviceSyncAuthorization({
      authorizationId: 'authorization-123',
      mode: 'continuous',
      selfDevicePub: bob.pub,
      peerDevicePub: alice.pub,
      selectedCategories: ['messages', 'contacts'],
      crypto: createSeaDeviceSyncCrypto(bob),
      issuedAt: '2026-08-22T20:01:00.000Z',
      sequence: 1,
    });
  });

  function verify(
    authorizations: readonly [DeviceSyncAuthorization, DeviceSyncAuthorization] = [aliceAuthorization, bobAuthorization],
    revocations = [] as Awaited<ReturnType<typeof buildDeviceSyncRevocation>>[],
  ) {
    return verifyMutualDeviceSyncAuthorization({
      authorizations,
      revocations,
      sourceDevicePub: alice.pub,
      targetDevicePub: bob.pub,
      selectedCategories: ['contacts', 'messages'],
      crypto: createSeaDeviceSyncCrypto(alice),
      now: new Date('2026-08-22T20:05:00.000Z'),
    });
  }

  it('requires matching category-scoped signatures from both devices', async () => {
    await expect(verify()).resolves.toEqual({
      ok: true,
      authorizationId: 'authorization-123',
      mode: 'continuous',
      selectedCategories: ['contacts', 'messages'],
    });
    await expect(verify([aliceAuthorization, aliceAuthorization])).resolves.toEqual({
      ok: false,
      reason: 'authorization requires one signature from each device',
    });
  });

  it('rejects mismatched categories and a third-device substitution', async () => {
    const narrower = await buildDeviceSyncAuthorization({
      authorizationId: 'authorization-123',
      mode: 'continuous',
      selfDevicePub: bob.pub,
      peerDevicePub: alice.pub,
      selectedCategories: ['contacts'],
      crypto: createSeaDeviceSyncCrypto(bob),
    });
    await expect(verify([aliceAuthorization, narrower])).resolves.toEqual({ ok: false, reason: 'authorization category scope mismatch' });

    const thirdDevice = await buildDeviceSyncAuthorization({
      authorizationId: 'authorization-123',
      mode: 'continuous',
      selfDevicePub: mallory.pub,
      peerDevicePub: alice.pub,
      selectedCategories: ['contacts', 'messages'],
      crypto: createSeaDeviceSyncCrypto(mallory),
    });
    await expect(verify([aliceAuthorization, thirdDevice])).resolves.toEqual({ ok: false, reason: 'authorization device binding mismatch' });
  });

  it('rejects tampered and expired authorization records', async () => {
    await expect(verify([{ ...aliceAuthorization, mode: 'migration' }, bobAuthorization])).resolves.toEqual({
      ok: false,
      reason: 'authorization peers did not approve the same scope',
    });
    const expired = await buildDeviceSyncAuthorization({
      authorizationId: 'authorization-expired',
      mode: 'migration',
      selfDevicePub: alice.pub,
      peerDevicePub: bob.pub,
      selectedCategories: ['contacts'],
      crypto: createSeaDeviceSyncCrypto(alice),
      issuedAt: '2026-08-20T00:00:00.000Z',
      expiresAt: '2026-08-21T00:00:00.000Z',
    });
    const expiredPeer = await buildDeviceSyncAuthorization({
      authorizationId: 'authorization-expired',
      mode: 'migration',
      selfDevicePub: bob.pub,
      peerDevicePub: alice.pub,
      selectedCategories: ['contacts'],
      crypto: createSeaDeviceSyncCrypto(bob),
      issuedAt: '2026-08-20T00:00:00.000Z',
      expiresAt: '2026-08-21T00:00:00.000Z',
    });
    await expect(verifyMutualDeviceSyncAuthorization({
      authorizations: [expired, expiredPeer],
      sourceDevicePub: alice.pub,
      targetDevicePub: bob.pub,
      selectedCategories: ['contacts'],
      crypto: createSeaDeviceSyncCrypto(bob),
      now: new Date('2026-08-22T00:00:00.000Z'),
    })).resolves.toEqual({ ok: false, reason: 'sync authorization expired' });
  });

  it('lets either device unilaterally revoke future sync', async () => {
    const revocation = await buildDeviceSyncRevocation({
      authorization: bobAuthorization,
      issuerDevicePub: bob.pub,
      crypto: createSeaDeviceSyncCrypto(bob),
      revokedAt: '2026-08-22T20:03:00.000Z',
      sequence: 2,
    });
    await expect(verify([aliceAuthorization, bobAuthorization], [revocation])).resolves.toEqual({
      ok: false,
      reason: 'sync authorization revoked',
    });
  });

  it('refuses device-local categories at runtime', async () => {
    await expect(buildDeviceSyncAuthorization({
      authorizationId: 'authorization-123',
      mode: 'migration',
      selfDevicePub: alice.pub,
      peerDevicePub: bob.pub,
      selectedCategories: ['passwords' as any],
      crypto: createSeaDeviceSyncCrypto(alice),
    })).rejects.toThrow('device-local or unknown category');
  });
});
