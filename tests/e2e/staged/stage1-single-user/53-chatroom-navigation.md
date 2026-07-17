# 53-chatroom-navigation

covers: SPEC-3.3, SPEC-13.1  <!-- auto-seeded; refine by hand -->

Merged spec (speed re-organization): one shared boot instead of 3. Sections below are the original per-spec narratives.

---

## from 53-chatroom-back-icon.md

# 53 — Chatroom back icon

Room-detail navigation contract (gui-redesign-plan §3, test plan T3):

1. **Icon swap** — the AppBar left zone is empty at the room list; entering a room detail
   shows the `‹` back icon (`#back-to-chatrooms`); leaving hides it; re-entering another
   room brings it straight back.
2. **Return-home per context** — 🏠 is enabled in a non-home room's detail, stays enabled
   back at the list (current room unchanged), and flips to disabled after clicking it
   (the app switches to the home room).
3. **No leakage** — the chatrooms back icon never shows on other tabs.

---

## from 60-chatroom-hierarchy-walk.md

# 60-chatroom-hierarchy-walk

Covers TODO item **F** (catalog Part 5 option matrix).

Expand/collapse hierarchy nodes, confirm every row shows a headcount, enter a room and back (C1/C2).

---

## from 55-create-and-rename-room.md

# 55-create-and-rename-room

Covers TODO item **F** (catalog Part 5 option matrix).

Create a custom community room via the Create Room dialog, land on its room detail, then rename it as owner (C5/C6).
