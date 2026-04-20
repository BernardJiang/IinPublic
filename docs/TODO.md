# IinPublic — Actionable TODO

> **For AI agents:** Work through phases in order. Each phase's tasks are safe to tackle
> in parallel within the phase, but later phases depend on earlier ones completing.
> Every task includes: the exact files to touch, what currently exists, and a precise
> description of what to implement. Run `npm test` after each task to verify nothing breaks.
>
> **Key:** `P0` = blocker · `P1` = high · `P2` = medium · `P3` = low  
> **Stack:** TypeScript monorepo · Node/Express server (`src/server/`) · vanilla-TS web client
> (`src/web/`) · Gun.js P2P graph DB · Socket.IO · Android/Kotlin skeleton (`android/`)

---

## Phase 1 — Build & CI Foundation
*Nothing else can be validated until the build pipeline is green.*

---

### INF-01 · P0 — Set up CI pipeline
**Files to create:** `.github/workflows/ci.yml`  
**What exists:** None.  
**Implement:**
1. On every PR: run `npx tsc --noEmit`, `npm run lint`, `npm test -- --coverage`.
2. Enforce minimum 80% line coverage (raise to 90% once test suite grows).
3. Run `npx webpack --config webpack.config.prod.js` to verify web bundle builds.
4. Run Playwright e2e suite (`npx playwright test`).
5. Block merge if any step fails.

---

### INF-02 · P0 — Production build & deployment scripts
**Files to create:** `scripts/deploy-web.sh`, `scripts/deploy-server.sh`, `Dockerfile`  
**What exists:** `webpack.config.prod.js` exists but no deploy automation.  
**Implement:**
1. `scripts/deploy-web.sh` — run webpack prod build, upload `dist/web/` to CDN/static host.
2. `scripts/deploy-server.sh` — compile `src/server/` to `dist/server/`, build Docker image, push and restart.
3. `Dockerfile` — Node 20-slim base, copy `dist/server/` + `public/`, expose port 8080.
4. Add `npm run build` script to `package.json` that runs both webpack and tsc.

---

### INF-05 · P2 — Structured logging
**File to edit:** `src/server/index.ts` and all service files  
**What exists:** Raw `console.log` calls everywhere.  
**Implement:**
1. `npm install pino pino-pretty` — add to `package.json`.
2. Create `src/server/logger.ts` exporting a configured pino instance.
3. Replace all `console.log/warn/error` in `src/server/` with `logger.info/warn/error`.
4. Add a `requestId` middleware that attaches a UUID to each request and includes it in log lines.

---

## Phase 2 — Security & Identity (SEA)
*All encryption and identity features depend on this phase.*

---

### AUTH-01 · P0 — SEA key-pair generation on first run
**Files to edit:** `src/web/app/app.ts`, `src/server/services/gun-service.ts`  
**What exists:** `GunService.createUserSEA()` returns mock keys `{ pub: 'mock_...', priv: 'mock_...' }`.  
**Implement:**
1. In `WebGunService` (or `GunBridge`), call `Gun.SEA.pair()` to generate a real `{ pub, priv, epub, epriv }` keypair.
2. Persist the keypair in `localStorage` under key `iinpublic_keypair` (encrypted with a user passphrase if available).
3. On app init, check for existing keypair; if found, call `gun.user().auth(pair)`.
4. Replace the mock in `GunService.createUserSEA()` with a call to `Gun.SEA.pair()` on the server side too.
5. Update `src/web/app/app.ts` `createNewUser()` to await keypair generation before writing the user node.

```typescript
// Target shape in app.ts createNewUser():
const pair = await SEA.pair();
localStorage.setItem('iinpublic_keypair', JSON.stringify(pair));
gun.user().auth(pair);
await gunService.put(`users/${userId}`, { ...userBase, pub: pair.pub });
```

---

### AUTH-02 · P1 — Private answer encryption
**Files to edit:** `src/web/services/web-user-service.ts`, `src/web/services/web-talk-service.ts`  
**What exists:** `QuestionAnswer.isAuto: boolean` in `src/shared/types.ts`. No encryption logic.  
**Implement:**
1. When saving a `QuestionAnswer` with `isAuto === false`, encrypt it before writing to Gun:
   ```typescript
   const encrypted = await SEA.encrypt(JSON.stringify(answer), pair);
   gun.user().get('answers').get('private').get(answer.id).put(encrypted);
   ```
2. When the chatbot fetches answers, only read from the `auto` namespace; never attempt to decrypt `private` answers.
3. Add a `getPrivateAnswers(pair)` method to `WebUserService` that reads and decrypts the private namespace.

---

### AUTH-03 · P1 — Known-person trust store
**Files to edit:** `src/shared/types.ts`, `src/web/services/web-user-service.ts`  
**What exists:** Nothing.  
**Implement:**
1. Add to `src/shared/types.ts`:
   ```typescript
   export type RelationshipLabel = 'friend' | 'relative' | 'coworker' | 'acquaintance';
   export interface KnownPerson {
     userId: string;
     label: RelationshipLabel;
     addedAt: Date;
   }
   ```
2. Add `knownPeople: KnownPerson[]` to the `User` interface.
3. Add `addKnownPerson(userId, targetId, label)` and `removeKnownPerson(userId, targetId)` to `WebUserService`, writing to `users/<userId>/knownPeople/<targetId>` in Gun.
4. Add REST endpoints `POST /api/users/:id/known-people` and `DELETE /api/users/:id/known-people/:targetId` in `src/server/index.ts`.

---

