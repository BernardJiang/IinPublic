/**
 * Dev stage seed from webpack EnvironmentPlugin (inlined at build time).
 * Do not guard with `typeof process` — webpack 5 browser bundles often have no `process`,
 * which would skip the inlined value and break stage-zero wipes.
 */
export function getDevStageSeed(): string {
  return process.env.IINPUBLIC_STAGE_SEED || '';
}

export function isDevStageZero(): boolean {
  const seed = getDevStageSeed();
  return seed === 'stage-zero' || seed === 'empty' || seed === 'multi';
}

export function getDevStageZeroMaxGlobalMembers(): number {
  const raw = process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL || '';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

/**
 * The stage-zero headcount self-heal (purge Gun graph + re-auth) assumes a single-user
 * empty network where a member count above the cap means a stray tab re-synced stale data.
 * In `multi` there are intentionally several real users, so that repair must NOT run — it
 * would wipe the shared graph and regenerate this window's SEA identity mid-session,
 * desyncing the published epub from the in-memory pair and breaking DM decryption.
 */
export function isDevStageZeroSelfHeal(): boolean {
  const seed = getDevStageSeed();
  return seed === 'stage-zero' || seed === 'empty';
}

/** Optional runtime fallback from index.html meta (set by webpack template). */
export function getDevStageSeedFromDom(): string {
  if (typeof document === 'undefined') return '';
  const meta = document.querySelector('meta[name="iinpublic-stage-seed"]');
  return meta?.getAttribute('content')?.trim() || '';
}

export function resolveDevStageSeed(): string {
  return getDevStageSeed() || getDevStageSeedFromDom();
}

export function isDevStageZeroResolved(): boolean {
  const seed = resolveDevStageSeed();
  return seed === 'stage-zero' || seed === 'empty' || seed === 'multi';
}

/**
 * dev:multi can launch one window as a TechSupport driver via `?devRole=techsupport`,
 * so a human can answer other users as TechSupport. That window logs in as the root
 * user instead of creating an ordinary Adam/Bob/Carol.
 */
export function isDevTechSupportDriver(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('devRole') === 'techsupport';
  } catch {
    return false;
  }
}
