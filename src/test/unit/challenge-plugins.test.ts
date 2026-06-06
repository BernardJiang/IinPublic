/**
 * Unit tests for the Challenge Plugin Framework (FR-CPF-01 – FR-CPF-05).
 * Spec: SRS v4.5 §3.13
 */
import {
  runChallengeGate,
  registerChallengePlugin,
  getChallengePlugin,
  listChallengePluginIds,
  RequireVerifiedIdentity,
  RequireTrustScore,
  RequireInvitation,
  RequirePreviousInteraction,
} from '../../shared/challenge-plugins';
import type {
  ChallengePlugin,
  ChallengeContext,
  GatedAction,
} from '../../shared/challenge-plugins';

// ─── Helper ───────────────────────────────────────────────────────────────────

const ctx = (overrides: Partial<ChallengeContext> = {}): ChallengeContext => ({
  userId: 'user-1',
  ...overrides,
});

// ─── FR-CPF-01 / FR-CPF-02: runChallengeGate — AND semantics (default) ───────

describe('runChallengeGate — AND semantics (default)', () => {
  it('passes when no plugins are configured', async () => {
    const result = await runChallengeGate('join-community', ctx(), { plugins: [] });
    expect(result.allowed).toBe(true);
  });

  it('passes when all plugins allow', async () => {
    const always: ChallengePlugin = { id: 'always', evaluate: () => ({ allowed: true }) };
    const result = await runChallengeGate('broadcast-talk', ctx(), {
      plugins: [always, always],
    });
    expect(result.allowed).toBe(true);
  });

  it('fails on the first plugin that denies', async () => {
    const pass: ChallengePlugin = { id: 'pass', evaluate: () => ({ allowed: true }) };
    const fail1: ChallengePlugin = { id: 'fail1', evaluate: () => ({ allowed: false, reason: 'nope1' }) };
    const fail2: ChallengePlugin = { id: 'fail2', evaluate: () => ({ allowed: false, reason: 'nope2' }) };
    const result = await runChallengeGate('submit-answer', ctx(), {
      plugins: [pass, fail1, fail2],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('nope1'); // first failure wins
  });
});

// ─── FR-CPF-02: runChallengeGate — OR semantics ───────────────────────────────

describe('runChallengeGate — OR semantics', () => {
  it('passes if at least one plugin allows', async () => {
    const fail: ChallengePlugin = { id: 'fail', evaluate: () => ({ allowed: false, reason: 'no' }) };
    const pass: ChallengePlugin = { id: 'pass', evaluate: () => ({ allowed: true }) };
    const result = await runChallengeGate('join-community', ctx(), {
      plugins: [fail, pass],
      semantics: 'any',
    });
    expect(result.allowed).toBe(true);
  });

  it('fails if all plugins deny — surfaces first reason', async () => {
    const fail1: ChallengePlugin = { id: 'f1', evaluate: () => ({ allowed: false, reason: 'first' }) };
    const fail2: ChallengePlugin = { id: 'f2', evaluate: () => ({ allowed: false, reason: 'second' }) };
    const result = await runChallengeGate('cast-vote', ctx(), {
      plugins: [fail1, fail2],
      semantics: 'any',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('first');
  });
});

// ─── FR-CPF-02: async plugins ────────────────────────────────────────────────

describe('runChallengeGate — async plugins', () => {
  it('awaits async evaluate correctly', async () => {
    const asyncPlugin: ChallengePlugin = {
      id: 'async',
      evaluate: () => Promise.resolve({ allowed: false, reason: 'async-deny' }),
    };
    const result = await runChallengeGate('broadcast-talk', ctx(), { plugins: [asyncPlugin] });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('async-deny');
  });
});

// ─── FR-CPF-03: RequireVerifiedIdentity ──────────────────────────────────────

describe('RequireVerifiedIdentity (FR-CPF-03)', () => {
  const plugin = new RequireVerifiedIdentity();

  it('allows when identityVerified is true', () => {
    expect(plugin.evaluate('join-community', ctx({ identityVerified: true })).allowed).toBe(true);
  });

  it('denies when identityVerified is false', () => {
    const r = plugin.evaluate('join-community', ctx({ identityVerified: false }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it('denies when identityVerified is absent', () => {
    expect(plugin.evaluate('join-community', ctx()).allowed).toBe(false);
  });
});

// ─── FR-CPF-03: RequireTrustScore ────────────────────────────────────────────

describe('RequireTrustScore (FR-CPF-03)', () => {
  it('allows when score meets threshold', () => {
    const p = new RequireTrustScore(0.6);
    expect(p.evaluate('broadcast-talk', ctx({ trustScore: 0.7 })).allowed).toBe(true);
  });

  it('allows when score equals threshold exactly', () => {
    const p = new RequireTrustScore(0.5);
    expect(p.evaluate('broadcast-talk', ctx({ trustScore: 0.5 })).allowed).toBe(true);
  });

  it('denies when score is below threshold', () => {
    const p = new RequireTrustScore(0.5);
    const r = p.evaluate('broadcast-talk', ctx({ trustScore: 0.3 }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/0\.50/);
  });

  it('uses 0.5 as default threshold', () => {
    const p = new RequireTrustScore();
    expect(p.evaluate('broadcast-talk', ctx({ trustScore: 0.49 })).allowed).toBe(false);
    expect(p.evaluate('broadcast-talk', ctx({ trustScore: 0.5 })).allowed).toBe(true);
  });

  it('treats absent score as 0', () => {
    const p = new RequireTrustScore(0.1);
    expect(p.evaluate('submit-answer', ctx()).allowed).toBe(false);
  });
});

// ─── FR-CPF-03: RequireInvitation ────────────────────────────────────────────

describe('RequireInvitation (FR-CPF-03)', () => {
  const plugin = new RequireInvitation();

  it('allows when a non-empty inviteToken is present', () => {
    expect(plugin.evaluate('join-community', ctx({ inviteToken: 'tok-abc' })).allowed).toBe(true);
  });

  it('denies when inviteToken is absent', () => {
    expect(plugin.evaluate('join-community', ctx()).allowed).toBe(false);
  });

  it('denies when inviteToken is whitespace-only', () => {
    expect(plugin.evaluate('join-community', ctx({ inviteToken: '   ' })).allowed).toBe(false);
  });
});

// ─── FR-CPF-03: RequirePreviousInteraction ───────────────────────────────────

describe('RequirePreviousInteraction (FR-CPF-03)', () => {
  const plugin = new RequirePreviousInteraction();

  it('allows when hasPreviousInteraction is true', () => {
    expect(plugin.evaluate('join-community', ctx({ hasPreviousInteraction: true })).allowed).toBe(true);
  });

  it('denies when hasPreviousInteraction is false', () => {
    expect(plugin.evaluate('join-community', ctx({ hasPreviousInteraction: false })).allowed).toBe(false);
  });

  it('denies when hasPreviousInteraction is absent', () => {
    expect(plugin.evaluate('join-community', ctx()).allowed).toBe(false);
  });
});

// ─── FR-CPF-04: plugin registry ──────────────────────────────────────────────

describe('plugin registry (FR-CPF-04)', () => {
  it('built-in plugins are pre-registered', () => {
    const ids = listChallengePluginIds();
    expect(ids).toContain('require-verified-identity');
    expect(ids).toContain('require-trust-score');
    expect(ids).toContain('require-invitation');
    expect(ids).toContain('require-previous-interaction');
  });

  it('getChallengePlugin returns the plugin by id', () => {
    const p = getChallengePlugin('require-verified-identity');
    expect(p).toBeDefined();
    expect(p!.id).toBe('require-verified-identity');
  });

  it('registerChallengePlugin stores and retrieves a custom plugin', () => {
    const custom: ChallengePlugin = {
      id: 'custom-test-plugin',
      evaluate: () => ({ allowed: true }),
    };
    registerChallengePlugin(custom);
    expect(getChallengePlugin('custom-test-plugin')).toBe(custom);
  });

  it('getChallengePlugin returns undefined for unknown id', () => {
    expect(getChallengePlugin('no-such-plugin')).toBeUndefined();
  });
});

// ─── FR-CPF-05: human-readable denial reason ─────────────────────────────────

describe('denial reason surface (FR-CPF-05)', () => {
  it('result includes a non-empty reason string on denial', async () => {
    const result = await runChallengeGate(
      'join-community',
      ctx(),
      { plugins: [new RequireVerifiedIdentity()] },
    );
    expect(result.allowed).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(result.reason!.length).toBeGreaterThan(0);
  });
});

// ─── GatedAction type coverage ───────────────────────────────────────────────

describe('GatedAction coverage', () => {
  const actions: GatedAction[] = ['join-community', 'broadcast-talk', 'submit-answer', 'cast-vote'];
  const passPlugin: ChallengePlugin = { id: 'pass', evaluate: () => ({ allowed: true }) };

  it.each(actions)('gate passes for action "%s" with a pass plugin', async (action) => {
    const result = await runChallengeGate(action, ctx(), { plugins: [passPlugin] });
    expect(result.allowed).toBe(true);
  });
});
