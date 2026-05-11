# Test: Blocking System - Block Stops Delivery and Limits Peer View

**Features tested:** Blocking workflow, blocked contact UI state, peer detail restrictions, blocked talk suppression

---

## What this test does (in plain English):

1. **Tom and Jerry join Global.**
2. **Warm-up match:** Tom broadcasts a talk and Jerry matches, so they appear in contacts.
3. **Tom blocks Jerry** in the Contacts relationship modal.
4. **Server confirmation:** Tom's block list contains Jerry.
5. **Contacts UI confirmation:** Jerry appears with blocked status in Tom's contacts list.
6. **Tom peer-detail checks (on Jerry):**
   - "Send My Talks" is disabled.
   - Block button shows "Unblock User".
7. **Delivery suppression check:** Tom broadcasts "Blocked Delivery Talk"; Jerry does not receive it.
8. **Blocked viewer check (Jerry viewing Tom):**
   - Peer detail shows "Profile unavailable".
   - Subtitle indicates blocked state.

## Verifications:

- ✅ Blocking persists in server and contacts UI.
- ✅ Blocked peers cannot receive newly broadcast talks.
- ✅ Peer detail enforces blocked-state UX constraints for both sides.
- ✅ Blocked user sees privacy-limited profile details.
