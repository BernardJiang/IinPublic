# Test: Stage 3 — Eve Joins Tom and Adam

covers: SPEC-3.5, SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** 00-aaa-stage3-eve-joins.spec.ts  
**Features tested:** Eve joins the same Nearby room as ordinary users Tom and Adam. TechSupport
stays Contacts-only and is excluded from the room count.

---

## What this test does (in plain English):

This bootstrap loads the Tom + Adam stage2 snapshot, adds Eve, and verifies a three-person Nearby
headcount while the built-in TechSupport identity remains outside the room.

1. **Load baseline:** Restores `stage2` (Tom and Adam in Nearby; TechSupport Contacts-only).
2. **Launch three browsers:** Each user gets their own Chromium instance with WebRTC args for P2P.
3. **Restore Tom & Adam:** Both load saved stage2 storage and enter Nearby.
4. **Onboard Eve:** Fresh login as Eve in the same Nearby cell.
5. **Verify headcount:** Eve's current Nearby badge reaches at least 3 (Tom + Adam + Eve).
6. **Save all storage states:** Persists `stage3/tom`, `stage3/adam`, and `stage3/eve`.
7. **Save stage snapshot:** Calls `saveStageSnapshot('stage3')` to freeze this three-user baseline.

> **Why this matters:** Stage 3 is the first time a third user enters the chatroom, enabling triangle tests (A→B, A→C, B↔C). The saved storage states let all stage-3 specs start from the same three-user configuration without re-bootstrapping. Note: `zzz-save-stage3.spec.ts` is an intentional no-op stub because saving already happens here immediately after Eve joins — later specs reset to this baseline so saving again would overwrite it.

---

**Helpers used:** `isStagePipeline`, `loadStageSnapshot`, `saveStageSnapshot`, `bootstrapTom`, `bootstrapAdam`, `bootstrapEve`, `saveUserStorageState`, `afterSync`, `headless`