### AUTH-04 · P1 — Encrypted message channels
**Files to edit:** `src/shared/types.ts`, `src/web/services/web-conversation-service.ts`  
**Depends on:** AUTH-01, AUTH-03  
**What exists:** `Message` has no `channel` field; no encryption on messages.  
**Implement:**
1. Add `channel: 'public' | 'known' | 'mutual'` to `Message` in `src/shared/types.ts`.
2. **Public channel:** no encryption, existing behaviour.
3. **Known channel:** encrypt with the recipient's `epub` key via `SEA.encrypt(text, await SEA.secret(recipientEpub, myPair))`.
4. **Mutual channel:** derive ECDH shared secret `SEA.secret(otherEpub, myPair)`, encrypt with it.
5. In `WebConversationService.sendMessage()`, branch on channel type before writing to Gun.
6. In `subscribeToMessages()`, attempt decrypt if `message.channel !== 'public'`.

---

### AUTH-05 · P1 — Socket.IO cryptographic authentication
**File to edit:** `src/server/index.ts` (the `authenticate` socket handler)  
**What exists:** Handler calls `userService.getUser(data.userId)` — no signature check.  
**Implement:**
1. Client emits `{ userId, pub, signature }` where `signature = await SEA.sign(userId, pair)`.
2. Server verifies: `const valid = await SEA.verify(data.userId, data.pub, data.signature)`.
3. If invalid, emit `auth_error` and disconnect the socket.
4. Store `pub` on `socket.data` for downstream use.

---

## Phase 3 — Safety & Reputation Enforcement
*Rate limiting and blocklist must exist before bulk send (Phase 4) goes live.*

---

### REP-01 · P0 — Rate limiting enforcement
**Files to edit:** `src/server/index.ts`, new file `src/server/services/rate-limiter.ts`  
**What exists:** `CONFIG.RATE_LIMITS` defines limits; nothing enforces them.  
**Implement:**
1. Create `RateLimiter` service using an in-memory Map (or Redis if available):
   ```typescript
   // src/server/services/rate-limiter.ts
   export class RateLimiter {
     check(userId: string, action: 'talk_send_daily' | 'bulk_send_daily' | 'message_per_minute'): void
     // throws RateLimitError with resetTime if limit exceeded
   }
   ```
2. Apply in `POST /api/talks/:id/send` (daily talk send limit).
3. Apply in `POST /api/talks/:id/send` bulk path (bulk send daily limit).
4. Apply in the `send_message` Socket.IO handler (per-minute message limit).
5. Return HTTP 429 with `{ error, resetTime }` when rate limit is hit.

---

### REP-02 · P0 — Blocklist data model & enforcement
**Files to edit:** `src/shared/types.ts`, `src/server/index.ts`, `src/web/services/web-user-service.ts`  
**What exists:** Nothing.  
**Implement:**
1. Add `blockedUserIds: string[]` to the `User` interface in `src/shared/types.ts`.
2. Add REST endpoints:
   - `POST /api/users/:id/block` — body `{ targetId }` — writes to `users/<id>/blocked/<targetId>`.
   - `DELETE /api/users/:id/block/:targetId`.
   - `GET /api/users/:id/blocked`.
3. Enforce in `POST /api/talks/:id/register-receivers-for-broadcast`: filter out any `receiverId` that appears in `sender.blockedUserIds` or has blocked the sender.
4. Enforce in `GET /api/users/:id`: return 403 if the requesting user is blocked by the requested user.

---

### REP-03 · P0 — Age gating: verification & content filtering
**Files to edit:** `src/server/index.ts`, `src/web/services/web-talk-service.ts`  
**What exists:** `Question.isAgeGate`, `Reputation.ageVerified`, `CONFIG.MIN_AGE_FOR_ADULT_CONTENT` — none evaluated.  
**Implement:**
1. In `POST /api/talks/:id/register-receivers-for-broadcast`: if `talk.isAdult === true`, filter out any receiver whose `reputation.ageVerified === false`.
2. In `GET /api/users/:id/incoming-talks`: strip `isAdult` talks from the response if `user.ageVerified === false`.
3. Implement age-verification voting: `POST /api/users/:id/age-verify` — body `{ voterId }`. Calls `reputationService.updateUserReputation(userId, 'age_verified')`. Once `ageVerificationVotes >= CONFIG.AGE_VERIFICATION_THRESHOLD`, set `ageVerified = true`.
4. In the web client, when a talk with `isAgeGate` question is received, block auto-answer and require manual confirmation.

---

### FILT-01 · P0 — Financial data detection & blocking
**File to edit:** `src/shared/reputation.ts` (`ContentFilter` class)  
**What exists:** `ContentFilter` class with placeholder dirty-words set only.  
**Implement:**
1. Add `detectFinancialData(content: string): boolean` to `ContentFilter`:
   - Credit/debit card: `/\b(?:\d[ -]?){13,19}\b/` + Luhn algorithm check.
   - CVV: `/\b\d{3,4}\b/` (context-sensitive, near "cvv"/"cvc"/"security code").
   - IBAN: `/\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/`.
   - Routing/sort/BSB numbers: common formats by country.
   - Crypto wallet addresses: BTC `/\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/`, ETH `/\b0x[a-fA-F0-9]{40}\b/`.
2. Call `detectFinancialData()` inside `applyFilters()`.
3. In `WebGunService.put()`, call `ContentFilter.detectFinancialData(JSON.stringify(data))` and throw `ValidationError` if detected.

---

