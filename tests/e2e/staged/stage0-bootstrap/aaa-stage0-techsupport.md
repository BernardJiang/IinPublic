# Test: Stage 0 — Empty Database, TechSupport First User (Bootstrap)

**File:** aaa-stage0-techsupport.spec.ts  
**Features tested:** E2E stage-pipeline bootstrap — resets all Gun databases to empty state, logs in the canonical TechSupport user on the Global chatroom, then saves persisted storage state for downstream stages.

---

## What this test does (in plain English):

This is the very first step of the staged pipeline (`E2E_STAGE_PIPELINE=1`). It wipes all existing Gun data so every stage starts from a known-empty baseline, creates and logs in the TechSupport user, verifies the UI shows "Global" chatroom with headcount 1, then saves the storage state snapshot.

1. **Reset:** Calls `resetToStage0Empty()` — clears all Gun databases and server graph to pristine state.
2. **Launch browser:** Single headless Chromium instance.
3. **Bootstrap TechSupport:** Logs in via `bootstrapTechSupport()`, joins Global chatroom.
4. **Status checks:** Confirms `statusBarRoom` contains "Global" and `chatroomHeadcount` for global = 1.
5. **Save state:** Persists browser storage state as `stage0/techsupport` for later stages to restore.

> **Why this matters:** This is the ground-zero anchor of the entire staged test pipeline. Without a clean, deterministic starting point every subsequent stage would be flaky. The saved storage state lets stage 1+, 2+, 3+ etc. resume from the exact same login without re-doing authentication.

---

**Helpers used:** `isStagePipeline`, `resetToStage0Empty`, `bootstrapTechSupport`, `saveUserStorageState`, `assertStatusChecks`, `headless`
