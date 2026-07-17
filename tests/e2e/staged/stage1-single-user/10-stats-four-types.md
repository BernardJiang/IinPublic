# Test: Stats API — All Four Talk Types (11 Users)

covers: SPEC-3.9  <!-- auto-seeded; refine by hand -->

**Features tested:** Server-side statistics aggregation across all talk types (summary, by-day, by-region, by-answer), multi-user response data integrity

---

## What this test does (in plain English):

Three users: Tom (broadcaster), Jerry (responder), and Sam (responder), all in the "Global" chatroom.

### Step 1: Tom creates and broadcasts one talk of each type

1. **Tom creates 4 talks** (Tag, Flow, Survey, Route) and broadcasts them to the room

### Step 2: Jerry and Sam each answer all 4 talks manually

2. **Jerry goes through all 4 talks**, answering each one manually
3. **Sam does the same** — answers all 4 manually, potentially with different choices

### Step 3: Server API validates statistics for every talk

4. For **each of the 4 talks**, the test hits four different API endpoints:

   **a) `/api/stats/talks/{id}/summary`** — confirms:
   - Total responses = 2 (Jerry + Sam)
   - Per-question breakdown shows correct answer counts and percentages (~100%)
   
   **b) `/api/stats/talks/{id}/by-day?bucket=day`** — confirms:
   - At least one day bucket exists
   - Sum of all day counts = 2
   
   **c) `/api/stats/talks/{id}/by-region`** — confirms:
   - At least one region bucket exists
   - Sum of all region counts = 2
   
   **d) `/api/stats/talks/{id}/by-answer?questionId={q}`** — confirms:
   - Total respondents ≥ 1
   - Answer percentages sum to ~100%

## Verifications:

- ✅ Statistics work uniformly for ALL four talk types (tag, flow, survey, route) without per-type special cases
- ✅ Summary endpoint correctly reports total responses
- ✅ By-day aggregation correctly buckets responses by date
- ✅ By-region aggregation correctly buckets responses by geographic region
- ✅ By-answer aggregation correctly shows answer distribution with ~100% total percentage
- ✅ Stats are accurate for multi-responder scenarios (Jerry + Sam = 2 responses)

> **Why this matters:** This is a backend integration test that verifies the statistical reporting layer works correctly for all talk types, proving data integrity across the entire analytics pipeline.
