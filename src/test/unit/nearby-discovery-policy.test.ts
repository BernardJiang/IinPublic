import {
  DISCOVERY_OFFLINE_BACKOFF_BASE_MS,
  DISCOVERY_OFFLINE_BACKOFF_MAX_MS,
  DISCOVERY_OFFLINE_BACKOFF_MAX_NO_BLE_MS,
  DISCOVERY_ONLINE_BACKOFF_BASE_MS,
  DISCOVERY_SCAN_WINDOW_MS,
  DiscoveryPolicy,
  discoveryProviderAvailability,
  hubDiscoveryPathAllowed,
  NEARBY_REGISTRY_MAX_PEERS,
  NearbyCandidateRegistry,
  type DiscoveryPolicyInput,
} from '../../shared/nearby-discovery-policy';
import { NEARBY_ID_EPOCH_MS, planOfflineGroup, rotatingNearbyId, type NearbyRecord } from '../../shared/nearby-offline';

const T0 = 10 * NEARBY_ID_EPOCH_MS;
const input = (overrides: Partial<DiscoveryPolicyInput> = {}): DiscoveryPolicyInput => ({
  now: T0,
  lan: true,
  wifiDirect: true,
  bluetooth: true,
  hubForDiscovery: true,
  roomPeerCount: 0,
  radioPeers: 0,
  groupCandidates: 0,
  inGroup: false,
  ...overrides,
});

describe('discovery provider availability', () => {
  const ready = { permission: true, bluetoothPermission: true, wifiEnabled: true, locationEnabled: true, bluetoothEnabled: true, wifiDirect: true, joinByCredential: true, ble: true };
  const env = (readiness = ready, permissionDenied = false) => ({ nativeBridge: true, readiness, permissionDenied });

  it('marks every provider unsupported in an ordinary browser (web-without-native-bridge)', () => {
    for (const kind of ['cellular', 'lan', 'wifi-direct', 'bluetooth'] as const) {
      expect(discoveryProviderAvailability(kind, true, { nativeBridge: false, readiness: null, permissionDenied: false })).toBe('unsupported');
    }
  });

  it('defaults every supported provider on and honors each switch independently', () => {
    for (const kind of ['cellular', 'lan', 'wifi-direct', 'bluetooth'] as const) {
      expect(discoveryProviderAvailability(kind, true, env())).toBe('on');
      expect(discoveryProviderAvailability(kind, false, env())).toBe('off');
    }
  });

  it('disables only the affected provider for missing capability, permission, or radio', () => {
    expect(discoveryProviderAvailability('wifi-direct', true, env({ ...ready, joinByCredential: false }))).toBe('unsupported');
    expect(discoveryProviderAvailability('bluetooth', true, env({ ...ready, joinByCredential: false }))).toBe('unsupported');
    expect(discoveryProviderAvailability('lan', true, env({ ...ready, joinByCredential: false }))).toBe('on');
    expect(discoveryProviderAvailability('bluetooth', true, env({ ...ready, ble: false }))).toBe('unsupported');
    expect(discoveryProviderAvailability('wifi-direct', true, env({ ...ready, ble: false }))).toBe('on');
    expect(discoveryProviderAvailability('wifi-direct', true, env(ready, true))).toBe('permission-denied');
    expect(discoveryProviderAvailability('bluetooth', true, env({ ...ready, bluetoothPermission: false }))).toBe('permission-denied');
    expect(discoveryProviderAvailability('bluetooth', true, env({ ...ready, bluetoothEnabled: false }))).toBe('radio-off');
    expect(discoveryProviderAvailability('wifi-direct', true, env({ ...ready, bluetoothEnabled: false }))).toBe('on');
    expect(discoveryProviderAvailability('lan', true, env({ ...ready, wifiEnabled: false }))).toBe('radio-off');
    expect(discoveryProviderAvailability('cellular', true, env({ ...ready, wifiEnabled: false }))).toBe('on');
  });

  it('Cellular switch off excludes only a cellular-only path', () => {
    expect(hubDiscoveryPathAllowed({ transports: ['cellular'] }, true)).toBe(true);
    expect(hubDiscoveryPathAllowed({ transports: ['cellular'] }, false)).toBe(false);
    expect(hubDiscoveryPathAllowed({ transports: ['wifi'] }, false)).toBe(true);
    expect(hubDiscoveryPathAllowed({ transports: ['wifi', 'cellular'] }, false)).toBe(true);
    expect(hubDiscoveryPathAllowed({ transports: ['ethernet'] }, false)).toBe(true);
    expect(hubDiscoveryPathAllowed(null, false)).toBe(true);
    expect(hubDiscoveryPathAllowed({ connected: false, transports: ['wifi'] }, true)).toBe(false);
  });
});

