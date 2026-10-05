import {
  encodeBlePresence,
  encodeNearbyTxt,
  deriveOfflineGroupCredentials,
  parseBlePresence,
  isPrivateIpv4,
  lanGunPeerUrl,
  NEARBY_ID_EPOCH_MS,
  NEARBY_RECORD_TTL_MS,
  parseNearbyTxt,
  planOfflineGroup,
  planWifiOnlyFallback,
  rotatingNearbyId,
  type NearbyRecord,
  type NearbySelf,
} from '../../shared/nearby-offline';
import { activeRoomScope, BASELINE_ROOM_PROTOCOL_CHECKPOINT } from '../../shared/active-exchange-room';

const NOW = 1_000_000;
const self = (overrides: Partial<NearbySelf> = {}): NearbySelf => ({ id: 'bbbbbbbbbbbb', canHost: true, joinByCredential: true, hostScore: 1, ...overrides });
const record = (overrides: Partial<NearbyRecord> = {}): NearbyRecord => ({ id: 'cccccccccccc', port: 8088, joinByCredential: true, hostScore: 1, seenAt: NOW, ...overrides });
const group = { networkName: 'DIRECT-ab-IinPublic', passphrase: '0123456789abcdef0123456789abcdef', frequencyMhz: 5765 };

describe('nearby offline records', () => {
  const roomScope = activeRoomScope({
    version: 1,
    roomId: 'hall-a',
    enteredAt: new Date(NOW).toISOString(),
    transitionId: 'test',
    neighborLimit: 12,
    exchangeState: 'active',
    ...BASELINE_ROOM_PROTOCOL_CHECKPOINT,
  }, NOW);

  it('round-trips a TXT record without exposing group credentials', () => {
    const plain = encodeNearbyTxt({ ...self(), port: 8088 });
    expect(parseNearbyTxt(plain, NOW, 'aa:bb')).toEqual({ id: 'bbbbbbbbbbbb', port: 8088, joinByCredential: true, hostScore: 1, seenAt: NOW, deviceAddress: 'aa:bb' });
    const hosting = encodeNearbyTxt({ ...self({ joinByCredential: false, hostScore: 7 }), port: 8088, group });
    expect(hosting.s).toBe('3');
    expect(hosting).not.toHaveProperty('n');
    expect(hosting).not.toHaveProperty('k');
    expect(parseNearbyTxt(hosting, NOW)).toMatchObject({ joinByCredential: false, hostScore: 3, hostingHint: true });
  });

  it('rejects malformed records and ignores malformed credentials', () => {
    expect(parseNearbyTxt(null, NOW)).toBeNull();
    expect(parseNearbyTxt({ v: '2', id: 'bbbbbbbbbbbb', p: '8088' }, NOW)).toBeNull();
    expect(parseNearbyTxt({ v: '1', id: 'not-hex', p: '8088' }, NOW)).toBeNull();
    expect(parseNearbyTxt({ v: '1', id: 'bbbbbbbbbbbb', p: '70000' }, NOW)).toBeNull();
    const badGroup = parseNearbyTxt({ v: '1', id: 'bbbbbbbbbbbb', p: '8088', n: 'HomeWifi', k: 'short' }, NOW);
    expect(badGroup).not.toBeNull();
    expect(badGroup?.group).toBeUndefined();
  });

  it('rejects legacy unscoped BLE and ignores credentials injected into TXT', () => {
    const payload = encodeBlePresence({ ...self({ hostScore: 3 }), hosting: true });
    expect(payload).toMatch(/^[0-9a-f]{16}$/);
    expect(parseBlePresence(payload, NOW, 8088)).toBeNull();
    expect(parseBlePresence(encodeBlePresence({ ...self({ joinByCredential: false, hostScore: 0 }), hosting: false }), NOW, 8088))
      .toBeNull();
    expect(parseBlePresence('03bbbbbbbbbbbb00', NOW, 8088)).toBeNull();
    expect(parseBlePresence('01bbbb', NOW, 8088)).toBeNull();
    expect(parseNearbyTxt({ v: '1', id: 'bbbbbbbbbbbb', p: '8088', n: group.networkName, k: group.passphrase }, NOW)?.group)
      .toBeUndefined();
  });

  it('rotates the nearby id per epoch', async () => {
    const a = await rotatingNearbyId('pub', 0);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(await rotatingNearbyId('pub', NEARBY_ID_EPOCH_MS - 1)).toBe(a);
    expect(await rotatingNearbyId('pub', NEARBY_ID_EPOCH_MS)).not.toBe(a);
    expect(await rotatingNearbyId('other', 0)).not.toBe(a);
  });

  it('derives different session credentials and rejects another room BLE token', () => {
    const otherScope = { ...roomScope, roomToken: 'f'.repeat(32) };
    expect(deriveOfflineGroupCredentials(roomScope)).not.toEqual(deriveOfflineGroupCredentials(otherScope));
    expect(deriveOfflineGroupCredentials(roomScope).networkName).not.toContain(roomScope.roomId);
    const payload = encodeBlePresence({ ...self(), hosting: true, roomToken: roomScope.roomToken });
    expect(parseBlePresence(payload, NOW, 8088, roomScope.roomToken)?.roomToken).toBe(roomScope.roomToken);
    expect(parseBlePresence(payload, NOW, 8088, otherScope.roomToken)).toBeNull();
  });

  it('accepts only private IPv4 Gun endpoints', () => {
    expect(isPrivateIpv4('192.168.10.71')).toBe(true);
    expect(isPrivateIpv4('172.20.0.1')).toBe(true);
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(lanGunPeerUrl('http://192.168.10.71:8088/gun')).toBe('http://192.168.10.71:8088/gun');
    expect(lanGunPeerUrl('http://8.8.8.8:8088/gun')).toBeNull();
    expect(lanGunPeerUrl('https://192.168.10.71:8088/gun')).toBeNull();
    expect(lanGunPeerUrl('http://192.168.10.71:8088/evil')).toBeNull();
    expect(lanGunPeerUrl('http://192.168.10.71:99999/gun')).toBeNull();
    // Wi-Fi Direct group addresses are not "same Wi-Fi".
    expect(lanGunPeerUrl('http://192.168.49.185:8088/gun')).toBeNull();
  });
});

