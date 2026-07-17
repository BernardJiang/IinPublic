# Test: Reputation System - Age-Verify Vouch Threshold

covers: SPEC-3.8  <!-- auto-seeded; refine by hand -->

**Features tested:** Vouch accumulation threshold, age-verified state transition, gated adult-talk delivery

---

## What this test does (in plain English):

1. **Tom and Jerry join Global.**
2. **Tom repeatedly submits age-verification vouches** for Jerry.
3. For each vouch step, **Tom creates and broadcasts an adult talk**.
4. **Before threshold is reached:** Jerry should not receive the adult talk.
5. **After threshold is reached (step 3):** Jerry should receive the adult talk.

## Verifications:

- ✅ Vouch votes accumulate over time.
- ✅ Delivery behavior flips only when verification threshold is met.
- ✅ Adult-talk gating is enforced consistently across broadcasts.
