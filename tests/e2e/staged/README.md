# Staged E2E pipeline

Sequential network stages build on each other. **TechSupport** is always the bootstrap root presence on an empty database; ordinary-user stages run alongside that root instead of treating it as an interchangeable user fixture.

| Stage | After | Network shape | Folder |
|-------|--------|---------------|--------|
| **stage0** | Empty DB + TechSupport bootstrap login | TechSupport root only | `stage0-bootstrap/` |
| **stage1** | Ordinary single-user tests | TechSupport root + one ordinary user per isolated spec | `stage1-single-user/` |
| **stage2** | Adam joins + 2-user tests | TechSupport root + two ordinary users | `stage2-two-user/` |
| **stage3** | Eve joins + 3-user tests | TechSupport root + three ordinary users | `stage3-three-user/` |
| **stage4** | Four-user tests | TechSupport root + four ordinary users | `stage4-four-user/` |
| **stage5** | Multi-user (5+) tests | TechSupport root + 5+ ordinary users | `stage5-multi-user/` |

## Commands

```bash
# Parallel regression (default) — specs under tests/e2e/, excludes staged/
npm run test:e2e

# Sequential stage pipeline (PW_WORKERS=1, accumulates Gun snapshots)
npm run test:e2e:staged
```

Snapshots: `tests/e2e/staged/snapshots/worker-{N}/stage{N}.json`  
User storage: `stage{N}-techsupport.storage.json`, `stage{N}-adam.storage.json`, etc.

## Pair-Direct Model

E2E defaults to mesh-talk delivery: the server is a bootstrap/signaling/room-membership connector, not the talk inbox authority. Tests should assert received talks from the receiver's local Gun IN index or UI.

## Status checks vs toasts

- **Hard:** `#status-bar-text`, headcount, nav active, conversation list, local incoming talk index (`helpers/e2e-status-checks.ts`).
- **Soft:** `.notification` toasts (`helpers/soft-toast.ts`) — log warning if missing, do not fail.

See `docs/testing/testplan.md` §4.4 for the full catalog sorted by user count.

## Non-staged directories (TODO.md K4)

`talks-matching/`, `mass/`, and `isolated/` have no stage folder of their own and currently reset
via the bare stage0 fixture on every spec (real TechSupport baseline, no ordinary users pre-seeded).
Decided 2026-07-27, based on an audit of each directory's actual `bootstrapUser()` call patterns:

- **`talks-matching/`** — dominant pattern is `launchThreeBrowsers()` (Tom/Jerry/Bob, three real
  users); 11 of 12 specs match this shape, one (`05-mailbox-offline-response`) uses only two of the
  three. **Decision: stage3** is the better-fitting progressive snapshot, not stage2 — the earlier
  TODO note guessing "stage2 for the pair-exchange mesh specs" was a hunch made before this audit
  and undercounted the actual per-spec user population.
- **`isolated/`** — `isolated-01-two-responders-partial-match` uses the same three-named-user
  pattern (Tom/Jerry/Bob). **Decision: stage3**, same reasoning as `talks-matching/`.
  `isolated-02-mixed-saturation` is the one outlier (see `mass/` below).
- **`mass/`** — every spec (`01`–`04` plus `isolated-02-mixed-saturation`, which is mass-shaped
  despite living in `isolated/`) spins up its own N *ephemeral* browsers in a loop (N = 1, 6, or 10+
  depending on the spec), created fresh inside the test rather than depending on a fixed pre-seeded
  population. **Decision: no stage benefit — stays on the bare stage0 fixture.** A progressive
  snapshot doesn't reduce this pattern's setup cost, since the test's own point is minting arbitrary
  numbers of fresh users.

This decision does not change TechSupport correctness in any of these directories — that is already
guaranteed everywhere by `verifyTechSupportBaseline()` regardless of which snapshot (if any) is
loaded. It only affects setup speed and multi-user realism for `talks-matching/`'s and
`isolated-01`'s per-spec `beforeAll`, and is not yet wired (needs `clearGunForStage3Spec`, tracked
in `docs/TODO.md` K4 alongside the stage2/4/5/mass/isolated/talks-matching conversion work).
