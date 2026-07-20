# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev                    # clean DB, browser logs in as built-in TechSupport (headcount 1); web (webpack, port 3001) + server (tsx watch, port 8080)
npm run dev:run                # web + server WITHOUT reset (internal base for dev/dev:multi)
npm run dev:stage-empty        # alias of dev (clean DB + TechSupport only)
npm run dev:stage-user1        # dev with a pre-seeded single user (IINPUBLIC_STAGE_SEED=user1)
npm run dev:stage-user2-match  # two users with a pre-existing match
npm run dev:stage-user3-network # three-user network scenario
npm run dev:web                # webpack dev server only
npm run dev:server             # Express/Gun server only (hot-reload via tsx)

# Build
npm run build:web              # webpack production bundle
npm run build:server           # tsc compile to dist/
npm run health                 # type-check + lint + unit + integration + both builds

# Type checking + lint
npm run test:type              # tsc --noEmit
npm run lint                   # eslint src/**/*.ts
npm run lint:fix

# Unit/integration tests (Jest, src/test/)
npm test                       # all Jest tests
npm run test:unit              # src/test/unit/ only
npm run test:integration       # src/test/integration/ only
npm run test:watch
npm run test:coverage

# E2E tests (Playwright, tests/e2e/)
npm run test:e2e               # build:server + full Playwright suite
npm run test:e2e:talks-matching  # talks-matching/ subset only
# Run a single spec:
npx playwright test tests/e2e/talks-matching/12-two-responders-partial-match.spec.ts
# Parallel workers (faster, isolated Gun servers per worker):
PW_WORKERS=4 npm run test:e2e
# Full suite, 20 workers, 10 min/test timeout (see playwright.config.ts):
npm run test:e2e:parallel
# Slow-motion for human watching:
PW_SLOW_MO=500 npm run test:e2e
```

`npm run test:e2e` always runs `build:server` first — the Playwright config starts `dist/server/server/index.js`, not `src/`. After server changes, the build must happen before running E2E.

## Architecture

### Three-layer structure

```
src/shared/   — domain types, match engine, location, reputation (used by both server and web)
src/server/   — Express + Socket.IO + Gun server; owns talk delivery, user management, stats
src/web/      — Webpack SPA; vanilla TypeScript + Gun client; no framework
```

### Data layer: Gun.js (P2P graph DB)

All persistence goes through [Gun.js](https://gun.eco/). The server has a `GunService` (server-side wrapper) and the browser has a `WebGunService`. Both write/read the same shared graph via HTTP relay. Key Gun paths:

- `users/<id>` — public user record
- `user-public-profile/<id>` — headshot + languages + profile JSON
- `user-talk-filters/<id>` — serialized `TalkIntakeFilters`
- `user-blocks/<blockerId>/<targetId>` / `user-blocked-by/<targetId>/<blockerId>` — block graph
- `talks/<id>` — talk definition + responses + stats
- `incomingTalksByUser/<userId>/<identityKey>` — incoming talk clusters (server-side `Map` is authoritative; Gun path is a mirror)
- `conversations/<id>` / `users/<id>/conversations/<convId>` — conversation records
- `talkAnswerTemplateByUser/<userId>/<identityKey>` — cached answer templates for chatbot auto-reply

**Gun.js quirks to know:**
- Gun cannot store nested arrays; use `questionsJson` (serialized) alongside `questions` arrays.
- `incomingTalksMap` on the server is an in-memory `Map<userId, Map<leaf, cluster>>` that bypasses Gun writes for bulk broadcast performance. The browser reads incoming talks via `GET /api/incoming-talks`, not by watching Gun directly.
- Cross-worker disk races in `clearGunDatabases()` are a known flakiness source — servers run `E2E_GUN_MEMORY_ONLY=1` so disk clears are not required.

### Server: `src/server/`

Entry: `src/server/index.ts` — `IinPublicServer` class wires all services and routes.

Services:
- `GunService` — low-level Gun read/write (get/put/getPath/putPath)
- `UserService` — user CRUD, blocks, age-verify, talk filters
- `TalkService` — talk CRUD, broadcast
- `ChatroomManager` — room join/leave, member counts (Socket.IO)
- `ReputationService` — reputation aggregation

Route modules (all in `src/server/routes/`):
- `talk-delivery-routes.ts` — `POST /api/talks/:id/received` (the critical path: filters, match, fanout, stats)
- `talk-routes.ts` — CRUD for talk definitions
- `user-routes.ts` — user profile, blocks, age-verify
- `chatroom-routes.ts` — room membership
- `stats-routes.ts` — survey analytics
- `peer-routes.ts` — peer detail view (exchanged talks, block status)
- `system-routes.ts` — `/api/test/clear-database` (E2E only), `/health`

**Talk delivery flow** (`POST /api/talks/:id/received`):
1. Load talk data from body or Gun graph
2. `getUserDeliveryContext` — check receiver's `talkFilters` + `ageVerified`
3. `filterReasonsForTalk` — returns array of rejection reasons (`age_gate`, `language`, etc.)
4. If not filtered: `upsertIncomingTalkForUser` (server Map + Gun mirror)
5. On answer submit: `fanoutResponseToSenders` → `checkIfMatch` → create conversation if match
6. `recordTalkStatsResponse` — updates in-memory stats indices + Gun mirrors

### Web client: `src/web/`

Entry: `src/web/index.ts` → `WebApp` → `IinPublicApp` (`src/web/app/app.ts`).

`IinPublicApp` is the app controller: it creates all services, initializes Gun, joins a chatroom, sets up event handlers between `UIManager` and services, then shows the UI.

**Event-driven UI pattern:** `UIManager` extends `EventEmitter`. UI actions emit named events (e.g. `'submitPeerReview'`, `'vouchAgeVerified'`, `'createTalk'`). `app.ts` listens and calls the appropriate service. Adding a new feature means:
1. Emit the event from `UIManager` (or a view function it calls)
2. Handle the event in `app.ts`
3. Call the relevant `Web*Service` method

Services (all in `src/web/services/`):
- `WebGunService` — Gun init, keypair/SEA auth, read/write
- `WebUserService` — user create/update, blocks, age-verify, private encrypted profile data
- `WebTalkService` — create/broadcast/list talks (REST + Gun)
- `WebChatroomService` — join/leave rooms, member count subscriptions
- `WebConversationService` — conversation list, message sync

UI modules (all in `src/web/ui/`):
- `ui-manager.ts` — coordinates all views, renders tabs (chatrooms / talks / me), emits events
- `talk-editor-dialog.ts` — talk creation/edit form
- `talk-response-dialog.ts` — answering an incoming talk
- `contacts-view.ts` — contacts list + relationship/detail modal
- `conversations-view.ts` — conversation list in the Me tab
- `answers-view.ts` — past answers/profile Q&A
- `user-detail-view.ts` — peer detail overlay

### Shared domain: `src/shared/`

- `types.ts` — all core interfaces (`User`, `Talk`, `Reputation`, `KnownPerson`, etc.)
- `talk-engine.ts` — `checkIfMatch` / `checkIfIgnore` (used by both server and browser)
- `reputation.ts` — `ReputationManager.updateReputation(rep, eventType, value?)`
- `talk-content-id.ts` — `buildTalkIdentityKey` / `computeTalkIdFromTalkData` (content-hash dedup)
- `chatroom-hierarchy.ts` — static `CHATROOM_HIERARCHY` tree (Global → Region → City)
- `talk-intake-filters.ts` — `talkPassesIntakeFilters` (delivery-time filter predicate)
- `location.ts` — `LocationPrivacy.blurLocation` / `getCurrentLocation`

### Talk types

Four talk types share the same `Talk` struct but behave differently:
- **flow** — directed graph of questions; last answer's `isMatch`/`isIgnore` flag determines outcome
- **tag** — checkbox list; checked items are `isMatch`, unchecked are `isIgnore`
- **survey** — no match/ignore; all answers collected for stats
- **route** — DAG with `next` pointers between questions; ends on a terminal node

### Direct P2P conversation transport

Ordinary post-match DMs use `DirectP2PConversationTransport` **only** — no star/relay fallback (P2P-messaging Phase 1, spec §19.4). On send, the message is written to local Gun (`conversations/.../messages`, via the Gun store) and then notified to the peer over the WebRTC DataChannel; on receive, the peer's update is applied to the receiver's local Gun and the UI reads from a Gun subscription. Gun-on-device is the source of truth; WebRTC is notify/sync only. `createConversationTransportDiagnostics` reports `availableModes: ['direct-p2p'], fallback: null`. TechSupport keeps its own server-backed transport (spec §19.7). `ResilientConversationTransport` (direct → server-relay → star-gun) and the relay/star classes remain in-tree but are **not wired by default** — reserved for an optional, off-by-default ephemeral server-relay forward (decision A) and for unit coverage. The web app syncs transport mode from `GET /api/debug/storage` flags at boot.

- Helpers: `tests/e2e/helpers/p2p-transport-e2e.ts` (`P2P_E2E_TIMEOUT_MS=10s`), `tests/e2e/helpers/webrtc-chromium.ts`
- Runtime WebRTC connect timeout: `P2P_WEBRTC_CONNECT_TIMEOUT_MS` (10s) in `p2p-webrtc-session.ts`

### E2E test infrastructure

Tests live in `tests/e2e/`. Each spec has a companion `.md` with a plain-English description.

**Parallel isolation:** each Playwright worker gets its own Gun server on `8080+N` and webpack dev server on `3001+N`. `parallelSlot()` in `helpers/ports.ts` maps a worker to its port pair. Run `PW_WORKERS=N` to enable.

**Key helpers** (`tests/e2e/helpers/`):
- `timing.ts` — `afterSync()` (600ms), `afterAction()` (100ms), `afterLoad()` (1s); use these instead of raw `wait()`
- `talks-matching-flow.ts` — `bootstrapUser`, `openIncomingTalkModal`, `waitForResponseModalClosed`, `resetTalksMatchingSession`, `finalCleanupPages`
- `talks-matching-browsers.ts` — `launchThreeBrowsers` / `shutdownThreeBrowsers`
- `clear-database.ts` — `clearGunDatabases()` (in-memory server clear via `POST /api/test/clear-database` + per-worker radata clear)
- `ports.ts` — `gunBaseURL()`, `webAppURLStableChatroom()`, `parallelSlot()`
- `fixtures.ts` — `e2eWorkerSlot` fixture that sets `parallelSlotOverride` before `beforeAll` runs

**Durable assertion patterns:** Prefer `#status-bar-text` (persists while tab is shown) and `.conversation-list-item` (from localStorage) over ephemeral toast notifications for match/mismatch assertions. `waitForTabActive(page, tabName)` is the reliable signal that navigation + Gun sync completed.

