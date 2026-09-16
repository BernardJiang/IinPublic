import SEA from 'gun/sea';
import {
  assertTechSupportDmPair,
  TECHSUPPORT_PAIR_MISMATCH_ERROR,
  TECHSUPPORT_PUB,
} from '../../shared/techsupport';

// assertTechSupportDmPair only checks shape + trust-anchor list membership — it never actually
// verifies priv/epriv cryptographically correspond to pub (that happens later, when the caller
// tries to gun.user().auth(pair) with it). So this fixture can be inert placeholder material
// rather than the real signing key: no real secret is needed to exercise this function.
const DEV_PAIR = {
  pub: TECHSUPPORT_PUB,
  priv: 'placeholder-not-a-real-key-shape-check-only',
  epub: 'placeholder-not-a-real-key-shape-check-only.placeholder-not-a-real-key-shape-check-only',
  epriv: 'placeholder-not-a-real-key-shape-check-only',
};

describe('assertTechSupportDmPair (docs/TODO.md K3)', () => {
  it('accepts the canonical dev pair whose pub is a trusted DM anchor', () => {
    expect(() => assertTechSupportDmPair(DEV_PAIR)).not.toThrow();
  });

  it('rejects a pair from a stranger key — the core "pub mismatches" case', async () => {
    const stranger = await SEA.pair();
    expect(() => assertTechSupportDmPair(stranger)).toThrow(TECHSUPPORT_PAIR_MISMATCH_ERROR);
  });

  it('rejects a pair whose pub is merely a substring/lookalike of the anchor', () => {
    expect(() => assertTechSupportDmPair({ ...DEV_PAIR, pub: DEV_PAIR.pub.slice(0, -1) })).toThrow(
      TECHSUPPORT_PAIR_MISMATCH_ERROR,
    );
  });

  it('rejects malformed input without leaking (missing fields, wrong types, null)', () => {
    expect(() => assertTechSupportDmPair(null)).toThrow(TECHSUPPORT_PAIR_MISMATCH_ERROR);
    expect(() => assertTechSupportDmPair(undefined)).toThrow(TECHSUPPORT_PAIR_MISMATCH_ERROR);
    expect(() => assertTechSupportDmPair('a string')).toThrow(TECHSUPPORT_PAIR_MISMATCH_ERROR);
    expect(() => assertTechSupportDmPair({})).toThrow(TECHSUPPORT_PAIR_MISMATCH_ERROR);
    expect(() => assertTechSupportDmPair({ pub: TECHSUPPORT_PUB })).toThrow(TECHSUPPORT_PAIR_MISMATCH_ERROR);
    expect(() => assertTechSupportDmPair({ ...DEV_PAIR, priv: undefined })).toThrow(
      TECHSUPPORT_PAIR_MISMATCH_ERROR,
    );
  });

  it('validates against the DM trust-anchor list, not a hand-rolled equality check (K3-2)', () => {
    // Documents the rotation contract: any pub in the list passes, not just the first entry.
    // Currently a one-element list, so this is the same case as the canonical-pair test above,
    // but it pins the *mechanism* (list membership) so it needs no rewrite once rotation adds a
    // second anchor.
    const { TECHSUPPORT_DM_TRUST_ANCHORS } = jest.requireActual('../../shared/techsupport');
    expect(TECHSUPPORT_DM_TRUST_ANCHORS).toContain(DEV_PAIR.pub);
    expect(() => assertTechSupportDmPair(DEV_PAIR)).not.toThrow();
  });
});
