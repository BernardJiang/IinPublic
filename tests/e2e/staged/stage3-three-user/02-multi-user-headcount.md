# Test: Multi-User — Three Users Enter Sequentially, Exit FIFO, Re-Enter Random Order

covers: SPEC-3.3, SPEC-3.1, SPEC-3.7

**File:** 02-multi-user-headcount.spec.ts
**Features tested:** the Nearby headcount ("N near you", my list without me) with three users
leaving and coming back

---

## What this test does (in plain English):

1. **Users 1, 2 and 3 enter one after another:** the headcounts read 0, then 1 and 1, then 2 on all
   three.
2. **They leave in order (1, then 2, then 3):** each closes their page only, keeping the browser
   context (and so their identity: its non-extractable key cannot be saved in a storage state).
   Nearby has no goodbye (design §3.7): the others drop the leaver when a swap gets no answer.
3. **They come back in another order (2, 3, then 1):** a returning user's saved list still holds
   people who left meanwhile; each drops after two silent swaps. Headcounts end at 2 on all three.

Every check runs swaps now (`expectNearbyHeadcount`) instead of waiting out gossip periods, and the
test allows 5 minutes for the stale entries to clear.

> **Why this matters:** lists stay right through arrivals, silent departures and returns,
> including a returning phone whose old peers have reset.

---

**Helpers used:** `expectNearbyHeadcount` (`helpers/nearby-v3.ts`), `injectIdbClear`, `ensureWindowFitsViewport`, `afterLoad`, `afterSync`, `afterNav`, `wait`, `attachE2eBrowserTabLabel`
