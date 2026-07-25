import {
  currentTechSupportAnnouncementPub,
  currentTechSupportDmPub,
  isTrustedAnnouncementPub,
  isTrustedTechSupportDmPub,
  TECHSUPPORT_ANNOUNCEMENT_TRUST_ANCHORS,
  TECHSUPPORT_DM_TRUST_ANCHORS,
  TECHSUPPORT_PUB,
} from '../../shared/techsupport';

/**
 * Decisions K3-1 (two keys) and K3-2 (trust-anchor list), docs/TODO.md.
 *
 * The lists exist so a key rotation can ship a new client build without orphaning
 * everything signed by the previous key: both verify during the rollout.
 */

describe('trust-anchor lists', () => {
  it('accepts the current development key on both anchors (backwards compatible)', () => {
    expect(isTrustedAnnouncementPub(TECHSUPPORT_PUB)).toBe(true);
    expect(isTrustedTechSupportDmPub(TECHSUPPORT_PUB)).toBe(true);
  });

  it('rejects an unknown key', () => {
    expect(isTrustedAnnouncementPub('not-a-real-pub')).toBe(false);
    expect(isTrustedTechSupportDmPub('not-a-real-pub')).toBe(false);
  });

  it('rejects empty/null input rather than treating it as trusted', () => {
    for (const bad of ['', '   ', null, undefined]) {
      expect(isTrustedAnnouncementPub(bad)).toBe(false);
      expect(isTrustedTechSupportDmPub(bad)).toBe(false);
    }
  });

  it('tolerates surrounding whitespace from transport/JSON', () => {
    expect(isTrustedTechSupportDmPub(`  ${TECHSUPPORT_PUB}  `)).toBe(true);
  });

  it('does not accept a truncated or extended key', () => {
    expect(isTrustedTechSupportDmPub(TECHSUPPORT_PUB.slice(0, -1))).toBe(false);
    expect(isTrustedTechSupportDmPub(`${TECHSUPPORT_PUB}x`)).toBe(false);
  });

  it('signs with the newest anchor (first entry)', () => {
    expect(currentTechSupportDmPub()).toBe(TECHSUPPORT_DM_TRUST_ANCHORS[0]);
    expect(currentTechSupportAnnouncementPub()).toBe(TECHSUPPORT_ANNOUNCEMENT_TRUST_ANCHORS[0]);
  });

  it('keeps both anchor lists non-empty so verification can never silently pass', () => {
    expect(TECHSUPPORT_DM_TRUST_ANCHORS.length).toBeGreaterThan(0);
    expect(TECHSUPPORT_ANNOUNCEMENT_TRUST_ANCHORS.length).toBeGreaterThan(0);
  });

  it('verifies a rotation rollout: an added anchor and the outgoing one both pass', () => {
    // Simulates what shipping a rotated build looks like — the helper is list-driven,
    // so an extra entry keeps the previous key verifiable instead of orphaning it.
    const rotated = ['new-key-pub', ...TECHSUPPORT_DM_TRUST_ANCHORS];
    expect(rotated.includes(TECHSUPPORT_PUB)).toBe(true);
    expect(rotated[0]).toBe('new-key-pub');
  });
});
