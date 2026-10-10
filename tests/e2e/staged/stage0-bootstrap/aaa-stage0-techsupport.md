# Test: Stage 0 — Empty Database, Contacts-Only TechSupport

covers: SPEC-3.5, SPEC-3.2, SPEC-12.4  <!-- auto-seeded; refine by hand -->

**File:** aaa-stage0-techsupport.spec.ts  
**Features tested:** E2E stage-pipeline bootstrap resets the databases, logs in the canonical
TechSupport root without room presence, and saves persisted state for downstream stages.

---

## What this test does (in plain English):

This step wipes existing data, logs in TechSupport, verifies the UI shows **Contacts only**, and
saves the storage snapshot.

1. **Reset:** Calls `resetToStage0Empty()` — clears all Gun databases and server graph to pristine state.
2. **Launch browser:** Single headless Chromium instance.
3. **Bootstrap TechSupport root:** Logs in via `bootstrapTechSupport()` without joining a room.
4. **Status check:** Confirms `statusBarRoom` contains "Contacts only".
5. **Save state:** Persists browser storage state as `stage0/techsupport` for later stages to restore.

> **Why this matters:** This is the ground-zero anchor of the entire staged test pipeline. Without a clean, deterministic starting point every subsequent stage would be flaky. The saved storage state lets stage 1+, 2+, 3+ etc. resume from the exact same login without re-doing authentication.

---

**Helpers used:** `isStagePipeline`, `resetToStage0Empty`, `bootstrapTechSupport`, `saveUserStorageState`, `assertStatusChecks`, `headless`