### FILT-02 · P1 — Comprehensive dirty words list
**File to edit:** `src/shared/reputation.ts`  
**What exists:** `dirtyWords = new Set(['spam','scam','fake','bot'])` — 4 placeholder words.  
**Implement:**
1. Load a production-grade word list from a JSON file `src/shared/data/dirty-words.json` (use an open-source list such as `bad-words` package patterns).
2. Support three strictness levels mapped to `CONFIG.DIRTY_WORDS_STRICTNESS: 'strict' | 'moderate' | 'lenient'`.
3. `detectLanguage()` — replace naive heuristics with the `franc-min` package (WASM-compatible, works in browser and Node).

---

### FILT-04 · P1 — Location radius filter for incoming talks
**Files to edit:** `src/server/index.ts` (register-receivers + received endpoints)  
**What exists:** `Talk.locationRadiusMiles` and `Talk.authorLocation` stored but never evaluated. `LocationPrivacy.calculateDistance()` exists in `src/shared/location.ts`.  
**Implement:**
1. In `POST /api/talks/:id/register-receivers-for-broadcast`, after loading talkData:
   ```typescript
   if (talkData.locationRadiusMiles && talkData.authorLocation) {
     filteredReceiverIds = await filterByRadius(receiverIds, talkData);
   }
   ```
2. `filterByRadius` reads each receiver's blurred location from Gun, calls `LocationPrivacy.calculateDistance()`, converts miles to metres, and excludes receivers beyond the radius.

---

### REP-04 · P1 — Reputation privacy controls
**Files to edit:** `src/shared/types.ts`, `src/server/index.ts`, `src/web/`  
**What exists:** `Reputation.isHidden: boolean` — no visibility levels.  
**Implement:**
1. Replace `isHidden: boolean` with `visibility: 'public' | 'connections' | 'private' | 'hidden'` in `Reputation`.
2. In `GET /api/users/:id`, strip reputation fields from response according to the requesting user's relationship to the profile owner.
3. Add `PATCH /api/users/:id/reputation-visibility` endpoint — body `{ visibility }`.

---

### FILT-06 · P2 — Per-user filter settings UI
**Files to edit:** `src/web/ui/ui-manager.ts`, `src/server/index.ts`  
**What exists:** `Filter` interface in `src/shared/types.ts` (language, grammar, dirtyWords, location, age). No UI or API to set it.  
**Implement:**
1. Add `PATCH /api/users/:id/filters` endpoint — body `Partial<Filter>` — writes to `users/<id>/filters` in Gun.
2. Add a settings panel in the web UI with toggles for each filter type.
3. Load user's `Filter` settings before evaluating `ContentFilter.applyFilters()` on incoming talks.

---

## Phase 4 — Talk & Bulk Send System
*Depends on Phase 3 (rate limiting + blocklist) being complete.*

---

### TALK-01 · P0 — Bulk send execution & batching
**Files to edit:** `src/server/services/talk-service.ts`, `src/server/index.ts`  
**What exists:** `TalkService.sendBulkTalk()` creates a `BulkSendJob` record with `status: 'pending'` but never executes sending.  
**Implement:**
1. Add `executeBulkSend(jobId: string): Promise<void>` to `TalkService`:
   ```
   Load job → fetch recipients from targetScope (chatroom members + tag match + distance filter)
   → apply blocklist filter (REP-02) → apply rate limit check (REP-01)
   → enforce getBulkSendCapacity(sender) → batch into groups of 50
   → for each batch: call POST /api/talks/:id/register-receivers-for-broadcast
   → delay 1 000 ms between batches
   → update job.sentCount, job.status = 'sending' → 'completed'
   ```
2. Call `executeBulkSend` asynchronously after creating the job in `POST /api/talks/:id/send`.
3. Add `GET /api/bulk-jobs/:id` to poll job status and counters.

---

### TALK-02 · P0 — Mandatory tag/location preamble for bulk send
**Files to edit:** `src/web/ui/ui-manager.ts`, `src/web/services/web-talk-service.ts`  
**What exists:** No preamble enforcement.  
**Implement:**
1. Before allowing `sendBulkTalk()` to be called, require the user to either:
   - Select at least one tag from the tag picker, **or**
   - Set a location radius in miles.
2. If neither is set, show an inline error: *"Please select a tag or set a location radius before sending."*
3. Store the preamble selection on the `BulkSendJob.targetScope`.

---

### TALK-03 · P0 — Auto linear talk capture from chat
**Files to edit:** `src/web/ui/ui-manager.ts`, `src/web/services/web-talk-service.ts`  
**What exists:** `TalkLinearCapture.parseChatLine()` in `src/shared/talk-engine.ts` parses the format but is never called from the UI.  
**Implement:**
1. In the message render loop, call `TalkLinearCapture.parseChatLine(message.text)` on each incoming message.
2. If a match is found, render answer-choice chips below the message bubble.
3. On chip click: call `webTalkService.processAnswer(conversationId, questionId, answerId, userId)`.
4. After all questions in the linear sequence are answered, call `TalkLinearCapture.createLinearTalk()` and store the resulting draft via `webTalkService.createTalk()`.
5. Show a "Talk saved as draft" confirmation toast.

---

### TALK-06 · P1 — Tag creation, popularity tracking & discovery
**Files to edit:** `src/server/index.ts`, `src/web/services/` (new `web-tag-service.ts`)  
**What exists:** `Tag` interface and `TagCategory` enum in `src/shared/types.ts`. No API.  
**Implement:**
1. Add REST endpoints:
   - `POST /api/tags` — create tag, store at `tags/<tagId>` in Gun.
   - `GET /api/tags?category=<cat>&region=<region>` — list tags sorted by `popularity`.
   - `POST /api/tags/:id/use` — increment `popularity` counter for the tag in the user's region.
2. Create `WebTagService` in `src/web/services/web-tag-service.ts` wrapping these endpoints.
3. Build a tag-picker component in `ui-manager.ts`: Craigslist-style category grid, search input, popularity-sorted suggestions.

