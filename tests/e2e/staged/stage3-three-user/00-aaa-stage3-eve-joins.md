# Test: Stage 3 — Eve Joins TechSupport and Adam

**File:** 00-aaa-stage3-eve-joins.spec.ts  
**Features tested:** Third user (Eve) joins the Global chatroom alongside existing TechSupport and Adam users. Verifies headcount correctly reflects three concurrent users, then saves all three storage states for stage 3 downstream tests.

---

## What this test does (in plain English):

This is the bootstrap spec for stage 3 of the E2E pipeline. It loads the stage 2 snapshot (where TechSupport + Adam are already present), then onboards Eve — a new third user — and verifies the chatroom headcount updates accordingly.

1. **Load baseline:** Restores `stage2` server snapshot (TechSupport and Adam already in Global).
2. **Launch three browsers:** Each user gets their own Chromium instance with WebRTC args for P2P.
3. **Restore TechSupport & Adam:** Both load from saved stage 2 storage state, navigate to Global chatroom.
4. **Onboard Eve:** Fresh login as new user "Eve", joins Global chatroom.
5. **Verify headcount:** Polls Eve's view of the Global chatroom badge → must be ≥ 3 (TechSupport + Adam + Eve).
6. **Save all storage states:** Persists each user's context for stage 3 downstream tests: `stage3/techsupport`, `stage3/adam`, `stage3/eve`.
7. **Save stage snapshot:** Calls `saveStageSnapshot('stage3')` to freeze this three-user baseline.

> **Why this matters:** Stage 3 is the first time a third user enters the chatroom, enabling triangle tests (A→B, A→C, B↔C). The saved storage states let all stage-3 specs start from the same three-user configuration without re-bootstrapping. Note: `zzz-save-stage3.spec.ts` is an intentional no-op stub because saving already happens here immediately after Eve joins — later specs reset to this baseline so saving again would overwrite it.

---

**Helpers used:** `isStagePipeline`, `loadStageSnapshot`, `saveStageSnapshot`, `bootstrapTechSupport`, `bootstrapAdam`, `bootstrapEve`, `saveUserStorageState`, `afterSync`, `headless`
