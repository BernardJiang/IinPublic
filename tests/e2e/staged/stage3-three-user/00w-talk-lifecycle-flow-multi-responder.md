# Test: Talk Lifecycle — Flow Multi-Responder Matrix

covers: SPEC-3.6, SPEC-3.4, SPEC-3.7  <!-- auto-seeded; refine by hand -->

**File:** 00w-talk-lifecycle-flow-multi-responder.spec.ts  
**Features tested:** Phase D4 multi-responder matrix — Tom broadcasts a flow talk, Jerry matches and Bob mismatches. Verifies conversation isolation (only Jerry gets P2P chat), contacts list includes both, transport mode defaults to direct-p2p for match pair, and Me/Answers tab accurately reflects each user's outcome.

---

## What this test does (in plain English):

Three users in Global chatroom exercise the full flow-talk lifecycle with asymmetric responder outcomes: Jerry matches (triggering P2P conversation creation), Bob mismatches (no conversation). Creator Tom sees both in contacts but only Jerry in conversations.

1. **Setup:** Three browsers — Tom (creator), Jerry (match responder), Bob (mismatch responder). All bootstrapped and joined Global.
2. **Tom creates & broadcasts** flow talk ("Lifecycle Matrix Flow") via company page JSON with match/ignore answers. Waits for 2 Gun peers, broadcasts until bulk ack.
3. **Jerry matches:** Completes talk via `flowMatchAnswerIds()` → MATCH outcome.
4. **Bob mismatches:** Completes same talk via `flowIgnoreAnswerIds()` → MISMATCH outcome recorded but no conversation triggered.
5. **Creator match count:** Tom's status bar ≥ 1 (only from Jerry). Server confirms exactly 1 conversation exists.
6. **Transport verification:** Both Tom and Jerry show active transport = `direct-p2p`. Conversation with "Jerry Matrix" is also tagged as `direct-p2p`.
7. **Conversation isolation:** Tom's localStorage `myConversations` contains exactly 1 non-support-channel entry for Jerry — Bob is absent (mismatch did not create a conversation).
8. **Contacts tab:** Both Jerry AND Bob appear in Tom's contacts list (both interacted), each labeled "Stranger" status.
9. **Jerry's Me/Answers:** Shows talk title + "Match" outcome badge.
10. **Bob's Me/Answers:** Shows talk title + "Mismatch" outcome badge.

> **Why this matters:** Validates that match vs mismatch produce the correct downstream effects: conversations only form for matches, both responders still appear as contacts, and each user sees their own outcome accurately in the Me tab. The transport mode check ensures P2P is the default (not relay-through-server) when WebRTC args are present. This is a core D4 lifecycle test paired with `00z-talk-lifecycle-tag-multi-responder`.

---

**Helpers used:** `maybeClearGunDatabases`, `afterAction`, `afterSync`, `clickBroadcastUntilBulkAck`, `createTalksFromCompanyPage`, `completeTalkInAppByAnswerIds`, `waitForDistinctGunPeersExcludingSelf`, `waitForStatusBarMatchCountAtLeast`, `expectActiveTransportMode`, `expectConversationTransportModeForPeer`, `waitForServerConversations`, `buildFlowTalkPayload`, `flowMatchAnswerIds`, `flowIgnoreAnswerIds`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `waitForTabActive`, `launchThreeBrowsers`, `shutdownThreeBrowsers`