---

### TALK-05 · P1 — Survey aggregation pipeline
**Files to edit:** `src/server/services/talk-service.ts`, `src/server/index.ts`  
**What exists:** `TalkService.getSurveyResults()` calls `gunService.get('surveys/<id>')` which is always empty. `SurveyAggregation` interface exists in `src/shared/types.ts`.  
**Implement:**
1. Add `aggregateSurveyResults(talkId: string): Promise<Survey>` to `TalkService`:
   - Read all `talks/<talkId>/responses/*` from Gun.
   - Group responses by `questionId` + `answerId`.
   - Compute `count` and `percentage` per answer.
   - Support `isAnonymous` flag — strip `responderId` from anonymous responses.
2. Update `GET /api/surveys/:id/results` to call `aggregateSurveyResults`.
3. Add `POST /api/surveys/:id/respond` — body `{ responderId, answers[], isAnonymous }`.

---

### TALK-07 · P2 — Concurrent edit lock & answer version bucketing
**Files to edit:** `src/shared/types.ts`, `src/server/index.ts`, `src/web/services/web-talk-service.ts`  
**Implement:**
1. Add to `Talk` in `src/shared/types.ts`:
   ```typescript
   version: number;          // incremented on every save
   editLock?: { userId: string; lockedAt: Date; };
   ```
2. Add `POST /api/talks/:id/lock` and `DELETE /api/talks/:id/lock` endpoints.
3. On talk save, increment `version` and write responses to `talks/<id>/answers/v<N>/`.
4. Add `POST /api/talks/:id/merge-stale-answers` — for each user with answers on an old version, re-map their answers to the new version's question IDs by text-matching.

---

### TALK-08 · P2 — Chatbot manual-answer reminder
**Files to edit:** `src/web/ui/ui-manager.ts`, `src/web/services/web-talk-service.ts`  
**What exists:** `talkAnswerTemplateByUser` stored on server; `isAuto` flag exists.  
**Implement:**
1. When a talk is received and `GET /api/users/:id/incoming-talks` returns `isAnswered: true, isAutoAnswered: false`:
   - Load the saved `templateEntries` from Gun path `talkAnswerTemplateByUser/<userId>/<identityKey>`.
   - Display a reminder chip: *"You previously answered: [answer text]"* — without auto-submitting.
2. User can confirm the previous answer (which re-submits it) or change it.

---

### TALK-09 · P2 — Talk expiry enforcement
**Files to edit:** `src/server/index.ts`, `src/web/services/web-talk-service.ts`  
**What exists:** `Talk.expiresAt` field stored but never evaluated.  
**Implement:**
1. In `POST /api/talks/:id/register-receivers-for-broadcast`: skip send if `Date.now() > talk.expiresAt`.
2. In `GET /api/users/:id/incoming-talks`: add `isExpired: boolean` field to each cluster.
3. In the web client, show an "Expired" badge on expired talks in the inbox and prevent answering.

---

## Phase 5 — Chatrooms
*Depends on Phase 3 (blocklist) for safe member listing.*

---

### CR-01 · P0 — FIFO eviction: complete the enforcement
**File to edit:** `src/web/services/web-chatroom-service.ts`  
**What exists:** `enforceCapacityLimitAfterJoin()` scaffolding collects active users and reads GPS, but `moveUserToChatroom()` is never reached in the eviction path.  
**Implement:**
1. Inside `checkCapacityAndEvict()`, after resolving `locationData`, actually call:
   ```typescript
   const childId = findAppropriateChildChatroom(chatroomId, gpsLocation);
   if (childId) await self.moveUserToChatroom(oldestUser.userId, chatroomId, childId, oldestUser.stageName);
   ```
2. Ensure `moveUserToChatroom` sets `movedTo: childId` on the old room's user node.
3. Verify `watchForEviction` detects the `movedTo` field and fires `onMoved(userData.movedTo)`.
4. Write a unit test: join 4 users in a room with `CHATROOM_CAPACITY = 3`, assert the oldest is evicted and moved to the correct child room.

---

### CR-02 · P1 — Hierarchical room splitting (full 6-level cascade)
**Files to edit:** `src/shared/chatroom-hierarchy.ts`, `src/shared/location-to-chatroom.ts`  
**What exists:** Hierarchy goes only 3 levels deep (Global → Continent → Country, 2 countries per continent). `findAppropriateChildChatroom` exists but only covers the shallow tree.  
**Implement:**
1. Extend `CHATROOM_HIERARCHY` to 6 levels: Global → Continent → Country → State/Province → City → GPS grid (≈2 km²).
   - At GPS grid level, generate IDs dynamically: `grid_<lat2dp>_<lon2dp>`.
2. Update `findAppropriateChildChatroom` to traverse the extended tree using the user's `GPSCoordinate`.
3. Add `mergeRooms(region, minUsers)` to `WebChatroomService` — fires when a room drops below 10 active users, moving all members to the parent room.

---

### CR-03 · P1 — Business chatroom creation & management
**Files to edit:** `src/server/index.ts`, `src/web/services/web-chatroom-service.ts`  
**What exists:** `BusinessInfo` interface in `src/shared/types.ts`. No API.  
**Implement:**
1. Add `POST /api/chatrooms/business` — body `{ ownerId, brandName, address, coordinates, description }` — creates a chatroom with `type: 'business'` and stores `businessInfo`.
2. Add `GET /api/chatrooms?type=business&region=<region>` for discovery.
3. Add `PATCH /api/chatrooms/:id/business` for name/description updates (owner only).
4. Add `POST /api/chatrooms/:id/verify` — stub for business verification workflow (sets `businessInfo.verified = true`).

