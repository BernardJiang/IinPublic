# Test: Stage 0 — Save Verified TechSupport Baseline

**File:** zzz-save-stage0.spec.ts  
**Features tested:** Persists the server Gun graph snapshot after TechSupport bootstrap, tab traversal, and four-talk-type creation. Used by downstream stages to restore this baseline.

---

## What this test does (in plain English):

This is the terminal step of stage 0 in the staged pipeline (`E2E_STAGE_PIPELINE=1`). All previous steps have verified TechSupport login, full UI traversal, and talk creation — now it captures the complete server graph so stages 1+ can replay from a known-good state.

1. **Save snapshot:** Calls `saveStageSnapshot('stage0')` to persist the entire Gun graph including TechSupport's user record, four talks (tag/flow/survey/route), and answer history.
2. Future stages call `loadStageSnapshot('stage0')` to restore this exact state before introducing additional users or talks.

> **Why this matters:** Provides a stable foundation for the entire staged test pipeline. Without persistence between stages, each stage would need to replay all prior setup — wasting minutes of CI time and multiplying flakiness surfaces.

---

**Helpers used:** `isStagePipeline`, `saveStageSnapshot`
