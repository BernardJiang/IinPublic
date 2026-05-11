# Test: Reputation System - Peer Star Rating

**Features tested:** Contact relationship rating persistence and reputation star aggregation

---

## What this test does (in plain English):

1. **Tom and Jerry become contacts** through a successful talk match.
2. **Tom opens Jerry's relationship modal** from Contacts.
3. **Tom selects a new star rating** (typically 4 or 5) and saves.
4. **Reputation API poll:** Jerry's `reputation.starRating` converges to the saved value.

## Verifications:

- ✅ Peer rating can be submitted from the relationship modal.
- ✅ Saved rating is reflected in reputation data.
- ✅ Reputation read path returns the updated aggregated value.
