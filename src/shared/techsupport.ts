import type { User } from './types';
import trustAnchorConfig from './techsupport-trust-anchors.json';

export const TECHSUPPORT_STAGE_NAME = 'TechSupport';
export const TECHSUPPORT_ROOT_USER_ID = 'iinpublic-root-techsupport';
/**
 * Compiled trust anchor for the TechSupport identity. Kept as the current single key while the
 * announcement and DM anchor lists below both hold it; rotation is via those lists (K3-2), not
 * by editing this constant.
 *
 * The **private** halves are never compiled into the client bundle or placed on the public relay.
 * The current protocol uses one pair for both roles, held in the operator's encrypted vault; the
 * keyless relay publishes committed pre-signed artifacts. See `assertTechSupportDmPair()` below,
 * `scripts/dev-techsupport-login.js`, and the production security policy.
 *
 * Rotated 2026-09-16: the original value here was a development placeholder whose private half
 * was committed in plaintext across multiple E2E fixture files (`DEV_PAIR`) — in a public repo,
 * meaning that "private" key was never actually private. This is a real key generated fresh for
 * this rotation; its private half lives ONLY in this machine's local env file, never committed
 * anywhere (see `techsupport-real-pair.ts` for the exact var name — deliberately not spelled out
 * here, since this module is bundled into the web client and its comments ship as-is). Tests that
 * need to sign as TechSupport load that same env var at runtime
 * (`tests/e2e/helpers/techsupport-real-pair.ts` / `src/test/helpers/techsupport-real-pair.ts`)
 * and skip gracefully when it's absent, rather than hardcoding a key — see those helpers' own doc
 * comments for what that means for CI.
 */
type TechSupportTrustAnchorConfig = {
  version: number;
  dm: { current: string; trusted: string[] };
  announcement: { current: string; trusted: string[] };
};

const trustAnchors = trustAnchorConfig as TechSupportTrustAnchorConfig;

/** Current TechSupport identity/DM public key. The committed JSON file is deliberately the only
 *  rotation edit point; `npm run techsupport:key -- rotation ...` changes it atomically. */
export const TECHSUPPORT_PUB = trustAnchors.dm.current;

/**
 * Two keys, two trust anchors (decision K3-1, docs/TODO.md).
 *
 * - **Announcement key** — intended for a future separate, limited online signer; currently the
 *   operator signs committed announcement/identity artifacts and the relay stays keyless.
 * - **DM key** — held by the TechSupport root operator; signs greetings, FAQ bundles, delegate
 *   grants, and support replies. It is deliberately kept off the relay: if the relay could sign
 *   DMs, relay compromise could author messages as TechSupport.
 *
 * Both lists currently hold the same key (rotated 2026-09-16, see TECHSUPPORT_PUB's own doc
 * comment), so nothing changes behaviourally until a separate device key is generated for the
 * announcement role specifically. They are lists rather than scalars because of decision
 * K3-2: rotation ships a new client build, and a list lets the old and new keys both verify
 * during the rollout instead of orphaning everything signed by the previous key.
 *
 * Ordered newest-first by convention; signing should always use the first entry.
 *
 * **The compiled list is the trust root.** A key served by the relay is a convenience for
 * discovery only and must be checked against these anchors before use — otherwise a compromised
 * relay could substitute its own TechSupport identity.
 */
export const TECHSUPPORT_ANNOUNCEMENT_TRUST_ANCHORS: readonly string[] =
  Object.freeze([...trustAnchors.announcement.trusted]);

export const TECHSUPPORT_DM_TRUST_ANCHORS: readonly string[] = Object.freeze([...trustAnchors.dm.trusted]);

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

/** The key to sign with now. Rotation tooling also orders it first, but `current` is authoritative. */
export function currentTechSupportDmPub(): string {
  return trustAnchors.dm.current;
}

export function currentTechSupportAnnouncementPub(): string {
  return trustAnchors.announcement.current;
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
