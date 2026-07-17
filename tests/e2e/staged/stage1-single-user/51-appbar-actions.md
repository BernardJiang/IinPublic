# 51 — AppBar actions

covers: SPEC-13.1  <!-- auto-seeded; refine by hand -->

Verifies the icon migration kept behavior identical (gui-redesign-plan §2, T1):

1. **Testids preserved** — `create-custom-chatroom-btn`, `return-home-btn`,
   `broadcast-talk-btn` all still exist exactly once.
2. **➕** opens the Talk Editor modal; Cancel closes it.
3. **🆕** opens the Create Room dialog; Cancel closes it.
4. **📣** with an empty OUT list fires the same guard toast the old text button used
   ("no talks to broadcast").
5. **🏠** becomes enabled after switching away from the home room; the `‹` back icon pops
   exactly one level (room detail → room list).
