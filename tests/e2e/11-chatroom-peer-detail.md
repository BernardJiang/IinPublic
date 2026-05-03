# Test: Chatroom Peer Detail Views (5 scenarios)

**Features tested:** Member status display, peer detail overlay, talk history, "Send My Talks" in both auto and manual modes

---

This test file contains **5 separate sub-tests**, each with its own fresh setup and teardown:

## Sub-test 1: Stranger Status

**What it does:**
1. **Tom and Jerry** both join the "Global" chatroom
2. **Tom waits** for Jerry to appear in the member list
3. **Jerry's status** shows as "Stranger" (because they have had no prior interaction yet)

**Verifications:**
- ✅ Jerry appears in the member list
- ✅ Jerry's status is labeled "Stranger"

---

## Sub-test 2: Open/Close Peer Detail Overlay

**What it does:**
1. **Tom and Jerry** both join the "Global" chatroom
2. **Tom clicks on Jerry** in the member list
3. **Jerry's peer detail overlay** opens, showing Jerry's name, stats section, and a "Send My Talks" button
4. **Tom clicks the back button** → the overlay closes

**Verifications:**
- ✅ Clicking a member opens their detail overlay
- ✅ The overlay shows the member's name, stats, and send button
- ✅ The back button closes the overlay

---

## Sub-test 3: Talk History After Exchange

**What it does:**
1. **Tom creates and broadcasts** a talk ("Tennis Peer Test")
2. **Jerry receives and answers** with "Yes" (match)
3. **Tom opens Jerry's peer detail** and sees:
   - Talk history controls (sort/filter buttons)
   - At least one history item (the Tennis Peer Test exchange)
4. **Tom sorts by outcome** and **filters to "Sent"** items
5. **Tom closes** the overlay

**Verifications:**
- ✅ Peer detail shows talk history after a talk exchange
- ✅ Sort by outcome works
- ✅ Filter to "Sent only" shows at least 1 item

---

## Sub-test 4: Send My Talks — Auto Mode

**What it does:**
1. **Tom creates a talk** ("Send Test Talk") that hasn't been sent to Jerry yet
2. **Both join** the "Global" chatroom
3. **Tom opens Jerry's peer detail**
4. **Auto mode is checked by default**
5. **Tom clicks "Send My Talks"** → it sends all unsent talks to Jerry
6. **The button text changes** to confirm the send
7. **Jerry checks his Talks tab** → "Send Test Talk" appears

**Verifications:**
- ✅ Auto mode is enabled by default
- ✅ "Send My Talks" sends unsent talks to the selected peer
- ✅ The recipient sees the talks in their Talks tab

---

## Sub-test 5: Send My Talks — Manual Mode

**What it does:**
1. **Tom creates a talk** ("Manual Mode Talk")
2. **Both join** the "Global" chatroom
3. **Tom opens Jerry's peer detail**
4. **Tom unchecks the auto mode** checkbox (switches to manual mode)
5. **Tom clicks "Send My Talks"** → a **picker modal opens** (showing which talks to send)
6. **Tom cancels** the picker → it closes
7. **Tom closes** the overlay

**Verifications:**
- ✅ Auto mode checkbox is checked by default
- ✅ Unchecking auto mode switches to manual mode
- ✅ Clicking "Send My Talks" in manual mode opens a selection picker
- ✅ Cancel button closes the picker
