# Stage 2 — Adam Joins TechSupport

covers: SPEC-3.5, SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** 00-aaa-stage2-adam-joins.spec.ts  
**Features tested:** Pipeline bootstrap — load stage1, join second user (Adam) to the network, exchange a talk match, save snapshots.

---

## What this test does (in plain English):

Pipeline-only spec: transitions from single-user stage1 to two-user stage2 by loading the stage1 database snapshot, bootstrapping a fresh Adam alongside existing TechSupport, broadcasting a talk and completing a match, then saving all state for downstream tests.

1. **Pipeline guard:** Skips if `E2E_STAGE_PIPELINE ≠ 1`.
2. **Load stage1 snapshot** (`loadStageSnapshot('stage1')`).
3. **Bootstrap both users in one browser:** TechSupport restored from canonical bootstrap; Adam created fresh (not restored from stale storage). Both join "Global" chatroom.
4. **Talk exchange:** TechSupport creates and broadcasts `"Stage2 Adam Hello"` → Adam receives it on server → opens modal → answers "Yes" with match branch → modal closes after sync.
5. **Verification:** `#current-chatroom-status` confirms headcount updates; Adam's profile loaded from user graph. Status bar shows match count updated (≥1).
6. **Save artifacts:** Persists user storage for both Adam & TechSupport (`stage2-techsupport.storage.json`, `stage2-adam.storage.json`). Saves server Gun graph diff as stage2 baseline snapshot.

## Verifications:

- ✅ Both users authenticated and synced in Global chatroom
- ✅ Talk delivered, matched, and headcount updated
- ✅ Status bar shows ≥1 match after exchange
- ✅ Storage state files written for both canonical users
- ✅ Server Gun baseline saved to `snapshots/stage2-adam-join.json`

> **Why this matters:** Bridges stage1→stage2 in the pipeline. Establishes two-user network with a completed match, providing the base graph for all subsequent stage2 specs.

---

**Helpers used:** `isStagePipeline`, `loadStageSnapshot`, `saveStageSnapshot`, `bootstrapTechSupport`, `bootstrapCanonicalUser`, `saveUserStorageState`, `createSimpleFlowTalkAndBroadcast`, `waitForIncomingTalkClusterOnServer`, `openIncomingTalkModal`, `waitForResponseModalClosed`
