# Find Similar People — UI-driven E2E

**File:** `tests/e2e/staged/stage5-multi-user/find-similar-people.spec.ts`

## Scenario

10 users join the global chatroom and interact entirely through the UI:

1. **Create 20 tag talks each** via the `+` (create-talk) button — visible in the OUT section.
2. **Broadcast from GlobalRoom** — click the broadcast button; server fans out to all members.
3. **Answer one incoming talk manually** — open the tag-talk response dialog, check the match checkbox, submit.
4. **Chatbot auto-answers the rest** — a pre-seeded `exactChatbotMemory` holds permanent preferences for all 30 interests; after the one manual answer the chatbot is enabled and processes the remaining ~179 incoming talks.
5. **Contacts tab, sort by weighted relevance** — the app's own weighted score (`matchedTalks × 100 + matchRate × 25 + recencyBoost`) naturally ranks users with more overlapping interests higher.

## Interest distribution

30-interest pool, each user i gets 20 starting at `i mod 30` (sliding window):

| User pair | Shared interests | Expected relative rank |
|-----------|-----------------|------------------------|
| (0, 1)    | 19              | user 0's top contact   |
| (0, 2)    | 18              | user 0's 2nd contact   |
| (0, 3)    | 17              | user 0's 3rd contact   |
| (9, 8)    | 19              | user 9's top contact   |
| (9, 7)    | 18              | user 9's 2nd contact   |
| (9, 6)    | 17              | user 9's 3rd contact   |

## UI selectors used

| Action | Selector |
|--------|----------|
| Open talk editor | `#create-talk-btn` |
| Select tag type | `input[name="talk-type-radio"][value="tag"]` |
| Fill title | `#talk-title` |
| Submit talk | `#talk-submit-btn` |
| OUT section items | `.talk-list-item[data-role="created"]` |
| Broadcast button | `#broadcast-talk-btn` |
| Broadcast complete | `#broadcast-bulk-ack` (hidden → visible) |
| Incoming talk (unanswered) | `.talk-list-item[data-role="incoming"]:not(.talk-incoming-answered)` |
| Tag match checkbox | `#tag-match-checkbox` |
| Submit tag answer | `#tag-submit-response` |
| Contacts tab nav | `[data-testid="bottom-navigation-button-contacts"]` |
| Sort dropdown | `#contacts-sort-order` (value `"weighted"`) |
| Contact item | `.contact-item[data-contact-user-id]` |
| Relevance score chip | `.contact-item-rank` |

## Chatbot pre-seed

Before the app loads, `exactChatbotMemory` is written to `localStorage` using `createEmptyExactChatbotMemoryState()` + `savePermanentAnswer()` for each of the 30 interest questions:
- `"Yes!"` for the user's 20 interests
- `"Not really"` for the other 10

The chatbot starts disabled so the test can demonstrate one manual answer, then is enabled to auto-answer the remaining incoming talks.

## Assertions

- Every user sees ≥ 9 contacts after all talk exchanges.
- User 0's top-3 contacts (sorted weighted) are users 1, 2, 3 (by Gun user ID).
- User 9's top-3 contacts are users 8, 7, 6.
- The `.contact-item-rank` chip is visible (confirming weighted sort is active).