---

### CR-04 · P1 — Move FIFO eviction authority to the server
**File to edit:** `src/server/services/chatroom-manager.ts`, `src/server/index.ts`  
**What exists:** `ChatroomManager.joinChatroom()` only increments headcount. All FIFO logic is client-side.  
**Implement:**
1. In `ChatroomManager.joinChatroom()`: after writing the user, read all active members; if count > capacity, evict oldest via `findAppropriateChildChatroom` and emit `evicted` Socket.IO event to the evicted user's socket.
2. Client-side FIFO in `WebChatroomService` becomes a fallback only.

---

### CR-05 · P2 — Traveller badge for remote users
**Files to edit:** `src/shared/types.ts`, `src/web/ui/ui-manager.ts`  
**Implement:**
1. Add `homeRegion: string` to `User` (set once on first location write, never auto-updated).
2. In the member list renderer, compare `member.currentRegion` vs `member.homeRegion`; if different, append a ✈️ traveller badge next to the stage name.

---

## Phase 6 — Messaging & Conversations
*Depends on Phase 2 (AUTH-04) for channel encryption.*

---

### MSG-01 · P1 — Conversation expiry (30-day rule)
**File to edit:** `src/web/services/web-conversation-service.ts`  
**What exists:** `CONFIG.CONVERSATION_EXPIRY_DAYS = 30` defined but never checked.  
**Implement:**
1. In `createConversation()`, store `expiresAt: Date.now() + 30 * 86400 * 1000` on the conversation record.
2. In `subscribeToMessages()` and `subscribeToUserConversations()`, if `Date.now() > conversation.expiresAt`, set `status: 'expired'`, stop accepting new messages, and surface an expiry notice in the UI.
3. Add a server-side cleanup job (`setInterval`, daily) that marks expired conversations in Gun.

---

### MSG-02 · P1 — Read receipts
**File to edit:** `src/web/services/web-conversation-service.ts`  
**What exists:** `Message.readBy: string[]` defined in `src/shared/types.ts` but never populated.  
**Implement:**
1. When a message is rendered on screen, call:
   ```typescript
   gun.get(`conversations/${convId}/messages/${msgId}/readBy`).set(currentUserId);
   ```
2. In the message renderer, show a ✓ (delivered) and ✓✓ (read by all participants) indicator.

---

### MSG-03 · P1 — Message history limit (1 000 per conversation)
**File to edit:** `src/web/services/web-conversation-service.ts`  
**Implement:**
1. In `subscribeToMessages()`, after collecting messages sort by timestamp and keep only the latest `CONFIG.MESSAGE_HISTORY_LIMIT` (1 000).
2. Older messages are still in Gun but not loaded into memory; add a "Load earlier messages" button that fetches the previous page.

---

### MSG-04 · P1 — Chatbot icon overlay on auto-answer messages
**File to edit:** `src/web/ui/ui-manager.ts`  
**What exists:** `Message.isFromChatbot: boolean` in types. Not used in rendering.  
**Implement:**
1. In the message bubble renderer, if `message.isFromChatbot === true`, add a small robot-icon badge (🤖 or SVG) to the avatar and a lighter background colour to distinguish chatbot messages from human messages.

---

### MSG-05 · P1 — "Let's talk in person" match conversation routing
**Files to edit:** `src/web/app/app.ts` or `src/web/ui/ui-manager.ts`  
**What exists:** Server returns `{ isMatch: true, conversationId, otherUserId }` from `POST /api/talks/:id/response`. The client ignores this.  
**Implement:**
1. After `POST /api/talks/:id/response` responds, check `isMatch`.
2. If true, navigate the user to the conversation view for `conversationId`.
3. Show a match banner: *"It's a match! You and [stageName] can now chat."*

---

## Phase 7 — UI Components

---

### UI-01 · P0 — Bulk send dashboard
**File to edit:** `src/web/ui/ui-manager.ts`  
**Depends on:** TALK-01, TALK-06  
**Implement:**
1. **Targeting panel:** checkboxes for chatroom IDs (from `CHATROOM_HIERARCHY`), tag picker (from TALK-06), distance radius slider (miles), audience preview count.
2. **Send button:** disabled until preamble is set (TALK-02). On click, calls `POST /api/talks/:id/send` and polls `GET /api/bulk-jobs/:id` every 2 seconds.
3. **Progress tracker:** live counters for sent / matched / ignored / expired using job poll data.
4. **Results panel:** list of matched users with "Open conversation" links.

---

### UI-02 · P1 — Answer choice chips for linear talk capture
**File to edit:** `src/web/ui/ui-manager.ts`  
**Depends on:** TALK-03  
**Implement:** (see TALK-03 step 2) — rendered as pill buttons below the detected question message. Selecting a chip highlights it and submits the answer.

---

### UI-03 · P1 — Survey analytics dashboard
**File to edit:** `src/web/ui/ui-manager.ts`  
**Depends on:** TALK-05  
**Implement:**
1. For each aggregatable question: render a horizontal bar chart (pure CSS or Chart.js) showing answer counts and percentages.
2. Show total response count, response rate (if total recipients known from bulk job), and skip rate.
3. Toggle to show/hide respondent list (only visible to talk author; respects `isAnonymous`).
4. "Export CSV" button that serialises `SurveyAggregation[]` to comma-separated format.

---

### UI-04 · P1 — Channel badge (public / known / mutual)
**File to edit:** `src/web/ui/ui-manager.ts`  
**Depends on:** AUTH-04  
**Implement:** In the conversation header, display an icon: 🌐 public · 🔒 known · 🔐 mutual. Tooltip explains the encryption level.

