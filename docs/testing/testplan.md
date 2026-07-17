# Test Plan for IinPublic
## Location-Based Chatbot Matching & Talk System

> **Inventory counts in this document are stale** (suite has grown well past the 70 tests
> described below). For the current, generated requirement-coverage view, see
> [`coverage-matrix.md`](./coverage-matrix.md) (regenerate with `npm run coverage:matrix`;
> ratchet with `npm run coverage:check`). This document remains useful for strategy prose
> and the SRS-style case descriptions.

**Last E2E verification:** 2026-05-16 — **70 / 70 passed** (`PW_WORKERS=15`, wall clock **~5.1 min**)

This document maps the **implemented Playwright E2E regression suite** (70 tests, 54 spec files) to product areas. Section 4 is the living catalog: durations, run order, steps, and extension notes. SRS-style cases in later sections remain for requirements not yet automated.

---

## 1. Introduction

### 1.1 Purpose
Guide QA, developers, and release owners on:
- What the **70 Playwright E2E tests** cover today
- How to run them (serial vs parallel workers)
- How to **refresh durations** and tune CI order
- Which SRS areas still need manual or future automation

### 1.2 Scope (automated today)
| Layer | Location | Count |
|-------|----------|------:|
| **E2E (Playwright)** | `tests/e2e/staged/**` | **70 tests** / 54 files (+ stage bootstrap specs in pipeline mode) |
| Unit + integration | `src/test/**` | Jest (`npm test`, `npm run health`) |
| Companion narratives | `tests/e2e/**/*.md` | 53 files (add alongside new specs) |

### 1.3 Test objectives
- Lock regressions for talk matching, broadcast, chatrooms, contacts, blocking, reputation, profile privacy, and Gun sync
- Track per-test duration for parallel scheduling and flake triage
- Preserve extension fields (Notes, FR-*, owner) as you add detail

---

## 2. Test strategy

### 2.1 Testing levels
| Level | Tooling | Role |
|-------|---------|------|
| Unit | Jest (`npm run test:unit`) | Shared domain (`talk-engine`, filters, chatbot memory) |
| Integration | Jest (`npm run test:integration`) | Server routes, Gun wrappers |
| **E2E** | **Playwright** (`npm run test:e2e`) | **Primary release gate — 70 scenarios** |
| UAT / manual | This plan + SRS sections 7+ | Flows not yet scripted |

### 2.2 E2E execution modes
| Mode | Command | When |
|------|---------|------|
| Default CI / local | `npm run test:e2e` | Builds server, `PW_WORKERS=1`, lexicographic file order |
| Parallel (recommended) | `PW_WORKERS=15 npm run test:e2e` | Isolated Gun port `8080+N`, webpack `3001+N` per worker |
| Watch / debug | `E2E_INTERVAL=long npx playwright test …` | Human observation; ~3× waits (`helpers/timing.ts`) |
| Single spec | `npx playwright test tests/e2e/…/file.spec.ts` | Fast triage |

**Invariants (see `CLAUDE.md`, `tests/e2e/README.md`):**
- Match logic only in `src/shared/talk-engine.ts`
- Server `incomingTalksMap` authoritative; browser uses `GET /api/incoming-talks`
- `E2E_GUN_MEMORY_ONLY=1` — in-memory Gun; `clearGunDatabases()` between suites
- Prefer durable assertions (`#status-bar-text`, `.conversation-list-item`) over ephemeral toasts

---

## 3. Test environment

### 3.1 E2E stack
- **Server:** `dist/server/server/index.js` on `8080` (+ worker offset)
- **Web:** webpack dev server on `3001` (+ worker offset)
- **Browsers:** Chromium; multi-browser specs use 2–3 launches or context grids (up to 25 contexts in `00k`)

### 3.2 Environment variables
| Variable | Effect |
|----------|--------|
| `PW_WORKERS` / `PW_WORKER` | Parallel worker count (default 1) |
| `E2E_INTERVAL=long` | Longer Gun/UI waits |
| `PW_SLOW_MO=500` | Slow motion for debugging |
| `IINPUBLIC_STAGE_SEED` | Dev stage seeds (`npm run dev:stage-user1`, etc.) |

### 3.3 Health gate
`npm run health` — typecheck, lint, unit, integration, web + server build — run before full E2E when validating a release.

---

## 4. E2E Playwright catalog (70 tests)

### 4.0 Quick index

| Group | Tests | Slowest (2026-05-16) |
|-------|------:|----------------------|
| Smoke, login, travel, mobile, location | 6 | 19.4s |
| Headcount, capacity, regional spread | 5 | 2.0m (`00k`) |
| HTTP API (no browser) | 3 | 6.3s |
| UI shell, navigation, statistics strip | 6 | 12.1s |
| Chatroom UX, hierarchy, peer detail | 13 | 59.5s |
| Profile, privacy, Me filters | 3 | 1.6m |
| Talks editor, tags, super-user copy | 3 | 1.5m |
| Broadcast and cancellation | 4 | 3.0m (`00d`) |
| Messaging and unread badges | 4 | 1.3m |
| Blocking and delivery | 2 | 1.9m |
| Reputation and age-gating | 4 | 1.5m |
| Contacts and relationships | 3 | 1.6m |
| Survey analytics dashboard | 1 | 1.5m |
| Talks matching (multi-browser) | 14 | 1.7m |
| Offline and reconnect | 1 | 49.3s |

**Files:** `tests/e2e/<name>.spec.ts` + optional `<name>.md` · **Helpers:** `tests/e2e/helpers/`

### 4.1 Running tests and refreshing durations

```bash
# Full suite (builds server first)
npm run health && PW_WORKERS=15 npm run test:e2e

# Capture per-test durations into junit log (refresh §4.2 table)
PW_WORKERS=15 npx playwright test --reporter=junit,line 2>&1 | tee /tmp/pw-e2e-run.log
# Parse: grep 'testcase name=' /tmp/pw-e2e-run.log

# Subset
npx playwright test tests/e2e/talks-matching
npx playwright test tests/e2e/00h-chatroom-hierarchy-broadcast.spec.ts
```

**Report:** `npx playwright show-report`

**Extension template:** When adding a test, create `tests/e2e/staged/<stage-folder>/<spec>.md`, add a row to §4.2 after a timed run, and fill **Notes** / FR links in §4.3.

### 4.4 Staged network pipeline (by user count)

Specs live under `tests/e2e/staged/`, sorted by **maximum concurrent users**. The first account on an empty database is always **TechSupport** (not Tom/Adam). Sequential pipeline mode accumulates Gun state across stages; parallel mode (`npm run test:e2e`) still clears Gun per file via `maybeClearGunDatabases()`.

| Stage | Folder | Users | Load snapshot | Save snapshot | Canonical users |
|------:|--------|------:|---------------|---------------|-----------------|
| 0 | `stage0-bootstrap/` | 1 | _(empty DB)_ | `stage0` | TechSupport bootstrapped |
| 1 | `stage1-single-user/` | 1 | `stage0` | `stage1` | TechSupport runs singles |
| 2 | `stage2-two-user/` | 2 | `stage1` | `stage2` | + **Adam** (talk exchange seed in `aaa-stage2-adam-joins`) |
| 3 | `stage3-three-user/` | 3 | `stage2` | `stage3` | + **Eve** (`aaa-stage3-eve-joins`) |
| 4 | `stage4-four-user/` | 4 | `stage3` | `stage4` | capacity / eviction |
| 5 | `stage5-multi-user/` | 5+ | `stage4` | `stage5` | 25-context spread, 8-context scroll, super-user 20 |

```bash
# Parallel regression (70 tests, isolated Gun per file)
npm run test:e2e

# Sequential stage pipeline (builds stage0→stage5 snapshots on worker 0)
npm run test:e2e:staged
```

**Snapshots:** `tests/e2e/staged/snapshots/worker-{N}/stage{N}.json` (Gun graph + server maps via `GET/POST /api/test/export-snapshot` / `import-snapshot`).

**Per-action status checks (hard assertions):**

| Check | Selector / API | When |
|-------|----------------|------|
| Room context | `#status-bar-text` contains room name | After travel / join |
| Match count | `#status-bar-text` · N matches | After talk exchange |
| Nav tab | `.nav-btn[data-view="…"].active` | After navigation |
| Stage name | `[data-testid="user-stage-name"]` | After login / rename |
| Headcount | `.chatroom-item[data-chatroom-id]` text | List + detail |
| Conversations | `localStorage.myConversations` keys | After match |
| Incoming talk | `GET /api/users/:id/incoming-talks` | Delivery paths |

Use `helpers/e2e-status-checks.ts` → `assertStatusChecks(page, checks[])`.

**Toasts (soft, non-blocking):** `helpers/soft-toast.ts` → `expectToastSoft(page, /match/i)` logs a warning if the `.notification` node is missing or already dismissed (parallel timing). Do **not** use toast visibility as the only pass/fail signal; pair with `#status-bar-text` or conversation list.

**Stage-only specs** (`aaa-*`, `zzz-save-*`, `stage0-bootstrap`) run only when `E2E_STAGE_PIPELINE=1`; parallel `npm run test:e2e` ignores them via `playwright.config.ts` `testIgnore`.

### 4.2 Optimal parallel run order (slowest first)

Playwright schedules files in **lexicographic path order** by default. For `PW_WORKERS=15`, starting the slowest specs first reduces tail latency. Target file renames or `test.describe.configure({ order: ... })` if you adopt this order in CI.

