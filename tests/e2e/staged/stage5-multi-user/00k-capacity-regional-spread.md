# Test: Capacity Regional Spread — 25 Users Cascade Across Global, Continents, USA, and Regional Rooms

covers: SPEC-3.3, SPEC-3.7  <!-- auto-seeded; refine by hand -->

**File:** 00k-capacity-regional-spread.spec.ts  
**Features tested:** Chatroom capacity enforcement (capacity=3, FIFO), geographic room cascade, multi-user multi-browser setup (25 users), cross-continental distribution, regional room auto-creation, server-side member count verification via API

---

## What this test does (in plain English):

1. **Setup:** Gun databases cleared. App launched with URL params `e2e_capacity=3&e2e_fifo=true` — enforces a hard cap of 3 users per room and FIFO eviction when exceeded.

2. **25 browser contexts are created** (one per "user"), each with spoofed geolocation and preset chatroom via init scripts:
   - 3 users positioned at San Francisco → targeting "global" room
   - 3 users positioned at Toronto area → targeting "north-america" room
   - 3 users positioned at São Paulo → targeting "south-america" room
   - 3 users positioned at London → targeting "europe" room
   - 3 users positioned at Tokyo → targeting "asia" room
   - 3 users positioned in Lagos, Nigeria → targeting "africa" room
   - 3 users positioned at Sydney → targeting "oceania" room
   - 4 users positioned at San Francisco → targeting "usa" room

3. **Each user's stage name is set** via `app.uiManager.currentUserStageName = "Capacity User <index+1>"` to identify them in test output.

4. **Memberships verified via server API:** After sync, the test polls the `/api/chatrooms/{room}/members` endpoint for each room (excluding TechSupport user ID) and confirms:
   - Global ≥ 3 members
   - North America ≥ 3 members
   - South America ≥ 3 members
   - Europe ≥ 3 members
   - Asia ≥ 3 members
   - Africa ≥ 3 members
   - Oceania ≥ 3 members
   - USA ≥ 3 members (note: 4 users targeted here due to capacity=3, one gets evicted)
   - Regional "california" room has > 0 members (auto-created from San Francisco geolocation clustering)

5. **Cleanup:** All 25 pages call `manualCleanup()`, all contexts are closed, Gun databases are cleared.

> **Why this matters:** Verifies that the capacity system correctly enforces per-room limits with FIFO eviction across a realistic multi-geography scenario. Users cascade into continent-level and regional rooms as expected, and smaller regional rooms (like California) are auto-created when enough users cluster together. Tests both the overflow behavior and server-side member tracking at scale (25 concurrent users).

---

**Helpers used:** `maybeClearGunDatabases`, `injectIdbClear`, `gotoWebApp`, `afterLoad`, `afterSync`, init script geolocation/location spoofing, server `/api/chatrooms/{room}/members` endpoint polling via Playwright `request.get()`
