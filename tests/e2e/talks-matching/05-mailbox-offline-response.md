# 05 — An answer while the author is offline (graph log catch-up)

covers: SPEC-31.9, SPEC-19.4, SPEC-3.6

## What this test proves

Two browser peers (Tom / Jerry). Tom is the Talk **author**; Jerry is a **matching responder**.
Since OPEN-106 there is no mailbox for Talks or answers: an answer is an entry in the
responder's per-pair device-graph log, and the author reads it the next time they are linked.

### Flow

1. Both are online. Tom offers a **tag** Talk over the graph (`offerTalkForE2e`).
2. Jerry receives it. Tom's page is then **closed** (Tom goes offline).
3. Jerry answers **MATCH**. The answer becomes an entry in Jerry's log for Tom; Jerry's device
   owes Tom that entry (the `owed` graph event lists Tom), so it keeps wanting a link to him.
4. **No mailbox:** `GET /api/mailbox/:tomId` returns 0 envelopes.
5. Tom **reconnects** in the same device context (user id and SEA key unchanged; the context
   keeps custody v3's non-extractable WebCrypto key).
6. **Durable match assertion:** Tom's `myConversations` gains the Tom↔Jerry conversation,
   from reading Jerry's log.
7. Tom's head now says he read the entry, so Jerry owes him nothing (`owed` no longer lists Tom);
   the mailbox is still empty.
8. The conversation id is identical on both sides.

### Invariants

- Zero calls to `POST /api/talks/:id/response`.
- No mailbox envelope at any point.
- The match conversation id is identical on both sides.
