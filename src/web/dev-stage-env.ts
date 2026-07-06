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
  return seed === 'stage-zero' || seed === 'empty';
}

export function getDevStageZeroMaxGlobalMembers(): number {
  const raw = process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL || '';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
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
  return seed === 'stage-zero' || seed === 'empty';
}
