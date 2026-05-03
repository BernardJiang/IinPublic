# Test: Chatroom UX — Member List Scroll & Unified Broadcast

**Features tested:** Member list scrolling behavior, single broadcast button per chatroom

---

## What this test does (in plain English):

This is a UI/UX test. 8 users join the "Global" chatroom.

1. **The "Owner" user joins** the Global chatroom
2. **7 "Peer" users** (Peer1 through Peer7) join the same chatroom

### Verification:

3. **The Owner sees 7 members** in the member list
4. **There is exactly ONE "Broadcast My Talks" button** on the page (not duplicated)
5. **The status bar** says "Broadcast to everyone in this room" (the unified broadcast text)
6. **The old broadcast text** ("Broadcast talk to everyone here") does NOT appear anywhere

### Scrolling test:

7. **The member list** (#chatroom-members-list) is tested to verify it scrolls:
   - The total scroll height is taller than the visible area
   - Scrolling to the bottom actually changes the scroll position

## Verifications:

- ✅ Member list shows all 7 peers when 8 people are in the room
- ✅ Exactly one broadcast action exists (no duplicated buttons)
- ✅ Status bar shows the correct unified broadcast label
- ✅ The member list is vertically scrollable when many users are present