describe('staged discovery policy', () => {
  it('lone online user: LAN silent, beacon on, bounded BLE scans, no Wi-Fi Direct', () => {
    const policy = new DiscoveryPolicy();
    const first = policy.decide(input());
    expect(first).toMatchObject({ stage: 'online-singleton', lanNsd: false, bleAdvertise: true, bleScan: true, wifiDirectDiscovery: false, groupFormation: false });
    const closed = policy.decide(input({ now: T0 + DISCOVERY_SCAN_WINDOW_MS }));
    expect(closed.bleScan).toBe(false);
    expect(closed.bleAdvertise).toBe(true);
    expect(closed.nextReviewAt).toBe(T0 + DISCOVERY_SCAN_WINDOW_MS + DISCOVERY_ONLINE_BACKOFF_BASE_MS);
  });

  it('second same-room member online: LAN NSD starts, no Wi-Fi Direct while nobody needs it', () => {
    const policy = new DiscoveryPolicy();
    expect(policy.decide(input({ roomPeerCount: 1 }))).toMatchObject({ stage: 'online-peers', lanNsd: true, wifiDirectDiscovery: false, groupFormation: false });
    // An online phone near another online phone: no candidate (the hub is their route).
    expect(policy.decide(input({ roomPeerCount: 1, radioPeers: 1, groupCandidates: 0 }))).toMatchObject({ wifiDirectDiscovery: false, groupFormation: false });
  });

  it('network-free: an online phone links an offline same-room phone (bridge)', () => {
    const decision = new DiscoveryPolicy().decide(input({ radioPeers: 1, groupCandidates: 1 }));
    expect(decision).toMatchObject({ stage: 'online-peers', wifiDirectDiscovery: true, groupFormation: true, lanNsd: true });
    // In the group an online bridge keeps scanning so it notices when the offline phone leaves.
    expect(new DiscoveryPolicy().decide(input({ inGroup: true })).bleScan).toBe(true);
  });

  it('unknown roster keeps LAN on (older callers)', () => {
    expect(new DiscoveryPolicy().decide(input({ roomPeerCount: null })).lanNsd).toBe(true);
  });

  it('lone offline user: searches one window, then goes quiet with doubling backoff up to the cap', () => {
    const policy = new DiscoveryPolicy();
    let now = T0;
    const offline = (at: number) => policy.decide(input({ now: at, hubForDiscovery: false }));
    expect(offline(now)).toMatchObject({ stage: 'offline-searching', lanNsd: true, bleScan: true, wifiDirectDiscovery: true, groupFormation: false });
    const gaps: number[] = [];
    let scanMs = 0;
    for (let i = 0; i < 12; i += 1) {
      now += DISCOVERY_SCAN_WINDOW_MS;
      scanMs += DISCOVERY_SCAN_WINDOW_MS;
      const quiet = offline(now);
      expect(quiet).toMatchObject({ stage: 'offline-quiet', bleScan: false, wifiDirectDiscovery: false, bleAdvertise: true });
      gaps.push(quiet.nextReviewAt - now);
      now = quiet.nextReviewAt;
      expect(offline(now).stage).toBe('offline-searching');
    }
    expect(gaps[0]).toBe(DISCOVERY_OFFLINE_BACKOFF_BASE_MS);
    expect(gaps[1]).toBe(DISCOVERY_OFFLINE_BACKOFF_BASE_MS * 2);
    expect(Math.max(...gaps)).toBe(DISCOVERY_OFFLINE_BACKOFF_MAX_MS);
    // Bounded duty cycle: an isolated phone does not scan indefinitely.
    expect(scanMs / (now - T0)).toBeLessThan(0.1);
  });

  it('without Bluetooth the offline backoff stays short so DNS-SD windows can still meet', () => {
    const policy = new DiscoveryPolicy();
    let now = T0;
    let longest = 0;
    for (let i = 0; i < 10; i += 1) {
      policy.decide(input({ now, hubForDiscovery: false, bluetooth: false }));
      now += DISCOVERY_SCAN_WINDOW_MS;
      const quiet = policy.decide(input({ now, hubForDiscovery: false, bluetooth: false }));
      longest = Math.max(longest, quiet.nextReviewAt - now);
      now = quiet.nextReviewAt;
    }
    expect(longest).toBe(DISCOVERY_OFFLINE_BACKOFF_MAX_NO_BLE_MS);
  });

  it('a same-room phone nearby ends the quiet state and keeps scanning; a group forms only for an eligible candidate', () => {
    const policy = new DiscoveryPolicy();
    policy.decide(input({ hubForDiscovery: false }));
    policy.decide(input({ now: T0 + DISCOVERY_SCAN_WINDOW_MS, hubForDiscovery: false }));
    const seen = policy.decide(input({ now: T0 + DISCOVERY_SCAN_WINDOW_MS + 1, hubForDiscovery: false, radioPeers: 1 }));
    expect(seen).toMatchObject({ stage: 'offline-peers', bleScan: true, wifiDirectDiscovery: true, groupFormation: false });
    expect(policy.decide(input({ now: T0 + 10 * DISCOVERY_SCAN_WINDOW_MS, hubForDiscovery: false, radioPeers: 1 })).bleScan).toBe(true);
    expect(policy.decide(input({ now: T0 + 11 * DISCOVERY_SCAN_WINDOW_MS, hubForDiscovery: false, radioPeers: 1, groupCandidates: 1 })).groupFormation).toBe(true);
  });

  it('no empty Wi-Fi Direct group: never group formation without a candidate, in any stage', () => {
    const policy = new DiscoveryPolicy();
    for (const hub of [true, false]) {
      for (const radioPeers of [0, 3]) {
        expect(policy.decide(input({ hubForDiscovery: hub, radioPeers, groupCandidates: 0 })).groupFormation).toBe(false);
      }
    }
  });

  it('hub loss and recovery restart the backoff with an immediate window', () => {
    const policy = new DiscoveryPolicy();
    let now = T0;
    for (let i = 0; i < 5; i += 1) {
      policy.decide(input({ now }));
      now += DISCOVERY_SCAN_WINDOW_MS;
      now = policy.decide(input({ now })).nextReviewAt;
    }
    expect(policy.getBackoffState().emptyWindows).toBeGreaterThan(0);
    const lost = policy.decide(input({ now: now + 1, hubForDiscovery: false }));
    expect(lost).toMatchObject({ stage: 'offline-searching', wifiDirectDiscovery: true });
    expect(policy.getBackoffState().emptyWindows).toBe(0);
    const back = policy.decide(input({ now: now + 2 }));
    expect(back).toMatchObject({ stage: 'online-singleton', wifiDirectDiscovery: false, bleScan: true });
  });

  it('in the offline group: Wi-Fi Direct stays up, BLE stops scanning but keeps advertising', () => {
    const decision = new DiscoveryPolicy().decide(input({ hubForDiscovery: false, inGroup: true }));
    expect(decision).toMatchObject({ stage: 'offline-peers', wifiDirectDiscovery: true, bleAdvertise: true, bleScan: false });
  });

  it('a switched-off provider never runs', () => {
    const decision = new DiscoveryPolicy().decide(input({ hubForDiscovery: false, lan: false, bluetooth: false, wifiDirect: false, radioPeers: 2, groupCandidates: 2 }));
    expect(decision).toMatchObject({ lanNsd: false, bleAdvertise: false, bleScan: false, wifiDirectDiscovery: false, groupFormation: false });
  });
});

