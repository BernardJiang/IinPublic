# IinPublic TODO

Last updated: 2026-06-13

This file is the short, execution-oriented plan. The detailed acceptance inventory and the
statistics / spec-gap follow-ups are consolidated into the appendices at the bottom of this file.
- Completed work: `docs/completed.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specifications.md` (§19.13, §19.14, REQ-P2P-09–29; mesh talk delivery design §23; libp2p/IPFS §25 — supersedes Phase D §24; find-similar §22)
- Detailed acceptance inventory: see "Appendix A — Detailed backlog inventory" below.

## Model routing legend

Each item is tagged with the cheapest model that can do it reliably, to optimize token spend:

- **`[Opus]`** — distributed-correctness / ordering / architecture is the hard part; design mistakes cascade.
- **`[Sonnet]`** — standard implementation against an existing spec or pattern.
- **`[Haiku]`** — mechanical, fully specified work; running test suites; scaffolding from a written design.

Token-saving rules: for `[Opus]` items, have Opus write a short design note first, then hand implementation + tests to Sonnet. Do steps 9–11 in one Opus session (shared versioning/ordering machinery). `- [ ] Test:` items belong to whichever model implemented the step.

## Open items — SHIPPING GATES & FOLLOW-UPS

All P1 (libp2p/IPFS), P2 (Find Similar), and P2.5 (sort pipeline) **completed** and moved to `docs/completed.md` (2026-06-12).

**Next phase:** Appendix C (P2P spec-gap audits `[Haiku]`). Appendix B (Statistics expansion) completed 2026-06-13 — see `docs/completed.md`.


## Run commands

```bash
npm run dev:p0-talks          # P0 mesh delivery (shipped)
npm run test:e2e:p0-talks     # P0 E2E only
npm run dev:relay-only        # Relay-only hub (RELAY_ONLY_HUB=1)
npm run test:e2e:parallel     # Full E2E suite in direct mode
```

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep SRS audit snapshots tied to code evidence and verification commands.

---

## Appendix A — Detailed backlog inventory `[Haiku]` — AUDITED (2026-06-12)

> Consolidated 2026-06-08 from `docs/TODO-backlog-inventory.md` (archived). Full acceptance closure audit completed 2026-06-12; all major items verified shipped and working correctly. See `docs/completed.md` for detailed audit findings.

**Audit summary (see completed.md for full details):**

| Area | Status | Finding |
|------|--------|---------|
| **Contacts** | ✓ VERIFIED | Stranger/undefined state on first contact; relationship labels filter/sort/save/reload work correctly (8 tests passing); profile parity complete |
| **Talks** | ✓ VERIFIED | D4 matrix complete: tag/flow/survey/route validation (1108 test lines); language edit, creator/recipient transitions, diagnostics all shipped |
| **Me Tab** | ✓ VERIFIED | Profile editing parity, preferences modes, per-answer ownership, durable reply review all working |
| **Settings** | ✓ VERIFIED | Localization/filter behavior, storage/transport diagnostics (TechSupport/room-visits/language/SEA/P2P flags) complete |
| **Conversation/Peer Detail** | ✓ VERIFIED | Transport status, privacy verification, history/search controls shipped |
| **TechSupport Root** | ✓ VERIFIED | Singleton identity, anti-impersonation, global anchor, support-channel, privacy constraints all implemented |
| **E2E Stage Pipeline** | ✓ VERIFIED | TechSupport baseline seeding, parallel isolation, single-user→Stage 0 consolidation complete |

**Deferred forward work:**
- Responder ranking enhancement (matched-talk/match-rate/relationship/recency/weighted) — covered by P2.5 sort-pipeline work; further strategy enhancements in future
- Custom chatroom detail metadata expansion (description/capacity/headline/owner/created/members/visits) — future feature gate
- Intake control richer dirty-word diagnostics and distance preamble polish — optional UX refinement
- Contextual statistics (cross-question correlation, completion rates, segment filters) — in Appendix B forward work

**Verification:** All 763 unit tests passing; type checking clean; no acceptance gaps or regressions detected.

## Appendix B — Statistics expansion backlog `[Sonnet]` — **COMPLETED 2026-06-13**

> All items shipped. See `docs/completed.md` for full details. Verification: `npx tsc --noEmit` clean; all 763 unit tests pass.

## Appendix C — Residual P2P transport & spec-gap follow-ups `[Haiku]` — AUDITED (2026-06-12)

> Consolidated 2026-06-08 from `docs/TODO-direct-p2p.md`, `docs/roadmap/spec-gap-matrix.md`, and `docs/reports/PROJECT_STATUS.md` (all archived). The direct-P2P transport stack shipped (see `docs/completed.md`); full audit completed 2026-06-12.

**Audit findings (see completed.md for details):**

- [x] Reputation/credit section visibility allowlists (FR-UM-7) — **Deferred** to next phase (requires design review).
- [x] Broader moderation UX and centralized reporting/appeal model (FR-BF / FR-SP) — **Deferred** (safety-critical, out of scope).
- [x] Production-durability review of in-memory stats indices, quota counters, rate-limit counters — **VERIFIED**: All intentionally ephemeral per spec; Gun-backed persistence deferred if requirements tighten. All 763 unit tests passing.
- [x] Statistics/visualization product polish (shipped dashboard/endpoints) — **Complete**; baseline live, forward aggregates in Appendix B.
- [x] Android: maintenance-only until web/server loop stable — **Acknowledged** (not blocking).

**Known runtime risks (verified):**
- ✓ Gun replication timing on auto-reply path: Mitigated by server POST path.
- ✓ `talkCompleted` handler fallback: Verified, preserves data safely.
