import { encodeBlePresence, encodeNearbyTxt, OFFLINE_GROUP_CREDENTIALS, rotatingNearbyId } from '../../shared/nearby-offline';
import { NearbyOfflineService, type NearbyOfflineBridge, type NearbyReadinessGap } from '../../web/services/nearby-offline-service';
import type { WifiDirectNative, WifiDirectNativeState } from '../../web/services/wifi-direct-link-service';
import type { WifiDirectGroupCredentials } from '../../shared/wifi-direct-link';

class FakeNative implements WifiDirectNative {
  state: WifiDirectNativeState = { state: 'idle' };
  joinByCredential = true;
  permission = true;
  created: WifiDirectGroupCredentials[] = [];
  joined: WifiDirectGroupCredentials[] = [];
  left = 0;
  permissionRequests = 0;
  private listeners = new Set<(state: WifiDirectNativeState) => void>();
  capabilities() { return { wifiDirect: true, joinByCredential: this.joinByCredential, hostScore: 1 }; }
  async requestPermission() { this.permissionRequests += 1; return this.permission; }
  createGroup(credentials: WifiDirectGroupCredentials) { this.created.push(credentials); this.set({ state: 'forming' }); }
  joinGroup(credentials: WifiDirectGroupCredentials) { this.joined.push(credentials); this.set({ state: 'joining' }); }
  leaveGroup() { this.left += 1; this.set({ state: 'idle' }); }
  getState() { return this.state; }
  onState(listener: (state: WifiDirectNativeState) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  set(state: WifiDirectNativeState) { this.state = state; for (const listener of this.listeners) listener(state); }
}

type Readiness = { permission: boolean; wifiEnabled: boolean; locationEnabled: boolean; bluetoothEnabled?: boolean };

function fakeBridge(readiness: Readiness = { permission: true, wifiEnabled: true, locationEnabled: true }) {
  const calls: string[] = [];
  const advertised: Array<Record<string, string>> = [];
  const bridge: NearbyOfflineBridge = {
    startLanDiscovery: (port, id) => { calls.push(`lan:${port}:${id}`); },
    stopLanDiscovery: () => { calls.push('lan-stop'); },
    advertiseWifiDirectService: (txt) => { advertised.push(JSON.parse(txt)); },
    startWifiDirectServiceDiscovery: () => { calls.push('wd-start'); },
    stopWifiDirectServiceDiscovery: () => { calls.push('wd-stop'); },
    nearbyReadiness: () => JSON.stringify(readiness),
    openNearbySettings: (kind) => { calls.push(`open:${kind}`); },
    startBlePresence: (payload) => { calls.push(`ble:${payload}`); },
    stopBlePresence: () => { calls.push('ble-stop'); },
    requestOfflineNearbyPermission: () => { calls.push('permission'); },
  };
  return { bridge, calls, advertised };
}

const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
const relayServer = { urls: ['turn:127.0.0.1:3478?transport=udp'], username: 'u', credential: 'c' };
const hostGroup = { networkName: 'DIRECT-ab-IinPublic', passphrase: '0123456789abcdef0123456789abcdef', frequencyMhz: 5765 };

function setup(options: { hubReachable?: boolean; readiness?: Readiness; wifiDirectAllowed?: boolean } = {}) {
  const events = new EventTarget();
  const native = new FakeNative();
  const { bridge, calls, advertised } = fakeBridge(options.readiness);
  const gunPeers: string[] = [];
  const iceServers: Array<RTCIceServer | null> = [];
  const relayStarts: string[] = [];
  const gaps: NearbyReadinessGap[] = [];
  let now = 1_000_000;
  let hubReachable = options.hubReachable ?? false;
  const service = new NearbyOfflineService({
    localPub: 'local-pub',
    port: 8088,
    bridge,
    native,
    localRelay: { start: async (address) => { relayStarts.push(address); return relayServer; }, stop: async () => undefined },
    addGunPeer: (url) => gunPeers.push(url),
    setLocalLinkIceServer: (server) => iceServers.push(server),
    hubReachable: async () => hubReachable,
    requestPermission: () => native.requestPermission(),
    wifiDirectAllowed: options.wifiDirectAllowed ?? true,
    onReadinessGap: (gap) => gaps.push(gap),
    events,
    now: () => now,
    tickMs: 60_000_000,
    random: () => 0,
  });
  return {
    service, events, native, calls, advertised, gunPeers, iceServers, relayStarts, gaps,
    setHub: (value: boolean) => { hubReachable = value; },
    advance: (ms: number) => { now += ms; },
    tick: () => (service as unknown as { tick(): Promise<void> }).tick(),
    emitLan: (transportId: string, endpoint: string) => events.dispatchEvent(new CustomEvent('iinpublic-nearby-candidate', { detail: { source: 'mdns', transportId, endpoint } })),
    emitPeers: (peers: Array<{ address: string; groupOwner: boolean; type: string }>) => events.dispatchEvent(new CustomEvent('iinpublic-nearby-wd-peers', { detail: { peers } })),
    emitBle: (payload: string) => events.dispatchEvent(new CustomEvent('iinpublic-nearby-ble', { detail: { payload, rssi: -50 } })),
    emitRecord: (txt: Record<string, string>) => events.dispatchEvent(new CustomEvent('iinpublic-nearby-wd-service', { detail: { deviceAddress: 'aa:bb:cc:dd:ee:ff', txt } })),
  };
}

describe('NearbyOfflineService', () => {
  it('starts LAN discovery with the rotating id and peers Gun with each LAN phone once', async () => {
    const t = setup({ hubReachable: true });
    await t.service.start();
    const id = await rotatingNearbyId('local-pub', 1_000_000);
    expect(t.calls).toContain(`lan:8088:${id}`);
    t.emitLan('cccccccccccc', 'http://192.168.10.71:8088/gun');
    t.emitLan('cccccccccccc', 'http://192.168.10.71:8088/gun');
    t.emitLan(id, 'http://192.168.10.35:8088/gun');
    t.emitLan(`iinpublic-v1-${id}`, 'http://192.168.10.34:8088/gun');
    t.emitLan('dddddddddddd', 'http://8.8.8.8:8088/gun');
    expect(t.gunPeers).toEqual(['http://192.168.10.71:8088/gun']);
    t.service.dispose();
  });

  it('keeps Wi-Fi Direct off while the hub is reachable', async () => {
    const t = setup({ hubReachable: true });
    await t.service.start();
    expect(t.calls).not.toContain('wd-start');
    expect(t.native.permissionRequests).toBe(0);
    t.service.dispose();
  });

  it('goes offline: asks for permission in context, advertises, and hosts for a peer', async () => {
    const t = setup({ readiness: { permission: false, wifiEnabled: true, locationEnabled: false } });
    await t.service.start();
    expect(t.native.permissionRequests).toBe(1);
    expect(t.calls).toContain('wd-start');
    expect(t.gaps).toEqual(['location']);
    expect(t.advertised.at(-1)).toMatchObject({ v: '1', p: '8088', j: '1' });
    // A peer with a higher id appears: this phone (lower id wins ties) hosts.
    t.emitRecord(encodeNearbyTxt({ id: 'ffffffffffff', canHost: true, joinByCredential: true, hostScore: 1, port: 8088 }));
    await t.tick();
    expect(t.native.created).toEqual([OFFLINE_GROUP_CREDENTIALS]);
    // Formed: relay on the group address, ICE server set, credentials advertised.
    t.native.set({ state: 'owner', localIp: '192.168.49.1', ownerIp: '192.168.49.1', clientCount: 0, ...t.native.created[0]!, frequencyMhz: 5765 });
    await flush();
    expect(t.relayStarts).toEqual(['192.168.49.1']);
    expect(t.iceServers.at(-1)).toEqual(relayServer);
    expect(t.advertised.at(-1)).toMatchObject({ n: t.native.created[0]!.networkName, k: t.native.created[0]!.passphrase, f: '5765' });
    t.service.dispose();
    expect(t.native.left).toBe(1);
    expect(t.iceServers.at(-1)).toBeNull();
  });

  it('joins an advertised group and peers Gun with the owner node', async () => {
    const t = setup();
    await t.service.start();
    t.emitRecord(encodeNearbyTxt({ id: '000000000000', canHost: true, joinByCredential: true, hostScore: 1, port: 9090, group: hostGroup }));
    await t.tick();
    expect(t.native.joined).toEqual([hostGroup]);
    t.native.set({ state: 'client', networkName: hostGroup.networkName, localIp: '192.168.49.185', ownerIp: '192.168.49.1' });
    await flush();
    expect(t.gunPeers).toEqual(['http://192.168.49.1:9090/gun']);
    expect(t.relayStarts).toEqual(['192.168.49.185']);
    t.native.set({ state: 'idle', reason: 'group-removed' });
    await flush();
    expect(t.iceServers.at(-1)).toBeNull();
    t.service.dispose();
  });

  it('does not form a group with a phone it already reaches over the LAN', async () => {
    const t = setup();
    await t.service.start();
    t.emitLan('ffffffffffff', 'http://192.168.10.71:8088/gun');
    t.emitRecord(encodeNearbyTxt({ id: 'ffffffffffff', canHost: true, joinByCredential: true, hostScore: 1, port: 8088 }));
    await t.tick();
    expect(t.native.created).toHaveLength(0);
    t.service.dispose();
  });

  it('reports a denied permission once and stops trying Wi-Fi Direct', async () => {
    const t = setup({ readiness: { permission: false, wifiEnabled: true, locationEnabled: true } });
    t.native.permission = false;
    await t.service.start();
    await t.tick();
    expect(t.gaps).toEqual(['permission']);
    expect(t.native.permissionRequests).toBe(1);
    expect(t.calls).not.toContain('wd-start');
    t.service.dispose();
  });

  it('respects an explicit opt-out of Wi-Fi Direct', async () => {
    const t = setup({ wifiDirectAllowed: false });
    await t.service.start();
    expect(t.calls).not.toContain('wd-start');
    t.service.dispose();
  });

  it('an owner without clients removes its group after a while', async () => {
    const t = setup();
    await t.service.start();
    t.emitRecord(encodeNearbyTxt({ id: 'ffffffffffff', canHost: true, joinByCredential: true, hostScore: 1, port: 8088 }));
    await t.tick();
    t.native.set({ state: 'owner', localIp: '192.168.49.1', clientCount: 0, ...t.native.created[0]! });
    await flush();
    await t.tick();
    t.advance(3 * 60_000 + 1);
    await t.tick();
    expect(t.native.left).toBe(1);
    t.service.dispose();
  });

  it('stops Wi-Fi Direct discovery once the hub is back (outside a group)', async () => {
    const t = setup();
    await t.service.start();
    expect(t.calls).toContain('wd-start');
    t.setHub(true);
    await t.tick();
    expect(t.calls).toContain('wd-stop');
    t.service.dispose();
  });
});

describe('NearbyOfflineService BLE presence', () => {
  it('advertises BLE presence while offline and flips the hosting bit once it owns a group', async () => {
    const t = setup();
    await t.service.start();
    const id = await rotatingNearbyId('local-pub', 1_000_000);
    expect(t.calls).toContain(`ble:${encodeBlePresence({ id, canHost: true, joinByCredential: true, hostScore: 1, hosting: false })}`);
    t.native.set({ state: 'owner', localIp: '192.168.49.1', clientCount: 0, ...OFFLINE_GROUP_CREDENTIALS });
    await flush();
    expect(t.calls.at(-1)).toBe(`ble:${encodeBlePresence({ id, canHost: true, joinByCredential: true, hostScore: 1, hosting: true })}`);
    t.service.dispose();
    expect(t.calls).toContain('ble-stop');
  });

  it('joins the fixed offline group when a BLE peer says it is hosting', async () => {
    const t = setup();
    await t.service.start();
    t.emitBle(encodeBlePresence({ id: '000000000000', canHost: true, joinByCredential: true, hostScore: 1, hosting: true }));
    await t.tick();
    expect(t.native.joined).toEqual([OFFLINE_GROUP_CREDENTIALS]);
    t.service.dispose();
  });

  it('hosts the fixed offline group when it wins the election against a BLE peer', async () => {
    const t = setup();
    await t.service.start();
    t.emitBle(encodeBlePresence({ id: 'ffffffffffff', canHost: true, joinByCredential: true, hostScore: 1, hosting: false }));
    await t.tick();
    expect(t.native.created).toEqual([OFFLINE_GROUP_CREDENTIALS]);
    t.service.dispose();
  });

  it('reports Bluetooth switched off', async () => {
    const t = setup({ readiness: { permission: true, wifiEnabled: true, locationEnabled: true, bluetoothEnabled: false } });
    await t.service.start();
    expect(t.gaps).toEqual(['bluetooth']);
    t.service.dispose();
  });
});

describe('NearbyOfflineService Wi-Fi-only fallback', () => {
  const phone = (address: string, groupOwner = false) => ({ address, groupOwner, type: '10-0050F204-5' });

  it('joins a phone that owns a group even without BLE or DNS-SD, and cools a failed owner down', async () => {
    const t = setup();
    await t.service.start();
    t.emitPeers([phone('aa:bb:cc:00:00:01', true)]);
    await t.tick();
    expect(t.native.joined).toEqual([OFFLINE_GROUP_CREDENTIALS]);
    t.native.set({ state: 'failed', reason: 'join-timeout' });
    await flush();
    t.advance(21_000);
    t.emitPeers([phone('aa:bb:cc:00:00:01', true)]);
    await t.tick();
    expect(t.native.joined).toHaveLength(1);
    t.service.dispose();
  });

  it('hosts after phones have been visible for the host delay', async () => {
    const t = setup();
    await t.service.start();
    t.emitPeers([phone('aa:bb:cc:00:00:01')]);
    await t.tick();
    expect(t.native.created).toHaveLength(0);
    t.advance(15_000);
    t.emitPeers([phone('aa:bb:cc:00:00:01')]);
    await t.tick();
    expect(t.native.created).toEqual([OFFLINE_GROUP_CREDENTIALS]);
    t.service.dispose();
  });

  it('an empty fallback group merges into another owner', async () => {
    const t = setup();
    await t.service.start();
    t.emitPeers([phone('aa:bb:cc:00:00:01')]);
    await t.tick();
    t.advance(15_000);
    t.emitPeers([phone('aa:bb:cc:00:00:01')]);
    await t.tick();
    t.native.set({ state: 'owner', localIp: '192.168.49.1', clientCount: 0, ...OFFLINE_GROUP_CREDENTIALS });
    await flush();
    t.emitPeers([phone('aa:bb:cc:00:00:01', true)]);
    await t.tick();
    t.advance(10_000);
    t.emitPeers([phone('aa:bb:cc:00:00:01', true)]);
    await t.tick();
    expect(t.native.left).toBe(1);
    t.advance(3_001);
    t.emitPeers([phone('aa:bb:cc:00:00:01', true)]);
    await t.tick();
    expect(t.native.joined).toEqual([OFFLINE_GROUP_CREDENTIALS]);
    t.service.dispose();
  });

  it('BLE presence takes precedence over the fallback', async () => {
    const t = setup();
    await t.service.start();
    t.emitPeers([phone('aa:bb:cc:00:00:01', true)]);
    t.emitBle(encodeBlePresence({ id: 'ffffffffffff', canHost: true, joinByCredential: true, hostScore: 1, hosting: false }));
    await t.tick();
    expect(t.native.created).toEqual([OFFLINE_GROUP_CREDENTIALS]);
    expect(t.native.joined).toHaveLength(0);
    t.service.dispose();
  });
});

describe('NearbyOfflineService back online', () => {
  it('leaves the offline group after the hub has been reachable for a minute', async () => {
    const t = setup();
    await t.service.start();
    t.native.set({ state: 'client', localIp: '192.168.49.185', ownerIp: '192.168.49.1', ...OFFLINE_GROUP_CREDENTIALS });
    await flush();
    t.setHub(true);
    await t.tick();
    expect(t.native.left).toBe(0);
    t.advance(60_000);
    await t.tick();
    expect(t.native.left).toBe(1);
    expect(t.calls).toContain('wd-stop');
    t.service.dispose();
  });

  it('keeps a group that is not the offline group', async () => {
    const t = setup({ hubReachable: true });
    await t.service.start();
    t.native.set({ state: 'owner', localIp: '192.168.49.1', networkName: 'DIRECT-ab-IinPublic', passphrase: 'x'.repeat(32) });
    await flush();
    await t.tick();
    t.advance(120_000);
    await t.tick();
    expect(t.native.left).toBe(0);
    t.service.dispose();
  });
});

describe('NearbyOfflineService settings switches and status', () => {
  it('turning Wi-Fi Direct off leaves the offline group and stops discovery right away', async () => {
    const t = setup();
    await t.service.start();
    t.native.set({ state: 'owner', localIp: '192.168.49.1', clientCount: 2, ...OFFLINE_GROUP_CREDENTIALS });
    await flush();
    expect(t.service.getStatus()).toEqual({ kind: 'wifi-direct', hosting: true, phones: 2, lanPhones: 0 });
    t.service.updateSettings({ wifiDirect: false, bluetooth: true });
    expect(t.native.left).toBe(1);
    expect(t.calls).toContain('wd-stop');
    expect(t.service.getStatus().kind).toBe('off');
    // Stays off on later ticks even while offline.
    const before = t.calls.length;
    await t.tick();
    expect(t.calls.slice(before)).not.toContain('wd-start');
    t.service.dispose();
  });

  it('turning Bluetooth off stops the beacon but keeps Wi-Fi discovery', async () => {
    const t = setup();
    await t.service.start();
    t.service.updateSettings({ wifiDirect: true, bluetooth: false });
    expect(t.calls.at(-1)).not.toMatch(/^ble:/);
    expect(t.calls).toContain('ble-stop');
    expect(t.calls).not.toContain('wd-stop');
    t.service.dispose();
  });

  it('reports searching while offline, standby while online, and LAN phones', async () => {
    const offline = setup();
    await offline.service.start();
    expect(offline.service.getStatus()).toEqual({ kind: 'searching', lanPhones: 0 });
    offline.service.dispose();
    const online = setup({ hubReachable: true });
    await online.service.start();
    online.emitLan('cccccccccccc', 'http://192.168.10.71:8088/gun');
    expect(online.service.getStatus()).toEqual({ kind: 'standby', lanPhones: 1 });
    online.service.dispose();
  });
});

describe('NearbyOfflineService on Android 7–9', () => {
  it('never starts offline Wi-Fi Direct (no prompt, no scanning, no group)', async () => {
    const t = setup();
    t.native.joinByCredential = false;
    await t.service.start();
    t.emitBle(encodeBlePresence({ id: '000000000000', canHost: true, joinByCredential: true, hostScore: 1, hosting: true }));
    await t.tick();
    expect(t.native.permissionRequests).toBe(0);
    expect(t.calls).not.toContain('wd-start');
    expect(t.native.joined).toHaveLength(0);
    expect(t.native.created).toHaveLength(0);
    t.service.dispose();
  });
});

describe('NearbyOfflineService join retry', () => {
  it('retries a failed join even while native keeps re-sending the failed state', async () => {
    const t = setup();
    await t.service.start();
    const host = () => t.emitBle(encodeBlePresence({ id: '000000000000', canHost: true, joinByCredential: true, hostScore: 1, hosting: true }));
    host();
    await t.tick();
    expect(t.native.joined).toHaveLength(1);
    t.native.set({ state: 'failed', reason: 'join-timeout' });
    await flush();
    for (let i = 0; i < 3; i += 1) {
      t.advance(10_000);
      t.native.set({ state: 'failed', reason: 'join-timeout' });
      await flush();
      host();
      await t.tick();
    }
    expect(t.native.joined.length).toBeGreaterThanOrEqual(2);
    t.service.dispose();
  });
});
