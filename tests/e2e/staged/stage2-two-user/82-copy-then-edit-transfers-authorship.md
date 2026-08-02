# Test: Copy Then Edit Transfers Authorship

covers: docs/TODO.md §Y1 — a copy is not authorship; only a real content edit transfers credit.

**File:** 82-copy-then-edit-transfers-authorship.spec.ts

## What this test does (in plain English):

1. **Setup:** TechSupport creates and broadcasts a talk. Tom receives it, answers it (a match),
   and copies it to his own outgoing list via the 📋 button in the Answers tab — the same flow
   `08-super-user-copy-talk.spec.ts` already covers for the disable/enable/delete lifecycle.
2. **Assertion 1 — copy preserves original authorship:** reads Tom's local `myTalks` entry for
   the copied row directly and checks `fullTalk.authorId` is still TechSupport's id, not Tom's.
3. **Opens the copied row's editor** (a plain row click, not the broadcast-toggle button) and
   checks the form's `data-editing-talk-id` is empty — proving the dialog did NOT enter
   "update in place" mode for a talk Tom doesn't own yet.
4. **Makes a real content edit** (new title, new first-question text) and submits.
5. **Assertion 2 — the edit minted a new, Tom-owned talk:** the new `role="created"` row's
   `fullTalk.authorId` is Tom's id, `originalAuthorId` is still TechSupport's id, and
   `supersedesTalkId` points back at the retired copy's talk id.
6. **Assertion 3 — the old copy is gone:** the predecessor `role="copied"` row is retired
   (deleted, the default `getKeepOldTalkOnEdit()` policy) rather than left behind as a duplicate.

## What this deliberately does NOT test (out of scope for this spec):

- The disable/enable/delete toggle lifecycle on a copied-but-unedited talk — already covered by
  `08-super-user-copy-talk.spec.ts`.
- The advanced "keep old talk, just disable it" revision policy (`getKeepOldTalkOnEdit()` set to
  keep) — pure settings-toggle logic, not re-verified here.
- The DM-shorthand (Auto Linear Capture) append case that also goes through
  `buildRevisedTalkDraft()` — a different entry point into the same shared machinery, covered
  separately.

**Helpers used:** `bootstrapSuperUser`, `getCurrentUserId`, `clickBroadcastUntilBulkAck`,
`submitTalkEditorAndWaitForOut`, `TECHSUPPORT_ROOT_USER_ID`.
