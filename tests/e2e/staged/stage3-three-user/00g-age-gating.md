# Test: Age Gating - Adult Talk Delivery by Verification State

covers: SPEC-3.2  <!-- auto-seeded; refine by hand -->

**Features tested:** Adult talk flag, age-verification threshold behavior, server-side delivery filtering

---

## What this test does (in plain English):

1. **Tom, Jerry, and Bob join Global.**
2. **Jerry is age-verified via API vouches** (3 sequential `POST /api/users/:id/age-verify` calls).
3. **Bob remains unverified.**
4. **Tom creates an adult talk** (`isAdult = true`) and broadcasts it.
5. **Jerry delivery check:** Jerry should receive the adult talk.
6. **Bob delivery check:** Bob should not receive the adult talk.

## Verifications:

- ✅ Age-verification votes can flip a user into verified state at threshold.
- ✅ Adult content is delivered to verified users.
- ✅ Adult content is blocked for unverified users.
- ✅ Filtering occurs server-side on incoming-talk delivery.
