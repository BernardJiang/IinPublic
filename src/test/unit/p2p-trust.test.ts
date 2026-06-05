import {
  CAPABILITY_TRUST_REQUIREMENTS,
  applyTrustLevelChange,
  capabilitiesForTrustLevel,
  createDefaultPeerTrustRecord,
  exportTrustStore,
  importTrustStore,
  isTrustCapable,
  toLegacyTrustStatus,
  upsertPeerTrustRecord,
  type PeerTrustRecord,
  type TrustLevel,
} from '../../shared/p2p-trust';

const peer = (overrides: Partial<PeerTrustRecord> = {}): PeerTrustRecord => ({
  version: 1,
  peerId: 'peer_1',
  pub: 'pub_1',
  trustLevel: 'unknown',
  setAt: null,
  userSet: false,
  ...overrides,
});

describe('createDefaultPeerTrustRecord', () => {
  it('creates an unknown, not-user-set record', () => {
    const r = createDefaultPeerTrustRecord('peer_1', 'pub_1');
    expect(r.trustLevel).toBe('unknown');
    expect(r.userSet).toBe(false);
    expect(r.setAt).toBeNull();
  });

  it('throws on missing peerId', () => {
    expect(() => createDefaultPeerTrustRecord('', 'pub_1')).toThrow(/peerId/);
  });

  it('throws on missing pub', () => {
    expect(() => createDefaultPeerTrustRecord('peer_1', '')).toThrow(/pub/);
  });
});

describe('isTrustCapable', () => {
  const CASES: Array<[TrustLevel, keyof typeof CAPABILITY_TRUST_REQUIREMENTS, boolean]> = [
    ['blocked', 'receive-broadcast', false],
    ['blocked', 'exchange-talks', false],
    ['unknown', 'receive-broadcast', true],
    ['unknown', 'initiate-contact', true],
    ['unknown', 'exchange-talks', false],
    ['unknown', 'high-trust-affordances', false],
    ['friend', 'exchange-talks', true],
    ['friend', 'high-trust-affordances', false],
    ['verified', 'high-trust-affordances', true],
    ['verified', 'exchange-talks', true],
  ];

  it.each(CASES)('%s + %s → %s', (level, cap, expected) => {
    expect(isTrustCapable(level, cap)).toBe(expected);
  });
});

describe('capabilitiesForTrustLevel', () => {
  it('blocked has no capabilities', () => {
    expect(capabilitiesForTrustLevel('blocked')).toEqual([]);
  });

  it('unknown has limited capabilities', () => {
    const caps = capabilitiesForTrustLevel('unknown');
    expect(caps).toContain('receive-broadcast');
    expect(caps).not.toContain('exchange-talks');
    expect(caps).not.toContain('high-trust-affordances');
  });

  it('friend has exchange-talks', () => {
    const caps = capabilitiesForTrustLevel('friend');
    expect(caps).toContain('exchange-talks');
    expect(caps).not.toContain('high-trust-affordances');
  });

  it('verified has all capabilities', () => {
    const caps = capabilitiesForTrustLevel('verified');
    expect(caps).toContain('high-trust-affordances');
    expect(caps).toContain('exchange-talks');
  });
});

describe('applyTrustLevelChange', () => {
  it('user can promote unknown → friend', () => {
    const r = applyTrustLevelChange(peer(), 'friend', { source: 'user' });
    expect(r.trustLevel).toBe('friend');
    expect(r.userSet).toBe(true);
    expect(r.setAt).not.toBeNull();
  });

  it('user can promote to verified', () => {
    const r = applyTrustLevelChange(peer({ trustLevel: 'friend', userSet: true }), 'verified', { source: 'user' });
    expect(r.trustLevel).toBe('verified');
  });

  it('user can block', () => {
    const r = applyTrustLevelChange(peer(), 'blocked', { source: 'user' });
    expect(r.trustLevel).toBe('blocked');
    expect(r.userSet).toBe(true);
  });

  it('user can un-block', () => {
    const blocked = peer({ trustLevel: 'blocked', userSet: true });
    const r = applyTrustLevelChange(blocked, 'unknown', { source: 'user' });
    expect(r.trustLevel).toBe('unknown');
  });

  it('reputation cannot override a user-set block', () => {
    const blocked = peer({ trustLevel: 'blocked', userSet: true });
    const r = applyTrustLevelChange(blocked, 'friend', { source: 'reputation' });
    expect(r.trustLevel).toBe('blocked');
  });

  it('reputation cannot demote a user-set friend below friend', () => {
    const friend = peer({ trustLevel: 'friend', userSet: true });
    const r = applyTrustLevelChange(friend, 'unknown', { source: 'reputation' });
    expect(r.trustLevel).toBe('friend');
  });

  it('reputation can promote an unknown non-user-set peer', () => {
    const r = applyTrustLevelChange(peer(), 'friend', { source: 'reputation' });
    expect(r.trustLevel).toBe('friend');
    expect(r.userSet).toBe(false);
  });

  it('trust survives serialise/deserialise round-trip', () => {
    const store = new Map<string, PeerTrustRecord>();
    const r = peer({ trustLevel: 'verified', userSet: true, setAt: '2026-01-01T00:00:00.000Z' });
    upsertPeerTrustRecord(store, r);
    const exported = exportTrustStore(store);
    const imported = importTrustStore(exported);
    expect(imported.get('peer_1')).toEqual(r);
  });
});

describe('toLegacyTrustStatus', () => {
  it('maps blocked → blocked', () => expect(toLegacyTrustStatus('blocked')).toBe('blocked'));
  it('maps friend → trusted', () => expect(toLegacyTrustStatus('friend')).toBe('trusted'));
  it('maps verified → trusted', () => expect(toLegacyTrustStatus('verified')).toBe('trusted'));
  it('maps unknown → unknown', () => expect(toLegacyTrustStatus('unknown')).toBe('unknown'));
});

describe('upsertPeerTrustRecord', () => {
  it('is idempotent for identical records', () => {
    const store = new Map<string, PeerTrustRecord>();
    const r = peer({ trustLevel: 'friend', userSet: true });
    upsertPeerTrustRecord(store, r);
    upsertPeerTrustRecord(store, { ...r });
    expect(store.size).toBe(1);
  });

  it('updates when trust level changes', () => {
    const store = new Map<string, PeerTrustRecord>();
    upsertPeerTrustRecord(store, peer());
    upsertPeerTrustRecord(store, peer({ trustLevel: 'friend', userSet: true }));
    expect(store.get('peer_1')?.trustLevel).toBe('friend');
  });
});

describe('export/import trust store', () => {
  it('produces a stable sorted export', () => {
    const store = importTrustStore([
      peer({ peerId: 'peer_b', pub: 'pub_b', trustLevel: 'friend' }),
      peer({ peerId: 'peer_a', pub: 'pub_a', trustLevel: 'verified' }),
    ]);
    const exported = exportTrustStore(store);
    expect(exported[0].peerId).toBe('peer_a');
    expect(exported[1].peerId).toBe('peer_b');
  });

  it('drops records with missing peerId or pub', () => {
    const store = importTrustStore([
      { version: 1, peerId: '', pub: 'pub', trustLevel: 'unknown', setAt: null, userSet: false },
      { version: 1, peerId: 'peer_1', pub: '', trustLevel: 'unknown', setAt: null, userSet: false },
    ]);
    expect(store.size).toBe(0);
  });
});
