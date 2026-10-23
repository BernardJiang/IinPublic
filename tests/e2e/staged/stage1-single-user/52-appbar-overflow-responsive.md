# 52 — AppBar overflow responsive

covers: SPEC-3.6, SPEC-3.4, SPEC-6.5  <!-- auto-seeded; refine by hand -->

Width-matrix check of the `⋯` overflow (gui-redesign-plan §1/§6, test plan T2):

1. At 1024, 768 and 390 the three Chatrooms-root actions (Map, List, New Room) render inline;
   unrelated Create Talk, Broadcast and Return Home actions stay hidden.
2. At 320 Map stays inline while List and New Room collapse into the `⋯` panel in priority order.
3. Panel items are the same live elements — same ids/testids, labels visible — and invoking
   one (🆕) opens the Create Room dialog and closes the panel.
4. Growing the window back to 1024 restores every contextual icon inline.
5. Tabs with a single action (Talks: ➕) never overflow, even at 320.
