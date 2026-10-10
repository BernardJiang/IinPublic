# Stage 2 — Adam Joins Tom

covers: SPEC-3.5, SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** 00-aaa-stage2-adam-joins.spec.ts  
**Features tested:** Pipeline bootstrap — load stage1, join second user (Adam) to the network, exchange a talk match, save snapshots.

---

## What this test does (in plain English):

Pipeline-only spec: transitions from stage1 to a two-ordinary-user stage2 by bootstrapping Tom and
Adam. TechSupport remains in the graph as a Contacts-only identity and is not used for the Talk.

1. **Pipeline guard:** Skips if `E2E_STAGE_PIPELINE ≠ 1`.
2. **Load stage1 snapshot** (`loadStageSnapshot('stage1')`).
3. **Bootstrap both ordinary users:** Tom and Adam are created fresh and share the same Nearby room.
4. **Talk exchange:** Tom creates and broadcasts `"Stage2 Adam Hello"` → Adam receives it → opens the modal → answers "Yes" with the match branch → modal closes after sync.
5. **Verification:** `#current-chatroom-status` confirms headcount updates; Adam's profile loaded from user graph. Status bar shows match count updated (≥1).
6. **Save artifacts:** Persists `stage2-tom.storage.json` and `stage2-adam.storage.json`, then saves the stage2 graph snapshot.

## Verifications:

- ✅ Both ordinary users authenticated and synced in Nearby
- ✅ Talk delivered, matched, and headcount updated
- ✅ Status bar shows ≥1 match after exchange
- ✅ Storage state files written for both canonical users
- ✅ Server Gun baseline saved to `snapshots/stage2-adam-join.json`

> **Why this matters:** Bridges stage1→stage2 in the pipeline. Establishes two-user network with a completed match, providing the base graph for all subsequent stage2 specs.

---

**Helpers used:** `isStagePipeline`, `loadStageSnapshot`, `saveStageSnapshot`, `bootstrapCanonicalUser`, `saveUserStorageState`, `createSimpleFlowTalkAndBroadcast`, `waitForIncomingTalkClusterOnServer`, `openIncomingTalkModal`, `waitForResponseModalClosed`
