import type { User } from './types';

export const TECHSUPPORT_STAGE_NAME = 'TechSupport';
export const TECHSUPPORT_ROOT_USER_ID = 'iinpublic-root-techsupport';
/**
 * Development trust anchor. Replace before production.
 *
 * @deprecated Prefer the trust-anchor lists below. Kept as the current single key so existing
 * call sites keep working while K3 lands; it is seeded into both lists.
 */
export const TECHSUPPORT_PUB = 'mYRexxiSF2FG3oV-3-LKXEtisnUv5JQ9nDHbRANxiZo.jRqTX1_rg0v3BbFWYt1ZqGwBRG7wzg44IKgPobrSpfQ';

/**
 * Two keys, two trust anchors (decision K3-1, docs/TODO.md).
 *
 * - **Announcement key** — held by the relay; signs system announcements.
 * - **DM key** — held by the TechSupport *device*; signs greetings, FAQ bundles, and support
 *   replies. Deliberately kept off the relay even under the K3-4 redundancy decision: if the
 *   relay could sign DMs, a relay compromise could author messages as TechSupport, which is
 *   exactly what K2's signature requirement exists to prevent.
 *
 * Both lists currently hold the same development key, so nothing changes behaviourally until a
 * separate device key is generated. They are lists rather than scalars because of decision
 * K3-2: rotation ships a new client build, and a list lets the old and new keys both verify
 * during the rollout instead of orphaning everything signed by the previous key.
 *
 * Ordered newest-first by convention; signing should always use the first entry.
 *
 * **The compiled list is the trust root.** A key served by the relay is a convenience for
 * discovery only and must be checked against these anchors before use — otherwise a compromised
 * relay could substitute its own TechSupport identity.
 */
export const TECHSUPPORT_ANNOUNCEMENT_TRUST_ANCHORS: readonly string[] = [TECHSUPPORT_PUB];

export const TECHSUPPORT_DM_TRUST_ANCHORS: readonly string[] = [TECHSUPPORT_PUB];

function isTrustedPub(pub: string | undefined | null, anchors: readonly string[]): boolean {
  const candidate = String(pub ?? '').trim();
  if (!candidate) return false;
  return anchors.includes(candidate);
}

/** True when `pub` may sign system announcements. */
export function isTrustedAnnouncementPub(pub: string | undefined | null): boolean {
  return isTrustedPub(pub, TECHSUPPORT_ANNOUNCEMENT_TRUST_ANCHORS);
}

/** True when `pub` may sign greetings, FAQ bundles, and support replies. */
export function isTrustedTechSupportDmPub(pub: string | undefined | null): boolean {
  return isTrustedPub(pub, TECHSUPPORT_DM_TRUST_ANCHORS);
}

/** The key to sign with now — the newest anchor. */
export function currentTechSupportDmPub(): string {
  return TECHSUPPORT_DM_TRUST_ANCHORS[0];
}

export function currentTechSupportAnnouncementPub(): string {
  return TECHSUPPORT_ANNOUNCEMENT_TRUST_ANCHORS[0];
}
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
