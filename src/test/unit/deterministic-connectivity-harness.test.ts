import { capabilityReport, DeterministicConnectivityHarness, type HarnessDiscovery, type HarnessRoute } from '../support/deterministic-connectivity-harness';

const object = { soul: 'users/bob/receivedTalks/alice/talk-1', objectId: 'talk-1', payload: { id: 'talk-1', title: 'Hello' } };

describe('deterministic redundancy harness', () => {
  test.each([
    ['hub', 'gun-wire'], ['known-peer', 'direct-libp2p'], ['dht', 'webrtc'], ['mdns', 'circuit-relay'],
    ['known-peer', 'peer-forward'], ['hub', 'mailbox'],
  ] as Array<[HarnessDiscovery, HarnessRoute]>)('isolates %s discovery with %s route', async (discovery, route) => {
    const harness = new DeterministicConnectivityHarness(); harness.configure({ discovery, route });
    await harness.deliver(object, { allowLowBatteryForwarding: true });
    expect(harness.oracle(object).ok).toBe(true); expect(harness.getAttempts()).toEqual([route]);
  });

  test('duplicate multi-path input still produces one durable/UI object', async () => {
    const harness = new DeterministicConnectivityHarness(); harness.configure({ discovery: 'dht', route: 'direct-libp2p', faults: { duplicate: 4 } });
    await harness.deliver(object); expect(harness.oracle(object).ok).toBe(true);
  });

  test('injects bounded latency and still converges', async () => {
    const harness = new DeterministicConnectivityHarness(); harness.configure({ discovery: 'mdns', route: 'webrtc', faults: { latencyMs: 500 } });
    await harness.deliver(object); expect(harness.oracle(object).ok).toBe(true);
  });

  test.each(['connectFailure', 'midSendDrop', 'corrupt', 'metered', 'lowBattery'] as const)('injects %s without false receipt', async (fault) => {
    const harness = new DeterministicConnectivityHarness();
    harness.configure({ discovery: 'known-peer', route: fault === 'lowBattery' ? 'peer-forward' : 'direct-libp2p', faults: { [fault]: true } });
    await expect(harness.deliver(object)).rejects.toThrow(); expect(harness.oracle(object).ok).toBe(false);
  });

  test.each([
    ['direct-libp2p', 'circuit-relay'], ['direct-libp2p', 'peer-forward'],
    ['circuit-relay', 'direct-libp2p'],
  ] as Array<[HarnessRoute, HarnessRoute]>)('transitions %s→%s with stable soul', async (first, second) => {
    const harness = new DeterministicConnectivityHarness(); harness.configure({ discovery: 'known-peer', route: first, faults: { connectFailure: true } });
    await expect(harness.deliver(object)).rejects.toThrow(); harness.configure({ discovery: 'known-peer', route: second }); await harness.deliver(object);
    expect(harness.oracle(object).ok).toBe(true); expect(harness.getAttempts()).toEqual([first, second]);
  });

  test('transitions LAN→cellular only with permission', async () => {
    const harness = new DeterministicConnectivityHarness(); harness.configure({ discovery: 'known-peer', route: 'gun-wire', faults: { connectFailure: true } });
    await expect(harness.deliver(object)).rejects.toThrow(); harness.configure({ discovery: 'hub', route: 'cellular-gun-wire' });
    await expect(harness.deliver(object)).rejects.toThrow('metered route denied');
    await harness.deliver(object, { allowMetered: true }); expect(harness.oracle(object).ok).toBe(true);
  });

  test('transitions live→mailbox→live without duplicate state', async () => {
    const harness = new DeterministicConnectivityHarness();
    harness.configure({ discovery: 'hub', route: 'direct-libp2p' }); await harness.deliver(object);
    harness.configure({ discovery: 'hub', route: 'mailbox' }); await harness.deliver(object);
    harness.configure({ discovery: 'hub', route: 'direct-libp2p' }); await harness.deliver(object);
    expect(harness.oracle(object).ok).toBe(true);
    expect(harness.getAttempts()).toEqual(['direct-libp2p', 'mailbox', 'direct-libp2p']);
  });

  test('server export contains no application bodies and report is machine-readable', async () => {
    const harness = new DeterministicConnectivityHarness(); harness.configure({ discovery: 'hub', route: 'gun-wire' }); await harness.deliver(object);
    expect(harness.exportServer().applicationBodies).toEqual([]);
    const report = JSON.parse(capabilityReport([{ discovery: 'hub', route: 'gun-wire', passed: true, assertions: harness.oracle(object).assertions }]));
    expect(report).toMatchObject({ version: 1, passed: true });
  });
});
