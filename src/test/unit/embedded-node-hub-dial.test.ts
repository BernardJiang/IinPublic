import { resolveUpstreamHubPeers } from '../../server/bootstrap/http-bootstrap';

describe('resolveUpstreamHubPeers (S3 embedded-node hub dial)', () => {
  const HUB_PEERS = ['https://www.iinpublic.com/gun'];

  it('does NOT dial generic Gun peers in default explicit HTTP relay mode', () => {
    const peers = resolveUpstreamHubPeers(
      { enabled: true, hubGunPeers: HUB_PEERS, hubRelayMode: 'explicit-http' },
      { e2eMemoryOnly: false, devGunFresh: false },
    );
    expect(peers).toEqual([]);
  });

  it('dials the configured hub peers in legacy gun-peer mode when no isolation flags are set', () => {
    const peers = resolveUpstreamHubPeers(
      { enabled: true, hubGunPeers: HUB_PEERS, hubRelayMode: 'gun-peer' },
      { e2eMemoryOnly: false, devGunFresh: false },
    );
    expect(peers).toEqual(HUB_PEERS);
  });

  it('does NOT dial when embedded mode is disabled (regular hub/dev server)', () => {
    const peers = resolveUpstreamHubPeers(
      { enabled: false, hubGunPeers: HUB_PEERS, hubRelayMode: 'gun-peer' },
      { e2eMemoryOnly: false, devGunFresh: false },
    );
    expect(peers).toEqual([]);
  });

  it('skips the dial under E2E_GUN_MEMORY_ONLY (explicit test isolation)', () => {
    const peers = resolveUpstreamHubPeers(
      { enabled: true, hubGunPeers: HUB_PEERS, hubRelayMode: 'gun-peer' },
      { e2eMemoryOnly: true, devGunFresh: false },
    );
    expect(peers).toEqual([]);
  });

  it('skips the dial under DEV_GUN_FRESH (explicit dev isolation)', () => {
    const peers = resolveUpstreamHubPeers(
      { enabled: true, hubGunPeers: HUB_PEERS, hubRelayMode: 'gun-peer' },
      { e2eMemoryOnly: false, devGunFresh: true },
    );
    expect(peers).toEqual([]);
  });

  // Regression: this used to be gated on a generic `isolatedGun` flag that also
  // folded in `ephemeralStarServer` (resolveP2PRuntimeFlags().starServerPersistence
  // === 'ephemeral'), which is hardcoded true for every boot since mesh talk
  // delivery shipped — see src/shared/p2p-runtime.ts resolveP2PRuntimeFlags().
  // That made the embedded node's hub dial unconditionally suppressed. This
  // function must NOT take starServerPersistence/relayOnlyHub into account at
  // all — only the two explicit isolation flags below.
  it('legacy gun-peer mode still dials the hub even though mesh talk delivery is on', () => {
    const peers = resolveUpstreamHubPeers(
      { enabled: true, hubGunPeers: HUB_PEERS, hubRelayMode: 'gun-peer' },
      { e2eMemoryOnly: false, devGunFresh: false },
    );
    expect(peers.length).toBeGreaterThan(0);
  });

  it('returns an empty array (not the configured peers) when embedded.hubGunPeers itself is empty', () => {
    const peers = resolveUpstreamHubPeers(
      { enabled: true, hubGunPeers: [], hubRelayMode: 'gun-peer' },
      { e2eMemoryOnly: false, devGunFresh: false },
    );
    expect(peers).toEqual([]);
  });
});