| Run # | Duration | Spec | Test |
|------:|---------:|------|------|
| 1 | 3.0m (179s) | `00d-super-user-20-broadcast.spec.ts` | Super user: 20 talks completed by Tom › TechSupport creates 10 tags +… |
| 2 | 2.0m (120s) | `00-broadcast-abort-clear-all.spec.ts` | Broadcast cancellation — clear all mid-flight › broadcast cancellatio… |
| 3 | 2.0m (120s) | `00k-capacity-regional-spread.spec.ts` | Capacity regional spread › fills global, all continental rooms, USA, … |
| 4 | 1.9m (115s) | `15a-blocking-unblock-resumes-talk-delivery.spec.ts` | Blocking system — unblock resumes talk delivery › unblock resumes tal… |
| 5 | 1.7m (102s) | `talks-matching/02-two-talks-status-answers.spec.ts` | Talks matching — two talks, status bar, answers tab › Tennis+Coffee: … |
| 6 | 1.7m (100s) | `talks-matching/14-exact-chatbot-memory.spec.ts` | Talks matching — exact chatbot Q/A memory › asks Tom when no exact op… |
| 7 | 1.7m (99s) | `talks-matching/05-partial-auto-answers.spec.ts` | Talks matching — partial auto-answers (flattened context) › Jerry fin… |
| 8 | 1.6m (97s) | `06-contacts-tab.spec.ts` | Contacts tab: list of users with matches, click to see matching talks… |
| 9 | 1.6m (94s) | `13-me-filters-credit.spec.ts` | Me tab filters and credit visibility › Me filters hide disallowed tal… |
| 10 | 1.5m (91s) | `00i-survey-analytics-dashboard.spec.ts` | Survey analytics dashboard › creator sees dashboard sections, can exp… |
| 11 | 1.5m (90s) | `07-tags-checkbox.spec.ts` | Tag: create tag, answer with checkbox (match/ignore) › Alice creates … |
| 12 | 1.5m (90s) | `21a-reputation-block-count.spec.ts` | Reputation system — block count propagation › block/unblock propagate… |
| 13 | 1.5m (89s) | `00-broadcast-deletion-mid-broadcast.spec.ts` | Broadcast cancellation — talk deletion mid-flight › talk deletion by … |
| 14 | 1.3m (78s) | `00f-ux-contacts-talks-answers.spec.ts` | UX polish: contacts, talks navigation, and answers details › contacts… |
| 15 | 1.3m (78s) | `talks-matching/03-chatbot-bot-badge.spec.ts` | Talks matching — chatbot + bot badge › Tom manual match, Bob bot matc… |
| 16 | 1.3m (75s) | `00j-messaging-edge-cases.spec.ts` | Messaging edge cases › messaging works after unblock |
| 17 | 1.2m (74s) | `21b-reputation-peer-star-rating.spec.ts` | Reputation system — peer star rating › submit peer star rating update… |
| 18 | 1.2m (74s) | `08-super-user-copy-talk.spec.ts` | Super user: copy talk broadcast toggle + delete › Copy talk: receive … |
| 19 | 1.2m (70s) | `15b-blocking-stops-delivery-and-peer-visibility.spec.ts` | Blocking system — block stops delivery › block stops delivery and hid… |
| 20 | 1.2m (70s) | `talks-matching/12-two-responders-partial-match.spec.ts` | Talks matching — one match one mismatch from two responders › Jerry m… |
| 21 | 1.1m (65s) | `00j-messaging-edge-cases.spec.ts` | Messaging edge cases › conversation can be reopened after page reopen… |
| 22 | 1.1m (65s) | `00-broadcast-boundary-match.spec.ts` | Broadcast — chatroom boundary matching › talk matching still works ac… |
| 23 | 1.1m (65s) | `10-message-unread-badge.spec.ts` | Unread badge on Me tab after match and new message › Unread badge app… |
| 24 | 1.1m (64s) | `09-messaging.spec.ts` | Direct messaging between matched users › Tom and Jerry match on talk,… |
| 25 | 1.0m (60s) | `14-contacts-relationship-credit.spec.ts` | Contacts relationship dialog › Contact relationship settings persist … |
| 26 | 59.5s | `00l-chatroom-talks-ui-regressions.spec.ts` | Chatrooms and Talks UI regressions › Talks rows expose new/answered a… |
| 27 | 56.9s | `00e-chatroom-peer-detail.spec.ts` | Chatroom peer detail views › peer detail shows talk history after a t… |
| 28 | 56.9s | `21c-reputation-vouch-threshold.spec.ts` | Reputation system — vouch threshold › vouch votes accumulate to thres… |
| 29 | 55.4s | `00l-chatroom-talks-ui-regressions.spec.ts` | Chatrooms and Talks UI regressions › Ignored incoming talks do not co… |
| 30 | 52.4s | `talks-matching/13-tag-reopen-mismatch-then-match.spec.ts` | Talks matching — tag answer removed from IN › Tom ignores tag (unchec… |
| 31 | 52.3s | `talks-matching/04-ignore-then-change-answer.spec.ts` | Talks matching — answered incoming leaves IN › Jerry answers No and t… |
| 32 | 51.3s | `24-profile-privacy-visibility.spec.ts` | Profile privacy visibility › hides contacts_only/private profile rows… |
| 33 | 51.3s | `00h-chatroom-hierarchy-broadcast.spec.ts` | Chatroom hierarchy navigation and regional broadcast › Global → North… |
| 34 | 51.3s | `talks-matching/11-mismatch-no-match.spec.ts` | Talks matching — mismatch path yields no match › Jerry picks the igno… |
| 35 | 50.4s | `00g-age-gating.spec.ts` | Age-gating — adult talk blocked for unverified user › age-verified Je… |
| 36 | 49.8s | `talks-matching/01-tennis-jerry-match.spec.ts` | Talks matching — tennis, Jerry match › Tom sends Tennis Partner, Jerr… |
| 37 | 49.3s | `26-offline-reconnect-incoming-sync.spec.ts` | Reconnect recovery › incoming talk sync recovers after offline/online… |
| 38 | 45.7s | `talks-matching/09-four-types-chatbot.spec.ts` | Talks matching — four talk types, Jerry chatbot auto-replies Sam › To… |
| 39 | 42.8s | `13-chatroom-scroll-and-broadcast-bar.spec.ts` | Chatroom UX: member list scroll and unified broadcast bar › chatroom … |
| 40 | 36.7s | `00e-chatroom-peer-detail.spec.ts` | Chatroom peer detail views › Send My Talks auto mode sends unsent tal… |
| 41 | 28.1s | `00h-chatroom-hierarchy-broadcast.spec.ts` | Chatroom hierarchy navigation and regional broadcast › Broadcaster on… |
| 42 | 21.4s | `02-multi-user-headcount.spec.ts` | Multi-user headcount (3 users: FIFO exit, random re-enter) › Three us… |
| 43 | 21.2s | `04-profile-edit-stage-name.spec.ts` | Profile foundation › New user edits stage name and public profile, th… |
| 44 | 19.4s | `18-travel-mode-single-room.spec.ts` | Chatrooms — hierarchy travel and return home › user can travel Global… |
| 45 | 16.9s | `03-capacity-eviction.spec.ts` | Capacity and eviction › Four users: Global fills to 3, fourth bumps f… |
| 46 | 15.3s | `28-stage-zero-n2n.spec.ts` | Stage zero N2N smoke › stage zero Adam configures profile, creates fo… |
| 47 | 14.1s | `00e-chatroom-peer-detail.spec.ts` | Chatroom peer detail views › Send My Talks manual mode shows picker m… |
| 48 | 12.1s | `00-statistics-dashboard.spec.ts` | Statistics dashboard › shows aggregate talk, chatroom, peer, and sour… |
| 49 | 12.0s | `00e-chatroom-peer-detail.spec.ts` | Chatroom peer detail views › member list shows Stranger status for un… |
| 50 | 10.7s | `01-login-two-users-headcount.spec.ts` | Login — two users headcount › Two users: headcount 1→2→1→2 and one ro… |
| 51 | 10.2s | `00l-chatroom-talks-ui-regressions.spec.ts` | Chatrooms and Talks UI regressions › chatroom headcounts keep updatin… |
| 52 | 9.5s | `00e-chatroom-peer-detail.spec.ts` | Chatroom peer detail views › clicking a chatroom member opens the pee… |
| 53 | 7.9s | `05-talks-edit.spec.ts` | Talks: create and edit › Create talk, Talks tab shows it with Edit; E… |
| 54 | 7.5s | `talks-matching/06-survey-customer-satisfaction.spec.ts` | Talks matching — survey customer satisfaction (multi-browser) › compa… |
| 55 | 7.5s | `talks-matching/08-route-job-seeking.spec.ts` | Talks matching — job seeker route (multi-browser) › company creates r… |
| 56 | 7.5s | `talks-matching/07-survey-restaurants.spec.ts` | Talks matching — restaurant survey (multi-browser) › company creates … |
| 57 | 7.4s | `talks-matching/10-stats-four-types.spec.ts` | Talks matching — generic stats across four talk types (STAT-01) › 4 t… |
| 58 | 7.2s | `00l-chatroom-talks-ui-regressions.spec.ts` | Chatrooms and Talks UI regressions › first Chatrooms screen hydrates … |
| 59 | 7.2s | `01-login-single-user-headcount.spec.ts` | Login — single user headcount › Single user: login, headcount 1, exit… |
| 60 | 6.3s | `17-chatroom-custom-business-api.spec.ts` | Chatroom custom/business API scripts › members add/remove endpoints a… |
| 61 | 5.4s | `00-ui-navigation-settings.spec.ts` | UI navigation and settings shell › bottom navigation exposes Chatroom… |
| 62 | 4.0s | `00h-chatroom-hierarchy-broadcast.spec.ts` | Chatroom hierarchy navigation and regional broadcast › Navigate Europ… |
| 63 | 3.0s | `00-ui-navigation-settings.spec.ts` | UI navigation and settings shell › auto-copy keeps answered talks in … |
| 64 | 2.8s | `25-mobile-viewport-navigation.spec.ts` | Mobile viewport navigation › bottom navigation and primary panels fit… |
| 65 | 2.7s | `27-location-auto-assignment.spec.ts` | Location-based chatroom assignment › explicit location refresh moves … |
| 66 | 2.4s | `00-ui-navigation-settings.spec.ts` | UI navigation and settings shell › custom room creation opens the new… |
| 67 | 1.8s | `00-ui-navigation-settings.spec.ts` | UI navigation and settings shell › settings tolerates legacy string-v… |
| 68 | 1.5s | `00-ui-navigation-settings.spec.ts` | UI navigation and settings shell › broadcast history suppresses uncha… |
| 69 | 0.3s | `17-chatroom-custom-business-api.spec.ts` | Chatroom custom/business API scripts › custom chatroom create validat… |
| 70 | 0.3s | `17-chatroom-custom-business-api.spec.ts` | Chatroom custom/business API scripts › business chatroom create retur… |

**Suite metrics (2026-05-16):** `PW_WORKERS=15` → **70 passed**, wall clock **~5.1 min**; sum of per-test durations **~54.3 min** (parallel overlap).

### 4.3 Catalog by feature area (documentation order)

#### Smoke, login, travel, mobile, location (6)

##### E2E-001 — Chatrooms — hierarchy travel and return home › user can travel Global to San Diego, London back to Global, then return home to San Diego

| Field | Value |
|-------|-------|
| **Spec** | `18-travel-mode-single-room.spec.ts` |
| **Companion doc** | `tests/e2e/18-travel-mode-single-room.md` |
| **Duration** | 19.4s (`19449` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #44 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **User starts in Global** and sees Global headcount `1`.

**Steps / assertions:**
- **User starts in Global** and sees Global headcount `1`.
- **Travel mode is enabled** and a "Return Home" control appears.
- **User travels to North America** by selecting that chatroom.
- **Current room check:** Chatroom list marks North America as current room.
- **User clicks Return Home** to go back to Global.
- **Status bar check:** Stable status text confirms the user is back in Global.

##### E2E-002 — Stage zero N2N smoke › stage zero Adam configures profile, creates four talks, travels home to San Diego, and persists room on login

| Field | Value |
|-------|-------|
| **Spec** | `28-stage-zero-n2n.spec.ts` |
| **Companion doc** | _none — add `.md` when extending_ |
| **Duration** | 15.3s (`15267` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #46 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-003 — Login — two users headcount › Two users: headcount 1→2→1→2 and one room navigation

| Field | Value |
|-------|-------|
| **Spec** | `01-login-two-users-headcount.spec.ts` |
| **Companion doc** | `tests/e2e/01-login-two-users-headcount.md` |
| **Duration** | 10.7s (`10728` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #50 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Multi-user headcount, chatroom switching, headcount updates on join/leave, persistence across re-login, screenshots

**Steps / assertions:**
- **Setup:** Two browsers are launched. Databases are cleared. Two browser contexts and pages are created with IndexedDB cleared.
- **User 1 logs in:** Headcount for "Global" chatroom shows `1`. Screenshot saved.
- **User 2 logs in:** Headcount on BOTH browsers updates to show `2` in the "Global" chatroom. Screenshot saved. This confirms real-time headcount sync via Gun.js.
- **User 2 exits:** User 2 calls `manualCleanup()`, waits, closes the page. After sync, User 1's headcount drops back to `1`.
- **User 2 re-logs in (same session):** A new page opens in User 2's context. Headcount on both browsers goes back to `2`. This persists User 2's identity.
- **User 2 clicks into "North America" room:** Global headcount drops back to `1` on User 1's browser (User 2 left the room). "North America" room shows `1`. User 2 sees the "back to chatrooms" button and clicks it.
- **Why this matters:** Verifies that chatroom headcounts correctly reflect users joining and leaving rooms in real-time, and that user identities persist across page close/reopen.

##### E2E-004 — Login — single user headcount › Single user: login, headcount 1, exit, re-login persists

| Field | Value |
|-------|-------|
| **Spec** | `01-login-single-user-headcount.spec.ts` |
| **Companion doc** | `tests/e2e/01-login-single-user-headcount.md` |
| **Duration** | 7.2s (`7216` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #59 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** User login, headcount display, session persistence, browser tab labels, screenshots

**Steps / assertions:**
- **Setup:** Databases are cleared. A browser is launched and a page context is created with IndexedDB cleared (`injectIdbClear`).
- **User logs in:** The user navigates to the app root URL and waits for the page to fully load with Gun sync.
- **Verification — Headcount shows "1":** The "Global" chatroom headcount indicator shows `1`, confirming the new user is counted. A full-page screenshot is saved.
- **User exits:** `manualCleanup()` is called and the page is closed.
- **User re-logs in (same session):** A new page is opened in the same browser context and navigates to the app. After Gun sync, the headcount shows `1` again — the user's identity persisted across page close/reopen. Another screenshot is saved.
- **Why this matters:** Verifies that user sessions persist (via IndexedDB) so that closing and reopening a tab re-connects the same user with the correct headcount.

##### E2E-005 — Mobile viewport navigation › bottom navigation and primary panels fit a phone viewport

| Field | Value |
|-------|-------|
| **Spec** | `25-mobile-viewport-navigation.spec.ts` |
| **Companion doc** | `tests/e2e/25-mobile-viewport-navigation.md` |
| **Duration** | 2.8s (`2780` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #64 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Opens the app at a 390x844 mobile viewport.

**Steps / assertions:**
- Opens the app at a 390x844 mobile viewport.
- Visits Chatrooms, Contacts, Talks, Answers, and Me from the bottom nav.
- Verifies each primary panel is visible.
- Verifies the document does not horizontally overflow the phone viewport.

##### E2E-006 — Location-based chatroom assignment › explicit location refresh moves the user to the blurred regional chatroom

| Field | Value |
|-------|-------|
| **Spec** | `27-location-auto-assignment.spec.ts` |
| **Companion doc** | `tests/e2e/27-location-auto-assignment.md` |
| **Duration** | 2.7s (`2691` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #65 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Starts the app with the default test location, which places the new user in Global.

**Steps / assertions:**
- Starts the app with the default test location, which places the new user in Global.
- Mocks browser geolocation to New York City.
- Triggers the app's location-refresh event.
- Verifies the current chatroom changes to the blurred regional room `region_40.71_-74.01_room_0`.

#### Headcount, capacity, regional spread (5)

##### E2E-007 — Capacity regional spread › fills global, all continental rooms, USA, and creates blurred regional rooms

| Field | Value |
|-------|-------|
| **Spec** | `00k-capacity-regional-spread.spec.ts` |
| **Companion doc** | _none — add `.md` when extending_ |
| **Duration** | 2.0m (120s) (`119500` ms) |
| **Browsers** | 1 browser × 25 contexts |
| **Parallel run rank** | #3 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-008 — Multi-user headcount (3 users: FIFO exit, random re-enter) › Three users enter sequentially, exit FIFO, re-enter random order

| Field | Value |
|-------|-------|
| **Spec** | `02-multi-user-headcount.spec.ts` |
| **Companion doc** | `tests/e2e/02-multi-user-headcount.md` |
| **Duration** | 21.4s (`21350` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #42 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Multi-user headcount (3 users), FIFO exit, storage state persistence, random re-entry order, real-time sync

**Steps / assertions:**
- **Setup:** Three browsers are launched at positions (0,0), (640,0), (1280,0). Databases are cleared.
- **User 1 enters:** Headcount in "Global" chatroom shows `1` on User 1's browser.
- **User 2 enters:** Headcount updates to `2` on BOTH User 1's and User 2's browsers.
- **User 3 enters:** Headcount updates to `3` on ALL three browsers.
- **User 1 exits (FIFO):** User 1 calls `manualCleanup()`, saves storage state to JSON, closes page + context. After sync, the remaining browsers (User 2, User 3) see headcount drop to `2`.
- **User 2 exits:** Same pattern — saves storage state, closes. User 3 sees headcount drop to `1`.
- **User 3 exits:** Same pattern. Room is now empty.
- **Users re-enter in random order (User 2, then User 3, then User 1):** Each re-logs in using saved storage states. Headcounts update correctly: User 2 enters (1), User 3 joins (2), User 1 joins (3). All three see headcount of `3`.

##### E2E-009 — Capacity and eviction › Four users: Global fills to 3, fourth bumps first to North America; persistence after re-enter

| Field | Value |
|-------|-------|
| **Spec** | `03-capacity-eviction.spec.ts` |
| **Companion doc** | `tests/e2e/03-capacity-eviction.md` |
| **Duration** | 16.9s (`16927` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #45 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Chatroom capacity limit, FIFO eviction, room reassignment persistence, multi-browser (4 browsers), storage state restore

**Steps / assertions:**
- **Setup:** Four browsers are launched. Databases are cleared. All users navigate with URL params `e2e_capacity=3&e2e_fifo=true` to enforce a max capacity of 3 users in Global and FIFO eviction enabled.
- **User 1 enters:** Joins Global chatroom.
- **User 2 enters:** Joins Global chatroom.
- **User 3 enters:** Joins Global chatroom. Headcount shows `3` — room is now at capacity.
- **User 4 enters:** This triggers FIFO eviction — User 1 (who was first to join) is bumped from Global and automatically reassigned to the "North America" room. User 1's status bar confirms "North America".
- **All four users save their storage state, call cleanup, and close.**
- **Phase 2 — All four re-enter with saved storage states:** User 1 re-enters and is persistently placed back in "North America" (not Global). Users 2, 3, 4 re-enter and land in "Global". Status bars are verified for each user.
- **Why this matters:** Verifies that chatroom capacity limits (FIFO eviction) work correctly and that room reassignment persists across browser close/reopen — eviction decisions survive page reloads.

##### E2E-010 — Chatrooms and Talks UI regressions › chatroom headcounts keep updating across room switches and Return Home refreshes the open detail view

| Field | Value |
|-------|-------|
| **Spec** | `00l-chatroom-talks-ui-regressions.spec.ts` |
| **Companion doc** | _none — add `.md` when extending_ |
| **Duration** | 10.2s (`10232` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #51 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-011 — Chatrooms and Talks UI regressions › first Chatrooms screen hydrates existing room headcounts before entering detail

| Field | Value |
|-------|-------|
| **Spec** | `00l-chatroom-talks-ui-regressions.spec.ts` |
| **Companion doc** | _none — add `.md` when extending_ |
| **Duration** | 7.2s (`7221` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #58 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

#### HTTP API (no browser) (3)

##### E2E-012 — Chatroom custom/business API scripts › members add/remove endpoints accept valid payloads and reject invalid payloads

| Field | Value |
|-------|-------|
| **Spec** | `17-chatroom-custom-business-api.spec.ts` |
| **Companion doc** | `tests/e2e/17-chatroom-custom-business-api.md` |
| **Duration** | 6.3s (`6279` ms) |
| **Browsers** | API only (request fixture) |
| **Parallel run rank** | #60 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-013 — Chatroom custom/business API scripts › custom chatroom create validates required fields and returns metadata

| Field | Value |
|-------|-------|
| **Spec** | `17-chatroom-custom-business-api.spec.ts` |
| **Companion doc** | `tests/e2e/17-chatroom-custom-business-api.md` |
| **Duration** | 0.3s (`258` ms) |
| **Browsers** | API only (request fixture) |
| **Parallel run rank** | #69 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-014 — Chatroom custom/business API scripts › business chatroom create returns business metadata

| Field | Value |
|-------|-------|
| **Spec** | `17-chatroom-custom-business-api.spec.ts` |
| **Companion doc** | `tests/e2e/17-chatroom-custom-business-api.md` |
| **Duration** | 0.3s (`255` ms) |
| **Browsers** | API only (request fixture) |
| **Parallel run rank** | #70 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

#### UI shell, navigation, statistics strip (6)

##### E2E-015 — Statistics dashboard › shows aggregate talk, chatroom, peer, and source-of-truth stats

| Field | Value |
|-------|-------|
| **Spec** | `00-statistics-dashboard.spec.ts` |
| **Companion doc** | `tests/e2e/00-statistics-dashboard.md` |
| **Duration** | 12.1s (`12071` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #48 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-016 — UI navigation and settings shell › bottom navigation exposes Chatrooms, Contacts, Talks, Me, Settings only

| Field | Value |
|-------|-------|
| **Spec** | `00-ui-navigation-settings.spec.ts` |
| **Companion doc** | _none — add `.md` when extending_ |
| **Duration** | 5.4s (`5366` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #61 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-017 — UI navigation and settings shell › auto-copy keeps answered talks in OUT and stores flat answer history

| Field | Value |
|-------|-------|
| **Spec** | `00-ui-navigation-settings.spec.ts` |
| **Companion doc** | _none — add `.md` when extending_ |
| **Duration** | 3.0s (`3026` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #63 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-018 — UI navigation and settings shell › custom room creation opens the newly created room

| Field | Value |
|-------|-------|
| **Spec** | `00-ui-navigation-settings.spec.ts` |
| **Companion doc** | _none — add `.md` when extending_ |
| **Duration** | 2.4s (`2416` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #66 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-019 — UI navigation and settings shell › settings tolerates legacy string-valued profile and filter fields

| Field | Value |
|-------|-------|
| **Spec** | `00-ui-navigation-settings.spec.ts` |
| **Companion doc** | _none — add `.md` when extending_ |
| **Duration** | 1.8s (`1786` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #67 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-020 — UI navigation and settings shell › broadcast history suppresses unchanged repeat room sends

| Field | Value |
|-------|-------|
| **Spec** | `00-ui-navigation-settings.spec.ts` |
| **Companion doc** | _none — add `.md` when extending_ |
| **Duration** | 1.5s (`1491` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #68 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

#### Chatroom UX, hierarchy, peer detail (11)

##### E2E-021 — Chatrooms and Talks UI regressions › Talks rows expose new/answered and broadcasting states without redundant edit controls

| Field | Value |
|-------|-------|
| **Spec** | `00l-chatroom-talks-ui-regressions.spec.ts` |
| **Companion doc** | _none — add `.md` when extending_ |
| **Duration** | 59.5s (`59519` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #26 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-022 — Chatroom peer detail views › peer detail shows talk history after a talk exchange

| Field | Value |
|-------|-------|
| **Spec** | `00e-chatroom-peer-detail.spec.ts` |
| **Companion doc** | `tests/e2e/00e-chatroom-peer-detail.md` |
| **Duration** | 56.9s (`56946` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #27 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Chatroom member list, Stranger status, peer detail overlay, talk history with sort/filter, Send My Talks auto mode, Send My Talks manual mode picker, multi-browser

##### E2E-023 — Chatrooms and Talks UI regressions › Ignored incoming talks do not copy and old talks open without an Edit button

| Field | Value |
|-------|-------|
| **Spec** | `00l-chatroom-talks-ui-regressions.spec.ts` |
| **Companion doc** | _none — add `.md` when extending_ |
| **Duration** | 55.4s (`55406` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #29 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-024 — Chatroom hierarchy navigation and regional broadcast › Global → North America → United States; broadcast in country room reaches peer

| Field | Value |
|-------|-------|
| **Spec** | `00h-chatroom-hierarchy-broadcast.spec.ts` |
| **Companion doc** | `tests/e2e/00h-chatroom-hierarchy-broadcast.md` |
| **Duration** | 51.3s (`51331` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #33 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-025 — Chatroom UX: member list scroll and unified broadcast bar › chatroom detail keeps one broadcast action and the member list can scroll

| Field | Value |
|-------|-------|
| **Spec** | `13-chatroom-scroll-and-broadcast-bar.spec.ts` |
| **Companion doc** | `tests/e2e/13-chatroom-scroll-and-broadcast-bar.md` |
| **Duration** | 42.8s (`42766` ms) |
| **Browsers** | 1 browser × 8 contexts (Owner + 7 peers) |
| **Parallel run rank** | #39 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Chatroom member list scrolling, unified broadcast button, status bar broadcast text, viewport overflow

**Steps / assertions:**
- **Setup:** Single browser. An "Owner" user and 7 "Peer" users all log in with a compact viewport (640x540) and enter the Global chatroom.
- **Verification — 7 member items** appear in the chatroom member list.
- **Verification — Only 1 broadcast button** exists (not duplicated).
- **Verification — Status bar** says "Broadcast to everyone in this room". The old text "Broadcast talk to everyone here" does NOT appear (zero count).
- **Verification — Member list is scrollable:** The `scrollHeight` is greater than `clientHeight`, and scrolling to the bottom actually changes `scrollTop`.
- **Why this matters:** Verifies that chatroom detail UI has a single unified broadcast action, no duplicate buttons, and the member list scrolls when it overflows (important for UX on small viewports).

##### E2E-026 — Chatroom peer detail views › Send My Talks auto mode sends unsent talks to peer

| Field | Value |
|-------|-------|
| **Spec** | `00e-chatroom-peer-detail.spec.ts` |
| **Companion doc** | `tests/e2e/00e-chatroom-peer-detail.md` |
| **Duration** | 36.7s (`36711` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #40 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Chatroom member list, Stranger status, peer detail overlay, talk history with sort/filter, Send My Talks auto mode, Send My Talks manual mode picker, multi-browser

##### E2E-027 — Chatroom hierarchy navigation and regional broadcast › Broadcaster on North America does not register inbox for peer joined only under United States

| Field | Value |
|-------|-------|
| **Spec** | `00h-chatroom-hierarchy-broadcast.spec.ts` |
| **Companion doc** | `tests/e2e/00h-chatroom-hierarchy-broadcast.md` |
| **Duration** | 28.1s (`28146` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #41 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-028 — Chatroom peer detail views › Send My Talks manual mode shows picker modal

| Field | Value |
|-------|-------|
| **Spec** | `00e-chatroom-peer-detail.spec.ts` |
| **Companion doc** | `tests/e2e/00e-chatroom-peer-detail.md` |
| **Duration** | 14.1s (`14140` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #47 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Chatroom member list, Stranger status, peer detail overlay, talk history with sort/filter, Send My Talks auto mode, Send My Talks manual mode picker, multi-browser

##### E2E-029 — Chatroom peer detail views › member list shows Stranger status for unknown user

| Field | Value |
|-------|-------|
| **Spec** | `00e-chatroom-peer-detail.spec.ts` |
| **Companion doc** | `tests/e2e/00e-chatroom-peer-detail.md` |
| **Duration** | 12.0s (`12042` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #49 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Chatroom member list, Stranger status, peer detail overlay, talk history with sort/filter, Send My Talks auto mode, Send My Talks manual mode picker, multi-browser

##### E2E-030 — Chatroom peer detail views › clicking a chatroom member opens the peer detail overlay

| Field | Value |
|-------|-------|
| **Spec** | `00e-chatroom-peer-detail.spec.ts` |
| **Companion doc** | `tests/e2e/00e-chatroom-peer-detail.md` |
| **Duration** | 9.5s (`9509` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #52 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Chatroom member list, Stranger status, peer detail overlay, talk history with sort/filter, Send My Talks auto mode, Send My Talks manual mode picker, multi-browser

##### E2E-031 — Chatroom hierarchy navigation and regional broadcast › Navigate Europe region and open Germany (hierarchy smoke)

| Field | Value |
|-------|-------|
| **Spec** | `00h-chatroom-hierarchy-broadcast.spec.ts` |
| **Companion doc** | `tests/e2e/00h-chatroom-hierarchy-broadcast.md` |
| **Duration** | 4.0s (`4050` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #62 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

#### Profile, privacy, Me filters (3)

##### E2E-032 — Me tab filters and credit visibility › Me filters hide disallowed talk types and preserve the credit visibility toggle

| Field | Value |
|-------|-------|
| **Spec** | `13-me-filters-credit.spec.ts` |
| **Companion doc** | `tests/e2e/13-me-filters-credit.md` |
| **Duration** | 1.6m (94s) (`94077` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #9 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Talk type filters (survey/flow), credit visibility toggle, filtered broadcast delivery, peer relationship modal

**Steps / assertions:**
- **Setup:** Three browsers (Tom, Jerry, Bob) launched. Tom and Jerry join Global chatroom.
- **Jerry adjusts Me tab settings:** Unchecks the "survey" talk type filter (so Jerry won't receive surveys) and unchecks "credit visibility" (hiding public credit). Navigates back and forth — settings persist.
- **Tom creates and broadcasts two talks:**
- **Verification — Server-side filtering:** Polls `/api/users/jerry/incoming-talks` — only "Filtered Flow Talk" arrives. The survey talk was filtered out server-side because Jerry disabled survey reception.
- **Verification — Jerry's Talks tab:** Shows only "Filtered Flow Talk". "Filtered Survey Talk" is absent. Jerry has exactly 1 incoming talk.
- **Jerry answers the flow talk with "Yes"** (match).
- **Verification — Credit visibility preserved in contact detail:** Tom opens his contacts, clicks Jerry, clicks "Edit Relationship" — the relationship modal shows "Public credit" text (the credit visibility setting is preserved and visible in the relationship dialog).
- **Why this matters:** Verifies that Me tab talk type filters work at the server level (not just UI filtering), credit visibility settings persist across navigation, and the relationship modal correctly reflects privacy settings.

##### E2E-033 — Profile privacy visibility › hides contacts_only/private profile rows from non-owner viewers

| Field | Value |
|-------|-------|
| **Spec** | `24-profile-privacy-visibility.spec.ts` |
| **Companion doc** | `tests/e2e/24-profile-privacy-visibility.md` |
| **Duration** | 51.3s (`51349` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #32 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom creates profile Q&A rows** with three visibility levels:

**Steps / assertions:**
- **Tom creates profile Q&A rows** with three visibility levels:
- **Two viewers are prepared:**
- **JerryNonContact opens Tom's peer detail:** should see only public Q&A.
- **JerryContact opens Tom's peer detail:** should see public + contacts-only Q&A.
- **Private Q&A remains hidden** for both non-owner viewers.

##### E2E-034 — Profile foundation › New user edits stage name and public profile, then peers can see it

| Field | Value |
|-------|-------|
| **Spec** | `04-profile-edit-stage-name.spec.ts` |
| **Companion doc** | `tests/e2e/04-profile-edit-stage-name.md` |
| **Duration** | 21.2s (`21191` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #43 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Stage name editing, public profile Q&A editing, profile persistence, server-side propagation, peer visibility of profile data, avatar setting, multi-browser

**Steps / assertions:**
- **Setup:** Two browsers launched (Tom's browser and Jerry's browser). Databases are cleared. Tom logs in with stage name "Tom".
- **Tom creates profile:** Tom edits stage name to "Tom", verifies the stage name appears in the UI header.
- **Tom edits public profile:** Clicks "Edit Profile", selects avatar emoji (😎), sets languages to "en, zh", adds two Q&A entries:
- **Verification — Profile displays on Tom's own page:** The profile section shows languages, Q&A entries, and the emoji avatar. The server API is polled to confirm the user object has `languages: [en, zh]` and `profile` array with 2 entries.
- **Jerry (peer) logs in, navigates to Global chatroom with Tom:** Jerry clicks on Tom's name in the chatroom member list. Tom's profile detail overlay opens for Jerry.
- **Verification — Jerry sees Tom's complete profile:** Jerry can see "Public Profile", "Languages: en, zh", "Favorite drink: Coffee", "Usual city: San Francisco", and the 😎 emoji avatar.
- **Why this matters:** Verifies that profile edits (stage name, avatar, languages, Q&A) persist to the server and are visible to other users viewing the profile — proving cross-user profile sync works.

#### Talks editor, tags, super-user copy (3)

##### E2E-035 — Tag: create tag, answer with checkbox (match/ignore) › Alice creates Coffee and Cat tags, sends to Tom; Tom answers Coffee checked, Cat unchecked; Alice confirms one match (Coffee)

| Field | Value |
|-------|-------|
| **Spec** | `07-tags-checkbox.spec.ts` |
| **Companion doc** | `tests/e2e/07-tags-checkbox.md` |
| **Duration** | 1.5m (90s) (`90041` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #11 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Tag-type talks, checkbox-based matching, broadcast of tags, match/mismatch outcomes, multi-browser

**Steps / assertions:**
- **Setup:** Two browsers — Alice and Tom — both log in and join "Global" chatroom. Databases are cleared.
- **Alice creates two tag-type talks:**
- **Alice broadcasts both tags** using the broadcast button with the tag preamble modal.
- **Server confirms Tom received the broadcast:** Polls `/api/users/tom/incoming-talks` until at least 1 incoming talk arrives.
- **Tom opens "Coffee" tag, checks the match checkbox, and submits** → Result: MATCH. Tom's status bar shows 1 match. Alice's status bar also confirms 1 match.
- **Tom opens "Cat" tag, leaves checkbox UNchecked, and submits** → Result: MISMATCH (ignored).
- **Alice verifies:** Opens the Talks tab — "Coffee" shows "Matched with: Tom". Status bar confirms "1 match".
- **Tom verifies Answers tab:** "Coffee" is marked as Match, "Cat" is marked as Mismatch.

##### E2E-036 — Super user: copy talk broadcast toggle + delete › Copy talk: receive saves automatically; disable filters broadcast; enable includes again; delete removes

| Field | Value |
|-------|-------|
| **Spec** | `08-super-user-copy-talk.spec.ts` |
| **Companion doc** | `tests/e2e/08-super-user-copy-talk.md` |
| **Duration** | 1.2m (74s) (`73650` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #18 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Copy talk feature, disable/enable broadcast toggle for copied talks, broadcast filtering, delete copied talk, multi-browser

**Steps / assertions:**
- **Setup:** Two browsers — TechSupport and Tom — both log in via `bootstrapSuperUser` and join "Global" chatroom.
- **TechSupport creates a flow-type talk** titled "CopyTestTalk" with the question "Want to connect for CopyTestTalk?" and two answers (match/ignore). Submits and broadcasts it.
- **Tom receives and answers the talk:** Tom opens the incoming talk, selects the matching answer ("Yes, lets play."), and the modal closes.
- **Tom copies the talk:** In the Answers tab, Tom clicks the "Copy Talk" button on "CopyTestTalk". Then in the Talks tab, the talk appears as a "copied" role item.
- **Tom disables broadcast for the copied talk:** Clicks the "Disable Broadcast" checkbox on the copied talk. Clicks Broadcast button — no talks are broadcast (the talk editor modal opens instead, which is cancelled).
- **Tom re-enables broadcast:** Unclicks the disable checkbox. Clicks Broadcast — this time the talk IS broadcast (confirms the toggle works correctly).
- **Tom deletes the copied talk:** Opens "Me" → "View My Talks", clicks delete on "CopyTestTalk". Verifies via polling that the talk is gone from the history (count = 0). Re-opens the my-talks modal to double-check.
- **Why this matters:** Verifies the copy-talk lifecycle: received talks can be copied, the broadcast toggle correctly includes/excludes copied talks from broadcast, and deletion removes them from the user's talk history.

##### E2E-037 — Talks: create and edit › Create talk, Talks tab shows it with Edit; Edit opens with prefilled data

| Field | Value |
|-------|-------|
| **Spec** | `05-talks-edit.spec.ts` |
| **Companion doc** | `tests/e2e/05-talks-edit.md` |
| **Duration** | 7.9s (`7862` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #53 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Talk creation, talk listing in Talks tab, edit talk with prefilled data, title update, flow-type talks

**Steps / assertions:**
- **Setup:** Single browser launched. Databases are cleared. User "EditTestUser" logs in and navigates to Chatrooms.
- **User creates a talk:** Clicks "Create Talk", fills in the talk editor:
- **Verification — Talks tab shows the talk:** The user clicks the Talks tab. The talk appears with its title, a "created" badge, and an "Edit" button.
- **User clicks Edit:** The talk editor modal opens with all data prefilled — the existing title, type, question, and answers are visible.
- **User edits the title** to "Coffee Meetup (Edited)" and saves.
- **Verification — Updated title appears in the list:** After sync, the talk in the list now shows the updated title.
- **Why this matters:** Verifies the complete talk CRUD cycle: creation, listing with badges, editing with prefilled data, and title updates persisting correctly.

#### Broadcast and cancellation (4)

##### E2E-038 — Super user: 20 talks completed by Tom › TechSupport creates 10 tags + 10 talks; Tom completes each through the app path; both verify 20 at end

| Field | Value |
|-------|-------|
| **Spec** | `00d-super-user-20-broadcast.spec.ts` |
| **Companion doc** | `tests/e2e/00d-super-user-20-broadcast.md` |
| **Duration** | 3.0m (179s) (`178804` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #1 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Bulk talk creation via super user/companyp page, large-scale broadcast (20 talks), bulk completion by responder, status bar verification, incoming-talks API count, localStorage ledger verification

**Steps / assertions:**
- **Setup:** Two browsers — TechSupport and Tom — both log in via `bootstrapSuperUser` and join "Global" chatroom.
- **TechSupport creates 20 talks** using the company page demo (API-based creation):
- **Tom joins Global.** Waits for broadcast delivery. Polls the incoming-talks API to confirm Tom has received talks.
- **Tom completes all 20 talks** using `completeTalksInAppByAnswerIds` — each talk is opened and answered with the matching answer. Timeout extended to 120 seconds.
- **TechSupport end-of-flow verification:**
- **Tom end-of-flow verification:**
- **Why this matters:** Verifies the system handles 20 simultaneous broadcasts — creation, delivery, completion, and end-state verification all work correctly at this scale. Performance and data integrity under load.

##### E2E-039 — Broadcast cancellation — clear all mid-flight › broadcast cancellation/abortion skips remaining batches when creator clears all talks mid-flight

| Field | Value |
|-------|-------|
| **Spec** | `00-broadcast-abort-clear-all.spec.ts` |
| **Companion doc** | `tests/e2e/00-broadcast-abort-clear-all.md` |
| **Duration** | 2.0m (120s) (`119830` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #2 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Broadcast cancellation, clear-all-talks, register batch delay, multi-browser

**Steps / assertions:**
- **Setup:** Tom (stage name "Tom Abort") and Jerry (stage name "Jerry Abort") both log into separate browsers. Databases are cleared before starting.
- **Tom creates 10 talks** titled "Broadcast Abort Talk 1" through "Broadcast Abort Talk 10" using the `createSimpleFlowTalk` helper and navigates to the Chatrooms tab.
- **Tom clicks Broadcast** to send all 10 talks to the network. A network route intercepts the `register-receivers-for-broadcast` API calls — on the 5th registration request, a signal is sent and the request is delayed by 10 seconds.
- **Mid-flight, Tom clears ALL talks:** Once the signal fires, Tom navigates to "Me" → "View My Talks", clicks "Clear All Talks", confirms the dialog, and navigates back to Chatrooms.
- **Broadcast batch acknowledgment** is waited for via `waitForBroadcastBulkAckMinSent` (1 receiver, minSent may be 0 since talks were cleared).
- **Verification — Jerry should NOT receive the remaining talks (6-10):** The test polls Jerry's `/api/users/jerry/incoming-talks` endpoint and confirms that talks #6 and #10 were NOT delivered to Jerry. Since Tom cleared all talks mid-broadcast, the remaining batches were skipped.
- **Why this matters:** Ensures that when a creator cancels all talks while a broadcast is still propagating, remaining sends are skipped and recipients don't receive incomplete or cancelled talks.

##### E2E-040 — Broadcast cancellation — talk deletion mid-flight › talk deletion by creator mid-broadcast cancels remaining talk delivery

| Field | Value |
|-------|-------|
| **Spec** | `00-broadcast-deletion-mid-broadcast.spec.ts` |
| **Companion doc** | `tests/e2e/00-broadcast-deletion-mid-broadcast.md` |
| **Duration** | 1.5m (89s) (`88918` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #13 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Talk deletion during broadcast, register batch delay, partial broadcast cancellation, multi-browser

**Steps / assertions:**
- **Setup:** Tom (stage name "Tom DelCancel") and Jerry (stage name "Jerry DelCancel") both log into separate browsers. Databases are cleared before starting.
- **Tom creates 6 talks** titled "Deletion Cancel Talk 1" through "Deletion Cancel Talk 6" using `createSimpleFlowTalk` and navigates to the Chatrooms tab.
- **Tom broadcasts all 6 talks.** A network route intercepts the `register-receivers-for-broadcast` API calls — on the 5th registration request, a signal is triggered and the request is delayed by 10 seconds.
- **Mid-flight, Tom deletes the LAST talk (Talk #6):** Once the signal fires, Tom navigates to "Me" → "View My Talks", and deletes only talk #6. Then navigates back to Chatrooms.
- **Broadcast acknowledgment waited for** via `waitForBroadcastBulkAckMinSent` (1 receiver, minSent 1 — meaning at least 1 of the surviving 5 talks should be delivered).
- **Verification — Jerry receives talks 1-5 but NOT talk #6:** Jerry's `/api/users/jerry/incoming-talks` confirms that "Deletion Cancel Talk 5" appeared, but "Deletion Cancel Talk 6" was never delivered because Tom deleted it mid-broadcast.
- **Why this matters:** Verifies that individual talk deletion mid-broadcast cancels only that specific talk's delivery — other talks in the same broadcast batch still propagate correctly.

##### E2E-041 — Broadcast — chatroom boundary matching › talk matching still works across chatroom boundaries (answer after switching rooms)

| Field | Value |
|-------|-------|
| **Spec** | `00-broadcast-boundary-match.spec.ts` |
| **Companion doc** | `tests/e2e/00-broadcast-boundary-match.md` |
| **Duration** | 1.1m (65s) (`65064` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #22 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Talk matching across chatroom boundaries, chatroom switching, incoming talk delivery

**Steps / assertions:**
- **Setup:** Tom (stage name "Tom Boundary") and Jerry (stage name "Jerry Boundary") both log into separate browsers via `bootstrapUser`. Databases are cleared before starting.
- **Tom creates a talk** titled "Boundary Match Talk" with two answer choices: "Yes, lets play." (matching) and "No thanks." (non-matching).
- **Tom broadcasts the talk.** Using `confirmBroadcastTagPreambleIfVisible` if the tag modal appears, and waits for the broadcast to be acknowledged with at least 1 receiver and 1 sent.
- **Jerry switches to a different chatroom:** Before answering Jerry navigates to Chatrooms and clicks into the "North America" room.
- **Jerry opens and answers the incoming talk:** Even though Jerry switched rooms, Jerry uses `openIncomingTalkModal` to find and open the incoming talk, then selects the matching answer ("Yes, lets play.").
- **Verification — Match is confirmed:** The status bar shows at least 1 match via `waitForStatusBarMatchCountAtLeast`. After the response modal closes, Jerry navigates to the "Me" tab and verifies Tom's conversation appears in the conversation list.
- **Why this matters:** Verifies that talk matching works correctly even if the responder switches chatrooms before answering — broadcasts cross chatroom boundaries properly.

#### Messaging and unread badges (4)

##### E2E-042 — Messaging edge cases › messaging works after unblock

| Field | Value |
|-------|-------|
| **Spec** | `00j-messaging-edge-cases.spec.ts` |
| **Companion doc** | `tests/e2e/00j-messaging-edge-cases.md` |
| **Duration** | 1.3m (75s) (`75451` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #16 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-043 — Messaging edge cases › conversation can be reopened after page reopen (same identity)

| Field | Value |
|-------|-------|
| **Spec** | `00j-messaging-edge-cases.spec.ts` |
| **Companion doc** | `tests/e2e/00j-messaging-edge-cases.md` |
| **Duration** | 1.1m (65s) (`65308` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #21 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

##### E2E-044 — Unread badge on Me tab after match and new message › Unread badge appears after match, clears on open; reappears after new message, clears on open

| Field | Value |
|-------|-------|
| **Spec** | `10-message-unread-badge.spec.ts` |
| **Companion doc** | `tests/e2e/10-message-unread-badge.md` |
| **Duration** | 1.1m (65s) (`64965` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #23 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Unread conversation badge lifecycle, notification badge on Me nav button, badge clear on conversation open, badge reappear on new message, multi-browser

**Steps / assertions:**
- **Setup:** Two browsers — Tom and Jerry — both log in and join "Global" chatroom.
- **Tom creates and broadcasts a talk** titled "E2E Unread Badge Tennis" with the same tennis question pattern. Jerry receives it and matches. Conversation entries are created for both.
- **Phase 1 — Unread badge appears for Jerry immediately after the new match:** Jerry navigates to the Me tab. The Me nav button shows a notification badge, and the conversation list item for Tom shows an unread-badge. (The match creates the conversation with `unread=true`.)
- **Phase 2 — Opening the conversation clears the badge:** Jerry clicks on Tom's conversation. The conversation overlay opens. Jerry clicks back. The notification badge on Jerry's Me button disappears.
- **Phase 3 — Tom sends a message while Jerry's overlay is closed:** Tom opens his conversation with Jerry and sends "Hey Jerry, first message!"
- **Phase 4 — Jerry's unread badge reappears:** The notification badge on Jerry's Me nav button and the conversation item unread-badge both appear again.
- **Phase 5 — Jerry opens the conversation again — badge clears:** Jerry clicks Tom's conversation, sees the new message, clicks back — notification badge disappears once more.
- **Why this matters:** Verifies the complete unread badge lifecycle: badge appears on new match → clears on open → reappears on new message → clears on open again. Proper unread state management.

##### E2E-045 — Direct messaging between matched users › Tom and Jerry match on talk, then exchange messages

| Field | Value |
|-------|-------|
| **Spec** | `09-messaging.spec.ts` |
| **Companion doc** | `tests/e2e/09-messaging.md` |
| **Duration** | 1.1m (64s) (`63759` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #24 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Talk matching triggering conversation creation, direct messaging between matched users, bidirectional message delivery, conversation overlay, multi-browser

**Steps / assertions:**
- **Setup:** Two browsers — Tom and Jerry — both log in and join "Global" chatroom. Test timeout is 420 seconds (7 minutes) due to long Gun sync waits.
- **Tom creates and broadcasts a talk** titled "Tennis Partner": "Want a tennis partner?" with match answer "Yes, lets play." and ignore answer "No thanks." Tom uses `clickBroadcastUntilBulkAck` helper to broadcast, then polls server to confirm Jerry received the incoming talk.
- **Jerry opens the incoming talk and matches** by selecting "Yes, lets play." After the match, conversation entries are created for both users (poll-localStorage for the other user's ID to appear as a conversation).
- **Tom opens conversation with Jerry** via `openConversation` helper, types "Hey Jerry, want to play tennis tomorrow?", and sends. Tom sees his own message appear.
- **Jerry opens conversation with Tom** and sees Tom's message arrive (polls until visible).
- **Jerry replies** with "Sounds great! Meet at the courts at 9am?" — Jerry sees the reply, and Tom (still on his conversation overlay) also sees Jerry's reply arrive.
- **Why this matters:** Verifies the complete messaging flow: match → conversation created → bidirectional real-time messaging works with correct message delivery in both directions.

#### Blocking and delivery (2)

##### E2E-046 — Blocking system — unblock resumes talk delivery › unblock resumes talk delivery

| Field | Value |
|-------|-------|
| **Spec** | `15a-blocking-unblock-resumes-talk-delivery.spec.ts` |
| **Companion doc** | `tests/e2e/15a-blocking-unblock-resumes-talk-delivery.md` |
| **Duration** | 1.9m (115s) (`114575` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #4 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom and Jerry join Global.**

**Steps / assertions:**
- **Tom and Jerry join Global.**
- **Warm-up match:** Tom broadcasts a simple match talk, Jerry answers "Yes", and they become contacts.
- **Tom blocks Jerry** from the Contacts relationship modal.
- **Server block list check:** Tom's `/api/users/:id/blocks` response includes Jerry.
- **Blocked-delivery check:** Tom broadcasts "Blocked Talk"; Jerry must not receive it in incoming talks.
- **Tom unblocks Jerry** from the same relationship modal (button shows "Unblock User").
- **Server unblock check:** Tom's block list no longer includes Jerry.
- **Delivery-after-unblock check:** Tom broadcasts "Post-Unblock Talk"; Jerry now receives it.

##### E2E-047 — Blocking system — block stops delivery › block stops delivery and hides peer detail from the blocked user

| Field | Value |
|-------|-------|
| **Spec** | `15b-blocking-stops-delivery-and-peer-visibility.spec.ts` |
| **Companion doc** | `tests/e2e/15b-blocking-stops-delivery-and-peer-visibility.md` |
| **Duration** | 1.2m (70s) (`70429` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #19 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom and Jerry join Global.**

**Steps / assertions:**
- **Tom and Jerry join Global.**
- **Warm-up match:** Tom broadcasts a talk and Jerry matches, so they appear in contacts.
- **Tom blocks Jerry** in the Contacts relationship modal.
- **Server confirmation:** Tom's block list contains Jerry.
- **Contacts UI confirmation:** Jerry appears with blocked status in Tom's contacts list.
- **Tom peer-detail checks (on Jerry):**
- **Delivery suppression check:** Tom broadcasts "Blocked Delivery Talk"; Jerry does not receive it.
- **Blocked viewer check (Jerry viewing Tom):**

#### Reputation and age-gating (4)

##### E2E-048 — Reputation system — block count propagation › block/unblock propagates reputation.blockCount

| Field | Value |
|-------|-------|
| **Spec** | `21a-reputation-block-count.spec.ts` |
| **Companion doc** | `tests/e2e/21a-reputation-block-count.md` |
| **Duration** | 1.5m (90s) (`89619` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #12 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom and Jerry are bootstrapped and connected** via a matching talk so they appear as contacts.

**Steps / assertions:**
- **Tom and Jerry are bootstrapped and connected** via a matching talk so they appear as contacts.
- **Tom opens Jerry's contact relationship modal.**
- **Tom blocks Jerry.**
- **Reputation API poll:** Jerry's `reputation.blockCount` becomes `1`.
- **Tom opens the modal again** and unblocks Jerry.
- **Reputation API poll:** Jerry's `reputation.blockCount` returns to `0`.

##### E2E-049 — Reputation system — peer star rating › submit peer star rating updates starRating + liked/disliked counts

| Field | Value |
|-------|-------|
| **Spec** | `21b-reputation-peer-star-rating.spec.ts` |
| **Companion doc** | `tests/e2e/21b-reputation-peer-star-rating.md` |
| **Duration** | 1.2m (74s) (`74272` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #17 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom and Jerry become contacts** through a successful talk match.

**Steps / assertions:**
- **Tom and Jerry become contacts** through a successful talk match.
- **Tom opens Jerry's relationship modal** from Contacts.
- **Tom selects a new star rating** (typically 4 or 5) and saves.
- **Reputation API poll:** Jerry's `reputation.starRating` converges to the saved value.

##### E2E-050 — Reputation system — vouch threshold › vouch votes accumulate to threshold (delivery flips at 3)

| Field | Value |
|-------|-------|
| **Spec** | `21c-reputation-vouch-threshold.spec.ts` |
| **Companion doc** | `tests/e2e/21c-reputation-vouch-threshold.md` |
| **Duration** | 56.9s (`56932` ms) |
| **Browsers** | 2 browsers |
| **Parallel run rank** | #28 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom and Jerry join Global.**

**Steps / assertions:**
- **Tom and Jerry join Global.**
- **Tom repeatedly submits age-verification vouches** for Jerry.
- For each vouch step, **Tom creates and broadcasts an adult talk**.
- **Before threshold is reached:** Jerry should not receive the adult talk.
- **After threshold is reached (step 3):** Jerry should receive the adult talk.

##### E2E-051 — Age-gating — adult talk blocked for unverified user › age-verified Jerry receives adult talk; unverified Bob does not

| Field | Value |
|-------|-------|
| **Spec** | `00g-age-gating.spec.ts` |
| **Companion doc** | `tests/e2e/00g-age-gating.md` |
| **Duration** | 50.4s (`50429` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #35 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom, Jerry, and Bob join Global.**

**Steps / assertions:**
- **Tom, Jerry, and Bob join Global.**
- **Jerry is age-verified via API vouches** (3 sequential `POST /api/users/:id/age-verify` calls).
- **Bob remains unverified.**
- **Tom creates an adult talk** (`isAdult = true`) and broadcasts it.
- **Jerry delivery check:** Jerry should receive the adult talk.
- **Bob delivery check:** Bob should not receive the adult talk.

#### Contacts and relationships (3)

##### E2E-052 — Contacts tab: list of users with matches, click to see matching talks › Contacts tab shows users with matches; click contact shows matching talks

| Field | Value |
|-------|-------|
| **Spec** | `06-contacts-tab.spec.ts` |
| **Companion doc** | `tests/e2e/06-contacts-tab.md` |
| **Duration** | 1.6m (97s) (`96788` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #8 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Contacts list, matching talk history, peer-to-peer contact visibility, multi-browser (Tom/Jerry/Bob), talk-matching cross-verification

**Steps / assertions:**
- **Setup:** Three browsers launched — Tom, Jerry, and Bob. All three join the "Global" chatroom.
- **Tom creates two talks** via the company page demo:
- **Tom broadcasts both talks.** The broadcasts reach Jerry and Bob.
- **Jerry answers both talks on Tom's behalf:**
- **Bob answers both talks on Tom's behalf:**
- **Peer history is verified via API polling:** The `/api/users/{uid}/peers/{peerId}/talk-history` endpoint is polled to confirm Tom-Jerry share the Tennis match and Tom-Bob share the Coffee match.
- **Verification — Tom sees 2 matches** in status bar, then navigates to Contacts tab:
- **Verification — Jerry's Contacts tab** shows only Tom (with Tennis match).

##### E2E-053 — UX polish: contacts, talks navigation, and answers details › contacts include mismatched peers, contacts/chatroom open the same peer detail, talks nav splits IN and OUT, and answers show question plus answer

| Field | Value |
|-------|-------|
| **Spec** | `00f-ux-contacts-talks-answers.spec.ts` |
| **Companion doc** | `tests/e2e/00f-ux-contacts-talks-answers.md` |
| **Duration** | 1.3m (78s) (`78351` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #14 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Contacts tab showing mismatched peers, peer detail from both contacts and chatroom, Talks tab IN/OUT navigation, Answers tab detail display, three-browser

**Steps / assertions:**
- **Setup:** Three browsers (Tom, Jerry, Bob) launched via `launchThreeBrowsers`. Tom and Jerry join Global chatroom.
- **Tom creates "Tom Out Talk"**, **Jerry creates "Jerry Out Talk"**. Both broadcast their respective talks.
- **Jerry answers "Tom Out Talk" with "No thanks."** (mismatch/no match).
- **Verification — Tom's contacts tab:** Shows Jerry as a contact (even though there was no *match* — contacts include mismatched peers). The contact item says "2 talks". Clicking Jerry shows the "Tom Out Talk" in Jerry's contact detail.
- **Verification — Chatroom peer detail:** Tom enters the Global chatroom, clicks Jerry's name — the same peer detail overlay opens with Jerry's name (contacts and chatroom show the same detail view).
- **Verification — Talks tab IN/OUT split:** Tom's Talks tab shows both IN and OUT tabs. "Back" shows all talks, "IN" shows only Jerry's talk (incoming), "OUT" shows only Tom's own talk (outgoing). "Back" shows both again.
- **Verification — Jerry's Answers tab:** Shows "Tom Out Talk" with the question "Do you want to join Tom?", the selected answer "No thanks.", "1 item" count, "answered 1 time", and "Mismatch" status.
- **Why this matters:** Verifies end-to-end UX polish: contacts include mismatched peers (not just matches), IN/OUT navigation works correctly, and answers show full question + answer detail.

##### E2E-054 — Contacts relationship dialog › Contact relationship settings persist nickname, label, rating, and notes

| Field | Value |
|-------|-------|
| **Spec** | `14-contacts-relationship-credit.spec.ts` |
| **Companion doc** | `tests/e2e/14-contacts-relationship-credit.md` |
| **Duration** | 1.0m (60s) (`60032` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #25 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Contact relationship editing, nickname persistence, label/relationship type, rating, notes, contact list display update

**Steps / assertions:**
- **Setup:** Three browsers (Tom, Jerry, Bob). Tom and Jerry join Global chatroom.
- **Tom creates and broadcasts "Relationship Match Talk"** ("Want coffee?" with Yes/No answers). Jerry opens it and matches with "Yes".
- **Tom opens contacts, clicks Jerry** — sees Jerry's contact detail.
- **Tom edits relationship:** Clicks "Edit Relationship":
- **Verification — Contact list updates:** The contacts list now shows Jerry as "J (Jerry)" with "Friend" label.
- **Verification — Settings persist on re-open:** Clicking the updated contact, then re-editing the relationship — all fields (nickname "J", rating "4", notes "coffee buddy") are pre-filled with saved values.
- **Why this matters:** Verifies that the contact relationship dialog correctly saves and restores nickname, label, rating, and notes, and that the contacts list reflects nickname changes.

#### Survey analytics dashboard (1)

##### E2E-055 — Survey analytics dashboard › creator sees dashboard sections, can export CSVs, and can create a follow-up survey

| Field | Value |
|-------|-------|
| **Spec** | `00i-survey-analytics-dashboard.spec.ts` |
| **Companion doc** | `tests/e2e/00i-survey-analytics-dashboard.md` |
| **Duration** | 1.5m (91s) (`90508` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #10 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom, Jerry, and Bob join Global.**

**Steps / assertions:**
- **Tom, Jerry, and Bob join Global.**
- **Tom creates a survey talk** (restaurant preferences).
- **Jerry and Bob submit survey responses** with different answer sets.
- **Tom opens survey analytics** from the created talk row.
- **Dashboard section checks:** Responses, Responses by day, and Responses by region are present.
- **Anonymity default check:** Anonymous mode is ON and details are hidden.
- **Anonymity OFF check:** Unchecking anonymity reveals concrete answer labels.
- **Export checks:** Summary, day, and region CSV export actions each produce a download.

#### Talks matching (multi-browser) (14)

##### E2E-056 — Talks matching — two talks, status bar, answers tab › Tennis+Coffee: Jerry/Bob match/mismatch; Tom sees 2 matches; Answers tab lists both

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/02-two-talks-status-answers.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/02-two-talks-status-answers.md` |
| **Duration** | 1.7m (102s) (`101784` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #5 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom creates two talks:**

**Steps / assertions:**
- **Tom creates two talks:**
- **Tom broadcasts** both talks
- **Jerry answers:**
- **Bob answers:**
- **Tom checks the status bar** → it should show "2 matches" (one from Jerry for tennis, one from Bob for coffee)
- **Jerry opens the Answers tab** → both "TwoTalks e2e Tennis" and "TwoTalks e2e Coffee" appear listed

##### E2E-057 — Talks matching — exact chatbot Q/A memory › asks Tom when no exact option matches, then auto-reuses older exact history when Apple returns

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/14-exact-chatbot-memory.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/14-exact-chatbot-memory.md` |
| **Duration** | 1.7m (100s) (`100071` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #6 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Context A (Apple available):**

**Steps / assertions:**
- **Context A (Apple available):**
- **Context B (Apple missing):**
- **Context C (Apple returns):**

##### E2E-058 — Talks matching — partial auto-answers (flattened context) › Jerry finishes talk with Sunday; new talk Sat skips Q1–Q2 then Jerry answers Q3

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/05-partial-auto-answers.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/05-partial-auto-answers.md` |
| **Duration** | 1.7m (99s) (`99104` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #7 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom creates a talk** with multiple questions (Q1, Q2, Q3)

**Steps / assertions:**
- **Tom creates a talk** with multiple questions (Q1, Q2, Q3)
- **Jerry answers all three questions** manually
- **The system saves Jerry's answers** as "flattened preferences" tied to the context hash of this talk
- **Tom creates a second talk** with the same Q1 and Q2 but a different Q3 (so the overall context hash is different)
- **Jerry sees the second talk** — Q1 and Q2 are **auto-filled** from his previous answers, but Q3 requires a manual answer since it's new
- **Jerry only has to answer Q3**

##### E2E-059 — Talks matching — chatbot + bot badge › Tom manual match, Bob bot match; Tom stores manual attribution, Bob stores bot attribution

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/03-chatbot-bot-badge.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/03-chatbot-bot-badge.md` |
| **Duration** | 1.3m (78s) (`77721` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #15 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom creates a talk and broadcasts it**

**Steps / assertions:**
- **Tom creates a talk and broadcasts it**
- **Jerry enables the chatbot** (an automated reply feature) and answers the talk
- **The chatbot saves Jerry's answer** as a template for future talks
- **Using `announceTalkToRoom`**, the system announces the talk again
- **Bob's conversation** with Jerry shows a **bot badge** (indicating Jerry's response was auto-generated by the chatbot, not manually typed)
- **Tom's conversation** does NOT show a bot badge (Tom responded normally)

##### E2E-060 — Talks matching — one match one mismatch from two responders › Jerry matches, Bob mismatches → Tom sees exactly 1 match, no Bob conversation

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/12-two-responders-partial-match.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/12-two-responders-partial-match.md` |
| **Duration** | 1.2m (70s) (`70428` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #20 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom creates a talk** called "E2E Partial Match Tennis" (question: "Want tennis?" — Yes=match, No=ignore)

**Steps / assertions:**
- **Tom creates a talk** called "E2E Partial Match Tennis" (question: "Want tennis?" — Yes=match, No=ignore)
- **Tom broadcasts it** to the room
- **Jerry answers** "Yes" → **Match!**
- **Bob answers** "No" (no match)
- **Tom's Me tab badge** shows "1" (exactly one unread conversation — from Jerry only)
- **Tom's conversation list** shows **only Jerry** as a conversation partner
- **Tom's conversation list has exactly 1 item** — Bob does NOT appear (since Bob was a mismatch, no conversation was created)
- **Jerry's Me tab badge** also shows "1" (unread conversation with Tom)

##### E2E-061 — Talks matching — tag answer removed from IN › Tom ignores tag (unchecked), reopens it, checks box → match

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/13-tag-reopen-mismatch-then-match.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/13-tag-reopen-mismatch-then-match.md` |
| **Duration** | 52.4s (`52403` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #30 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Alice creates a tag** called "E2E Tag Reopen Coffee"

**Steps / assertions:**
- **Alice creates a tag** called "E2E Tag Reopen Coffee"
- **Alice broadcasts it** to the room
- **Tom opens the tag modal** → leaves the checkbox **unchecked** → submits
- **NO "Match!" notification** appears for either Alice or Tom
- **Tom's Answers tab** shows the tag labeled as "Mismatch"
- **Tom reopens the same tag** (navigates back to it)
- **Tom checks the checkbox** this time → submits
- **Now both sides' status bars** show "1 match"

##### E2E-062 — Talks matching — answered incoming leaves IN › Jerry answers No and the answered incoming talk is removed from IN

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/04-ignore-then-change-answer.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/04-ignore-then-change-answer.md` |
| **Duration** | 52.3s (`52347` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #31 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom creates a multi-question talk** with several branching questions

**Steps / assertions:**
- **Tom creates a multi-question talk** with several branching questions
- **Tom broadcasts** to the room
- **Jerry receives it**, goes through the questions, and ends up on the **mismatch** (ignore) branch
- **Jerry then changes one of his earlier answers** — navigating back through the questions
- **The new combination of answers** leads to a **match** instead
- **Tom sees the match** notification
- **Bob also answers** through the flow

##### E2E-063 — Talks matching — mismatch path yields no match › Jerry picks the ignore branch → no match toast, Tom has 0 matches, Jerry Answers tab shows Mismatch

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/11-mismatch-no-match.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/11-mismatch-no-match.md` |
| **Duration** | 51.3s (`51268` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #34 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom creates a talk** called "E2E Mismatch No Match Flow" (question: "Want to play tennis?" with Yes=match, No=ignore)

**Steps / assertions:**
- **Tom creates a talk** called "E2E Mismatch No Match Flow" (question: "Want to play tennis?" with Yes=match, No=ignore)
- **Tom broadcasts** the talk
- **Jerry receives the talk** and answers "No thanks." (the ignore/mismatch branch)
- **Neither Jerry nor Tom** sees a "Match!" notification toast
- **Tom's status bar** does NOT show any match count
- **Jerry's Answers tab** lists the talk with a "Mismatch" label
- **Why this matters:** Tests that the system correctly handles the case where a talk generates zero matches — no false matches, no phantom notifications.

##### E2E-064 — Talks matching — tennis, Jerry match › Tom sends Tennis Partner, Jerry answers match

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/01-tennis-jerry-match.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/01-tennis-jerry-match.md` |
| **Duration** | 49.8s (`49781` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #36 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom creates a talk** called "Tennis Partner" with the question: "Want a tennis partner?" (Yes = match, No = ignore)

**Steps / assertions:**
- **Tom creates a talk** called "Tennis Partner" with the question: "Want a tennis partner?" (Yes = match, No = ignore)
- **Tom broadcasts** the talk to everyone in the room
- **Jerry opens his Talks tab** → sees "Tennis Partner" in his incoming list
- **Jerry opens the talk modal**, answers "Yes, let's play." → **Match!**
- **Both Tom and Jerry's apps** navigate/redirect after the match is confirmed
- **Note:** This is the simplest "Hello World" test of the matching system — single talk, single responder, match path.

##### E2E-065 — Talks matching — four talk types, Jerry chatbot auto-replies Sam › Tom broadcasts 4 talks, Jerry auto-answers all, Sam re-asks, chatbot replies

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/09-four-types-chatbot.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/09-four-types-chatbot.md` |
| **Duration** | 45.7s (`45684` ms) |
| **Browsers** | 3 browsers (Tom / Jerry / Bob or Alice) |
| **Parallel run rank** | #38 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom creates and broadcasts 4 talks:**

**Steps / assertions:**
- **Tom creates and broadcasts 4 talks:**
- **Jerry turns on the chatbot** feature before answering
- **Jerry answers all 4 talks** using auto-mode:
- **Jerry opens his Answers tab** — all 4 talks are listed with their respective question/answer details
- **A new user (Sam) joins** the Global chatroom
- **Sam re-announces the same 4 talk IDs** to Jerry (using `announceTalkToRoom`)
- **Jerry's chatbot auto-replies** to all match-capable talks (tag, flow, route — NOT survey since surveys don't match)
- **Sam opens the Me tab** — sees conversations with Jerry

##### E2E-066 — Talks matching — survey customer satisfaction (multi-browser) › company creates survey; 10 recorded responses; stats show 10 responses

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/06-survey-customer-satisfaction.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/06-survey-customer-satisfaction.md` |
| **Duration** | 7.5s (`7483` ms) |
| **Browsers** | 1 browser × 3+ contexts (grid) |
| **Parallel run rank** | #54 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Company launches** a customer satisfaction survey with three question categories:

**Steps / assertions:**
- **Company launches** a customer satisfaction survey with three question categories:
- **Each of the 10 respondent users** receives the survey and answers:
- **The Company checks the survey results** — the talk row in their Talks tab shows **"10 responses"** (confirming all 10 users answered)
- **Why this matters:** Tests that surveys scale correctly and that the aggregate response count is accurate across many users in real-time.

##### E2E-067 — Talks matching — job seeker route (multi-browser) › company creates route; 10 recorded paths; stats show 10 responses

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/08-route-job-seeking.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/08-route-job-seeking.md` |
| **Duration** | 7.5s (`7463` ms) |
| **Browsers** | 1 browser × 3+ contexts (grid) |
| **Parallel run rank** | #55 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Company creates a job-seeking route talk** — a multi-step decision tree with questions like:

**Steps / assertions:**
- **Company creates a job-seeking route talk** — a multi-step decision tree with questions like:
- **Each of the 10 job seekers** receives the route and walks through a unique path:
- **The Company checks results** — each talk row shows **"10 responses"** confirming all seekers completed their routes
- **Why this matters:** Routes are the most complex talk type (directed acyclic graphs with conditional branching). This test proves that the system handles multi-step, state-dependent flows across many concurrent users.

##### E2E-068 — Talks matching — restaurant survey (multi-browser) › company creates restaurant survey; 10 recorded responses; stats show 10 responses

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/07-survey-restaurants.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/07-survey-restaurants.md` |
| **Duration** | 7.5s (`7456` ms) |
| **Browsers** | 1 browser × 3+ contexts (grid) |
| **Parallel run rank** | #56 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Company launches a restaurant preference survey** with three food categories:

**Steps / assertions:**
- **Company launches a restaurant preference survey** with three food categories:
- **Each of the 10 diner users** receives the survey and answers with different combinations of preferences (rotating through the available options)
- **The Company checks the survey results** — the talk row shows **"10 responses"**
- **Why this matters:** Same as test 06 but with a different domain — tests that surveys work for various question types and that the system handles different answer option sets correctly.

##### E2E-069 — Talks matching — generic stats across four talk types (STAT-01) › 4 talks × 2 responders → /api/stats summary/by-day/by-region/by-answer all report 2

| Field | Value |
|-------|-------|
| **Spec** | `talks-matching/10-stats-four-types.spec.ts` |
| **Companion doc** | `tests/e2e/talks-matching/10-stats-four-types.md` |
| **Duration** | 7.4s (`7418` ms) |
| **Browsers** | 1 browser × 3+ contexts (grid) |
| **Parallel run rank** | #57 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** **Tom creates 4 talks** (Tag, Flow, Survey, Route) and broadcasts them to the room

**Steps / assertions:**
- **Tom creates 4 talks** (Tag, Flow, Survey, Route) and broadcasts them to the room
- **Jerry goes through all 4 talks**, answering each one manually
- **Sam does the same** — answers all 4 manually, potentially with different choices
- For **each of the 4 talks**, the test hits four different API endpoints:
- **Why this matters:** This is a backend integration test that verifies the statistical reporting layer works correctly for all talk types, proving data integrity across the entire analytics pipeline.

#### Offline and reconnect (1)

##### E2E-070 — Reconnect recovery › incoming talk sync recovers after offline/online transition

| Field | Value |
|-------|-------|
| **Spec** | `26-offline-reconnect-incoming-sync.spec.ts` |
| **Companion doc** | `tests/e2e/26-offline-reconnect-incoming-sync.md` |
| **Duration** | 49.3s (`49316` ms) |
| **Browsers** | 1 browser |
| **Parallel run rank** | #37 of 70 |
| **Notes** | _Add owner, FR-*, flakiness, last failure here._ |

**Summary:** Tom and Jerry join the app.

**Steps / assertions:**
- Tom and Jerry join the app.
- Jerry's browser context goes offline.
- Tom broadcasts a talk while Jerry is disconnected.
- Jerry comes back online.
- The server incoming-talk API and Jerry's Talks UI both show the talk after reconnect.


---

## 5. Performance testing (SRS + E2E signals)

| Concern | E2E coverage | SRS / load |
|---------|----------------|------------|
| Chatroom capacity / FIFO | `03-capacity-eviction`, `00k-capacity-regional-spread` | TC-CR-002, TC-PERF-003 |
| Bulk broadcast | `00d-super-user-20-broadcast`, cancellation specs | TC-PERF-002, TC-BM-001 |
| Many concurrent browsers | `00k` (25 contexts), `PW_WORKERS=15` suite | TC-PERF-001 (manual load) |
| Stats at scale | `talks-matching/06–08`, `10-stats-four-types` | TC-SV-001 |

Wall-clock target: **≤6 min** for 70 tests at `PW_WORKERS=15` (baseline **5.1 min**, 2026-05-16).

---

## 6. Security and privacy testing

| Concern | E2E tests |
|---------|-----------|
| Location blur / regional rooms | `27-location-auto-assignment`, `00k`, `18-travel-mode-single-room` |
| Profile visibility | `24-profile-privacy-visibility` |
| Blocking / peer visibility | `15a`, `15b` |
| Age-gating / adult content | `00g-age-gating`, `21c-reputation-vouch-threshold`, `13-me-filters-credit` |
| Input / API validation | `17-chatroom-custom-business-api` |

Manual SRS cases (TC-SEC-*) for penetration and encryption review remain outside Playwright.

---

## 7. User acceptance scenarios (partial automation)

| UAT | E2E overlap |
|-----|-------------|
| UAT-001 Dating / matching | `talks-matching/01`, `06-contacts-tab`, messaging specs |
| UAT-002 Buy/sell tags | `07-tags-checkbox`, `talks-matching/13` |
| UAT-003 Hobby / tennis | `talks-matching/01`, `02-two-talks-status-answers` |
| UAT-004 Business survey | `00i-survey-analytics-dashboard`, `talks-matching/06–08` |

---

## 8. Automation strategy

### 8.1 Coverage targets
- **E2E:** 70 scenarios (this catalog) — expand by adding `.spec.ts` + `.md` and updating §4.2–4.3
- **Unit:** 80% goal per legacy plan; enforced via `npm run test:coverage`
- **CI:** `npm run health` + `PW_WORKERS=15 npm run test:e2e`

### 8.2 Tooling
| Tool | Use |
|------|-----|
| Playwright | E2E (`tests/e2e`) |
| Jest | Unit/integration (`src/test`) |
| `helpers/timing.ts` | `afterLoad`, `afterSync`, `afterNav`, `afterAction` |
| `helpers/clear-database.ts` | Gun clear + `waitForGunApiReady` |
| `helpers/talks-matching-flow.ts` | Tom/Jerry/Bob bootstrap, incoming modals |

---

## 9. Test execution schedule (suggested)

| Phase | Focus |
|-------|--------|
| Per PR | `npm run health` + targeted spec(s) |
| Pre-release | Full 70 E2E, `PW_WORKERS=15` |
| After duration regression | Re-run §4.1 capture; reorder slow specs per §4.2 |
| Weekly | Review **Notes** column in §4.3 for flakes |

---

## 10. Risk analysis (E2E-informed)

| Risk | Mitigation in suite |
|------|---------------------|
| Gun sync latency | `afterSync`, `waitForGunPeerCountInRoom`, `E2E_INTERVAL=long` |
| Ghost chatroom members | `clearGunDatabases`, per-worker ports, `E2E_GUN_MEMORY_ONLY` |
| Hierarchy collapse (pre-expanded nodes) | `ensureHierarchyParentExpanded` in `00h` |
| Toast assertions | Durable UI state (`#status-bar-text`, conversation list) |
| Late-suite load | Parallel slow-first order (§4.2); optional rename `00d` → sort early |

---

## 11. Success and exit criteria

- **Release gate:** All **70** E2E tests pass; `npm run health` clean
- **Performance gate:** Full parallel E2E ≤ **6 min** wall clock (baseline 5.1 min)
- **Documentation gate:** New specs update §4.2 duration row and §4.3 entry

---

## 12. Defect management

Classify flakes vs product bugs using Playwright trace (`on-first-retry`), screenshot, and video on failure. Record chronic flakes in the **Notes** field for the matching **E2E-*** entry in §4.3.

---

## 13. Deliverables

| Artifact | Path |
|----------|------|
| This test plan | `docs/testing/testplan.md` |
| E2E README | `tests/e2e/README.md` |
| Per-test narrative | `tests/e2e/**/*.md` |
| Playwright HTML report | `playwright-report/` (after run) |
| Duration refresh log | `/tmp/pw-e2e-run.log` (local; optional CI artifact) |

---

## Appendix A — Lexicographic file order (Playwright default)

When `PW_WORKERS=1`, tests run in path order: `00-*` … `28-*`, then `talks-matching/01` … `14`. This differs from §4.2 optimal parallel order.

## Appendix B — SRS manual test cases (not fully automated)

Sections **4.1–4.10** of the 2025 SRS-style case library (user management, built-in filters, spam prevention, platform matrix, etc.) are **not** duplicated here. Implement or map them over time into new E2E specs and §4.3 entries.

---

_§4.2–4.3 generated from `PW_WORKERS=15` run 2026-05-16. Re-run §4.1 to update durations after major perf or test changes._

---

## Appendix C — Flake investigations & historical benchmarks

> **Consolidated 2026-06-08** from `docs/testing-benchmarks.md`, `docs/P2P_nodes.md` (test-history portions), and the root-level `test-12-flake-root-cause.md`. Those source docs were moved to `docs/archive/`.

### C.1 `12-two-responders-partial-match` — disk-race flake (2026-05-12)

Root-cause analysis for historical flakiness observed at W4+ during full-suite runs.

**Isolation benchmark (single test only) — 2026-05-02.** When run in isolation, the test passes at **every** worker count; it is not inherently flaky:

| Workers | Duration | Pass | Fail | Exit |
|---------|----------|------|------|------|
| W1 | 47s | 1 | 0 | 0 |
| W2 | 47s | 1 | 0 | 0 |
| W3 | 49s | 1 | 0 | 0 |
| W4 | 50s | 1 | 0 | 0 |
| W5 | 52s | 1 | 0 | 0 |
| W6 | 54s | 1 | 0 | 0 |
| W7 | 58s | 1 | 0 | 0 |
| W8 | 59s | 1 | 0 | 0 |

**Full-suite run (talks-matching/, 13 files) — 2026-05-02.** At W4 the test fails (1 failed, 12 passed in 5.8m), reproducing the historical flakiness.

**Root cause: cross-test interference via shared disk paths in `clearGunDatabases()`** (`tests/e2e/helpers/clear-database.ts`). Every worker deleted shared disk paths (`radata/`, `data1.json`, `data.json`); when Worker 0 deleted `radata/` mid-test, Worker 1 could be syncing, tearing down Gun's disk persistence mid-write and corrupting the graph for subsequent tests. The test is most vulnerable because it launches 3 browser instances with heavy Gun sync and has 30s polling timeouts.

**Historical reference benchmarks:** W1 (clean) 4.75m / 32 pass; W4 (clean) 2.6m / 28 pass + 4 fail (12.5%); noisy runs worse due to port conflicts + disk races.

**Fix applied:** `clearGunDatabases()` now polls `GET /health` before clearing, retries `POST /api/test/clear-database` with exponential backoff, relies on `E2E_GUN_MEMORY_ONLY=1` server state instead of deleting shared disk paths, waits a short settle window after a successful clear, and still clears browser IndexedDB via `injectIdbClear()`. Action items closed: root cause diagnosed; shared disk deletes removed (per-worker `radata_w{N}/` / `data1_w{N}.json` if disk persistence is needed); retry/synchronization added; revalidated — `PW_WORKERS=10 npm run test:e2e` passed 58 tests on 2026-05-12.

### C.2 `12-two-responders-partial-match` — badge replication race (2026-05-03, commit `c1674942aaad`)

A distinct earlier flake on the same spec. Symptom: with the full talks-matching suite at ≥3 workers, Tom's conversation badge showed 0/stale instead of the expected 1 (1–2 workers ~90% pass, 3–4 workers ~60–75%).

**Root cause: the Gun replication race after a database clear.** `clearGunDatabases()` resets `gun._.graph = {}` on the server, but clients replicate incrementally — a `.once()` snapshot taken right after a clear can be stale/empty. The badge reads from localStorage, which only updates when the sync handler ingests fresh Gun data; if the first post-clear `.once()` missed the new conversation, the badge never converged. A prior fix (commit `2c58744`) added two `requestConversationSync` calls but `waitForConversationBadgeCount` still polled the DOM passively for 30s without pulling new data. More workers worsened it (concurrent clears, larger accumulated graph, less replication time).

**Fix:** `waitForConversationBadgeCount` changed from passive DOM polling to an **active sync loop** — every iteration calls `requestConversationSync(page)` (dispatches `needConversationSync` → fresh Gun `.once()` → localStorage update → UI re-render), waits `afterSync()`, then reads the badge; timeout raised 30s → 45s. The test keeps "tugging" Gun until the replicated data converges.

**Lesson:** do not treat localStorage as immediately authoritative after a database clear; test helpers must actively participate in the sync cycle.

### C.3 `E2E_GUN_MEMORY_ONLY=1` semantics (test-environment note)

When set: server Gun runs with `radisk: false` (no disk persistence); each Playwright worker runs its own server pair on offset ports; each worker has isolated in-memory Gun state and workers do not share graph state. This is why per-worker disk clears are unnecessary (see C.1) and why cross-worker disk races were the flake source.

---

## Appendix D — Mesh talk delivery test impact (`P2P_MESH_TALKS`)

> Source: `docs/p2p-mesh-talk-delivery-plan.md` §9 (archived). Design detail now in spec §23; rollout checklist in `docs/TODO.md` §"P0 — Mesh talk delivery".

- **`find-similar-people`:** once announce + responses are on the mesh (rollout steps 2/4), remove the sequential-deliver workaround and go concurrent again — the hub-saturation reason is gone. Multi-browser-per-user already models real peers, so it becomes the natural mesh test.
- **Star-mode integration suites** (`talk-loop`, `peer-routes`, `system-routes`) shrink or are deleted as their endpoints go away; replace with mesh-transport + receiver-filter unit/integration tests.
- **New mesh transport tests:** gossip coverage, seen-set dedupe, body pull, offline mailbox drain, neighbor churn.
- **First proof:** a 3-browser E2E asserting a message gossips A→B→C without any `talks/*` or `peerTalkOffers/*` Gun write (proves the rendezvous-only server model before any feature moves).

---

## Appendix E — Statistics feature verification requirements

> Source: `docs/roadmap/statistics-expansion.md` (archived). Forward feature work tracked in `docs/TODO.md`.

Every new statistics feature should include: unit tests for aggregation math; integration tests for endpoint input validation, empty data, UTC boundaries, and privacy masking; E2E tests for dashboard entry points and visible results; and documentation updates in `docs/TODO.md` and the spec where the source-of-truth or privacy model changes.
