# 61 — Peer actions in the AppBar

covers: SPEC-7.9, SPEC-13.1  <!-- auto-seeded; refine by hand -->

User-layout actions after the redesign (§5, T5):

1. **📤 Send My Talks** renders inline in the layout's AppBar right zone, keeping
   `data-testid="peer-send-talks-btn"`.
2. **🚫 Block User** is not inline — it lives under the `⋯` overflow panel
   (destructive actions never get a one-tap surface), keeping
   `data-testid="peer-block-user-btn"`.
3. Blocking from the bar writes the real server block edge (same signal 15b asserts),
   closes the layout, and the same ⋯ item flips to **Unblock User**; unblocking
   removes the edge.
