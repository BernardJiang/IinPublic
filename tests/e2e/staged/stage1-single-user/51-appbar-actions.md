# 51 — AppBar actions

covers: SPEC-13.1  <!-- auto-seeded; refine by hand -->

Verifies the icon migration kept behavior identical (gui-redesign-plan §2, T1):

1. **Testids preserved** — `create-custom-chatroom-btn` and `return-home-btn` each exist exactly
   once; `broadcast-talk-btn` is gone (talk exchange is automatic, OPEN-112).
2. **➕** opens the Talk Editor modal; Cancel closes it.
3. **🆕** opens the Create Room dialog; Cancel closes it.
4. **🏠** is hidden in the user's own Nearby room and becomes visible inside a newly created
   Place (the only way away from home now that tile travel is retired); the `‹` back icon pops
   exactly one level (room detail → room list) and 🏠 stays enabled there.
