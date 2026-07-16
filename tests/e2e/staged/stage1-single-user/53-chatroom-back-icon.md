# 53 — Chatroom back icon

Room-detail navigation contract (gui-redesign-plan §3, test plan T3):

1. **Icon swap** — the AppBar left zone is empty at the room list; entering a room detail
   shows the `‹` back icon (`#back-to-chatrooms`); leaving hides it; re-entering another
   room brings it straight back.
2. **Return-home per context** — 🏠 is enabled in a non-home room's detail, stays enabled
   back at the list (current room unchanged), and flips to disabled after clicking it
   (the app switches to the home room).
3. **No leakage** — the chatrooms back icon never shows on other tabs.
