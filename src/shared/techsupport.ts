import type { User } from './types';

export const TECHSUPPORT_STAGE_NAME = 'TechSupport';
export const TECHSUPPORT_ROOT_USER_ID = 'iinpublic-root-techsupport';
/** Development trust anchor. Replace this public key together with the server secret before production. */
export const TECHSUPPORT_PUB = 'mYRexxiSF2FG3oV-3-LKXEtisnUv5JQ9nDHbRANxiZo.jRqTX1_rg0v3BbFWYt1ZqGwBRG7wzg44IKgPobrSpfQ';
export const TECHSUPPORT_NETWORK_ROLE = 'root-techsupport';
export const TECHSUPPORT_HEADSHOT = 'TS';

export const RESERVED_STAGE_NAMES = [
  TECHSUPPORT_STAGE_NAME,
  'admin',
  'administrator',
  'api',
  'root',
  'system',
  'support',
  'www',
] as const;

export function normalizeReservedStageName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s._-]+/g, '');
}

const RESERVED_NORMALIZED = new Set(RESERVED_STAGE_NAMES.map(normalizeReservedStageName));

export function isReservedStageName(stageName: string): boolean {
  return RESERVED_NORMALIZED.has(normalizeReservedStageName(stageName));
}

export function isTechSupportUser(user: Pick<User, 'id' | 'stageName'> | undefined | null): boolean {
  if (!user) return false;
  return user.id === TECHSUPPORT_ROOT_USER_ID || normalizeReservedStageName(user.stageName) === normalizeReservedStageName(TECHSUPPORT_STAGE_NAME);
}

/** Id-only variant for call sites that never load the full user record (block graph, filters). */
export function isTechSupportId(id: string | undefined | null): boolean {
  return String(id ?? '') === TECHSUPPORT_ROOT_USER_ID;
}

export const TECHSUPPORT_UNBLOCKABLE_ERROR = 'TechSupport cannot be blocked.';

/**
 * TechSupport can never be blocked, muted into silence, or filtered out (docs/TODO.md K6).
 * The support channel is the only recourse a stuck user has, so every block path — web
 * client and server alike — refuses the canonical root id rather than writing a block edge
 * that later silently drops support messages.
 *
 * Scope, stated honestly: this is a guarantee about the shipped client. A user running
 * patched code can always drop TechSupport traffic locally; P2P offers no way to prevent
 * that, and the contract doc says so.
 */
export function canBlockTarget(targetId: string | undefined | null): boolean {
  return !isTechSupportId(targetId);
}

export function assertBlockTargetAllowed(targetId: string | undefined | null): void {
  if (!canBlockTarget(targetId)) throw new Error(TECHSUPPORT_UNBLOCKABLE_ERROR);
}

/**
 * TechSupport ignores all talks (docs/TODO.md K5). It is never a talk recipient and so can
 * never produce a response, match, or ignore — its only channel is the support DM.
 *
 * Deliberately a hard rule on the canonical root id rather than a `TalkIntakeFilters` entry:
 * intake filters are user-editable, so expressing it there would let TechSupport be filtered
 * back into talk delivery.
 */
export function acceptsIncomingTalks(userId: string | undefined | null): boolean {
  return !isTechSupportId(userId);
}

export function assertStageNameAllowed(stageName: string, options?: { allowTechSupportRoot?: boolean }): void {
  if (options?.allowTechSupportRoot && normalizeReservedStageName(stageName) === normalizeReservedStageName(TECHSUPPORT_STAGE_NAME)) {
    return;
  }
  if (isReservedStageName(stageName)) {
    throw new Error(`Stage name "${stageName}" is reserved.`);
  }
}
