# IinPublic Production Release Checklist

_Created: 2026-10-22_

This checklist is derived from the current open work in:

- `docs/TODO.md`
- `docs/OWNER-TODO.md`
- `docs/completed.md`

Use this as the execution order for the next production push.

---

## Phase 0 — Freeze release target

- [ ] Pick release commit SHA (no moving target after this).
- [ ] Create release branch from that SHA (example: `release/1.0.188`).
- [ ] Enforce scope freeze: only blocker/security/release-candidate fixes.
- [ ] Confirm version bump plan (`package.json`, Android build metadata, release notes version).

**Exit criteria:** frozen branch and explicit change policy.

---

## Phase 1 — Close hard blockers

- [ ] Close OPEN-81 G7 carried field gate (real walking + transit/subway with genuine GPS loss).
- [ ] Close OPEN-76 long unplugged battery run on 3+ phones with retained measurements.
- [ ] Close OPEN-77 release-key custody ceremony (offline split backup + restore verification).
- [ ] Close OPEN-79 VPS delegate roster watcher verification (`delegate-roster-monitor.jsonl` review).

**Exit criteria:** all four are closed and recorded with evidence.

---

## Phase 2 — Security hardening gate

- [ ] Audit auth/authz boundaries on sensitive HTTP/API routes.
- [ ] Audit static serving scope (no unintended workspace exposure).
- [ ] Harden CSP and remove/justify risky directives.
- [ ] Verify no keys/secrets/passphrases in repo, logs, or release artifacts.
- [ ] Add/run focused regression tests for the above.

**Exit criteria:** no unresolved critical security findings.

---

## Phase 3 — Full quality gate

- [ ] `npm run test:type`
- [ ] `npm run lint`
- [ ] `npm run test:unit`
- [ ] `npm run test:integration`
- [ ] `npm run test:e2e:parallel`
- [ ] `npm run test:e2e:heavy`
- [ ] `npm run test:e2e:mesh`
- [ ] Run required Android phone-path/native-app journeys for this release.

**Exit criteria:** all required checks green on the frozen release commit.

---

## Phase 4 — Packaging and integrity

- [ ] Build release artifacts (`npm run build:embedded`, `npm run build:server`, Android artifacts as needed).
- [ ] Generate/verify checksums (`npm run release:verify-checksums`).
- [ ] Record artifact inventory (SHA, build ID, filenames, checksums).
- [ ] Perform one clean-environment rebuild and compare integrity.

**Exit criteria:** reproducible, verified release bundle.

---

## Phase 5 — Staged deployment

- [ ] Deploy to canary/staging cohort.
- [ ] Observe for 24–48h (latency, duplicates, Nearby/Place stability, background reliability, crashes).
- [ ] Decide go/no-go with explicit signoff checklist.

**Exit criteria:** canary meets acceptance metrics with no critical regressions.

---

## Phase 6 — Production push

- [ ] Tag approved release SHA (`v1.0.xxx`).
- [ ] Deploy production server + web assets.
- [ ] Publish Android artifact through release channel.
- [ ] Run post-deploy smoke (new user, returning user, offline/reconnect path).
- [ ] Publish release announcement + known limitations + rollback contact path.

**Exit criteria:** production deploy healthy and smoke checks pass.

---

## Phase 7 — 72-hour post-release watch

- [ ] Monitor key metrics hourly/day-by-day for first 72h.
- [ ] Triage incidents by severity and owner.
- [ ] Limit hotfixes to P0/P1; queue lower-priority items.
- [ ] Write release retrospective and update `docs/completed.md`.

**Exit criteria:** stable first 72 hours with documented closeout.

---

## Definition of “Production Ready”

Only push when all are true:

- [ ] Non-deferred blockers for this release are closed in `docs/TODO.md`.
- [ ] Required owner actions in `docs/OWNER-TODO.md` are completed.
- [ ] Security hardening gate is passed.
- [ ] Full quality gate is passed on the frozen commit.
- [ ] Canary/staged deployment passes.
- [ ] Rollback plan is verified and documented.

