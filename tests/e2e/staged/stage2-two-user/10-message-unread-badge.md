# Test: Unread Badge on Me Tab — Appears After Match, Clears on Open, Reappears After New Message

covers: SPEC-3.2, SPEC-7.6, SPEC-19.4  <!-- auto-seeded; refine by hand -->

**File:** 10-message-unread-badge.spec.ts  
**Features tested:** Unread conversation badge lifecycle, notification badge on Me nav button, badge clear on conversation open, badge reappear on new message, multi-browser

---

## What this test does (in plain English):

1. **Setup:** Two browsers — Tom and Jerry — both log in and join "Global" chatroom.

2. **Tom creates and broadcasts a talk** titled "E2E Unread Badge Tennis" with the same tennis question pattern. Jerry receives it and matches. Conversation entries are created for both.

3. **Phase 1 — Unread badge appears for Jerry immediately after the new match:** Jerry navigates to the Me tab. The Me nav button shows a notification badge, and the conversation list item for Tom shows an unread-badge. (The match creates the conversation with `unread=true`.)

4. **Phase 2 — Opening the conversation clears the badge:** Jerry clicks on Tom's conversation. The conversation overlay opens. Jerry clicks back. The notification badge on Jerry's Me button disappears.

5. **Phase 3 — Tom sends a message while Jerry's overlay is closed:** Tom opens his conversation with Jerry and sends "Hey Jerry, first message!"

6. **Phase 4 — Jerry's unread badge reappears:** The notification badge on Jerry's Me nav button and the conversation item unread-badge both appear again.

7. **Phase 5 — Jerry opens the conversation again — badge clears:** Jerry clicks Tom's conversation, sees the new message, clicks back — notification badge disappears once more.

> **Why this matters:** Verifies the complete unread badge lifecycle: badge appears on new match → clears on open → reappears on new message → clears on open again. Proper unread state management.

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`, `openIncomingTalkModal`, `waitForResponseModalClosed`, `clickBroadcastUntilBulkAck`, `waitForConversationEntry`
