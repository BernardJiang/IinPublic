# Test: Chatrooms - Travel Mode Single-Room Presence

covers: SPEC-3.3  <!-- auto-seeded; refine by hand -->

**Features tested:** Travel mode toggle, current-room switching, home-room memory and return-home behavior

---

## What this test does (in plain English):

1. **User starts in Global**; the room tree is Global → L1 region tiles (45° squares labeled by continent) → GPS grid rooms — no
   country/state/city rooms.
2. **Return Home** is visible and enabled.
3. **User travels by GPS grid**: Global → the London grid room ("📍 Near London") → the Tokyo grid
   room (titled by coordinates, no nearby named city) → Global. Remote grid rooms are opened the
   way a map tap opens them.
4. **One travel room at a time:** the London grid room is the only current row while there.
5. **User clicks Return Home** and lands back in their own grid room ("Near San Diego").

## Verifications:

- ✅ No country/state rooms are offered; travel targets are coarse GPS grid cells.
- ✅ Room context changes to the destination while traveling.
- ✅ Home room is remembered and restored by Return Home.
- ✅ Status bar reflects authoritative current-room state.
