import { DEFAULT_FORWARDING_SETTINGS, MeshForwardingPolicy, classifyForwardingFrame } from '../../shared/mesh-forwarding-policy';
import type { P2PMeshFrame } from '../../shared/p2p-mesh-protocol';

function frame(overrides: Partial<P2PMeshFrame> = {}): P2PMeshFrame {
  return { version: 1, kind: 'talk-body', msgId: 'm1', roomId: 'global', originUserId: 'alice', originPub: 'alice-pub', recipientUserId: 'bob', createdAt: new Date().toISOString(), ttlHops: 5, payload: { talkId: 't', authorId: 'alice', authorName: 'Alice', title: 'T', questionCount: 1, talkData: {} }, ...overrides };
}

describe('configurable mesh forwarding policy', () => {
  const wifi = { routeId: 'wifi-carol', interface: 'wifi' as const, lowBattery: false };
  const cellular = { routeId: 'cell-carol', interface: 'cellular' as const, lowBattery: false };

  test('defaults are enabled on Wi-Fi and disabled/budget-zero on cellular', () => {
    expect(DEFAULT_FORWARDING_SETTINGS).toMatchObject({ enabled: true, wifiForwarding: true, cellularForwarding: false, lowBatteryPause: true, cellularByteBudget: 0 });
  });

  test('Alice→Carol→Bob is permitted on Wi-Fi by default', () => {
    const policy = new MeshForwardingPolicy();
    expect(policy.evaluate(frame(), 'carol', wifi, 100).allowed).toBe(true);
  });

  test('disabling Carol forwarding blocks the third-party path', () => {
    const policy = new MeshForwardingPolicy({ enabled: false });
    expect(policy.evaluate(frame(), 'carol', wifi, 100)).toMatchObject({ allowed: false, frameClass: 'third-party' });
  });

  test('low battery and cellular independently stop only forwarded traffic', () => {
    const low = new MeshForwardingPolicy();
    expect(low.evaluate(frame(), 'carol', { ...wifi, lowBattery: true }, 100).allowed).toBe(false);
    expect(low.evaluate(frame({ originUserId: 'carol' }), 'carol', { ...wifi, lowBattery: true }, 100).allowed).toBe(true);
    const cell = new MeshForwardingPolicy();
    expect(cell.evaluate(frame(), 'carol', cellular, 100).allowed).toBe(false);
    expect(cell.evaluate(frame({ recipientUserId: 'carol' }), 'carol', cellular, 100).allowed).toBe(true);
  });

  test('enforces per-route bytes and records diagnostics', () => {
    const policy = new MeshForwardingPolicy({ routeByteBudget: 150 });
    expect(policy.evaluate(frame(), 'carol', wifi, 100).allowed).toBe(true);
    policy.recordForwarded(wifi.routeId, 100);
    expect(policy.evaluate(frame(), 'carol', wifi, 60).allowed).toBe(false);
    expect(policy.diagnostics()).toMatchObject({ bytesByRoute: { 'wifi-carol': 100 }, forwardedFrames: 1, droppedFrames: 1 });
  });

  test('rate-limits abusive third-party forwarding per route', () => {
    const policy = new MeshForwardingPolicy({ maxFramesPerRoutePerMinute: 1 });
    expect(policy.evaluate(frame(), 'carol', wifi, 1).allowed).toBe(true);
    policy.recordForwarded(wifi.routeId, 1);
    expect(policy.evaluate(frame({ msgId: 'm2' }), 'carol', wifi, 1).allowed).toBe(false);
    expect(policy.diagnostics().abuseDrops).toBe(1);
  });

  test('classifies discovery gossip separately and preserves original authorship', () => {
    const { recipientUserId: _recipient, ...withoutRecipient } = frame({ kind: 'talk-announce' });
    const original = withoutRecipient as P2PMeshFrame;
    expect(classifyForwardingFrame(original, 'carol')).toBe('discovery-gossip');
    const forwarded = { ...original, ttlHops: original.ttlHops - 1 };
    expect(forwarded).toMatchObject({ originUserId: 'alice', originPub: 'alice-pub', msgId: original.msgId });
  });
});
