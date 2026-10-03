import {
  classifySelectedPath,
  generateWifiDirectGroupCredentials,
  newWifiDirectLinkId,
  parseWifiDirectLinkMessage,
  planWifiDirectLink,
  selectedCandidatePairFromStats,
  type WifiDirectPeerInfo,
  type WifiDirectPlan,
} from '../../shared/wifi-direct-link';
import type { P2PConnectionState } from '../../web/services/p2p-webrtc-session';
import {
  WifiDirectLinkService,
  type LinkableSession,
  type WifiDirectNative,
  type WifiDirectNativeState,
} from '../../web/services/wifi-direct-link-service';
import { parseNativeWifiDirectState, resolveWifiDirectLinkFlag } from '../../web/services/android-wifi-direct-native';

const idle: WifiDirectPeerInfo = { canHost: true, joinByCredential: true, hostScore: 1 };
const group = { networkName: 'DIRECT-ab-IinPublic', passphrase: '0123456789abcdef', ownerDeviceAddress: 'aa:bb:cc:dd:ee:ff' };

async function plans(local: WifiDirectPeerInfo, remote: WifiDirectPeerInfo): Promise<[WifiDirectPlan, WifiDirectPlan]> {
  return Promise.all([
    planWifiDirectLink({ localPub: 'pub-alice', remotePub: 'pub-bob', local, remote }),
    planWifiDirectLink({ localPub: 'pub-bob', remotePub: 'pub-alice', local: remote, remote: local }),
  ]);
}

describe('Wi-Fi Direct host election', () => {
  test('two idle peers reach complementary plans via the SEA-pub hash tie-break', async () => {
    const [a, b] = await plans(idle, idle);
    expect([a.action, b.action].sort()).toEqual(['await-group', 'host']);
  });

  test('a higher host score (charging) hosts', async () => {
    const [a, b] = await plans({ ...idle, hostScore: 3 }, idle);
    expect(a).toEqual({ action: 'host', reuseExisting: false });
    expect(b).toEqual({ action: 'await-group' });
  });

  test('a pre-Android-10 device hosts so the Android 10+ peer joins prompt-free', async () => {
    const [a, b] = await plans({ ...idle, joinByCredential: false, hostScore: 0 }, { ...idle, hostScore: 3 });
    expect(a).toEqual({ action: 'host', reuseExisting: false });
    expect(b).toEqual({ action: 'await-group' });
  });

  test('only a host-capable device hosts; neither capable aborts', async () => {
    const [a, b] = await plans({ ...idle, canHost: false, hostScore: 3 }, idle);
    expect(a.action).toBe('await-group');
    expect(b.action).toBe('host');
    const [c] = await plans({ ...idle, canHost: false }, { ...idle, canHost: false });
    expect(c).toEqual({ action: 'abort', reason: 'no-host-capable-peer' });
  });

  test('joining an existing group beats forming a new one (owner or client re-shares)', async () => {
    for (const role of ['owner', 'client'] as const) {
      const [a, b] = await plans({ ...idle, group: { ...group, role } }, idle);
      expect(a).toEqual({ action: 'host', reuseExisting: true });
      expect(b).toEqual({ action: 'join', credentials: group });
    }
  });

  test('same group → already linked; different groups are not bridged', async () => {
    const [a] = await plans({ ...idle, group: { ...group, role: 'owner' } }, { ...idle, group: { ...group, role: 'client' } });
    expect(a).toEqual({ action: 'already-linked' });
    const [c] = await plans({ ...idle, group: { ...group, role: 'owner' } }, { ...idle, group: { ...group, networkName: 'DIRECT-zz-Other', role: 'owner' } });
    expect(c).toEqual({ action: 'abort', reason: 'both-in-different-groups' });
  });
});