describe('planOfflineGroup', () => {
  const plan = (s: NearbySelf, records: NearbyRecord[], lanIds: string[] = []) =>
    planOfflineGroup({ self: s, records, lanIds: new Set(lanIds), now: NOW });

  it('does nothing without fresh peers that are off the LAN', () => {
    expect(plan(self(), [])).toEqual({ action: 'none', reason: 'no-offline-peers' });
    expect(plan(self(), [record({ seenAt: NOW - NEARBY_RECORD_TTL_MS - 1 })]).action).toBe('none');
    expect(plan(self(), [record()], ['cccccccccccc']).action).toBe('none');
    expect(plan(self(), [record({ id: 'bbbbbbbbbbbb' })]).action).toBe('none');
  });

  it('joins an advertised group, preferring the best-ranked host', () => {
    const result = plan(self(), [
      record({ id: 'dddddddddddd', group: { ...group, networkName: 'DIRECT-dd-IinPublic' } }),
      record({ id: 'cccccccccccc', group }),
    ]);
    expect(result).toMatchObject({ action: 'join', record: { id: 'cccccccccccc', group } });
  });

  it('never joins by credential from Android 7–9', () => {
    expect(plan(self({ joinByCredential: false }), [record({ group })])).toEqual({ action: 'none', reason: 'cannot-join-by-credential' });
  });

  it('elects exactly one host among two Android 10+ phones', () => {
    const a = self({ id: 'aaaaaaaaaaaa' });
    const b = self({ id: 'bbbbbbbbbbbb' });
    expect(plan(a, [record({ id: b.id })])).toEqual({ action: 'host' });
    expect(plan(b, [record({ id: a.id })])).toEqual({ action: 'wait', reason: 'peer-hosts' });
  });

  it('prefers a higher host score', () => {
    expect(plan(self({ id: 'bbbbbbbbbbbb', hostScore: 3 }), [record({ id: 'aaaaaaaaaaaa', hostScore: 1 })]).action).toBe('host');
    expect(plan(self({ id: 'aaaaaaaaaaaa', hostScore: 1 }), [record({ id: 'bbbbbbbbbbbb', hostScore: 3 })]).action).toBe('wait');
  });

  it('Android 7–9 phones sit out offline Wi-Fi Direct and are never waited on', () => {
    // They cannot set the app-wide credentials as host nor join by them.
    expect(plan(self({ joinByCredential: false }), [record()])).toEqual({ action: 'none', reason: 'cannot-join-by-credential' });
    expect(plan(self({ joinByCredential: false }), [record({ joinByCredential: false })]).action).toBe('none');
    // An Android 10+ phone that only sees an Android 7–9 phone has nobody to link with.
    expect(plan(self(), [record({ joinByCredential: false })])).toEqual({ action: 'none', reason: 'no-offline-peers' });
    // ...and never defers to one in the election.
    expect(plan(self({ id: 'ffffffffffff' }), [record({ id: '000000000000', joinByCredential: false, hostScore: 3 }), record({ id: 'eeeeeeeeeeee' })]).action).toBe('wait');
    expect(plan(self({ id: 'aaaaaaaaaaaa' }), [record({ id: '000000000000', joinByCredential: false, hostScore: 3 }), record({ id: 'eeeeeeeeeeee' })]).action).toBe('host');
  });

  it('waits when this phone cannot host', () => {
    expect(plan(self({ canHost: false }), [record()])).toEqual({ action: 'wait', reason: 'cannot-host' });
  });
});

