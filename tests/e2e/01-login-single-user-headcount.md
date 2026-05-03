# Test: Single User Login & Headcount

**Features tested:** User authentication, session persistence, real-time headcount sync

---

## What this test does (in plain English):

1. **A user (Tom) logs into the app** — the test launches a browser window that opens the IinPublic app for the first time.

2. **The user lands in the "Global" chatroom.** The headcount displayed next to the "Global" chatroom should show `1` (only Tom is there).

3. **Tom leaves the app** — the test simulates Tom logging out or closing the browser.

4. **Tom logs back in** — a new page is opened for the same user session. The headcount for "Global" should again show `1`, confirming that Tom's session was persisted correctly and he was automatically re-connected to the chatroom.

## Verifications:

- ✅ After first login, "Global" chatroom headcount shows "1"
- ✅ After leaving and rejoining, headcount still shows "1" (session persistence works)
