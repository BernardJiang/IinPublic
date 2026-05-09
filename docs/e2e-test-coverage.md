# E2E Test Spec Translations & Coverage Analysis

Last updated: 2026-05-02

## Translations Written

Plain English translations have been written for all 30 test spec files across both directories.

### tests/e2e/ Root (18 translations)

| File | Translation |
|------|-------------|
| 01-login-single-user-headcount | Single login, headcount, session persistence |
| 01-login-two-users-headcount | 2-user headcount 1→2→1→2, room switching |
| 02-multi-user-headcount | 3-user FIFO exit, random re-entry |
| 03-capacity-eviction | 4-user capacity bump, persistent eviction |
| 04-profile-edit-stage-name | Profile editing, cross-user visibility |
| 05-talks-edit | Talk create → list → edit with prefilled data |
| 06-contacts-tab | Contacts after matching, bidirectional, per-contact talks |
| 07-tags-checkbox | Tag match/ignore, status bar counts |
| 08-super-user-20-broadcast | 20 talks (10 tags + 10 flows), concurrent answering |
| 08-super-user-copy-talk | Copy talk, broadcast toggle, delete from history |
| 09-messaging | 1-on-1 real-time messaging after match |
| 10-message-unread-badge | Badge lifecycle: match→badge→read→clear→msg→badge→clear |
| 11-chatroom-peer-detail | 5 sub-tests: stranger status, overlay open/close, history, send auto/manual |
| 12-ux-contacts-talks-answers | Mismatch contacts, IN/OUT split, answers detail |
| 13-chatroom-scroll-and-broadcast-bar | Member list scroll, unified broadcast button |
| 13-me-filters-credit | Talk type filters, credit visibility toggle |
| 14-contacts-relationship-credit | Nickname, label, rating, notes persistence |
| 15a-blocking-unblock-resumes-talk-delivery, 15b-blocking-stops-delivery-and-peer-visibility | Block user, delivery stop, profile unavailable; unblock resumes delivery |

### tests/e2e/talks-matching/ (13 translations)

| File | Translation |
|------|-------------|
| 01-tennis-jerry-match | Basic happy path |
| 02-two-talks-status-answers | Mixed match/mismatch, status count |
| 03-chatbot-bot-badge | Bot badge on auto-replies |
| 04-ignore-then-change-answer | Reopen and change mismatch→match (multi-q) |
| 05-partial-auto-answers | Flattened prefs, auto-fill Q1-Q2 |
| 06-survey-customer-satisfaction | 11-user survey, aggregate stats |
| 07-survey-restaurants | 11-user food survey |
| 08-route-job-seeking | 11-user DAG route completion |
| 09-four-types-chatbot | All 4 types, chatbot relay to Sam |
| 10-stats-four-types | API stats: summary/by-day/by-region/by-answer |
| 11-mismatch-no-match | Pure mismatch, zero matches |
| 12-two-responders-partial-match | 1 match + 1 mismatch = exactly 1 convo |
| 13-tag-reopen-mismatch-then-match | Reopen tag, change checkbox |

---

## Missing Test Scenarios

Based on the app's feature set, the following areas are not currently covered by e2e tests.

### Critical Gaps

1. **Unblocking a user** — Test 15 covers blocking but not the inverse (unblock + verification that talks resume delivering)
2. **Multi-chatroom broadcasts** — All broadcast tests use "Global" only; no tests for broadcasting region-specific chatrooms (e.g., "North America", city-level rooms)
3. **Chatroom hierarchy navigation** — The app has a chatroom hierarchy (Global → Region → City); no e2e tests navigate across hierarchical levels
4. **Location-based chatroom auto-assignment** — Users get a chatroom based on their geolocation; no test verifies correct auto-assignment

### Medium Gaps

5. **Messaging edge cases** — No tests for: message read receipts, messaging history persistence across re-login, messaging after unblock
6. **Talk deletion by creator** — Test 08 covers deleting copied talks, but not deleting your own created talks mid-broadcast
7. **Profile privacy settings** — Profile editing is tested, but hiding specific profile fields from certain users is not
8. **Broadcast cancellation/abortion** — What happens if broadcaster clicks Broadcast but cancels mid-way?
9. **Talk matching across chatroom boundaries** — Can users in different chatrooms (e.g., Global vs. North America) match?
10. **Reputation system** — The codebase has `reputation.ts` and `reputation.d.ts` with no corresponding e2e tests

### Nice-to-Have

11. **Mobile viewport testing** — All tests use desktop/compact viewports; no mobile-specific layout tests
12. **WebSocket disconnection recovery** — What happens when the Gun sync drops and reconnects?
13. **Search/filter within Answers tab** — With 20+ answered talks, does filtering work?
14. **Timezone handling** — The by-day stats API has no test verifying timezone boundaries
