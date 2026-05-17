# Test: Reputation System - Block Count Propagation

**Features tested:** Reputation block-count updates from block/unblock relationship actions

---

## What this test does (in plain English):

1. **Tom and Jerry are bootstrapped and connected** via a matching talk so they appear as contacts.
2. **Tom opens Jerry's contact relationship modal.**
3. **Tom blocks Jerry.**
4. **Reputation API poll:** Jerry's `reputation.blockCount` becomes `1`.
5. **Tom opens the modal again** and unblocks Jerry.
6. **Reputation API poll:** Jerry's `reputation.blockCount` returns to `0`.

## Verifications:

- ✅ Blocking increments the target user's reputation block count.
- ✅ Unblocking decrements/restores block count.
- ✅ Reputation changes propagate through server read APIs.
