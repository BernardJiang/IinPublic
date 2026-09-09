# Archived — TODO consolidation 2026-09-08

`docs/README.md`'s own maintenance rule says there is one canonical future-work document,
[`docs/TODO.md`](../../TODO.md) — but six more TODO-shaped files had accumulated directly under
`docs/` outside that convention. They were reviewed and moved here. The three still-active phased
plans were merged into `docs/TODO.md` in full (as new sections); the three effectively-finished
ones had their sole remaining open item(s) pulled into `docs/TODO.md` and are archived otherwise
unchanged. None of these files are authoritative any more — treat `docs/TODO.md` as the current
source for every item below.

| Archived file | Original path | Disposition |
|---|---|---|
| `IinPublic_cross_platform_e2e_test_matrix_TODO.md` | `docs/IinPublic_cross_platform_e2e_test_matrix_TODO.md` | **Merged in full** → `docs/TODO.md` Priority 3, "Cross-platform E2E test matrix" |
| `TODO-ui-godobject-and-react-deps.md` | `docs/TODO-ui-godobject-and-react-deps.md` | **Merged in full** → `docs/TODO.md` Priority 6, "UI god-object refactor" |
| `TODO-react-cross-platform-performance.md` | `docs/TODO-react-cross-platform-performance.md` | **Merged in full** → `docs/TODO.md` Priority 6, "React DOM / React Native evaluation" |
| `TODO_codex.md` | `docs/TODO_codex.md` | Nearly all milestones shipped (see `docs/completed.md`). Its remaining open items (Apple/cross-platform Wi-Fi Aware and BLE prototyping, the physical-device matrix, the pre-cellular-forwarding security review, and four deferred-decision bullets) were folded into `docs/TODO.md` Priority 3 and "Deferred product decisions". No re-merge of the ~90% already-checked milestones. |
| `TODO_item.md` | `docs/TODO_item.md` | Tag-similarity scoring — fully shipped. Its one open research note (asymmetric/containment similarity metric) moved to `docs/TODO.md` "Smaller independent work". |
| `iinpublic_map_chatrooms_todo.md` | `docs/iinpublic_map_chatrooms_todo.md` | Map view — fully shipped. Its one open follow-up (evaluate PMTiles/Protomaps) moved to `docs/TODO.md` "Smaller independent work". |

## Out of scope for this consolidation

- `docs/IinPublic Identity & Key Architecture TODO.md` — reviewed but deliberately **not** merged or
  moved. It is a full architecture/design specification (goal, target key hierarchy, threat
  reasoning) that happens to use checkbox lists, not a task queue; folding it into `docs/TODO.md`
  would bury the design rationale inside the task tracker. `docs/TODO.md` now carries a one-line
  pointer to it instead.

## Pointer references updated as part of this consolidation

- `docs/device-verification/README.md` pointed at `TODO_codex.md` for the open physical-device
  items; updated to point at `docs/TODO.md` Priority 3.
- `docs/README.md` updated to list this archive folder alongside the 2026-06-08/2026-07-29 ones.

Historical mentions inside `docs/completed.md` and `memory/2026-09-07.md` (which correctly described
reality at the time they were written) were deliberately left as-is — same reasoning as the
2026-07-29 consolidation's own README.
