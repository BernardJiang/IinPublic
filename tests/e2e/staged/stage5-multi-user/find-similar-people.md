# Find Similar People — UI-driven E2E

covers: SPEC-3.7  <!-- auto-seeded; refine by hand -->

**File:** `tests/e2e/staged/stage5-multi-user/find-similar-people.spec.ts`

## Scenario

10 users join the Global chatroom and interact entirely through the UI. The spec only
performs user actions and verifications — all matching, chatbot, ranking and percentage
logic lives in the app.

1. **Create 20 tag talks each** via the `➕` create-talk dialog (Talks tab). Each tag is
   created with its "I'm interested" checkbox checked (the default), so the tag is the
   user's own match answer and the app records it as the chatbot's preference for that
   keyword.
2. **Enable the chatbot** in Settings (before broadcasting).
3. **Broadcast** every tag to the Global chatroom. Delivery uses the app E2E
   broadcast path with the audience preview skipped (`deliverPendingBroadcastTalksForE2e(n, { skipAudiencePreview: true })`):
   the preview is a per-talk server HTTP round-trip that is unused for direct
   delivery and does not scale to 10 users x 20 tags. Peer offers + the chatroom
   announcement still publish, so receiver chatbots auto-answer exactly as they
   would from the Broadcast button.
4. **Answer incoming tags.** The chatbot auto-matches every tag the user already created
   (his interests). A tag the user never created is unknown to the chatbot, so it surfaces
   to the user, who answers it once (rejects a non-interest). After the first answer the
   chatbot holds the preference and takes over repeats.
5. **Contacts tab, sort by match rate.** Strangers are ordered by the highest percentage of
   matching tags; each row shows the matched-tag count and percentage.
6. **Tag the most-similar stranger** with the relationship `similar interest people`
   (the custom relationship label).

## Interest distribution

30-keyword pool, each user `i` creates 20 keywords starting at `i mod 30` (sliding window),
so adjacent users share the most tags and rank highest by match rate.

## UI selectors used

| Action | Selector |
|--------|----------|
| Open create-talk dialog | `#create-talk-btn` |
| Select tag type | `input[name="talk-type-radio"][value="tag"]` |
| Tag keyword field | `#talk-title` |
| Submit talk | `#talk-editor-form button[type="submit"]` |
| OUT list items | `.talk-list-item[data-role="created"]` |
| Enable chatbot | `#settings-chatbot-enabled` |
| Broadcast | `app.deliverPendingBroadcastTalksForE2e(n, { skipAudiencePreview: true })` (offers + announcement, no preview HTTP) |
| Incoming filter | `#talks-filter-incoming` / `#talks-filter-outgoing` (checkboxes) |
| Incoming tag (unanswered) | `.talk-list-item[data-role="incoming"]:not(.talk-incoming-answered)` |
| Tag match checkbox | `#tag-match-checkbox` |
| Submit tag answer | `#tag-submit-response` |
| Contacts sort dropdown | `#contacts-sort-order` (value `match-rate`) |
| Contact row | `.contact-item[data-contact-user-id]` (excludes `[data-support-contact="true"]`) |
| Match-% chip | `.contact-item-match-rate` (carries `data-match-percent`, `data-matched-talks`) |
| Edit relationship | `#contact-edit-relationship-btn` → `#contact-relationship-label` (`custom`) + `#contact-relationship-custom-label` → `#contact-relationship-save-btn` |

## App support added for this test

- `contacts-view.ts` renders a match-rate chip (`.contact-item-match-rate`) with the match
  percentage and `matched/total tags matched` when the Contacts list is sorted by `match-rate`,
  and stamps `data-match-percent` / `data-matched-talks` on each contact row.
- Translation key `contactsMatchRateDetail` (`{matched}/{total} tags matched`).

## Assertions

- Each user's OUT list holds all 20 created tags.
- The chatbot is enabled (`chatbotEnabled === 'true'`).
- Every incoming tag from the other 9 users ends up answered.
- Each user sees ≥ 9 stranger contacts, each with a visible match-% chip.
- Contacts are ordered by descending match percentage.
- The most-similar stranger keeps the `similar interest people` relationship label after save.
