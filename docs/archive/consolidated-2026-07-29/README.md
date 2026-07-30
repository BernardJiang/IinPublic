# Archived — Docs consolidation 2026-07-29

These documents were reviewed and moved here. Some were merged in full into the canonical
[Technical Specification](../../specs/iinpublic-technical-specifications.md) (Part VI, §26–28, and
the §19.7 expansion); others were already fully superseded by shipped implementation (recorded in
`docs/completed.md`) or by content already present elsewhere in the spec, and are archived without
re-merge. They are historical sources only; do not treat them as authoritative. See
`docs/completed.md` (2026-07-29 entry) for the full consolidation record.

| Archived file | Original path | Disposition |
|---|---|---|
| `gui-redesign-plan.md` | `docs/gui-redesign-plan.md` | **Merged in full** → spec §26.1 |
| `gui-layout-catalog-and-e2e-plan.md` | `docs/gui-layout-catalog-and-e2e-plan.md` | **Merged in full** → spec §26.2 |
| `S3-embedded-node-shell.md` | `docs/design/S3-embedded-node-shell.md` | **Merged in full** → spec §27 |
| `Gun-Database-Architecture.md` | `docs/Gun-Database-Architecture.md` | **Merged in full** → spec §28 |
| `techsupport-bootstrap-contract.md` | `docs/design/techsupport-bootstrap-contract.md` | **Merged in full** → spec §19.7.1 |
| `hub-hardening-explicit-relay-channel.md` | `docs/design/hub-hardening-explicit-relay-channel.md` | Superseded by shipped implementation — see `docs/completed.md` 2026-07-06 ("Embedded hub hardening: explicit HTTP relay replaces generic Gun peer"). No re-merge; the S3 shell architecture it hardens is spec §27. |
| `p0-step1-mesh-transport.md` | `docs/design/p0-step1-mesh-transport.md` | Implementation-handoff plan; shipped — see `docs/completed.md` 2026-06-09 ("P0 Step 1: Mesh Transport Foundation"). Authoritative design was already spec §23/§19.13 per the note's own header. No re-merge. |
| `p0-step4-mesh-responses.md` | `docs/design/p0-step4-mesh-responses.md` | Implementation-handoff plan; shipped — see `docs/completed.md` 2026-06-10 ("P0 Steps 4-6"). Authoritative design was already spec §23.6/§19.13/§19.4. No re-merge. |
| `p0-steps8-11-ledger.md` | `docs/design/p0-steps8-11-ledger.md` | Implementation-handoff plan; shipped — see `docs/completed.md` 2026-06-10 ("P0 Step 8") and 2026-06-12 ("P0 Steps 9-11"). Authoritative design was already spec §23.6/§20.7/§19.13. No re-merge. |
| `S3-native-libp2p-shell.md` | `docs/design/S3-native-libp2p-shell.md` | Explicitly superseded by `S3-embedded-node-shell.md` (now spec §27) per its own header. No re-merge. |
| `techsupport-k1-design-note.md` | `docs/design/techsupport-k1-design-note.md` | Implementation-handoff plan for K1; conclusions folded into `techsupport-bootstrap-contract.md` (now spec §19.7.1) and `docs/completed.md` 2026-07-25 ("K1: TechSupport built-in identity + relay-light presence"). No re-merge. |
| `techsupport-k2-design-note.md` | `docs/design/techsupport-k2-design-note.md` | Same as K1 — conclusions in spec §19.7.1 + `docs/completed.md` 2026-07-25 ("K2: signed greeting without server storage"). No re-merge. |
| `techsupport-k3-design-note.md` | `docs/design/techsupport-k3-design-note.md` | Same — conclusions in spec §19.7.1 + `docs/completed.md` 2026-07-26 ("K3: developer login as TechSupport"). No re-merge. |
| `techsupport-k5-design-note.md` | `docs/design/techsupport-k5-design-note.md` | Same — conclusions in spec §19.7.1 + `docs/completed.md` 2026-07-25/26 ("K5: TechSupport DM Q&A", Items 1–5). No re-merge. |
| `p2p-mesh-libp2p-analysis.md` | `docs/architecture/p2p-mesh-libp2p-analysis.md` | Already merged into spec §25 on 2026-06-10 — confirmed by the file's own §6 "Review notes" section, which records exactly that. No re-merge. |
| `current-README.md` | `docs/current/README.md` | Redundant duplicate pointer of `docs/README.md`, itself stale (referenced spec "§19–24"; spec is now through §28). `docs/current/` removed as a directory. |
| `projectplan_zh.md` | `docs/zh/projectplan_zh.md` | Stale Chinese translation of a pre-consolidation, superseded draft SRS (old product framing — "Location-Based Chatbot Matching & Talk System"). Not maintained; no current translation exists to supersede it with. `docs/zh/` removed as a directory. |
| `testplan_zh.md` | `docs/zh/testplan_zh.md` | Stale Chinese translation of a pre-consolidation, superseded draft test plan. Same disposition as `projectplan_zh.md`. |

## Out of scope for this consolidation

Reviewed and deliberately left in place — not design requirements, so out of scope for "consolidate
design requirements into the SRS":

- `docs/LAN-HTTPS.md` — dev-ops/how-to guide (LAN HTTPS cert setup), not a design requirement.
- `docs/e2e-test-analysis.md` — test-coverage analysis (dated 2026-06-27); belongs to the Test Plan
  canonical doc's territory, and is likely itself superseded by the auto-generated
  `docs/testing/coverage-matrix.md` (2026-07-17) — a separate cleanup, not attempted here.
- `docs/design/port-usage-scenarios.md` — already its own canonical doc per `docs/README.md`, not a
  candidate for merging into the SRS.

## Pointer references updated as part of this consolidation

`CLAUDE.md` and `docs/TODO.md`'s `Source:` lines that pointed at the merged files were updated to
point at their new spec section numbers. Historical mentions inside `docs/completed.md` (which
correctly described reality at the time they were written) and scattered code-comment pointers
(e.g. `src/web/app/app.ts`, `src/shared/talk-ledger.ts`) were deliberately left as-is — they still
resolve to real, findable content at the archived paths above, and rewriting historical ledger
entries or every scattered comment was judged out of proportion with the value, consistent with how
the 2026-06-08 consolidation handled the same situation.