describe('selected ICE path classification', () => {
  test.each([
    [{ localType: 'host', localAddress: '192.168.1.5', remoteType: 'host', remoteAddress: '192.168.1.9' }, 'lan'],
    [{ localType: 'host', localAddress: 'x.local', remoteType: 'prflx', remoteAddress: '10.0.0.2' }, 'lan'],
    [{ localType: 'host', localAddress: '192.168.49.1', remoteType: 'host', remoteAddress: '192.168.49.77' }, 'wifi-direct'],
    [{ localType: 'srflx', localAddress: '1.2.3.4', remoteType: 'srflx', remoteAddress: '5.6.7.8' }, 'internet'],
    [{ localType: 'host', localAddress: '10.1.1.1', remoteType: 'relay', remoteAddress: '9.9.9.9' }, 'relay'],
  ] as const)('%o → %s', (pair, expected) => {
    expect(classifySelectedPath({ ...pair })).toBe(expected);
  });

  test('missing selection is unknown', () => {
    expect(classifySelectedPath(null)).toBe('unknown');
  });

  test('reads the transport selectedCandidatePairId from a stats report', () => {
    const stats = new Map<string, Record<string, unknown>>([
      ['T1', { type: 'transport', selectedCandidatePairId: 'P2' }],
      ['P1', { type: 'candidate-pair', localCandidateId: 'L0', remoteCandidateId: 'R0', state: 'failed' }],
      ['P2', { type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1', state: 'succeeded' }],
      ['L1', { type: 'local-candidate', candidateType: 'host', address: '192.168.49.1' }],
      ['R1', { type: 'remote-candidate', candidateType: 'host', address: '192.168.49.20' }],
    ]);
    expect(selectedCandidatePairFromStats(stats)).toEqual({ localType: 'host', localAddress: '192.168.49.1', remoteType: 'host', remoteAddress: '192.168.49.20' });
  });
});

describe('link message validation', () => {
  const linkId = newWifiDirectLinkId();

  test('generated credentials satisfy the Android Builder contract', () => {
    const creds = generateWifiDirectGroupCredentials();
    expect(creds.networkName).toMatch(/^DIRECT-[A-Za-z0-9]{2}-IinPublic$/);
    expect(creds.passphrase).toMatch(/^[0-9a-f]{32}$/);
    expect(parseWifiDirectLinkMessage({ v: 1, kind: 'wd-group', linkId, credentials: creds })).not.toBeNull();
  });

  test('rejects malformed frames', () => {
    expect(parseWifiDirectLinkMessage({ v: 2, kind: 'wd-joined', linkId })).toBeNull();
    expect(parseWifiDirectLinkMessage({ v: 1, kind: 'wd-joined', linkId: 'nope' })).toBeNull();
    expect(parseWifiDirectLinkMessage({ v: 1, kind: 'wd-group', linkId, credentials: { networkName: 'Home', passphrase: '0123456789' } })).toBeNull();
    expect(parseWifiDirectLinkMessage({ v: 1, kind: 'wd-group', linkId, credentials: { ...group, passphrase: 'short' } })).toBeNull();
    expect(parseWifiDirectLinkMessage({ v: 1, kind: 'wd-hello', linkId, info: { ...idle, hostScore: 99 } })).toBeNull();
    expect(parseWifiDirectLinkMessage({ v: 1, kind: 'wd-hello', linkId, info: { ...idle, group: { ...group, role: 'boss' } } })).toBeNull();
    expect(parseWifiDirectLinkMessage({ v: 1, kind: 'wd-hello', linkId, info: idle })).not.toBeNull();
    expect(parseWifiDirectLinkMessage({ v: 1, kind: 'wd-group', linkId, credentials: { ...group, frequencyMhz: 5765 } })).not.toBeNull();
    expect(parseWifiDirectLinkMessage({ v: 1, kind: 'wd-group', linkId, credentials: { ...group, frequencyMhz: 99 } })).toBeNull();
    expect(parseWifiDirectLinkMessage({ v: 1, kind: 'wd-group', linkId, credentials: { ...group, frequencyMhz: 2437.5 } })).toBeNull();
  });
});

describe('feature flag + native state parsing', () => {
  function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
    const map = new Map<string, string>();
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
  }

  test('off by default; query param persists', () => {
    const storage = memoryStorage();
    expect(resolveWifiDirectLinkFlag('', storage)).toBe(false);
    expect(resolveWifiDirectLinkFlag('?wifi_direct_link=1', storage)).toBe(true);
    expect(resolveWifiDirectLinkFlag('', storage)).toBe(true);
    expect(resolveWifiDirectLinkFlag('?wifi_direct_link=0', storage)).toBe(false);
    expect(resolveWifiDirectLinkFlag('', storage)).toBe(false);
  });

  test('unknown native fields are dropped', () => {
    expect(parseNativeWifiDirectState({ state: 'owner', networkName: 'DIRECT-ab-x', passphrase: 'p', bogus: 1, clientCount: 2 }))
      .toEqual({ state: 'owner', networkName: 'DIRECT-ab-x', passphrase: 'p', clientCount: 2 });
    expect(parseNativeWifiDirectState({ state: 'weird' })).toEqual({ state: 'idle' });
  });
});

// ── Service end-to-end with fake radios + paired sessions ─────────────────────────────────────

type PathRef = { kind: 'internet' | 'wifi-direct' | 'lan' };

class FakeSession implements LinkableSession {
  peer!: FakeSession;
  state: P2PConnectionState = 'connected';
  reconnects = 0;
  overrideCalls: Array<string | null> = [];
  private override: RTCConfiguration | null = null;
  /** Simulates a chipset that does not forward between group members. */
  relayBroken = false;
  private listeners = new Set<(state: P2PConnectionState) => void>();
  private hook: ((message: unknown) => void | Promise<void>) | null = null;
  constructor(readonly otherUserId: string, readonly otherPub: string, readonly isInitiator: boolean, private readonly path: PathRef, private readonly radios: { a: FakeNative; b: FakeNative }) {}
  getState(): P2PConnectionState { return this.state; }
  onStateChange(listener: (state: P2PConnectionState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  setOnLinkUpgradeMessage(hook: ((message: unknown) => void | Promise<void>) | null): void { this.hook = hook; }
  async sendLinkUpgradeMessage(message: unknown): Promise<void> {
    const copy = JSON.parse(JSON.stringify(message));
    setTimeout(() => { void this.peer.hook?.(copy); }, 1);
  }
  async getSelectedCandidatePair() {
    const addresses = this.path.kind === 'wifi-direct' ? ['192.168.49.1', '192.168.49.50'] : ['1.2.3.4', '5.6.7.8'];
    const type = this.path.kind === 'internet' ? 'srflx' : 'host';
    return { localType: type, localAddress: addresses[0], remoteType: type, remoteAddress: addresses[1] };
  }
  setIceConfigOverride(config: RTCConfiguration | null): void {
    this.override = config;
    this.overrideCalls.push(config ? `${config.iceTransportPolicy}:${String(config.iceServers?.[0]?.urls)}` : null);
  }
  emit(state: P2PConnectionState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener(state);
  }
  private reconnecting = false;
  async reconnect(): Promise<void> {
    this.reconnects += 1;
    this.reconnecting = true;
    // Closing this side's connection drops the peer's old one too (found on hardware: the
    // responder switches first and the initiator's DataChannel closes under it).
    if (this.peer.state === 'connected' && !this.peer.reconnecting) this.peer.emit('failed');
    this.emit('idle');
    this.emit('connecting');
    try {
      await this.connectFresh();
    } finally {
      this.reconnecting = false;
    }
  }
  private async connectFresh(): Promise<void> {
    // A fresh connection needs the peer's fresh connection too (offer/answer between new pcs).
    const deadline = Date.now() + 400;
    while (this.peer.reconnects < this.reconnects) {
      if (Date.now() > deadline) { this.emit('failed'); throw new Error('WebRTC connection timeout'); }
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await new Promise((resolve) => setTimeout(resolve, 3));
    if (!this.override) {
      this.path.kind = 'internet';
      this.emit('connected');
      return;
    }
    // A relay-only connection comes up only when both radios really share a group.
    const { a, b } = this.radios;
    const shared = a.state.networkName && a.state.networkName === b.state.networkName && ['owner', 'client'].includes(a.state.state) && ['owner', 'client'].includes(b.state.state);
    if (!shared || this.relayBroken) {
      this.emit('failed');
      throw new Error('WebRTC connection timeout');
    }
    this.path.kind = 'wifi-direct';
    this.emit('connected');
  }
}

class FakeNative implements WifiDirectNative {
  state: WifiDirectNativeState = { state: 'idle' };
  calls: string[] = [];
  /** Owner's group, so a joiner can only succeed with the right passphrase. */
  static owned: { networkName: string; passphrase: string } | null = null;
  failCreate = false;
  private listeners = new Set<(state: WifiDirectNativeState) => void>();
  constructor(private readonly caps = { wifiDirect: true, joinByCredential: true, hostScore: 1 }) {}
  capabilities() { return this.caps; }
  async requestPermission() { this.calls.push('permission'); return true; }
  createGroup(creds: { networkName: string; passphrase: string }): void {
    this.calls.push('create');
    this.emit({ state: 'forming' });
    setTimeout(() => {
      if (this.failCreate) return this.emit({ state: 'failed', reason: 'create:busy' });
      FakeNative.owned = { networkName: creds.networkName, passphrase: creds.passphrase };
      this.emit({ state: 'owner', networkName: creds.networkName, passphrase: creds.passphrase, ownerDeviceAddress: 'aa:bb:cc:dd:ee:ff', frequencyMhz: 5765, ownerIp: '192.168.49.1', localIp: '192.168.49.1' });
    }, 2);
  }
  lastJoin: { networkName: string; passphrase: string; frequencyMhz?: number } | null = null;
  joinGroup(creds: { networkName: string; passphrase: string; frequencyMhz?: number }): void {
    this.calls.push(`join:${creds.networkName}`);
    this.lastJoin = creds;
    this.emit({ state: 'joining' });
    setTimeout(() => {
      const ok = FakeNative.owned?.networkName === creds.networkName && FakeNative.owned.passphrase === creds.passphrase;
      this.emit(ok ? { state: 'client', networkName: creds.networkName, ownerIp: '192.168.49.1', localIp: '192.168.49.50' } : { state: 'failed', reason: 'join:error' });
    }, 2);
  }
  leaveGroup(): void { this.calls.push('leave'); this.emit({ state: 'idle' }); }
  getState() { return this.state; }
  onState(listener: (state: WifiDirectNativeState) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(state: WifiDirectNativeState) { this.state = state; for (const l of this.listeners) l(state); }
}

function setup(options: { path?: PathRef['kind']; capsB?: { wifiDirect: boolean; joinByCredential: boolean; hostScore: number } } = {}) {
  FakeNative.owned = null;
  const path: PathRef = { kind: options.path ?? 'internet' };
  const radioA = new FakeNative({ wifiDirect: true, joinByCredential: true, hostScore: 3 });
  const radioB = new FakeNative(options.capsB);
  const radios = { a: radioA, b: radioB };
  const sessionA = new FakeSession('bob', 'pub-bob', true, path, radios);
  const sessionB = new FakeSession('alice', 'pub-alice', false, path, radios);
  sessionA.peer = sessionB; sessionB.peer = sessionA;
  const relay = (name: string) => ({
    started: [] as string[],
    stops: 0,
    async start(address: string) { this.started.push(address); return { urls: `turn:127.0.0.1:1?${name}`, username: 'u', credential: 'p' }; },
    async stop() { this.stops += 1; },
  });
  const relayA = relay('a');
  const relayB = relay('b');
  const timing = { decisionDelayMs: 5, verifyDelayMs: 5, switchDelayMs: 5, switchTimeoutMs: 500, verifyAttempts: 3, idleTeardownMs: 20, upgradeTimeoutMs: 2_000, retryCooldownMs: 60_000 };
  const serviceA = new WifiDirectLinkService({ localPub: 'pub-alice', native: radioA, localRelay: relayA, ...timing });
  const serviceB = new WifiDirectLinkService({ localPub: 'pub-bob', native: radioB, localRelay: relayB, ...timing });
  serviceA.attach(sessionA);
  serviceB.attach(sessionB);
  debugState = () => `${serviceA.getPhase('bob')}/${serviceB.getPhase('alice')} A=${sessionA.state} B=${sessionB.state}`;
  return { path, radioA, radioB, sessionA, sessionB, serviceA, serviceB, relayA, relayB };
}

let debugState: (() => string) | null = null;
async function waitFor(predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met' + (debugState ? ' ' + debugState() : ''));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('WifiDirectLinkService', () => {
  test('internet path → elected host forms a group, peer joins, both switch to their group relays', async () => {
    const t = setup();
    try {
      await waitFor(() => t.serviceA.getPhase('bob') === 'active' && t.serviceB.getPhase('alice') === 'active');
      // Alice charges (hostScore 3) → she hosts; Bob joins with the credentials she sent.
      expect(t.radioA.calls).toEqual(['permission', 'create']);
      expect(t.radioB.calls).toEqual(['permission', `join:${FakeNative.owned!.networkName}`]);
      // The joiner scans the owner's channel (2.4 GHz station vs 5 GHz owner, found on hardware).
      expect(t.radioB.lastJoin?.frequencyMhz).toBe(5765);
      // Both replace their connection with a relay-only one (an ICE restart would keep the old pair).
      expect(t.sessionA.reconnects).toBe(1);
      expect(t.sessionB.reconnects).toBe(1);
      expect(t.path.kind).toBe('wifi-direct');
      // Each side routes through its own loopback relay bound to its group address.
      expect(t.relayA.started).toEqual(['192.168.49.1']);
      expect(t.relayB.started).toEqual(['192.168.49.50']);
      expect(t.sessionA.overrideCalls).toEqual(['relay:turn:127.0.0.1:1?a']);
      expect(t.sessionB.overrideCalls).toEqual(['relay:turn:127.0.0.1:1?b']);
    } finally {
      t.serviceA.dispose(); t.serviceB.dispose();
    }
  });

  test('a second session to the same peer reuses the group (already-linked → relay switch only)', async () => {
    const t = setup();
    try {
      await waitFor(() => t.serviceA.getPhase('bob') === 'active' && t.serviceB.getPhase('alice') === 'active');
      const dmPath: PathRef = { kind: 'internet' };
      const radios = { a: t.radioA, b: t.radioB };
      const dmA = new FakeSession('bob', 'pub-bob', false, dmPath, radios);
      const dmB = new FakeSession('alice', 'pub-alice', true, dmPath, radios);
      dmA.peer = dmB; dmB.peer = dmA;
      t.serviceA.attach(dmA);
      t.serviceB.attach(dmB);
      await waitFor(() => dmPath.kind === 'wifi-direct');
      expect(dmA.reconnects).toBe(1);
      expect(dmB.reconnects).toBe(1);
      expect(t.radioA.calls.filter((call) => call === 'create')).toHaveLength(1);
      expect(t.radioB.calls.filter((call) => call.startsWith('join'))).toHaveLength(1);
    } finally {
      t.serviceA.dispose(); t.serviceB.dispose();
    }
  });

  test('same-LAN path is left alone', async () => {
    const t = setup({ path: 'lan' });
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(t.radioA.calls).toEqual([]);
      expect(t.radioB.calls).toEqual([]);
      expect(t.serviceA.getPhase('bob')).toBe('idle');
    } finally {
      t.serviceA.dispose(); t.serviceB.dispose();
    }
  });

  test('a peer without Wi-Fi Direct aborts the upgrade and both sides cool down', async () => {
    const t = setup({ capsB: { wifiDirect: false, joinByCredential: false, hostScore: 0 } });
    try {
      await waitFor(() => t.serviceA.getPhase('bob') === 'cooldown');
      expect(t.radioA.calls).not.toContain('create');
      expect(t.path.kind).toBe('internet');
    } finally {
      t.serviceA.dispose(); t.serviceB.dispose();
    }
  });

  test('group creation failure aborts both sides without touching the path', async () => {
    const t = setup();
    t.radioA.failCreate = true;
    try {
      await waitFor(() => t.serviceA.getPhase('bob') === 'cooldown' && t.serviceB.getPhase('alice') === 'cooldown');
      expect(t.radioB.calls.some((call) => call.startsWith('join'))).toBe(false);
      expect(t.path.kind).toBe('internet');
    } finally {
      t.serviceA.dispose(); t.serviceB.dispose();
    }
  });

  test('a relay switch that cannot connect falls back to normal ICE and tears the group down', async () => {
    const t = setup();
    t.sessionA.relayBroken = true;
    t.sessionB.relayBroken = true;
    try {
      await waitFor(() => t.serviceA.getPhase('bob') === 'cooldown');
      await waitFor(() => t.radioA.calls.includes('leave') && t.radioB.calls.includes('leave'));
      expect(t.path.kind).toBe('internet');
      // Relay-only is dropped and both reconnect on the normal ICE servers.
      expect(t.sessionA.overrideCalls).toEqual(['relay:turn:127.0.0.1:1?a', null]);
      expect(t.sessionB.overrideCalls).toEqual(['relay:turn:127.0.0.1:1?b', null]);
      expect(t.sessionA.reconnects).toBe(2);
      expect(t.sessionA.state).toBe('connected');
      expect(t.relayA.stops).toBeGreaterThan(0);
    } finally {
      t.serviceA.dispose(); t.serviceB.dispose();
    }
  });

  test('session loss after linking releases the group after the idle window', async () => {
    const t = setup();
    try {
      await waitFor(() => t.serviceA.getPhase('bob') === 'active' && t.serviceB.getPhase('alice') === 'active');
      t.sessionA.state = 'failed';
      (t.sessionA as unknown as { listeners: Set<(s: P2PConnectionState) => void> }).listeners.forEach((l) => l('failed'));
      await waitFor(() => t.radioA.calls.includes('leave'));
      expect(t.serviceA.getPhase('bob')).toBe('idle');
    } finally {
      t.serviceA.dispose(); t.serviceB.dispose();
    }
  });
});
