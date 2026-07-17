# Test: Stage 5 — Save Multi-User Snapshot

covers: SPEC-3.5, SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** zzz-save-stage5.spec.ts  
**Features tested:** Persists the stage 5 server graph snapshot after the multi-user test suite completes. Used by downstream stages to restore this baseline with multiple users active.

---

## What this test does (in plain English):

Terminal step of stage 5 in the E2E staged pipeline (`E2E_STAGE_PIPELINE=1`). After all multi-user tests have run, this captures the complete Gun graph state — including any users, talks, conversations, and reply history accumulated during the suite. Future stages can call `loadStageSnapshot('stage5')` to resume from this state.

1. **Save snapshot:** Calls `saveStageSnapshot('stage5')` persisting server-side Gun graph.

> **Why this matters:** Follows the same pattern as `zzz-save-stage0` and other stage-terminators — provides a deterministic checkpoint for downstream stages to replay from without re-running all prior setup.

---

**Helpers used:** `isStagePipeline`, `saveStageSnapshot`
