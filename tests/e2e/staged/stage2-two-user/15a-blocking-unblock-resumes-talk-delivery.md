# Test: Blocking System - Unblock Resumes Delivery

**Features tested:** Block/unblock relationship toggle, blocked delivery suppression, delivery restoration after unblock

---

## What this test does (in plain English):

1. **Tom and Jerry join Global.**
2. **Warm-up match:** Tom broadcasts a simple match talk, Jerry answers "Yes", and they become contacts.
3. **Tom blocks Jerry** from the Contacts relationship modal.
4. **Server block list check:** Tom's `/api/users/:id/blocks` response includes Jerry.
5. **Blocked-delivery check:** Tom broadcasts "Blocked Talk"; Jerry must not receive it in incoming talks.
6. **Tom unblocks Jerry** from the same relationship modal (button shows "Unblock User").
7. **Server unblock check:** Tom's block list no longer includes Jerry.
8. **Delivery-after-unblock check:** Tom broadcasts "Post-Unblock Talk"; Jerry now receives it.

## Verifications:

- ✅ Block action is persisted in server block state.
- ✅ While blocked, Jerry receives no new talks from Tom.
- ✅ Unblock action removes Jerry from Tom's block list.
- ✅ After unblock, talk delivery to Jerry resumes normally.
