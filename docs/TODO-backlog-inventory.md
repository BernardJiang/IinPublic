# IinPublic Backlog Inventory

Last updated: 2026-05-27

This document holds the detailed acceptance inventory that used to live in `docs/TODO.md`.
Use `docs/TODO.md` for immediate next actions and execution ordering.

## Detailed D6 Acceptance Inventory

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

## TechSupport Root Network Role Inventory

Scope: FR-CR-1 / FR-CR-2 and P2P identity/signaling/direct-message boundaries.

Core inventory:
- Canonical singleton root identity for `TechSupport`.
- Bootstrap enforcement and reserved-name anti-impersonation behavior.
- Global-room non-empty anchor guarantees.
- Idempotent greeting + support-channel establishment for each ordinary user.
- Direct transport preference with encrypted relay fallback compatibility.
- User-visible support-channel health metadata.
- Support contact UX guardrails (mute vs ordinary block semantics).
- Privacy/safety constraints (no private key/message leakage through diagnostics/storage).

Verification inventory:
- First-run bootstrap checks.
- Multi-user/reconnect/idempotency behavior.
- Cross-tab support behavior consistency.
- Parallel stage behavior and stage snapshot integrity.

## E2E Stage Pipeline Inventory

- Consolidate single-user coverage into TechSupport Stage 0 baseline where applicable.
- Keep later stages loading a canonical TechSupport baseline before adding ordinary users.
- Audit broadcast and member-count assertions so TechSupport presence does not cause false failures.
- Require tests to declare whether TechSupport participates/is ignored/is excluded.
- Preserve parallel worker isolation while still seeding TechSupport before ordinary users.

## Legacy Baseline Notes (Condensed)

- D2/D3/D4/D5/D6 all have shipped partial proofs and scripts; the remaining work is acceptance closure, not a greenfield implementation.
- Localization coverage is broad but still needs edge-path fallback audit.
- Intake controls are broadly covered but still need richer dirty-word diagnostics and distance preamble polish.
- Lifecycle and triage work are materially advanced but not fully exhaustive across all branches/tabs.

## Working Rule

- Keep `docs/TODO.md` concise.
- Track detailed acceptance inventory here.
- Move shipped outcomes to `docs/completed.md`.
