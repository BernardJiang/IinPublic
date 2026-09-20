# x6-offline-mailbox

covers: SPEC-19.4, SPEC-9.1

Two matched clients (`setupLeanMatchedPair`, the overlay-free helper `staged/
stage2-two-user/36-offline-beyond-mailbox-ttl` already uses) on the shared
per-worker hub. "Offline" is simulated the same way `talks-matching/
05-mailbox-offline-response` and spec 36 already do: close the browser's only page,
then later reopen a page in the same isolated device context. This leaves no active
network peer while preserving custody v3's non-extractable IndexedDB key; the test
asserts both the app user id and SEA public key remain identical.

Both existing mailbox specs only ever take one side offline. This spec proves
the same mechanism works in the other direction too, in one continuous run:

1. B goes offline; A sends a message (`sendConversationMessage` — the ordinary
   production path, `WebConversationService.sendMessage` →
   `postConversationMessageToMailbox` on WebRTC failure, not a manually
   constructed envelope).
2. B reconnects with the same identity, drains, and the message from A appears
   in B's message store.
3. A goes offline; B (now reconnected) sends a message back.
4. A reconnects with the same identity, drains, and the message from B appears
   in A's message store.
5. Both recipients' mailboxes end empty after their respective drains.

Run: `npm run test:e2e:cross-platform` (part of the P0 merge-gate set alongside
X1/X2/X4; X3/X5/X7/X8 remain nightly/native-shell-gated per this folder's
README).
