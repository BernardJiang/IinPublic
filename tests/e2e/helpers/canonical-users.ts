/** Canonical stage names for the E2E stage pipeline (see tests/e2e/staged/README.md). */
export const TECHSUPPORT = 'TechSupport';
export const ADAM = 'Adam';
export const EVE = 'Eve';

/** Legacy aliases used in older specs — map to canonical users in staged runs. */
export const LEGACY_TOM = 'Tom';
export const LEGACY_JERRY = 'Jerry';
export const LEGACY_BOB = 'Bob';
export const LEGACY_ALICE = 'Alice';

export type CanonicalUser = typeof TECHSUPPORT | typeof ADAM | typeof EVE;
