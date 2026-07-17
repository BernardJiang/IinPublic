# 54 — Notification auto-dismiss

covers: SPEC-13.1  <!-- auto-seeded; refine by hand -->

Toast contract after redesign §4 (rule G1/N6):

1. Every ordinary toast type (success / error / info / warning) auto-dismisses after ~3s.
2. A Match! toast keeps `data-match-notification="true"`, outlives the 3s window, and
   auto-dismisses by ~8s — the old "stays until clicked" behavior is gone.
3. Clicking a Match! toast dismisses it and opens the conversation created for that match
   (rule N6); the conversation overlay shows the peer's name.
4. Clicking an ordinary toast dismisses it without navigating anywhere.
