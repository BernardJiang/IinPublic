# Stage 2 Save — Persist Server Graph Snapshot

**File:** zzz-save-stage2.spec.ts  
**Features tested:** Pipeline checkpoint — save server Gun graph after two-user tests.

---

## What this test does (in plain English):

Pipeline-only spec: persists the current server Gun state and user storage states after all stage2 specs complete. This snapshot seeds stage3 with a live two-peer network.

- Skips if `E2E_STAGE_PIPELINE ≠ 1`.
- Saves TechSupport & Adam user storage (`stage3-techsupport.storage.json`, `stage3-adam.storage.json`).
- Calls `saveStageSnapshot('stage2')` which diffs from stage1 baseline and persists to disk.

## Verifications:

- ✅ Server graph persisted as stage2.json for downstream pipeline stages
- ✅ User storage state files written for TechSupport and Adam

> **Why this matters:** Enables incremental state across sequential stages — every stage starts from a verified checkpoint rather than rebuilding the graph from scratch.

---

**Helpers used:** `isStagePipeline`, `saveStageSnapshot`
