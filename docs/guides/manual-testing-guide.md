# IinPublic — Manual Testing Guide

> Last updated: 2026-07-10 | Covers running features + how to verify each one by hand.
> For automated E2E coverage see `docs/testing/testplan.md`.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Bottom Navigation — Five Tabs](#2-bottom-navigation--five-tabs)
3. [Chatrooms](#3-chatrooms)
4. [Talk System — Four Types](#4-talk-system----four-types)
5. [Talk Creation & Broadcasting](#5-talk-creation--broadcasting)
6. [Talk Response Flow](#6-talk-response-flow)
7. [Contacts](#7-contacts)
8. [Direct Messaging](#8-direct-messaging)
9. [Me Tab — Profile & Settings](#9-me-tab----profile--settings)
10. [Statistics Dashboard](#10-statistics-dashboard)
11. [TechSupport](#11-techsupport)
12. [P2P Mesh & Discovery](#12-p2p-mesh--discovery)
13. [Desktop App](#13-desktop-app)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Quick Start

```bash
cd ~/IinPublic
npm install          # first time only
npm run dev          # starts web dev server + backend on localhost:3001 / :8080
```

Verify health:
| Endpoint | Expected |
|----------|----------|
| `http://localhost:8080/health` | `200 OK` or JSON status |
| `http://localhost:3001` | SPA loads, bottom nav visible |

**Multi-browser dev session** (test two+ users simultaneously):
```bash
npm run dev:multi    # starts server + 3 browser profiles on one screen
```

---

## 2. Bottom Navigation — Five Tabs

The app shell has five persistent bottom nav buttons (`data-view` attribute):

| Tab | Selector | Purpose |
|-----|----------|---------|
| **Chatrooms** | `data-view="chatrooms"` | Room list, member presence, broadcast entry point |
| **Contacts** | `data-view="contacts"` | Users you've matched or exchanged with |
| **Talks** | `data-view="talks"` | All talks (All / In / Out filter) |
| **Me** | `data-view="me"` | Profile editor, public profile link |
| **Settings** | `data-view="settings"` | Language, notification, location privacy |

### Manual test — tab switching
1. Open `http://localhost:3001` and register/login
2. Click each of the 5 bottom-nav buttons
3. Verify active tab gets `.active` class on button
4. Verify content area updates (no blank states)

---

## 3. Chatrooms

Chatrooms are organized as a **location-based hierarchy**: Global → City → GPS-grid room.

### Room types
| Type | Scope | Example Room ID |
|------|-------|-----------------|
| `global` | All users worldwide | `global` |
| `city` | By city name (e.g., "san-francisco") | `city:san-francisco` |
| `gps-grid` | 100m × 100m grid tile | `37.77_-122.41` |

### Manual test — Global room
1. Navigate to **Chatrooms** tab
2. Click **Global** card — member list should populate
3. Member count shown as "TechSupport + N users" (TechSupport is excluded from ordinary count)
4. Open a second browser profile → register another user → both appear in Global within ~10s

### Manual test — location-based rooms
1. Go to **Settings** → set custom latitude/longitude
2. Return to Chatrooms → your city room should be at the top of the list
3. Click it → member count should reflect local presence

### Manual test — custom/business chatroom
Custom rooms can be created with a unique name + optional password:
1. Find the "Create Chatroom" control in Chatrooms view
2. Enter a name (e.g., "test-room"), optionally a password
3. Verify new room appears in list and is joinable by another browser

---

## 4. Talk System — Four Types

The core of IinPublic. Every talk is an interactive content piece the creator broadcasts to their chatroom audience. Each type has different internal structure:

| Type | Structure | Match logic | Use case |
|------|-----------|-------------|----------|
| **tag** | Single keyword/phrase (boolean toggle) | checked = match, unchecked = ignore | Interest signaling |
| **flow** | Sequential Q→A chain (path graph) | Full preceding context must match stored answer | Chatbot-like conversation |
| **survey** | Independent Q/A pairs (star graph) | Aggregate statistics only | Opinion collection |
| **route** | Branching DAG with `contextPath` | `contextHash` must match current conversation path | Decision tree / quiz |

### How to manually test each talk type

#### Test: Tag talk
1. Go to **Talks** tab → click **Create Talk** button
2. Choose type = **Tag**, enter a phrase (e.g., "Likes coffee")
3. Save → broadcast to Global
4. Another user sees the tag in incoming talks → tap checkbox to match/ignore

#### Test: Flow talk
1. Create with type = **Flow**, add sequential questions and answers
2. Each question's context includes all prior Q/A — test that responder path matters
3. Broadcast → another user should navigate through the question chain sequentially

#### Test: Survey talk
1. Create with type = **Survey**, add 5+ independent questions each with 4 answer options
2. Note: no shared context between questions — answers are independent
3. Broadcast → responders pick freely per question
4. After responses, author sees survey analytics (completion rate, cross-question correlation)

#### Test: Route talk
1. Create with type = **Route**, add branching Q/A that forms a DAG
2. `contextPath` and `contextHash` control which branch the responder is on
3. Broadcast → test that different answer paths lead to different leaves
4. Verify each responder lands on the correct terminal node

---

## 5. Talk Creation & Broadcasting

### Create flow (manual)
```
Talks tab → "Create" button → editor modal
  └─ Title (required, ≤500 chars)
  └─ Type (flow | survey | tag | route)
  └─ Questions + answers (min 1 question, min 1 answer per question)
  └─ Tags (optional keywords for targeting/filters)
  └─ Expiration (optional timestamp, null = permanent)
```

### Broadcast flow (manual)
```
Talks tab → find your talk in "Out" section → tap row → Broadcast button
  └─ Audience preview shows eligible members
  └─ Confirm broadcast → delivery happens via mesh P2P
```

### Manual test — full creator loop
1. Register User A, navigate to Talks → +Create
2. Create a survey with 3 questions (each has 4 numeric answers like `q1a`, `q1b`, `q1c`, `q1d`)
3. Go back to your talks list → find the new talk under "Outgoing"
4. Tap Broadcast → confirm audience → watch progress indicator
5. Verify: on the **Contacts** tab, after responders reply, the contextual stats strip updates with response count

### Manual test — delivery suppression prevents re-broadcast
Once a tag talk's answers have been exchanged with a peer, that peer is suppressed (won't receive it again):
1. User A sends "tag:coffee" to Global
2. User B responds → exchange complete
3. User A tries to broadcast the same tag → User B should NOT receive it again

---

## 6. Talk Response Flow

When talks arrive, responders see them in **Talks → In** as incoming cards with a preview.

### Manual test — respond to an incoming talk
1. Open two browser profiles (User A + User B) using `npm run dev:multi` or manual incognito window
2. **User A**: Create any talk type → Broadcast to Global
3. **User B**: Navigate to Talks tab → switch filter from "All" to "In" (incoming)
4. After ~5-15 seconds the incoming talk card should appear
5. **User B**: Tap the card → response modal opens → answer questions → submit
6. **User A**: Check Stats dashboard or contextual strip → response count incremented

### Manual test — chatbot auto-reply (flow type)
Flow talks with `isTerminal: true` on answers trigger an exact-match auto-reply when the full preceding Q/A context matches the stored path:
1. Create a flow talk where question 3 has `isTerminal: true` on one answer option
2. Responder hits that terminal node → auto-reply fires immediately
3. Verify responder sees the continuation message

---

## 7. Contacts

The **Contacts** tab shows users you've had any exchange with (matched or ignored).

### Manual test — contact appears after match
1. User A broadcasts a tag → User B responds and matches
2. **User B**: Go to Contacts tab → User A's row should appear within ~10s
3. Row shows: stage name, support/contact label if applicable (TechSupport always has `data-support-contact="true"`)

### Manual test — filter/search contacts
1. With 5+ contacts in the list, use the search box above the contact list
2. Type a partial stage name → list should narrow to matching entries only
3. Clear → all returns

---

## 8. Direct Messaging

Direct peer-to-peer messaging (no server relay — WebRTC DataChannel or Gun-prefixed mailbox fallback):

### Manual test — direct message between two users
1. After User A and User B have exchanged a talk, both should see each other in Contacts
2. **User A**: Tap User B's contact row → conversation view opens with send box
3. **User A**: Type a message → send
4. **User B**: Conversation with User A appears (under `conv_pair_<sorted-ids>`); message arrives within ~5s
5. **User B**: Reply → message should appear in the same thread on both sides

### Manual test — concurrent message ordering
1. Both users type simultaneously → observe messages converge to a consistent chronological order on both sides

### Manual test — unread indicators
1. User A sends 3 messages to User B without opening their conversation
2. User B's contact list should show an unread count badge on User A's row
3. After B opens the conversation, badge resets to zero

---

## 9. Me Tab — Profile & Settings

### Manual test — profile editor
1. Click **Me** tab
2. Edit fields:
   - **Headshot**: upload or paste an image URL → avatar updates immediately
   - **Stage name**: 3-30 alphanumeric + `_-` chars (reserved words rejected)
   - **Languages**: multi-select from supported languages
   - **Location privacy**: set blur radius (default ~1km, configurable up to city-level)
   - **Travel mode**: toggle single-room visibility for when you're away from your home location
3. Save → verify public profile rendering reflects changes on another user's view

### Manual test — intake filters
Intake filters control what incoming talks reach you:
1. Go to **Settings** tab → find "Incoming Talk Filters" section
2. Set language filter (e.g., "English only") → Chinese surveys should not appear in your "In" list
3. Set distance cap (e.g., "5 miles") → far-away location-room broadcasts filtered out
4. Save settings → verify they persist across page reload

### Manual test — block/unblock user
1. User A sends message to User B → User B opens conversation
2. Use the block control in the peer-detail view
3. User A's messages should be suppressed from User B's inbox moving forward
4. Unblock → messages resume normal delivery

---

## 10. Statistics Dashboard

Stats run **entirely client-side** from `localStorage` — no server endpoints needed since P0 Step 7.

### Manual test — creator dashboard
After creating talks and receiving responses:
1. Check the contextual stats strips (appear under Talks, Contacts, Me tabs) showing summary counts
2. Click into full statistics view:
   - **By-type breakdown**: flows vs surveys vs tags vs routes + match rate per type
   - **Top talks table**: sorted by response count
   - **Time-series trend**: daily response volumes
   - **Survey analytics**: skip/completion rates per question, cross-question correlation tables, 7-day/30-day filters

### Manual test — survey analytics deep-dive
1. Create a survey with 5 questions each having 4 answer options
2. Have ~8 users respond to it
3. Open stats → verify:
   - Completion rate per question (answered / total responds)
   - Cross-question co-occurrence table between two selected questions
   - CSV export button works if server available (otherwise falls back to local aggregation only)

---

## 11. TechSupport

The system has a canonical bootstrap identity (`TECHSUPPORT_ROOT`) whose ID is `TECHSUPPORT_ROOT` (a pinned, SEA-signed public key). Every user sees one welcome message from TechSupport on first login.

### Manual test — TechSupport presence and greeting
1. Do a cold run: `npm run dev` → clear browser data → navigate to app
2. Register a new user
3. Go to Contacts tab → **TechSupport** should be the first row with `data-support-contact="true"`
4. Open the conversation → welcome message appears exactly once (deterministic ID)

---

## 12. P2P Mesh & Discovery

IinPublic runs a Gun.js peer-to-peer mesh over WebSocket + WebRTC DataChannels for direct talk delivery. The public hub at `https://www.iinpublic.com/gun` is used **for discovery only** — no private graph data syncs upstream.

### Manual test — mesh forms with multiple browsers
1. Start `npm run dev:multi` which opens 3 browser profiles (Tom, Jerry, Bob)
2. On each profile's **Chatrooms → Global**, verify the other users appear within ~30 seconds
3. From Tom's Chatrooms view, broadcast a talk to Global
4. On Jerry and Bob profiles, verify the incoming talk appears under Talks/In

### Manual test — direct P2P conversation works offline-friendly
1. After two users have a DM open, stop the backend server: `Ctrl+C` on the `npm run dev` terminal
2. Try sending another message → it should use Gun mailbox fallback (persist in IndexedDB, delivered when hub comes back)
3. Restart server → verify mailbox drains and message arrives

---

## 13. Desktop App

The desktop app runs the **same embedded Node.js process** plus an Electron renderer:

```bash
npm run desktop:dev   # builds web + server, then launches Electron on port 8088
# or
npm run desktop:dist  # produces installable DMG/ZIP/AppImage
```

### Manual test — desktop boots with embedded node
1. Run `npm run desktop:dev`
2. Window opens → bottom nav loads same UI as browser
3. Register user → verify Global chatroom shows members (TechSupport + your identity)
4. From DevTools console check logs: `[embedded-node] starting on 127.0.0.1:8088`

---

## 14. Troubleshooting

### App won't load / blank screen
- Check browser console for red errors — common cause is Gun hub URL derivation mismatch
- Verify server health at `http://localhost:8080/health`
- Clear IndexedDB in DevTools → F12 → Application → IndexedDB → delete all databases

### Ghost users persisting in Global room
- Run `npm run dev:multi` (wipes persistent browser profiles) or manually clear user data via Settings

### Talks not appearing on receiver side
- Wait up to 90 seconds — mesh delivery with WebRTC negotiation between 12+ nodes can take that long under CPU contention
- Check DevTools → Application → Service Workers are not blocking Gun WebSocket connections

### Build fails type-check
```bash
npm run test:type     # TypeScript check only
npm run lint          # ESLint only
npm run health        # full type + lint + unit + integration suite
```

---

## Quick Reference — Key URLs

| Purpose | URL |
|---------|-----|
| Dev web server | `http://localhost:3001` |
| Dev backend API | `http://localhost:8080` |
| Health check | `http://localhost:8080/health` |
| Gun hub (local) | `http://localhost:8080/gun` |
| Public Gun hub (prod) | `https://www.iinpublic.com/gun` |
| Desktop embedded node loopback | `http://127.0.0.1:8088` |

## Quick Reference — npm Scripts for Testing

| Command | What it runs |
|---------|-------------|
| `npm run test:e2e` | Full E2E suite (single worker) |
| `npm run test:e2e:parallel` | Light shard + parallel workers |
| `npm run test:all` | Everything: type, lint, jest, light, mass, mesh, heavy staged shards |
| `npm run health` | Type check + lint + all Jest tests, no E2E |
| `npx playwright show-report` | Open last merged HTML report in browser |
