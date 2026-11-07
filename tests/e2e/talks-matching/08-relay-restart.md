# 08 — Relay process restart recovery

covers: SPEC-5.2, SPEC-9.2

The controller restarts the relay process mid-session. The browser must observe the hub going
down, reconnect to the restarted relay, and republish — all while retaining its original SEA
identity (same `pub` before and after the restart).
