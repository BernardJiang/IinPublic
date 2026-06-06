/**
 * Challenge Plugin Framework (FR-CPF-01 – FR-CPF-05)
 *
 * Provides a composable, pluggable gate that can run one or more validation
 * plugins before high-stakes user actions are accepted.  Plugin results are
 * combined with AND semantics by default (all must pass); OR semantics can be
 * selected per gate.
 *
 * Spec: SRS v4.5 §3.13
 */

// ─── Core types ──────────────────────────────────────────────────────────────

/**
 * The set of actions a challenge gate may protect (FR-CPF-01).
 * Extend this union when new gated actions are introduced.
 */
export type GatedAction =
  | 'join-community'
  | 'broadcast-talk'
  | 'submit-answer'
  | 'cast-vote';

/**
 * Contextual information passed to every plugin during evaluation.
 * Plugins should only read the fields they care about.
 */
export interface ChallengeContext {
  /** The user attempting the action. */
  userId: string;
  /** Chatroom / community the action targets (if applicable). */
  chatroomId?: string;
  /** Reputation score (0–1) for the user, if pre-computed by the caller. */
  trustScore?: number;
  /** True when the user has a verified SEA identity on record. */
  identityVerified?: boolean;
  /** Signed invite token (opaque string) presented by the user. */
  inviteToken?: string;
  /**
   * Whether the user has at least one completed talk exchange with the
   * community owner or a moderator.
   */
  hasPreviousInteraction?: boolean;
  /** Catch-all for future or plugin-specific context fields. */
  [key: string]: unknown;
}

/** Result returned by a single plugin's `evaluate` call (FR-CPF-02). */
export interface ChallengeResult {
  allowed: boolean;
  /** Human-readable reason shown to the user when `allowed` is false (FR-CPF-05). */
  reason?: string;
}

/**
 * FR-CPF-02: The interface every challenge plugin must implement.
 *
 * Plugins are stateless value objects.  Any configuration they need
 * should be passed at construction time.
 */
export interface ChallengePlugin {
  /** Stable identifier, used for logging and per-room config (FR-CPF-04). */
  readonly id: string;
  evaluate(action: GatedAction, context: ChallengeContext): ChallengeResult | Promise<ChallengeResult>;
}

// ─── Gate configuration ───────────────────────────────────────────────────────

/**
 * Configuration for a single challenge gate protecting one or more actions.
 *
 * Stored per-chatroom in owner-private (zone-B) storage (FR-CPF-04).
 */
export interface ChallengeGateConfig {
  /** Plugins to run (in order). */
  plugins: ChallengePlugin[];
  /**
   * Composition semantics:
   * - 'all' (default) — every plugin must pass (AND)
   * - 'any'           — at least one plugin must pass (OR)
   */
  semantics?: 'all' | 'any';
}

// ─── Gate executor ────────────────────────────────────────────────────────────

/**
 * Runs the configured plugins for `action` against `context`.
 *
 * Returns the first failing result (AND mode) or the first passing result
 * (OR mode).  If no plugins are configured the gate always passes.
 *
 * FR-CPF-05: the returned `reason` is suitable for direct display to the user.
 */
export async function runChallengeGate(
  action: GatedAction,
  context: ChallengeContext,
  config: ChallengeGateConfig,
): Promise<ChallengeResult> {
  const { plugins, semantics = 'all' } = config;

  if (plugins.length === 0) {
    return { allowed: true };
  }

  if (semantics === 'any') {
    // OR: return as soon as one plugin passes
    const failures: ChallengeResult[] = [];
    for (const plugin of plugins) {
      const result = await plugin.evaluate(action, context);
      if (result.allowed) return { allowed: true };
      failures.push(result);
    }
    // All failed — surface the first reason
    return failures[0] ?? { allowed: false, reason: 'Challenge gate denied the action.' };
  }

  // AND (default): return as soon as one plugin fails
  for (const plugin of plugins) {
    const result = await plugin.evaluate(action, context);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}

// ─── Built-in plugins (FR-CPF-03) ────────────────────────────────────────────

/**
 * Requires the user to have a verified SEA identity on record.
 */
export class RequireVerifiedIdentity implements ChallengePlugin {
  readonly id = 'require-verified-identity';

  evaluate(_action: GatedAction, context: ChallengeContext): ChallengeResult {
    if (context.identityVerified === true) return { allowed: true };
    return {
      allowed: false,
      reason: 'A verified identity is required to perform this action.',
    };
  }
}

/**
 * Requires the user's trust score to be at or above a configurable threshold.
 *
 * @param threshold  Minimum trust score in the range [0, 1].  Defaults to 0.5.
 */
export class RequireTrustScore implements ChallengePlugin {
  readonly id = 'require-trust-score';

  constructor(private readonly threshold: number = 0.5) {}

  evaluate(_action: GatedAction, context: ChallengeContext): ChallengeResult {
    const score = context.trustScore ?? 0;
    if (score >= this.threshold) return { allowed: true };
    return {
      allowed: false,
      reason: `A minimum trust score of ${this.threshold.toFixed(2)} is required (yours: ${score.toFixed(2)}).`,
    };
  }
}

/**
 * Requires the user to present a signed invite token from a room member.
 *
 * In the current implementation the token is validated as a non-empty string.
 * A full production implementation would verify a SEA-signed invite against
 * the inviter's public key stored in the room's zone-B config.
 */
export class RequireInvitation implements ChallengePlugin {
  readonly id = 'require-invitation';

  evaluate(_action: GatedAction, context: ChallengeContext): ChallengeResult {
    if (context.inviteToken && context.inviteToken.trim().length > 0) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: 'An invitation token from a room member is required to join this community.',
    };
  }
}

/**
 * Requires the user to have at least one completed talk exchange with the
 * community owner or a moderator before joining or broadcasting.
 */
export class RequirePreviousInteraction implements ChallengePlugin {
  readonly id = 'require-previous-interaction';

  evaluate(_action: GatedAction, context: ChallengeContext): ChallengeResult {
    if (context.hasPreviousInteraction === true) return { allowed: true };
    return {
      allowed: false,
      reason: 'You must have a previous completed talk exchange with a community moderator or owner.',
    };
  }
}

// ─── Plugin registry (FR-CPF-04) ──────────────────────────────────────────────

/**
 * A simple in-process plugin registry.  Third-party plugins register here;
 * gate configurations reference plugins by their `id`.
 *
 * In a future phase, plugin bundles will be loaded from owner-private Gun
 * paths and instantiated dynamically.
 */
const _registry = new Map<string, ChallengePlugin>([
  ['require-verified-identity', new RequireVerifiedIdentity()],
  ['require-trust-score', new RequireTrustScore()],
  ['require-invitation', new RequireInvitation()],
  ['require-previous-interaction', new RequirePreviousInteraction()],
]);

/** Register a plugin so it can be referenced by id in gate configurations. */
export function registerChallengePlugin(plugin: ChallengePlugin): void {
  _registry.set(plugin.id, plugin);
}

/** Look up a registered plugin by id.  Returns undefined if not found. */
export function getChallengePlugin(id: string): ChallengePlugin | undefined {
  return _registry.get(id);
}

/** List all registered plugin ids. */
export function listChallengePluginIds(): string[] {
  return Array.from(_registry.keys());
}
