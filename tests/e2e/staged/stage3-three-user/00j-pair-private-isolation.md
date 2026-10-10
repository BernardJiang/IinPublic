# Test: Pair-Private Isolation — Answer and DM Ciphertext Hidden from Third Party

covers: SPEC-7.5  <!-- auto-seeded; refine by hand -->

**File:** 00j-pair-private-isolation.spec.ts  
**Features tested:** P1 pair-private encryption isolation — when Bob broadcasts the same talk to both Alice and Tom, Alice's answer payload and Alice↔Bob DM ciphertext must remain unreadable by Tom even though Tom shares the same Gun graph.

---

## What this test does (in plain English):

Three users share one automatic Nearby room. Bob broadcasts a flow talk that both Alice and Tom receive. Alice matches and sends Bob a P2P DM. Tom cannot recover Alice's answer payload, and the DM body never enters the shared graph at all.

1. **Setup:** Three browsers mapped as Bob, Alice, and Tom in the same Nearby room, with direct Talk delivery enabled.
2. **Bob broadcasts flow talk** with match/ignore answers. Waits for both Alice and Tom to receive it via outgoing offers.
3. **Alice matches the talk** — selects the first answer → MATCH outcome.
4. **Pair-private enforcement (two paths):**
   - **Mesh delivery mode (`isMeshTalkDeliveryE2e`):** Pair responses are ephemeral — Bob's `pairTalkResponses` is empty and Tom sees 0 rows, 0 decrypted payloads. Legacy graph paths absent.
   - **Legacy Gun storage mode:** Bob can read exactly 1 pair response with `encryption: "sea-ecdh-v1"` and base64 ciphertext. Raw JSON does NOT contain Alice's answer text, stage names — plaintext is sealed. Tom attempts to decrypt using both Bob's and Alice's epub keys → `decrypted` array is empty (SEA decryption fails).
5. **P2P DM between Alice↔Bob:** Alice sends a timestamped private DM. Bob's encrypted peerless local envelope receives it (`assertLocalPrivateMessageBodies`); the exported hub graph contains no pair-message soul or plaintext.
6. **Tom sees talk in IN list** (proving broadcast delivery works) but has zero access to Alice↔Bob private data.
7. **Talk body dedup check:** Exports Gun graph snapshot → verifies `peerTalkOffers` nodes contain only `talkRef` pointers, not full `talkData` payloads — confirming canonical talk body deduplication.

> **Why this matters:** This is the storage and cryptographic boundary test. Pair responses are end-to-end encrypted; durable DM history is endpoint-local and synchronizes directly, so a third party sharing the control graph sees no conversation body to archive or attack.

---

**Helpers used:** `bootstrapUser`, `openCurrentChatroom`, `prepareDirectP2PConversation`, `assertLocalPrivateMessageBodies`, `clickBroadcastUntilBulkAck`, `completeTalkInAppByAnswerIds`, `waitForIncomingTalkClusterOnLocalGun`, `gunBaseURL`
