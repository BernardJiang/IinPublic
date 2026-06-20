# Test: TechSupport Creates Four Talk Types

**File:** caa-techsupport-four-talk-types.spec.ts  
**Features tested:** Creating all four talk types — tag, flow, survey, and route — via the company page JSON API. Verifies each appears in the Me/Answers tab with correct answers including context paths for route talks.

---

## What this test does (in plain English):

TechSupport programmatically creates one talk of each type (tag, flow, survey, route) using `createTalkFromCompanyPage()`, then verifies all four show up correctly in the Me/Answers tab.

1. **Setup:** Restores TechSupport from stage 0 storage state.
2. **Create 4 talks via company page:** Each with a timestamp-based run ID to ensure uniqueness:
   - **Tag talk** ("TechSupport food tag"): single yes/no question with self-answer = "Interested" → maps to checked checkbox in Me tab.
   - **Flow talk** ("TechSupport tennis flow"): single yes/no question with self-answer = "Yes, tennis".
   - **Survey talk** ("TechSupport food survey"): aggregatable question (Chinese/Italian cuisine) with self-answer = Chinese.
   - **Route talk** ("TechSupport job route"): multi-question branching — Q1: job searching? → Yes → Q2: engineering roles? → Yes. Verifies context path displays as human-readable "TechSupport job searching? -> Yes." NOT raw IDs.
3. **Verify Me/Answers tab:** All four talk titles visible with correct `talk-type-*` class.
4. **Verify answer rows:** 5 answer-outcome items match expected question/answer pairs.
5. **Verify route context path:** Child question row shows context path in display format, not raw questionId/answerId tuples.
6. **Verify localStorage:** Exactly 5 TechSupport-prefixed questions in `myQuestionAnswers`.

> **Why this matters:** Exercises the complete talk-creation pipeline for every supported type. The route-talk context path check catches regressions where internal IDs leak into the user-visible UI.

---

**Helpers used:** `isStagePipeline`, `bootstrapTechSupport`, `createTalkFromCompanyPage`, `afterNav`, `afterSync`, `headless`
