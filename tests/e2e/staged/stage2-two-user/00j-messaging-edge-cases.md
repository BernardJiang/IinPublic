# Messaging Edge Cases E2E

covers: SPEC-7.6, SPEC-19.4  <!-- auto-seeded; refine by hand -->

This file documents the intent and coverage for `tests/e2e/00j-messaging-edge-cases.spec.ts`.

## Covered
- **Message history persistence across reload**: after sending a message in an active conversation, reloading the page should still show the same message when reopening the conversation overlay.
- **Messaging after unblock**: after blocking the other user and then unblocking, direct messaging should continue to work (new messages delivered and visible in the other user’s conversation).

## Notes
- **Message read receipts** are represented in the UI by the conversation unread lifecycle and are already covered by `tests/e2e/10-message-unread-badge.spec.ts`.
