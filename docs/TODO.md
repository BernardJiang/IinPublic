# IinPublic TODO

Last updated: 2026-06-12

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

**Next phase:** Appendix B (Statistics expansion `[Sonnet]`) and Appendix C (P2P spec-gap audits `[Haiku]`).


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

## Appendix A — Detailed backlog inventory `[Haiku]` — acceptance closure against shipped code; escalate findings to Sonnet

> Consolidated 2026-06-08 from `docs/TODO-backlog-inventory.md` (archived). This is the detailed D6 acceptance inventory; the action-ordered queue is the "Open items" section above. Move shipped outcomes to `docs/completed.md`.

### Chatrooms
- Finish custom/business room detail metadata: description, capacity, headline, owner, created date, active members, lifetime visits, and unique visitors.
- Make broadcast recipient preview explain language, distance, type, content, age, block, expiration, reputation/quota, and TechSupport/support-only exclusions.
- Verify Global/region/home/travel/return-home paths, member ordering, pre-match `Stranger` state, and permanent TechSupport anchor behavior.

### Contacts
- Ensure ordinary answerers/matches start as `Stranger`/unassigned until explicit relationship selection.
- Ensure all relationship labels filter/search/sort/save/reload correctly.
- Add high-volume responder ranking from D5 (matched-talk count, match rate, relationship, recency, weighted relevance) with stable tie-breaking and TechSupport exclusion.
- Complete profile presentation parity: headshot, localized/shared languages, shared interests (when present), talk history, public credit/privacy, block status, channel/transport health.

### Talks
- Complete D4 exhaustive creation/branch/response matrix for tag/flow/survey/route.
- Add language edit preservation and creator/recipient state transitions.
- Add recipient + filtered-count diagnostics by rejection reason and clearer IN/OUT/copied/answered status boundaries.
- Add talk ranking visibility (matches/replies/match-rate/latest/weighted) with visible aggregate counts.
- Keep survey aggregate/report/export distinct from matching conversations.
- Verify route context hashes do not incorrectly reuse answers across branches/languages.

### Me
- Align profile editing parity with Settings (headshot/languages/interests/privacy).
- Complete Preferences modes (temporary, permanent, suppressed, manual, auto, conditional) with clear branch/context explanations.
- Add per-answer ownership controls (language, export/delete/sync semantics, support-message exclusion).
- Add scalable reply review mode with responder/talk/date/outcome/relationship filters and durable sort/group behavior.

### Settings
- Finish D2-D3 localization/filter behavior with clear validation/persistence/reset/hidden-count preview.
- Expand storage/transport diagnostics for TechSupport root/support state, room visit counts, localization/filter state, talk language defaults, SEA custody, relay leak checks, local storage, and P2P flags (without secrets).

### Conversation, Peer Detail, Hidden Surfaces
- Add support-channel vs normal-channel transport status, fallback reasons, privacy verification, translation consent behavior, and history/search controls.
- Keep contextual statistics design (no standalone Statistics tab) consistent with per-survey analytics dialog.

### TechSupport root network role
Scope: FR-CR-1 / FR-CR-2 and P2P identity/signaling/direct-message boundaries. Core: canonical singleton root identity; bootstrap enforcement + reserved-name anti-impersonation; global-room non-empty anchor guarantees; idempotent greeting + support-channel establishment per ordinary user; direct transport preference with encrypted relay fallback; user-visible support-channel health metadata; support contact UX guardrails (mute vs ordinary block); privacy/safety constraints (no private key/message leakage via diagnostics/storage). Verification: first-run bootstrap checks; multi-user/reconnect/idempotency; cross-tab consistency; parallel stage behavior and stage snapshot integrity.

### E2E stage pipeline inventory
- Consolidate single-user coverage into TechSupport Stage 0 baseline where applicable.
- Keep later stages loading a canonical TechSupport baseline before adding ordinary users.
- Audit broadcast and member-count assertions so TechSupport presence does not cause false failures.
- Require tests to declare whether TechSupport participates / is ignored / is excluded.
- Preserve parallel worker isolation while still seeding TechSupport before ordinary users.

### Legacy baseline notes (condensed)
- D2/D3/D4/D5/D6 all have shipped partial proofs and scripts; remaining work is acceptance closure, not greenfield.
- Localization coverage is broad but still needs edge-path fallback audit.
- Intake controls are broadly covered but still need richer dirty-word diagnostics and distance preamble polish.
- Lifecycle and triage work are materially advanced but not fully exhaustive across all branches/tabs.

## Appendix B — Statistics expansion backlog `[Sonnet]` — aggregation on shipped schemas; privacy-masking rules need attention

> Consolidated 2026-06-08 from `docs/roadmap/statistics-expansion.md` (archived). Baseline stats are shipped (see `docs/completed.md`); the items below are forward analytics work. Verification requirements: `docs/testing/testplan.md` Appendix E.

**Design decisions already made:** normalized response events are append-only + Gun-mirrored; in-memory indices are derived caches; broadcast tag counters are server trend buckets; quota counters remain server-cache state. No precise locations in stats (regions use blurred/chatroom ids); small cohorts masked at < 3 responses; exports keep masking on. Shared schemas/aggregators live in `src/shared/talk-stats.ts`. Raw stats events retained as Gun-mirrored append-only records; compaction/user-pruning is a production policy follow-up.

- **Survey analytics:** cross-question correlation; completion/skip rates by question; time-to-answer; segment filters (region/time bucket/talk type/responder cohort) under privacy thresholds; original vs follow-up survey comparison.
- **Talk analytics:** unified creator dashboard (tags/flows/routes/surveys); match/ignore/response/completion rates across types; time series with day/week/month controls; per-question answer-distribution drilldown.
- **Broadcast & tag analytics:** reach vs response rate; tag demand trends by region/time bucket; targeting effectiveness (tags → eligible → delivered → responses → matches); distance-cap effectiveness and local-vs-traveller split.
- **Chatroom & location analytics:** room activity over time; broadcast volume/response/match rate by room; region-level trends without precise location; travel-mode participation and remote-room effectiveness.
- **Peer & reputation analytics:** relationship history summaries; reputation trend inputs (ratings/blocks/age-votes/capacity impact); visibility-aware reputation sections respecting privacy settings.

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
