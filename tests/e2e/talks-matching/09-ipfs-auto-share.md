# 09 — Matched-talk IPFS attachment auto-share (L5)

**Features tested:** L5 — encrypted IPFS attachment published alongside a talk is automatically shared via a single deterministic `IPFS_SHARE:` message once a match occurs. The matched responder can fetch and decrypt the bytes; non-matching peers never see the link. A mailbox drain re-materializes the same share idempotently.

**Run:** `npx playwright test tests/e2e/talks-matching/09-ipfs-auto-share.spec.ts`

## Flow

1. Tom, Jerry, and Bob bootstrap in parallel (three Chromium browsers) with `maybeClearGunDatabases`.
2. Mesh neighbors are established via `ensureMeshNeighbors` so each peer knows the other two.
3. **Jerry's mailbox is intercepted:** `GET /api/mailbox/*` returns an empty envelope array to verify that no fallback traffic leaks while Jerry is "online".
4. Tom retrieves his SEA pair and Jerry's public key, then calls `contentNodeService.publishAttachmentBytes` — encrypting arbitrary bytes for the recipient (Jerry). The blockstore call is monkey-patched so the encrypted ciphertext blob can be captured and later seeded into Jerry's node.
5. The encrypted block bytes are injected directly into Jerry's IPFS blockstore (seeded by hand, since the local test suite has no external bitswap relay peer).
6. Tom creates a **tag talk** carrying `ipfsAttachments: [attachment]` with an `isMatch: true` answer and an `isIgnore: true` answer, and calls `peerMeshService.broadcastTalk`.
7. Both Jerry and Bob receive the cached talk body through the mesh (verified via `getCachedTalkBody`).
8. **Share subscriptions:** Tom and Jerry each call `conversationService.subscribeToMessages` with a filter for messages starting with `IPFS_SHARE:` — results land in `window.__l5ShareMessages`.
9. Jerry answers MATCH; Bob answers IGNORE — both via `submitTalkResponsePairDirect`, run in parallel.
10. **Conversation assertions:** Tom and Jerry each have a conversation entry (`getConversationIdForPeer` reads localStorage-backed `myConversations`). Bob has none for Tom (ignore path). The conversation ID is deterministic: `conv_<sorted userIds>_<talkId>`.
11. **Share-message assertions:** both Tom and Jerry receive exactly one `IPFS_SHARE:` message in their subscription callback — `ids.length === 1`, payload contains `cid` matching the attachment, `link === ipfs://<cid>`, and a non-empty `keyCiphertext`.
12. **Fetch + decrypt assertion:** Jerry calls `maybeFetchSharedAttachmentBytes(payload, tomId)` then reads back the decrypted byte length via `getFetchedAttachmentBytesLengthForE2e(cid)`. Expected length equals the UTF-8 encoded original attachment text.
13. **Bob suppression assertion:** Bob's GUN `users/<bobId>/conversations` map is queried for any message containing the attachment CID — count must be 0, proving the share link never reached a non-matching peer.
14. Durable mailbox envelope (`mbx_share_<messageId>`) is verified present on the server even though Jerry's live GUN held the message.
15. **Idempotent redrain sub-case:** Jerry's conversation-message node in GUN (`pairConversations/<pairId>/<cid>/messages/<messageId>`) is set to `null` (deleting it). Jerry's page is closed and a new page opened on the same context. `drainMailbox()` is called — the share message is re-materialized with identical content, and the server mailbox ends up with 0 envelopes after the drain.

## Key assertions / verifications

- Both peers get exactly one share message (`ids.length === 1`, unique IDs via `Set` check).
- Share payload carries the correct attachment CID and `ipfs://<cid>` link plus non-empty `keyCiphertext`.
- Jerry can successfully fetch + decrypt and recover byte length of original plaintext.
- Bob receives zero messages containing the attachment CID (suppression).
- After deleting the live GUN node + reopening + mailbox drain, the share message re-materializes identically (idempotency).

## Helper functions used

| Helper / fn | Purpose |
|---|---|
| `getConversationIdForPeer(page, peerId)` | Reads localStorage `myConversations` and returns the key for a conversation with the given peer. |
| `subscribeToShareMessages(page, cid, otherUserId)` | Attaches a callback to `conversationService.subscribeToMessages` filtered for `IPFS_SHARE:` prefix; stores matches in `window.__l5ShareMessages`. |
| `getShareSnapshot(page)` | Reads `__l5ShareMessages`, parses each payload into `{ cid, link, keyCiphertext }` and returns message IDs and parsed payloads. |
| `bootstrapUser(browser, userId, userName)` | Creates a new page + context, navigates to the app, boots under a given identity. |
| `ensureMeshNeighbors(...)` | Drives presence so each peer connects its mesh DataChannels to the specified neighbor set. |
| `finalCleanupPages(pages, contexts)` / `shutdownThreeBrowsers(browsers)` | Teardown helpers (close pages/contexts/browsers). |
| `maybeClearGunDatabases()` | Clears GUN persistence before and after the test. |

## Key design invariants verified

- Auto-share fires **exactly once** per matched pair — no duplicates even when both sides subscribe.
- Non-matching peers (Bob) never receive the IPFS link or key ciphertext.
- The durable mailbox envelope backs up the live GUN share message; draining it after deletion proves idempotent re-materialization.
- Jerry's intercepted mailbox (`GET /api/mailbox/* → 200 { envelopes: [] }`) proves no fallback traffic was needed while both sides are online.