**Age verification threshold:** `AGE_VERIFICATION_THRESHOLD = 3`. Call `POST /api/users/:id/age-verify` three times to flip `ageVerified` to `true`.

### Dev stage seeds

`src/web/dev-stage-seeds.ts` contains seed functions keyed by `IINPUBLIC_STAGE_SEED`:
- `stage-zero` / `empty` — clean DB; browser boots logged in as the built-in TechSupport root (headcount 1)
- `multi` — dev:multi only: clean DB, ordinary browser users; TechSupport seeded server-side
- `user1` — one user with profile
- `user2-match` — two users with a pre-existing match conversation
- `user3-network` — three-user social graph

## Key invariants

- **Match logic is in `src/shared/talk-engine.ts`** — never duplicate it in routes or UI.
- **TechSupport is the built-in first user and counts as exactly 1 in every headcount** (status bar, room badges) — see `docs/design/techsupport-bootstrap-contract.md`.
- **Server `incomingTalksMap` is authoritative** — Gun writes for `incomingTalksByUser` are skipped in the delivery path; the browser fetches via HTTP.
- **Private user data is SEA-encrypted** — `WebUserService.putPrivateUserData` writes `blockedUserIds`, `knownPeople`, `talkFilters` under the Gun user keypair. The server cannot read these; server-side user ops use Gun public paths only.
- **`ContactsViewDeps`** must include every function deps object passed to contacts-view rendering; there are three call sites in `ui-manager.ts` (~lines 873, 890, 908).
