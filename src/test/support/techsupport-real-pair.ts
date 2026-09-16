import type { TechSupportSeaPair } from '../../shared/techsupport';

/**
 * Loads the real TechSupport signing key from this machine's own `.env.local`
 * (`TECHSUPPORT_SEA_PAIR_JSON`, sourced into `process.env` by `npm test`/`test:unit`/
 * `test:integration` before Jest starts). Rotated 2026-09-16 specifically so this key is never
 * committed to the repo — the previous value was a placeholder whose private half sat in
 * plaintext across multiple E2E fixture files in a public repo, so it was never actually
 * private. Tests that need to sign as TechSupport call this and skip themselves (see
 * `describeWithRealTechSupportPair`) when it's unset, rather than falling back to a hardcoded
 * fixture.
 *
 * CI impact: unless a CI job is separately given `TECHSUPPORT_SEA_PAIR_JSON` as a secret, these
 * tests will skip there. That's the intended tradeoff of not committing the real key anywhere —
 * add the secret to CI if you want this coverage to run there too.
 */
export function loadRealTechSupportPair(): TechSupportSeaPair | null {
  const raw = process.env.TECHSUPPORT_SEA_PAIR_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TechSupportSeaPair>;
    if (!parsed.pub || !parsed.priv || !parsed.epub || !parsed.epriv) return null;
    return parsed as TechSupportSeaPair;
  } catch {
    return null;
  }
}

/**
 * `describe.skip` when the real key isn't available locally, `describe` (running for real,
 * pair passed to the suite body) when it is — the standard shape for a suite that needs the
 * real TechSupport identity to sign anything.
 */
export function describeWithRealTechSupportPair(
  name: string,
  fn: (pair: TechSupportSeaPair) => void,
): void {
  const pair = loadRealTechSupportPair();
  if (!pair) {
    describe.skip(`${name} (skipped: no TECHSUPPORT_SEA_PAIR_JSON in .env.local)`, () => {
      it('is skipped', () => {});
    });
    return;
  }
  describe(name, () => fn(pair));
}
