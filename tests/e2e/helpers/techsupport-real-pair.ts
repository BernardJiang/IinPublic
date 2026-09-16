import type { TechSupportSeaPair } from '../../../src/shared/techsupport';

/**
 * Loads the real TechSupport signing key from this machine's own `.env.local`
 * (`TECHSUPPORT_SEA_PAIR_JSON`, sourced into `process.env` by every `test:e2e*`/
 * `test:e2e:native-app*` npm script before Playwright starts). Rotated 2026-09-16 specifically
 * so this key is never committed to the repo — the previous value was a placeholder whose
 * private half sat in plaintext across multiple E2E spec files in a public repo, so it was
 * never actually private.
 *
 * Specs that need to boot a real browser/WebView as TechSupport (K3 mode) call this and
 * `test.skip(!pair, ...)` when it's unset, rather than hardcoding a fixture.
 *
 * CI impact: unless a CI job is separately given `TECHSUPPORT_SEA_PAIR_JSON` as a secret, these
 * specs will skip there. That's the intended tradeoff of not committing the real key anywhere —
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
