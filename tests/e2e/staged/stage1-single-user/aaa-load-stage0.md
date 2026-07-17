# Stage 1 Load — Import stage0 Snapshot

covers: SPEC-3.5, SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** aaa-load-stage0.spec.ts  
**Features tested:** Pipeline bootstrap — load the stage0 server snapshot before running single-user tests.

---

## What this test does (in plain English):

Pipeline-only spec: imports the Gun graph from `snapshots/stage0.json` as baseline for the sequential stage pipeline. Skipped when not in pipeline mode.

- Skips if `E2E_STAGE_PIPELINE ≠ 1`.
- Calls `loadStageSnapshot('stage0')` which applies the previous save snapshot.

## Verifications:

- ✅ stage0 snapshot is loaded and applied to the server Gun graph before any single-user spec runs

> **Why this matters:** Ensures deterministic state across sequential pipeline runs — every stage starts from a known baseline.

---

**Helpers used:** `isStagePipeline`, `loadStageSnapshot`
