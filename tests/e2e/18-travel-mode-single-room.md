# Test: Chatrooms - Travel Mode Single-Room Presence

**Features tested:** Travel mode toggle, current-room switching, home-room memory and return-home behavior

---

## What this test does (in plain English):

1. **User starts in Global** and sees Global headcount `1`.
2. **Travel mode is enabled** and a "Return Home" control appears.
3. **User travels to North America** by selecting that chatroom.
4. **Current room check:** Chatroom list marks North America as current room.
5. **User clicks Return Home** to go back to Global.
6. **Status bar check:** Stable status text confirms the user is back in Global.

## Verifications:

- ✅ Travel mode can be enabled from the chatroom UI.
- ✅ Room context changes to destination while traveling.
- ✅ Home room is remembered and restored by Return Home.
- ✅ Status bar reflects authoritative current-room state.
