# Test: Pair-Private Isolation — Answer and DM Ciphertext Hidden from Third Party

**File:** 00j-pair-private-isolation.spec.ts  
**Features tested:** P1 pair-private encryption isolation — when Bob broadcasts the same talk to both Alice and Tom, Alice's answer payload and Alice↔Bob DM ciphertext must remain unreadable by Tom even though Tom shares the same Gun graph.

---

## What this test does (in plain English):

Three users (Alice, Bob, Tom in Global chatroom). Bob broadcasts a flow talk that both Alice and Tom receive. Alice matches and sends Bob a P2P DM. The core assertion: Tom can see public routing metadata (that a pair exists) but cannot decrypt either Alice's answer payload or the DM message content.

1. **Setup:** Three browsers mapped as Bob (sender), Alice (responder+DM-er), Tom (third party). All in Global chatroom, all with direct talk delivery enabled.
2. **Bob broadcasts flow talk** with match/ignore answers. Waits for both Alice and Tom to receive it via outgoing offers.
3. **Alice matches the talk** — selects the first answer → MATCH outcome.
4. **Pair-private enforcement (two paths):**
   - **Mesh delivery mode (`isMeshTalkDeliveryE2e`):** Pair responses are ephemeral — Bob's `pairTalkResponses` is empty and Tom sees 0 rows, 0 decrypted payloads. Legacy graph paths absent.
   - **Legacy Gun storage mode:** Bob can read exactly 1 pair response with `encryption: "sea-ecdh-v1"` and base64 ciphertext. Raw JSON does NOT contain Alice's answer text, stage names — plaintext is sealed. Tom attempts to decrypt using both Bob's and Alice's epub keys → `decrypted` array is empty (SEA decryption fails).
5. **P2P DM between Alice↔Bob:** Prepares direct P2P conversation via `prepareDirectP2PConversation`. Alice sends a timestamped private DM. Bob receives it (`assertGunStoredMessageBodies`). Gun graph shows the message with `encryption: "sea-ecdh-v1"` and plaintext NOT visible in serialized JSON.
6. **Tom sees talk in IN list** (proving broadcast delivery works) but has zero access to Alice↔Bob private data.
7. **Talk body dedup check:** Exports Gun graph snapshot → verifies `peerTalkOffers` nodes contain only `talkRef` pointers, not full `talkData` payloads — confirming canonical talk body deduplication.

> **Why this matters:** This is the cryptographic boundary test. Pair responses and P2P DMs are end-to-end encrypted with SEA ECDH — a third party sharing the same Gun graph must see only ciphertext. The test covers both mesh-delivery and legacy-storage modes since the feature has two implementations. Without this, any user in a shared chatroom could read everyone's private conversations.

---

**Helpers used:** `maybeClearGunDatabases`, `afterSync`, `launchThreeBrowsers`, `shutdownThreeBrowsers`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `waitForIncomingTalkClusterOnLocalGun`, `waitForTabActive`, `createSimpleFlowTalk`, `goToChatrooms`, `clickBroadcastUntilBulkAck`, `completeTalkInAppByAnswerIds`, `findIncomingTalkIdByTitle`, `prepareDirectP2PConversation`, `assertGunStoredMessageBodies`, `gunBaseURL`, `isMeshTalkDeliveryE2e`, `waitForDistinctGunPeersExcludingSelf`