describe('NearbyCandidateRegistry', () => {
  const ROOM = 'a'.repeat(32);
  const registry = () => new NearbyCandidateRegistry({ ttlMs: 90_000, lanTtlMs: 20 * 60_000 });
  const rec = (id: string, overrides: Partial<NearbyRecord> = {}): NearbyRecord => ({ id, port: 8088, joinByCredential: true, hostScore: 1, seenAt: T0, ...overrides });

  it('merges LAN, BLE and DNS-SD sightings of one rotating id into one logical peer', () => {
    const r = registry();
    r.observe({ source: 'lan', discoveryId: 'cccccccccccc', seenAt: T0, roomVerified: false, route: 'http://192.168.1.5:8088/gun' });
    r.observe({ source: 'ble', discoveryId: 'cccccccccccc', seenAt: T0, roomVerified: true, record: rec('cccccccccccc') });
    r.observe({ source: 'dns-sd', discoveryId: 'cccccccccccc', seenAt: T0, roomVerified: true, route: 'aa:bb:cc:dd:ee:ff', record: rec('cccccccccccc') });
    const peers = r.list(T0);
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ onLan: true, eligible: true });
    expect(peers[0]!.sources.sort()).toEqual(['ble', 'dns-sd', 'lan']);
    expect(r.freshCount(T0)).toBe(1);
  });

  it('binds rotating ids to SEA identity from the signed roster and merges across id epochs', async () => {
    const r = registry();
    const oldId = await rotatingNearbyId('peer-pub', T0 - NEARBY_ID_EPOCH_MS, ROOM);
    const newId = await rotatingNearbyId('peer-pub', T0, ROOM);
    expect(oldId).not.toBe(newId);
    // LAN saw the previous epoch's id; BLE now reports the new one — before the roster is known
    // they look like two phones.
    r.observe({ source: 'lan', discoveryId: oldId, seenAt: T0 - 1_000, roomVerified: false, route: 'http://192.168.1.5:8088/gun' });
    r.observe({ source: 'ble', discoveryId: newId, seenAt: T0, roomVerified: false, record: rec(newId) });
    expect(r.list(T0)).toHaveLength(2);
    r.bindRoster(['peer-pub', 'someone-else'], ROOM, T0);
    const peers = r.list(T0);
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ key: 'sea:peer-pub', seaPub: 'peer-pub', onLan: true, eligible: true });
    // So the phone is already on the LAN under either id: no Wi-Fi Direct group is needed.
    expect(r.lanIds(T0).has(newId)).toBe(true);
  });

  it('a prefix-only (legacy) sighting of an unknown phone is never eligible for a group', () => {
    const r = registry();
    r.observe({ source: 'ble', discoveryId: 'dddddddddddd', seenAt: T0, roomVerified: false, record: rec('dddddddddddd') });
    expect(r.list(T0)[0]!.eligible).toBe(false);
    expect(r.eligibleRecords(T0)).toEqual([]);
    expect(r.freshCount(T0)).toBe(1);
  });

  it('expires radio sightings and LAN sightings on their own clocks', () => {
    const r = registry();
    r.observe({ source: 'ble', discoveryId: 'eeeeeeeeeeee', seenAt: T0, roomVerified: true, record: rec('eeeeeeeeeeee') });
    r.observe({ source: 'lan', discoveryId: 'ffffffffffff', seenAt: T0, roomVerified: false });
    r.prune(T0 + 90_001);
    expect(r.list(T0 + 90_001).map((peer) => peer.discoveryIds[0])).toEqual(['ffffffffffff']);
    r.prune(T0 + 20 * 60_000 + 1);
    expect(r.list(T0 + 20 * 60_000 + 1)).toEqual([]);
  });

  it('stays bounded by the room capacity under a flood of sightings (over-C crowd)', () => {
    const r = registry();
    for (let i = 0; i < NEARBY_REGISTRY_MAX_PEERS + 250; i += 1) {
      r.observe({ source: 'ble', discoveryId: i.toString(16).padStart(12, '0'), seenAt: T0 + i, roomVerified: true });
    }
    expect(r.list(T0).length).toBe(NEARBY_REGISTRY_MAX_PEERS);
  });

  it('three or more eligible phones elect exactly one host', () => {
    const ids = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc', 'dddddddddddd'];
    const plans = ids.map((id) => planOfflineGroup({
      self: { id, canHost: true, joinByCredential: true, hostScore: 1 },
      records: ids.filter((other) => other !== id).map((other) => rec(other, { roomVerified: true })),
      lanIds: new Set(),
      now: T0,
    }));
    expect(plans.filter((plan) => plan.action === 'host')).toHaveLength(1);
    expect(plans.filter((plan) => plan.action === 'wait')).toHaveLength(ids.length - 1);
  });
});
