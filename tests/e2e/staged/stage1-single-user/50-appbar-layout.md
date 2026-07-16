# 50 — AppBar layout

Single-user check of the redesigned shell (gui-redesign-plan §1–§3, test plan T1):

1. **One bar everywhere** — every tab shows exactly one `.app-bar` (`#top-header`); the old
   second row (`.tab-action-bar` / `#chatroom-action-bar`) no longer exists; the status line
   renders inside the AppBar center zone.
2. **Scoped actions** — the right-zone icons appear only on their tab: chatrooms shows
   ➕ 📣 🏠 🆕, talks shows ➕ only, contacts/me show none, settings shows 📍 Refresh Location.
3. **Back icon** — entering a chatroom detail swaps the AppBar left zone to the `‹` back icon
   (same `#back-to-chatrooms` id as before); clicking it returns to the room list and hides
   the icon again.
