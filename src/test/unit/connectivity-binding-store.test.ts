import { VerifiedConnectivityBindingStore, connectivityPersonLabel, isConnectivityBindingAllowed } from '../../web/services/connectivity-binding-store';
import type { ConnectivityBinding } from '../../shared/connectivity-binding';

const binding: ConnectivityBinding = {
  version: 1, seaPub: 'sea-bob-public-key', connectivityKind: 'libp2p-peer', connectivityId: '12D3KooTransportOnly',
  addresses: [], capabilities: [], sequence: 1, issuedAt: '2026-08-12T00:00:00.000Z', expiresAt: '2026-08-12T01:00:00.000Z',
  proof: { peerId: 'proof-peer', pub: 'sea-bob-public-key', timestamp: '2026-08-12T00:00:00.000Z', nonce: 'n', payloadHash: 'h', signature: 's' },
};

describe('verified connectivity binding local-Gun store', () => {
  test('persists and reloads a live verified binding from owner-private Gun', async () => {
    const values = new Map<string, unknown>();
    const store = new VerifiedConnectivityBindingStore({
      putPrivate: async (key, value) => { values.set(key, value); },
      getPrivate: async (key) => values.get(key) ?? null,
    });
    await store.put(binding);
    await expect(store.get(binding.seaPub, binding.connectivityKind, new Date('2026-08-12T00:30:00.000Z'))).resolves.toEqual(binding);
    await expect(store.get(binding.seaPub, binding.connectivityKind, new Date('2026-08-12T02:00:00.000Z'))).resolves.toBeNull();
  });

  test('SEA-level block survives transport ID rotation', () => {
    const blocked = new Set([binding.seaPub]);
    expect(isConnectivityBindingAllowed(binding, blocked)).toBe(false);
    const rotated = { ...binding, connectivityId: 'rotated-peer-id' };
    expect(isConnectivityBindingAllowed(rotated, blocked)).toBe(false);
  });

  test('person labels never expose libp2p or radio IDs', () => {
    expect(connectivityPersonLabel({ displayName: 'Bob', seaPub: binding.seaPub })).toBe('Bob');
    const fallback = connectivityPersonLabel({ seaPub: binding.seaPub });
    expect(fallback).toMatch(/^SEA /);
    expect(fallback).not.toContain(binding.connectivityId);
  });
});
