# 17 — Chatroom Custom/Business API Flows

covers: SPEC-3.3  <!-- auto-seeded; refine by hand -->

This suite validates the newly added chatroom server APIs for user-defined and business rooms.

## Coverage

1. **Custom chatroom create contract**
   - Invalid payload rejected (400)
   - Create custom room succeeds and returns metadata (`POST /api/chatrooms`)

2. **Business chatroom creation**
   - Create business room with `businessInfo`
   - Verify persisted business metadata on read

3. **Membership endpoint contract**
   - Add member (`POST /api/chatrooms/:id/members`)
   - Invalid add payload rejected (400)
   - Remove member (`DELETE /api/chatrooms/:id/members/:userId`)

## Why this exists

Recent feature work added server support for:
- custom/business room metadata,
- explicit member add/remove endpoints.

This test locks the new API request/response contracts so future changes do not regress them.
