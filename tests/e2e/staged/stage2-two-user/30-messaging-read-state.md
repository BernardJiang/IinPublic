# Test: Messaging — Unread Badge Lifecycle Persists Across Reload

**File:** 30-messaging-read-state.spec.ts
**Features tested:** Unread conversation badge on Me nav, badge clear on open, durable read-cursor persistence in `localStorage` surviving a full page reload

---

## What this test does (in plain English):

1. **Setup:** Two users (A and B) are fast-matched into a direct-p2p conversation via `setupFastMatchedDm`. Both conversation overlays start open (part of setup warm-up); the test closes B's overlay so subsequently-arriving messages register as unread.

2. **A sends 2 messages** while B's conversation overlay is closed. B is on the Me tab: the Me nav button shows a notification badge once B's conversation-preview subscription (wired automatically when the conversation record is ingested) picks up both messages.

3. **B opens the conversation:** the badge clears, and the read cursor for this conversation is recorded in `localStorage['iinpublic:conversation-read-cursors']` (see `ui-manager.ts` `syncConversationMessageSummary`, ~line 7393-7422).

4. **B reloads the page.** The conversation-preview subscription is torn down and re-established from scratch on boot, but the read cursor is durable `localStorage` state — so even though the subscription re-delivers both historical messages, they are older than the recorded cursor and must NOT re-trigger the unread badge.

> **Why this matters:** Without a durable, per-conversation read cursor, a page reload would make every already-read conversation look unread again (the preview subscription necessarily replays history on re-subscribe). The cursor is what lets `syncConversationMessageSummary` tell "read before reload" apart from "arrived after."

---

**Helpers used:** `setupFastMatchedDm`, `sendConversationMessage`, `reloadAppReady`, `teardownFastDmPair` (`tests/e2e/helpers/fast-dm-setup.ts`, `tests/e2e/helpers/timing.ts`)