---

### UI-06 · P2 — First-run onboarding flow
**File to edit:** `src/web/app/app.ts`  
**Depends on:** AUTH-01  
**Implement:**
1. If no keypair in `localStorage`: show a welcome screen → generate keypair (AUTH-01) → prompt for stageName → request location permission → join nearest chatroom → optional profile tour.
2. Progress is tracked in `localStorage` so the flow resumes if the user closes mid-way.

---

### UI-05 · P2 — Reputation display in profile & chat
**File to edit:** `src/web/ui/ui-manager.ts`  
**Depends on:** REP-04  
**Implement:**
1. Profile card: star rating (★ out of 5), match count, questions answered count.
2. Respect `reputation.visibility` setting (REP-04): hide fields if `visibility !== 'public'` for non-connections.
3. Member list in chatroom: show star rating next to stageName.

---

## Phase 8 — Android Implementation
*All Android items are independent of each other within this phase.*

---

### AND-01 · P0 — Gun.js WebSocket client (Kotlin)
**File to create:** `android/app/src/main/java/com/iinpublic/gun/GunClient.kt`  
**Implement:**
1. Open WebSocket connection to `ws://<server>:8080/gun` using the `Java-WebSocket` dependency.
2. Implement `put(key: String, data: JSONObject, callback: (ack: JSONObject) -> Unit)`.
3. Implement `get(key: String, callback: (data: JSONObject?) -> Unit)`.
4. Implement `on(key: String, callback: (data: JSONObject) -> Unit): Cancellable`.
5. Apply the same serialisation conventions as the web client: wrap complex objects in `{ "data": "<json>" }`, encode arrays as `{ "_isArray": true, "_length": N, "0": ... }`, serialise `Date` to ISO-8601 strings.

---

### AND-02 · P0 — GPS & location bridge (Android)
**File to create:** `android/app/src/main/java/com/iinpublic/location/LocationService.kt`  
**Implement:**
1. Wrap `FusedLocationProviderClient` to get the current `Location`.
2. Port `LocationPrivacy.blurLocation()` grid formula to Kotlin:
   ```kotlin
   fun blurLocation(lat: Double, lon: Double): BlurredLocation {
       val gridLat = (lat * 100).toLong() / 100.0
       val gridLon = (lon * 100).toLong() / 100.0
       return BlurredLocation("region_${gridLat}_${gridLon}", emptyList())
   }
   ```
3. **Never** write the raw `Location` to the Gun graph — always blur first.

---

### AND-03 · P0 — Shared module Kotlin ports
**Files to create:** `android/app/src/main/java/com/iinpublic/shared/`  
**Implement the following as Kotlin `object` singletons:**

| Kotlin file | From TypeScript |
|---|---|
| `TalkContentId.kt` | `src/shared/talk-content-id.ts` — FNV-1a hash, `computeTalkIdFromTalkData` |
| `TalkEngine.kt` | `src/shared/talk-engine.ts` — `checkIfMatch`, `TalkValidator.validateTalk` |
| `ReputationManager.kt` | `src/shared/reputation.ts` — `calculateReputationScore`, `getBulkSendCapacity` |
| `ChatroomHierarchy.kt` | `src/shared/chatroom-hierarchy.ts` — `CHATROOM_HIERARCHY` tree |
| `Config.kt` | `src/shared/config.ts` — all `CONFIG` constants |

---

### AND-04 · P0 — Core Activity/Fragment structure
**Files to create:** under `android/app/src/main/java/com/iinpublic/ui/`  
**Implement 5 fragments** matching the spec UI screens:
1. `ChatroomFragment` — member list, chatroom switcher.
2. `TalksFragment` (IN tab) — incoming talk cluster list, answer flow.
3. `ConversationFragment` — message thread, send box.
4. `ProfileFragment` — stageName, reputation stats, settings.
5. `BulkSendFragment` — targeting panel (post-MVP).

Wire fragments in `MainActivity` with a `BottomNavigationView`.

---

### AND-05 · P1 — Push notifications (FCM)
**Files to edit:** `android/`, `src/server/index.ts`  
**Implement:**
1. Integrate `firebase-messaging` in `android/app/build.gradle`.
2. Send FCM registration token to server via `POST /api/users/:id/push-token`.
3. Server: on talk received, match created, or new message — call FCM API with the recipient's token.
4. Add `src/server/services/push-service.ts` wrapping the FCM HTTP v1 API.

---

### AND-06 · P1 — Battery-level feature tiering
**File to create:** `android/app/src/main/java/com/iinpublic/platform/BatteryMonitor.kt`  
**Implement:**
1. Read `BatteryManager.EXTRA_LEVEL` via a `BroadcastReceiver`.
2. Map to tiers: Normal (>30%), Low (15–30%), Critical (5–15%), Emergency (<5%).
3. In `GunClient`, throttle background sync based on tier: Normal = full sync, Low = sync on user action only, Critical = read-only, Emergency = offline.

---

### AND-07 · P2 — Tit-for-Tat fair relay (T4T)
**File to create:** `android/app/src/main/java/com/iinpublic/relay/T4TRelayService.kt`  
**Implement:**
1. Run as a `WorkManager` periodic task (every 15 minutes when on WiFi).
2. Track bytes relayed for peers vs. bytes received from peers in `SharedPreferences`.
3. Accept relay requests proportional to the ratio: relay_given / relay_received ≥ 1.0.
4. Expose T4T stats in `ProfileFragment`.

---

## Phase 9 — iOS (Planning & Foundation)

---

