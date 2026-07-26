import type { User } from './types';

export const TECHSUPPORT_STAGE_NAME = 'TechSupport';
export const TECHSUPPORT_ROOT_USER_ID = 'iinpublic-root-techsupport';
/**
 * Compiled trust anchor for the TechSupport identity. Kept as the current single key while the
 * announcement and DM anchor lists below both hold it; rotation is via those lists (K3-2), not
 * by editing this constant.
 *
 * The **private** halves live off the client: the DM key on the TechSupport device (replicated
 * across operator machines per K3-4), the announcement key on the relay. Neither is ever
 * compiled into the client bundle — see `assertTechSupportDmPair()` below and
 * `scripts/dev-techsupport-login.js`.
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

export interface TechSupportSeaPair {
  pub: string;
  epub: string;
  priv: string;
  epriv: string;
}

export const TECHSUPPORT_PAIR_MISMATCH_ERROR =
  'Loaded TechSupport key does not match a TechSupport DM trust anchor — refusing to start.';

/**
 * Refuses to boot a TechSupport-mode client with the wrong key (docs/TODO.md K3 — "no silent
 * impersonation"). Validates shape, then checks `pub` against the DM trust-anchor **list**
 * (not a literal `=== TECHSUPPORT_PUB`) so this survives key rotation (K3-2) without editing.
 */
export function assertTechSupportDmPair(pair: unknown): asserts pair is TechSupportSeaPair {
  const candidate = pair as Partial<TechSupportSeaPair> | null | undefined;
  const wellFormed =
    !!candidate &&
    typeof candidate === 'object' &&
    typeof candidate.pub === 'string' &&
    typeof candidate.epub === 'string' &&
    typeof candidate.priv === 'string' &&
    typeof candidate.epriv === 'string' &&
    candidate.pub.length > 0;
  if (!wellFormed || !isTrustedTechSupportDmPub(candidate!.pub)) {
    throw new Error(TECHSUPPORT_PAIR_MISMATCH_ERROR);
  }
}

export const TECHSUPPORT_NETWORK_ROLE = 'root-techsupport';
export const TECHSUPPORT_HEADSHOT = 'TS';

/**
 * The synthetic Global-room roster entry the client injects from compiled constants (docs/TODO.md
 * K1 item 1) — "no round-trip, no dependence on a browser having bootstrapped it." Only ever used
 * as a floor when no real `TECHSUPPORT_ROOT_USER_ID` roster entry is already present; callers must
 * dedup by this id so a real seeded row (K1 item 2) is never double-counted.
 */
export interface TechSupportRosterMember {
  userId: string;
  stageName: string;
}

export function techSupportRosterMember(): TechSupportRosterMember {
  return { userId: TECHSUPPORT_ROOT_USER_ID, stageName: TECHSUPPORT_STAGE_NAME };
}

/** Only Global carries the built-in TechSupport floor (K1) — never sub-rooms. */
export const TECHSUPPORT_GLOBAL_ROOM_ID = 'global';

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
