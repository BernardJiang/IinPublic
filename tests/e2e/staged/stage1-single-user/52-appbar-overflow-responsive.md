# 52 — AppBar overflow responsive

Width-matrix check of the `⋯` overflow (gui-redesign-plan §1/§6, test plan T2):

1. At 1024 and 768 all four chatroom icons (➕ 📣 🏠 🆕) render inline; no `⋯` button.
2. At 390 everything still fits (the `⋯` slot is reclaimed when a single overflow would
   otherwise remain) — all inline.
3. At 320 only ➕ stays inline; 📣, 🏠, 🆕 collapse into the `⋯` panel **in priority order**
   (➕ stays inline longest → 🆕 collapses first).
4. Panel items are the same live elements — same ids/testids, labels visible — and invoking
   one (🆕) opens the Create Room dialog and closes the panel.
5. Growing the window back to 1024 restores every icon inline.
6. Tabs with a single action (Talks: ➕) never overflow, even at 320.
