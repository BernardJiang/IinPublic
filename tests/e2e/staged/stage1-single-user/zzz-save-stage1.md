# Stage 1 Save — Persist Server Graph Snapshot

covers: SPEC-3.5, SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** zzz-save-stage1.spec.ts  
**Features tested:** Pipeline checkpoint — save server Gun graph after single-user tests.

---

## What this test does (in plain English):

Pipeline-only spec: persists the current server Gun state to `snapshots/stage1.json` after all single-user specs complete. This snapshot seeds stage2.

- Skips if `E2E_STAGE_PIPELINE ≠ 1`.
- Calls `saveStage1SnapshotFromStage0Baseline()` which diffs from stage0 and saves stage1.

## Verifications:

- ✅ Server graph persisted to disk as stage1.json for downstream pipeline stages

> **Why this matters:** Enables incremental state across sequential stages — each stage starts from the prior one's snapshot instead of a blank database.

---

**Helpers used:** `isStagePipeline`, `saveStage1SnapshotFromStage0Baseline`
