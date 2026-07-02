# Test: Multi-Partner Conversation List Sorting

**File:** 29-conversation-list-sorting.spec.ts
**Features tested:** Contacts tab default "recent" sort (`src/web/ui/contacts-view.ts` line 697) ranks matched peers by `lastInteractionAt` descending, which is derived from `conversation.lastMessageTime` (`src/web/services/local-peer-derivation.ts` line 159) and updated on every message via `UIManager#syncConversationMessageSummary` (`src/web/ui/ui-manager.ts` lines 7399-7400).

---

## What this test does (in plain English):

Three users: C is the hub, matched independently with A and with B (two separate 1:1 matches, both authored by C via the pair-direct mesh match trick — no talk-editor UI). Once both matches exist, C's Contacts tab shows two rows: A and B.

1. **A messages C.** A's contact row should move above B's — A now has a real message timestamp; B's `lastInteractionAt` is still pinned to the match's creation time, which is older.
2. **B messages C.** B's row should move above A's — B's message timestamp is now the newest.
3. **C reloads the page.** The order (B above A) must survive — Contacts state is read from `localStorage.myConversations` on every render, which persists across reload.

Row order is asserted via **DOM element ordering** (index of each `.contact-item[data-contact-user-id="..."]` among all non-support contact rows), not toast/notification text.

---

## Important finding: the "conversations list" in CLAUDE.md docs is dead code

`src/web/ui/conversations-view.ts#displayConversationsList` looks up `document.getElementById('conversations-list')`. No static HTML template in the running app defines a `#conversations-list` element — the only place that id exists is a synthetic DOM built by a unit test (`src/test/unit/ui-extracted-modules.test.ts:302`). In the real app, `displayConversationsList()` always no-ops (`if (!conversationsList) return;`). It is called from 6+ places in `ui-manager.ts` but never renders anything visible.

The **live**, rendered, sorted list is the **Contacts tab** (`#contacts-list`, rows `.contact-item[data-contact-user-id="..."]`, rendered by `src/web/ui/contacts-view.ts#displayContactsList`). Its default sort strategy (`sortOrder === 'recent'`, the fallback when no other strategy matches) orders by `lastInteractionAt` descending — this is the recency sort this spec exercises. This selector is also used live in `06-contacts-tab.spec.ts`.

---

**Helpers used:** `bootstrapUser`, `waitForTabActive` (`talks-matching-flow.ts`), `getConversationIdBetween`, `waitForServerConversationBetween` (`conversation-e2e.ts`), `sendConversationMessage` (`fast-dm-setup.ts`), `maybeClearGunDatabases` (`clear-database.ts`), `afterAction`/`afterSync`/`reloadAppReady` (`timing.ts`). A local `matchExistingUsers()` helper (defined in the spec file) generalizes the `setupLeanMatchedPair` mesh-cache-and-pair-direct-response trick to reuse an already-bootstrapped hub user (C) across two independent matches, since the shared helpers in `fast-match-lean.ts` / `fast-dm-setup.ts` always mint two brand-new users per call.
