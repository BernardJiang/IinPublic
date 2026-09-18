import trustAnchorConfig from '../../shared/techsupport-trust-anchors.json';
import {
  TECHSUPPORT_ANNOUNCEMENT_TRUST_ANCHORS,
  TECHSUPPORT_DM_TRUST_ANCHORS,
  TECHSUPPORT_PUB,
  currentTechSupportAnnouncementPub,
  currentTechSupportDmPub,
  isTrustedAnnouncementPub,
  isTrustedTechSupportDmPub,
} from '../../shared/techsupport';

describe('TechSupport trust-anchor config', () => {
  it.each(['dm', 'announcement'] as const)('%s current key is present exactly once in a non-empty trust list', (role) => {
    const entry = trustAnchorConfig[role];
    expect(entry.trusted.length).toBeGreaterThan(0);
    expect(new Set(entry.trusted).size).toBe(entry.trusted.length);
    expect(entry.trusted.filter((pub) => pub === entry.current)).toHaveLength(1);
  });

  it('exports the committed config without silently collapsing overlap anchors', () => {
    expect(currentTechSupportDmPub()).toBe(trustAnchorConfig.dm.current);
    expect(currentTechSupportAnnouncementPub()).toBe(trustAnchorConfig.announcement.current);
    expect(TECHSUPPORT_DM_TRUST_ANCHORS).toEqual(trustAnchorConfig.dm.trusted);
    expect(TECHSUPPORT_ANNOUNCEMENT_TRUST_ANCHORS).toEqual(trustAnchorConfig.announcement.trusted);
  });

  it('accepts the current key on both anchors', () => {
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

  it('orders the explicit current key first for deterministic signing and rollback', () => {
    expect(currentTechSupportDmPub()).toBe(TECHSUPPORT_DM_TRUST_ANCHORS[0]);
    expect(currentTechSupportAnnouncementPub()).toBe(TECHSUPPORT_ANNOUNCEMENT_TRUST_ANCHORS[0]);
  });

  it('models an overlap release without orphaning the outgoing key', () => {
    const rotated = ['new-key-pub', ...TECHSUPPORT_DM_TRUST_ANCHORS];
    expect(rotated.includes(TECHSUPPORT_PUB)).toBe(true);
    expect(rotated[0]).toBe('new-key-pub');
  });
});
