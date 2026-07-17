# Test: Stage 3 — Save Snapshot (Intentional No-Op)

covers: SPEC-3.5, SPEC-3.2  <!-- auto-seeded; refine by hand -->

**File:** zzz-save-stage3.spec.ts  
**Features tested:** None — this is a deliberately empty placeholder. The stage 3 snapshot was already saved by `00-aaa-stage3-eve-joins.spec.ts` immediately after Eve joined, and subsequent specs intentionally reset to that TechSupport baseline. Saving again here would overwrite the canonical state mid-suite.

---

## What this test does (in plain English):

Nothing — it's a no-op stub with a comment explaining why. In every other stage, the `zzz-save-stageN` spec captures the server graph after that stage's tests complete. But for stage 3, the snapshot is saved early (right in 00-aaa) because later specs within stage 3 need to reset *back* to it, so saving at the end would overwrite the baseline with whatever state the last spec left behind.

> **Why this matters:** The presence of this file signals intent — stage 3 is intentionally handled differently from stages 0/2 where zzz-save runs last.

---

**Helpers used:** `isStagePipeline` (skip guard only)