### IOS-01 · P1 — Decide iOS technology stack
**Deliverable:** An ADR (Architecture Decision Record) committed to `docs/decisions/ios-stack.md`.  
**Evaluate three options:**
1. **React Native** — reuses `src/web/services/` directly; requires Metro bundler + RN bridge.
2. **WKWebView bridge** — wraps the compiled web bundle; minimal new code but limited native access.
3. **Native Swift + custom Gun client** — most work; best performance and App Store compliance.

**Recommendation** (for agent to confirm): Option 1 (React Native) unless the team has strong Swift expertise, because it reuses all web services unchanged.

---

### IOS-02 · P1 — iOS GPS bridge (after stack decision)
**Depends on:** IOS-01  
**Implement:** Mirror AND-02 using `CLLocationManager`. Apply same `blurLocation()` formula. Ensure the Swift/RN port produces identical region strings to the web and Android clients.

---

### IOS-03 · P2 — iOS push notifications (APNs)
**Depends on:** AND-05 (server push-service must exist first)  
**Implement:** Configure APNs certificate in server push-service. Register device token on app launch, send to `POST /api/users/:id/push-token` with `platform: 'ios'`.

---

## Phase 10 — Tests & Quality

---

### TEST-01 · P1 — E2E test: full talk flow (TC-TEN-01)
**File to create:** `tests/e2e/talk-flow.spec.ts`  
**Depends on:** TALK-01, MSG-05  
**Steps to cover:**
1. User A creates a talk and sends it to User B.
2. User B receives it in their incoming-talks list.
3. User B answers all questions.
4. Assert server returns `isMatch: true` and a `conversationId`.
5. Assert both users can send and receive messages in the conversation.

---

### TEST-02 · P1 — E2E test: age gating (TC-DATE-01)
**File to create:** `tests/e2e/age-gate.spec.ts`  
**Depends on:** REP-03  
**Steps to cover:**
1. Create a talk with `isAdult: true`.
2. Attempt to send it to a user with `ageVerified: false`.
3. Assert the user does NOT appear in the incoming-talks list.
4. Set `ageVerified: true` on the user (via voting endpoint).
5. Resend — assert the talk now appears.

---

### TEST-03 · P1 — E2E test: auto linear capture (TC-LIN-01)
**File to create:** `tests/e2e/linear-capture.spec.ts`  
**Depends on:** TALK-03  
**Steps to cover:**
1. Send a message: `"Do you like coffee? Yes.; No.; Maybe."`.
2. Assert answer chips are rendered.
3. Click "Yes."
4. Assert `processAnswer` is called with the correct `answerId`.
5. Assert a talk draft is saved with one question and three answers.

---

### TEST-04 · P1 — Unit tests: rate limiting & blocklist
**File to create:** `src/test/unit/rate-limiter.test.ts`, `src/test/unit/blocklist.test.ts`  
**Depends on:** REP-01, REP-02  
**Cover:**
- Sending 11 talks in one day throws `RateLimitError` on the 11th.
- Sending to a blocked user excludes them from `receiverIds`.
- `BlockCount` reduces bulk-send capacity via `getBulkSendCapacity`.

---

### TEST-05 · P2 — Unit tests: SEA encryption round-trips
**File to create:** `src/test/unit/sea-encryption.test.ts`  
**Depends on:** AUTH-01, AUTH-02  
**Cover:**
- `SEA.pair()` produces a valid keypair with `pub`, `priv`, `epub`, `epriv`.
- `SEA.encrypt` + `SEA.decrypt` round-trip for private answers.
- Financial data detection catches credit card numbers, IBANs, crypto wallets.
- `detectFinancialData` returns `false` for clean text.

---

## Quick Reference: Dependency Graph

```
Phase 1 (CI/Build)
    └── Phase 2 (SEA/Auth)
            └── Phase 3 (Safety/Filters)
                    └── Phase 4 (Talks/Bulk Send)
                            └── Phase 5 (Chatrooms)
                            └── Phase 6 (Messaging)
                                    └── Phase 7 (UI)
                                            └── Phase 10 (Tests)
Phase 8 (Android) ── independent, can start after Phase 1
Phase 9 (iOS)     ── independent, can start after IOS-01 decision
```

---

## Item Index

