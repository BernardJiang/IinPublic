import {
  TECHSUPPORT_NETWORK_ROLE,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../../src/shared/techsupport';
import {
  TECHSUPPORT_GREETING_TEMPLATES,
  verifyTechSupportGreeting,
  type GreetingLocale,
} from '../../../src/shared/techsupport-greeting';

/**
 * Shared TechSupport-baseline checks (docs/TODO.md K4).
 *
 * One definition of "this graph has a valid built-in TechSupport", used by BOTH
 * `e2e-stage-pipeline.ts` (snapshot save/load integrity) and `clear-database.ts`
 * (post-reset guard). Previously the stage pipeline was the only thing asserting it,
 * so a reset path that quietly stopped producing a root went unnoticed until a
 * headcount assertion failed several specs later with an unrelated-looking message.
 *
 * Lives in its own module so `clear-database.ts` and `e2e-stage-pipeline.ts` can both
 * import it without a cycle (the pipeline already imports the clear helpers).
 */

export type GunGraph = Record<string, any>;

/** Returns a human-readable reason the graph lacks a valid TechSupport root, or null if it is fine. */
export function techSupportBaselineProblem(graph: GunGraph | undefined): string | null {
  if (!graph) return 'graph is empty or missing';

  const root = graph[`users/${TECHSUPPORT_ROOT_USER_ID}`];
  if (
    root?.id !== TECHSUPPORT_ROOT_USER_ID ||
    root?.stageName !== TECHSUPPORT_STAGE_NAME ||
    root?.networkRole !== TECHSUPPORT_NETWORK_ROLE
  ) {
    return `missing the canonical TechSupport user root (users/${TECHSUPPORT_ROOT_USER_ID})`;
  }

  const networkRoot = graph['network-root-techsupport'];
  if (
    networkRoot?.userId !== TECHSUPPORT_ROOT_USER_ID ||
    networkRoot?.stageName !== TECHSUPPORT_STAGE_NAME ||
    networkRoot?.networkRole !== TECHSUPPORT_NETWORK_ROLE
  ) {
    return 'missing the canonical TechSupport network marker (network-root-techsupport)';
  }

  const globalMember = graph[`chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}`];
  if (
    globalMember?.userId !== TECHSUPPORT_ROOT_USER_ID ||
    globalMember?.stageName !== TECHSUPPORT_STAGE_NAME ||
    globalMember?.isActive !== true
  ) {
    return 'does not keep TechSupport active in Global';
  }

  return null;
}

const SUPPORT_GREETING_SOUL_RE = /^conversations\/conv_support_[^/]+\/messages\/support_welcome_(.+)$/;

/** Duplicate support greetings for one receiver, or null if clean. */
export function duplicateSupportGreeting(graph: GunGraph | undefined): string | null {
  if (!graph) return null;
  const seen = new Set<string>();
  for (const soul of Object.keys(graph)) {
    const match = soul.match(SUPPORT_GREETING_SOUL_RE);
    if (!match) continue;
    if (seen.has(match[1])) return match[1];
    seen.add(match[1]);
  }
  return null;
}

/**
 * K2 (docs/TODO.md): any stored `support_welcome_*` greeting must carry a signature that
 * verifies against the compiled DM trust anchors. Presence is never required — under K2 the
 * greeting is authored client-side, into the receiver's own local Gun, and not transmitted, so
 * a server-side snapshot legitimately has zero greeting souls. Only "if one is present, it must
 * be genuine" is asserted; returns a human-readable reason or null if clean/absent.
 */
export async function signedGreetingProblem(graph: GunGraph | undefined): Promise<string | null> {
  if (!graph) return null;
  for (const [soul, record] of Object.entries(graph)) {
    const match = soul.match(SUPPORT_GREETING_SOUL_RE);
    if (!match) continue;
    const locale = record?.greetingLocale as GreetingLocale | undefined;
    const verified = await verifyTechSupportGreeting({
      locale,
      template: locale ? TECHSUPPORT_GREETING_TEMPLATES[locale] : undefined,
      authorPub: record?.greetingAuthorPub,
      signature: record?.greetingSignature,
    });
    if (!verified) {
      return `support_welcome_${match[1]} (${soul}) does not verify against the compiled DM trust anchors`;
    }
  }
  return null;
}

/** Throws with a pointed message if the graph has no valid built-in TechSupport. */
export function assertTechSupportBaseline(graph: GunGraph | undefined, context: string): void {
  const problem = techSupportBaselineProblem(graph);
  if (problem) {
    throw new Error(
      `[techsupport-baseline] ${context}: ${problem}. ` +
        'Every E2E baseline except the deliberate stage0 empty reset must contain the built-in ' +
        'TechSupport root — see docs/TODO.md K4 and docs/design/techsupport-bootstrap-contract.md.',
    );
  }
}
