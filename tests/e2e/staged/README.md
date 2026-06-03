# Staged E2E pipeline

Sequential network stages build on each other. **TechSupport** is always the first user on an empty database.

| Stage | After | Users in network | Folder |
|-------|--------|------------------|--------|
| **stage0** | Empty DB + TechSupport login | 1 | `stage0-bootstrap/` |
| **stage1** | All single-user tests | 1 (TechSupport) | `stage1-single-user/` |
| **stage2** | Adam joins + 2-user tests | 2 | `stage2-two-user/` |
| **stage3** | Eve joins + 3-user tests | 3 | `stage3-three-user/` |
| **stage4** | Four-user tests | 4 | `stage4-four-user/` |
| **stage5** | Multi-user (5+) tests | 5+ | `stage5-multi-user/` |

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

E2E defaults to `P0_DIRECT_TALK_DELIVERY=1`: the server is a bootstrap/signaling/room-membership connector, not the talk inbox authority. Tests should assert received talks from the receiver's local Gun IN index or UI. Legacy `/incoming-talks` assertions are only for explicit star-mode regressions.

## Status checks vs toasts

- **Hard:** `#status-bar-text`, headcount, nav active, conversation list, local incoming talk index (`helpers/e2e-status-checks.ts`).
- **Soft:** `.notification` toasts (`helpers/soft-toast.ts`) — log warning if missing, do not fail.

See `docs/testing/testplan.md` §4.4 for the full catalog sorted by user count.
