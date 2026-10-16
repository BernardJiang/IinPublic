import SEA from 'gun/sea';
import {
  PEER_EXCHANGE_CACHE_TTL_MS,
  issuePeerExchangeRecord,
  parsePeerExchangePayload,
  verifyCachedPeerExchangeEntry,
  verifyPeerExchangeRecord,
} from '../../shared/peer-exchange';
import type { SeaSigningPair } from '../../shared/p2p-runtime';

describe('signed peer exchange records', () => {
  test('accepts a fresh room-scoped record and rejects tampering or another room', async () => {
    const pair = await SEA.pair() as SeaSigningPair;
    const now = new Date('2026-10-15T20:00:00.000Z');
    const record = await issuePeerExchangeRecord({ pair, userId: 'alice', roomId: 'nearby-room', now });

    await expect(verifyPeerExchangeRecord(record, { expectedRoomId: 'nearby-room', now }))
      .resolves.toMatchObject({ ok: true });
    await expect(verifyPeerExchangeRecord(record, { expectedRoomId: 'other-room', now }))
      .resolves.toEqual({ ok: false, reason: 'peer exchange room mismatch' });
    await expect(verifyPeerExchangeRecord({ ...record, userId: 'mallory' }, { expectedRoomId: 'nearby-room', now }))
      .resolves.toMatchObject({ ok: false });
  });

  test('keeps an expired network record only as a bounded local bootstrap hint', async () => {
    const pair = await SEA.pair() as SeaSigningPair;
    const issued = new Date('2026-10-15T20:00:00.000Z');
    const restart = new Date('2026-10-15T21:00:00.000Z');
    const record = await issuePeerExchangeRecord({ pair, userId: 'bob', roomId: 'room', now: issued });
    const entry = {
      record,
      verifiedAt: issued.toISOString(),
      cacheExpiresAt: new Date(issued.getTime() + PEER_EXCHANGE_CACHE_TTL_MS).toISOString(),
    };

    await expect(verifyPeerExchangeRecord(record, { expectedRoomId: 'room', now: restart }))
      .resolves.toEqual({ ok: false, reason: 'peer exchange record lifetime is invalid' });
    await expect(verifyCachedPeerExchangeEntry(entry, { expectedRoomId: 'room', now: restart }))
      .resolves.toMatchObject({ ok: true });
  });

  test('payload parser enforces the bounded record count', async () => {
    const pair = await SEA.pair() as SeaSigningPair;
    const record = await issuePeerExchangeRecord({ pair, userId: 'alice', roomId: 'room' });
    expect(parsePeerExchangePayload({ version: 1, kind: 'peer-exchange', records: [record] })).not.toBeNull();
    expect(parsePeerExchangePayload({
      version: 1,
      kind: 'peer-exchange',
      records: Array.from({ length: 17 }, () => record),
    })).toBeNull();
  });
});
