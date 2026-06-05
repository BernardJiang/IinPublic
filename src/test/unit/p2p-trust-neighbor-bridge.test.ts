import {
  isTrustCapableForOffer,
  neighborRecordWithTrust,
  trustLevelFromNeighborRecord,
} from '../../shared/p2p-trust-neighbor-bridge';
import {
  createDefaultPeerTrustRecord,
  applyTrustLevelChange,
} from '../../shared/p2p-trust';
import type { P2PNeighborRecord } from '../../shared/p2p-runtime';

function makeNeighbor(trustStatus: P2PNeighborRecord['trustStatus']): P2PNeighborRecord {
  return {
    peerId: 'peer_1',
    endpointHints: ['ws://localhost:8765'],
    lastSeenAt: new Date().toISOString(),
    successfulSessions: 1,
    latencyMs: 10,
    transportType: 'webrtc-datachannel',
    capabilities: ['signed-discovery'],
    trustStatus,
    endpointStatus: 'active',
    expiresAt: new Date(Date.now() + 1_000_000).toISOString(),
    nearbyChatrooms: [],
    isContact: false,
  };
}

describe('trustLevelFromNeighborRecord', () => {
  it('maps blocked → blocked', () => {
    expect(trustLevelFromNeighborRecord(makeNeighbor('blocked'))).toBe('blocked');
  });
  it('maps trusted → friend', () => {
    expect(trustLevelFromNeighborRecord(makeNeighbor('trusted'))).toBe('friend');
  });
  it('maps unknown → unknown', () => {
    expect(trustLevelFromNeighborRecord(makeNeighbor('unknown'))).toBe('unknown');
  });
});

describe('neighborRecordWithTrust', () => {
  it('sets trustStatus to blocked when trust record is blocked', () => {
    const neighbor = makeNeighbor('unknown');
    let trust = createDefaultPeerTrustRecord('peer_1', 'pub_1');
    trust = applyTrustLevelChange(trust, 'blocked', { source: 'user' });
    const updated = neighborRecordWithTrust(neighbor, trust);
    expect(updated.trustStatus).toBe('blocked');
  });

  it('sets trustStatus to trusted when trust record is friend', () => {
    const neighbor = makeNeighbor('unknown');
    let trust = createDefaultPeerTrustRecord('peer_1', 'pub_1');
    trust = applyTrustLevelChange(trust, 'friend', { source: 'user' });
    const updated = neighborRecordWithTrust(neighbor, trust);
    expect(updated.trustStatus).toBe('trusted');
  });

  it('sets trustStatus to trusted when trust record is verified', () => {
    const neighbor = makeNeighbor('unknown');
    let trust = createDefaultPeerTrustRecord('peer_1', 'pub_1');
    trust = applyTrustLevelChange(trust, 'verified', { source: 'user' });
    const updated = neighborRecordWithTrust(neighbor, trust);
    expect(updated.trustStatus).toBe('trusted');
  });

  it('does not mutate the original record', () => {
    const neighbor = makeNeighbor('unknown');
    const trust = createDefaultPeerTrustRecord('peer_1', 'pub_1');
    neighborRecordWithTrust(neighbor, trust);
    expect(neighbor.trustStatus).toBe('unknown');
  });
});

describe('isTrustCapableForOffer', () => {
  it('allows unknown peer (no trust record) for receive-broadcast', () => {
    expect(isTrustCapableForOffer(undefined, 'receive-broadcast')).toBe(true);
  });

  it('blocks a blocked peer', () => {
    let trust = createDefaultPeerTrustRecord('peer_1', 'pub_1');
    trust = applyTrustLevelChange(trust, 'blocked', { source: 'user' });
    expect(isTrustCapableForOffer(trust, 'receive-broadcast')).toBe(false);
  });

  it('allows a friend peer for receive-broadcast', () => {
    let trust = createDefaultPeerTrustRecord('peer_1', 'pub_1');
    trust = applyTrustLevelChange(trust, 'friend', { source: 'user' });
    expect(isTrustCapableForOffer(trust, 'receive-broadcast')).toBe(true);
  });

  it('allows a verified peer for exchange-talks', () => {
    let trust = createDefaultPeerTrustRecord('peer_1', 'pub_1');
    trust = applyTrustLevelChange(trust, 'verified', { source: 'user' });
    expect(isTrustCapableForOffer(trust, 'exchange-talks')).toBe(true);
  });

  it('blocks unknown peer for exchange-talks', () => {
    const trust = createDefaultPeerTrustRecord('peer_1', 'pub_1');
    expect(isTrustCapableForOffer(trust, 'exchange-talks')).toBe(false);
  });
});
