# 05 — Encrypted offline mailbox (P0 step 6)

covers: SPEC-19.4, SPEC-9.1, SPEC-3.6  <!-- auto-seeded; refine by hand -->

## What this test proves

Two browser peers (Tom / Jerry). Tom is the talk **author**; Jerry is a **matching responder**.

### Flow

1. Both Tom and Jerry are online. Tom creates and broadcasts a **tag** talk.
2. Jerry receives it over mesh. Tom's page is then **closed** (simulating Tom going offline).
3. Jerry answers **MATCH**. Because Tom is offline, the direct mesh unicast cannot succeed.
   The response is posted to the server mailbox as a ciphertext-only envelope.
4. **Ciphertext opacity assertion:** `GET /api/mailbox/:tomId` returns exactly 1 envelope
   whose `ciphertext` field does NOT contain the answer text in plaintext. The server sees
   only an opaque SEA ECDH ciphertext blob.
5. Tom **reconnects** (new browser context, same identity via `storageState`). On boot,
   `drainMailbox()` is called automatically.
6. **Durable match assertion:** Tom's side shows a `conversation-list-item` for the
   Tom↔Jerry pair (localStorage-backed — persists while the Conversations tab is active).
   The conversation id on Tom's side matches the one Jerry created optimistically.
7. The mailbox envelope is deleted from the server after successful drain.

### Expired envelope sub-case (server integration test)

The "expired envelope is dropped on drain" case is covered by the server integration test
`src/test/integration/mailbox-routes.test.ts` (TTL eviction section), which can control
time precisely without browser clock manipulation. The E2E spec omits this sub-case to
avoid clock-override fragility in Playwright.

### Invariants

- Zero calls to `POST /api/talks/:id/response` (server fan-in not used).
- The ciphertext field in the mailbox envelope does not contain the plaintext answer.
- After drain, `GET /api/mailbox/:tomId` returns 0 envelopes.
- The match conversation id is identical on both sides (deterministic `conv_<sorted>_<talkId>`).
