# Test: Save Stage 4 Snapshot — Pipeline-Only End-of-Suite Checkpoint

covers: SPEC-3.5, SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** zzz-save-stage4.spec.ts  
**Features tested:** E2E stage pipeline snapshot saving, stage persistence checkpoint after four-user test suite

---

## What this test does (in plain English):

1. **Conditional execution:** This test is gated behind `isStagePipeline()` — it only runs when the environment variable `E2E_STAGE_PIPELINE=1` is set. In normal test runs it is silently skipped via `test.skip()`.

2. **Save snapshot:** Calls `saveStageSnapshot('stage4')` which captures the current state after all Stage 4 four-user tests have completed. This checkpoint preserves the Gun database and application State for downstream Stage 5 tests to build on.

> **Why this matters:** Provides a deterministic checkpoint between test stages in CI pipelines so that Stage 5 multi-user tests can start from a known-good state left by the Stage 4 four-user suite. The `zzz-` prefix ensures this runs last within the Stage 4 suite.

---

**Helpers used:** `isStagePipeline`, `saveStageSnapshot`
