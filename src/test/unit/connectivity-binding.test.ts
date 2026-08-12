import SEA from 'gun/sea';
import { ConnectivityBindingVerifier, issueConnectivityBinding } from '../../shared/connectivity-binding';
import type { SeaSigningPair } from '../../shared/p2p-runtime';

describe('SEA-signed ConnectivityBinding', () => {
  let pair: SeaSigningPair;
  const now = new Date('2026-08-12T00:00:00.000Z');

  beforeAll(async () => { pair = await SEA.pair() as SeaSigningPair; });

  test('verifies SEA authorship and connectivity ID control separately', async () => {
    const checked: string[] = [];
    const verifier = new ConnectivityBindingVerifier((_kind, id) => { checked.push(id); return id === 'peer-ok'; });
    const binding = await issueConnectivityBinding({ pair, connectivityKind: 'libp2p-peer', connectivityId: 'peer-ok', sequence: 1, issuedAt: now });
    await expect(verifier.verify(binding, now)).resolves.toEqual({ ok: true });
    expect(checked).toEqual(['peer-ok']);
  });

  test('rejects stale sequence and supports revocation floor', async () => {
    const verifier = new ConnectivityBindingVerifier(() => true);
    verifier.revoke(pair.pub, 'libp2p-peer', 4);
    const stale = await issueConnectivityBinding({ pair, connectivityKind: 'libp2p-peer', connectivityId: 'peer', sequence: 4, issuedAt: now });
    const rotated = await issueConnectivityBinding({ pair, connectivityKind: 'libp2p-peer', connectivityId: 'peer-new', sequence: 5, issuedAt: now });
    await expect(verifier.verify(stale, now)).resolves.toEqual({ ok: false, reason: 'stale sequence' });
    await expect(verifier.verify(rotated, now)).resolves.toEqual({ ok: true });
  });

  test('rejects expired and mismatched SEA identity', async () => {
    const verifier = new ConnectivityBindingVerifier(() => true);
    const binding = await issueConnectivityBinding({ pair, connectivityKind: 'ble', connectivityId: 'ble-1', sequence: 1, issuedAt: now, lifetimeMs: 1_000 });
    await expect(verifier.verify(binding, new Date(now.getTime() + 1_001))).resolves.toEqual({ ok: false, reason: 'expired binding' });
    await expect(verifier.verify({ ...binding, seaPub: 'attacker' }, now)).resolves.toEqual({ ok: false, reason: 'SEA pub mismatch' });
  });

  test('rejects a valid SEA signature when transport control fails', async () => {
    const verifier = new ConnectivityBindingVerifier(() => false);
    const binding = await issueConnectivityBinding({ pair, connectivityKind: 'wifi-direct', connectivityId: 'uncontrolled', sequence: 1, issuedAt: now });
    await expect(verifier.verify(binding, now)).resolves.toEqual({ ok: false, reason: 'connectivity ID control failed' });
  });
});