describe('planWifiOnlyFallback', () => {
  const phone = (address: string, groupOwner = false, seenAt = NOW) => ({ address, groupOwner, type: '10-0050F204-5', seenAt });
  const base = { state: 'idle' as const, clientCount: 0, peers: [], cooldownUntil: new Map<string, number>(), phonesSince: null, emptySince: null, hostDelayMs: 30_000, leaveDelayMs: 20_000, now: NOW };

  it('joins a visible phone-type group owner, skipping cooled-down and non-phone owners', () => {
    expect(planWifiOnlyFallback({ ...base, peers: [phone('bb:00:00:00:00:02', true), phone('aa:00:00:00:00:01', true)] }))
      .toEqual({ action: 'join', address: 'aa:00:00:00:00:01' });
    expect(planWifiOnlyFallback({ ...base, peers: [phone('aa:00:00:00:00:01', true)], cooldownUntil: new Map([['aa:00:00:00:00:01', NOW + 1]]) }))
      .toEqual({ action: 'none' });
    expect(planWifiOnlyFallback({ ...base, peers: [{ address: 'cc:00:00:00:00:03', groupOwner: true, type: '7-0050F204-1', seenAt: NOW }] }))
      .toEqual({ action: 'none' });
  });

  it('hosts once phones have been around for the random delay', () => {
    const peers = [phone('aa:00:00:00:00:01')];
    expect(planWifiOnlyFallback({ ...base, peers, phonesSince: NOW - 29_999 })).toEqual({ action: 'none' });
    expect(planWifiOnlyFallback({ ...base, peers, phonesSince: NOW - 30_000 })).toEqual({ action: 'host' });
    expect(planWifiOnlyFallback({ ...base, peers: [phone('aa:00:00:00:00:01', false, NOW - 31_000)], phonesSince: NOW - 60_000 })).toEqual({ action: 'none' });
  });

  it('an empty owner that sees another owner leaves after its delay; a used group stays', () => {
    const owner = { ...base, state: 'owner' as const, peers: [phone('aa:00:00:00:00:01', true)] };
    expect(planWifiOnlyFallback({ ...owner, emptySince: NOW - 19_999 })).toEqual({ action: 'none' });
    expect(planWifiOnlyFallback({ ...owner, emptySince: NOW - 20_000 })).toEqual({ action: 'leave-and-join', address: 'aa:00:00:00:00:01' });
    expect(planWifiOnlyFallback({ ...owner, clientCount: 1, emptySince: NOW - 60_000 })).toEqual({ action: 'none' });
  });
});