| ID | Phase | Priority | Title |
|---|---|---|---|
| INF-01 | 1 | P0 | CI pipeline |
| INF-02 | 1 | P0 | Production build & deploy scripts |
| INF-05 | 1 | P2 | Structured logging |
| AUTH-01 | 2 | P0 | SEA key-pair generation |
| AUTH-02 | 2 | P1 | Private answer encryption |
| AUTH-03 | 2 | P1 | Known-person trust store |
| AUTH-04 | 2 | P1 | Encrypted message channels |
| AUTH-05 | 2 | P1 | Socket.IO cryptographic auth |
| REP-01 | 3 | P0 | Rate limiting enforcement |
| REP-02 | 3 | P0 | Blocklist data model & enforcement |
| REP-03 | 3 | P0 | Age gating |
| FILT-01 | 3 | P0 | Financial data detection |
| FILT-02 | 3 | P1 | Comprehensive dirty-words list |
| FILT-04 | 3 | P1 | Location radius filter |
| REP-04 | 3 | P1 | Reputation privacy controls |
| FILT-06 | 3 | P2 | Per-user filter settings UI |
| TALK-01 | 4 | P0 | Bulk send execution & batching |
| TALK-02 | 4 | P0 | Mandatory tag/location preamble |
| TALK-03 | 4 | P0 | Auto linear talk capture |
| TALK-06 | 4 | P1 | Tag creation & popularity tracking |
| TALK-05 | 4 | P1 | Survey aggregation pipeline |
| TALK-07 | 4 | P2 | Concurrent edit lock & versioning |
| TALK-08 | 4 | P2 | Chatbot manual-answer reminder |
| TALK-09 | 4 | P2 | Talk expiry enforcement |
| CR-01 | 5 | P0 | FIFO eviction enforcement |
| CR-02 | 5 | P1 | 6-level room splitting cascade |
| CR-03 | 5 | P1 | Business chatroom management |
| CR-04 | 5 | P1 | Server-side FIFO authority |
| CR-05 | 5 | P2 | Traveller badge |
| MSG-01 | 6 | P1 | Conversation expiry |
| MSG-02 | 6 | P1 | Read receipts |
| MSG-03 | 6 | P1 | Message history limit |
| MSG-04 | 6 | P1 | Chatbot icon overlay |
| MSG-05 | 6 | P1 | Match conversation routing |
| UI-01 | 7 | P0 | Bulk send dashboard |
| UI-02 | 7 | P1 | Answer choice chips |
| UI-03 | 7 | P1 | Survey analytics dashboard |
| UI-04 | 7 | P1 | Channel badge |
| UI-06 | 7 | P2 | First-run onboarding flow |
| UI-05 | 7 | P2 | Reputation display |
| AND-01 | 8 | P0 | Gun.js WebSocket client (Kotlin) |
| AND-02 | 8 | P0 | GPS & location bridge |
| AND-03 | 8 | P0 | Shared module Kotlin ports |
| AND-04 | 8 | P0 | Core Activity/Fragment structure |
| AND-05 | 8 | P1 | Push notifications (FCM) |
| AND-06 | 8 | P1 | Battery-level feature tiering |
| AND-07 | 8 | P2 | Tit-for-Tat relay |
| IOS-01 | 9 | P1 | iOS stack decision |
| IOS-02 | 9 | P1 | iOS GPS bridge |
| IOS-03 | 9 | P2 | iOS APNs |
| TEST-01 | 10 | P1 | E2E: full talk flow |
| TEST-02 | 10 | P1 | E2E: age gating |
| TEST-03 | 10 | P1 | E2E: auto linear capture |
| TEST-04 | 10 | P1 | Unit: rate limiting & blocklist |
| TEST-05 | 10 | P2 | Unit: SEA encryption |
| INF-03 | — | P1 | Replace in-memory incomingTalksMap (Redis) |
| INF-04 | — | P1 | Gun.js persistent storage upgrade |
| INF-06 | — | P2 | Push notification dispatcher (server) |
| REP-05 | — | P1 | Mutual friends count tracking |
| REP-06 | — | P2 | Star rating & review system |
| FILT-03 | — | P1 | Language detection library |
| FILT-05 | — | P2 | Privacy-sensitive question classifier |
| LOC-01 | — | P1 | Dynamic blur radius per user |
| LOC-02 | — | P1 | Location-privacy validation on all writes |
| LOC-03 | — | P2 | Full 6-level location hierarchy |
| TALK-04 | — | P1 | Visual talk editor (DAG UI) |
| STAT-01 | — | P1 | Generic stats/inquiry layer across 4 talk types |

---

### STAT-01 · P1 — Generic statistics & inquiry across all four talk types
**Files to create/edit:** `src/shared/talk-stats.ts` (new), `src/server/index.ts`, `src/web/services/web-talk-service.ts`
**What exists:** Nothing. Each talk type (tags, flow, survey, route) currently carries its own ad-hoc aggregation (e.g. `SurveyAggregation`). There is no unified way for users to add statistics to their own talks without writing per-type code.
**Design goal (from user):** *"Make the statistics and inquiry as easily as possible so that it can be added to talks by users without complex definitions."* Statistics must work uniformly across **tags, flow, survey, route** and support three basic inquiry dimensions:
  - **Time-based** — counts / percentages bucketed by day / week / month.
  - **Location-based** — counts / percentages by blurred region (reuse `LocationPrivacy` grid).
  - **Answer-based** — yes/no or choice-distribution % per question.

**Implement:**
1. **Normalize every response** at write time into a common shape, regardless of talk type:
   ```typescript
   interface TalkResponse {
     talkId: string;          // content-hash id
     talkType: 'tags' | 'flow' | 'survey' | 'route';
     responderId: string;     // or anonymised hash
     region: string;          // blurred location id
     answers: Array<{ questionId: string; answerId: string; answerText: string }>;
     createdAt: number;
   }
   ```
   Written to `talks/<talkId>/responses/<responseId>`.
2. **Write secondary indices** at response time so aggregation is O(1) lookups, not graph scans:
   - `idx/responses_by_day/<YYYY-MM-DD>/<talkId>/<responseId>`
   - `idx/responses_by_region/<region>/<talkId>/<responseId>`
   - `idx/responses_by_talk_answer/<talkId>/<questionId>/<answerId>/<responseId>`
3. **Server aggregation endpoints** (all talk types share these; no per-type handler):
   - `GET /api/stats/talks/:talkId/summary` — total responses + per-question counts and %.
   - `GET /api/stats/talks/:talkId/by-day?from=&to=&bucket=day|week|month`.
   - `GET /api/stats/talks/:talkId/by-region`.
   - `GET /api/stats/talks/:talkId/by-answer?questionId=`.
4. **Client helper** `WebTalkService.queryStats(talkId, { dimension, ... })` that wraps the endpoints above, so users can attach a stats widget to any talk with one call.
5. **Extensibility** — custom user-defined aggregations (e.g. "score = sum of answer weights") expressed as a small JSON DSL (`{ reduce: 'sum', field: 'answer.weight' }`) evaluated server-side against the normalised response list. No code per talk required.
