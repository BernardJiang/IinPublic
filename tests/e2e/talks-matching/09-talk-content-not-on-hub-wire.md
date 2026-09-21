# Test: Wire audit — talk content vs the hub

covers: docs/testing/room-heartbeat-load-test.md (wire-audit finding)

**File:** 09-talk-content-not-on-hub-wire.spec.ts
**Features tested:** where talk content travels during a real two-user talk exchange (mesh vs relay/server)

## What this test does (in plain English)

1. Two browsers (Tom, Jerry) join the same room and form a mesh connection.
2. Tom creates a talk through the app's own talk service and announces it to the room, exactly as the broadcast
   button does. The talk title, question and answer text are unique marker strings.
3. Jerry receives the talk over the mesh and answers it.
4. Every WebSocket frame to/from the hub's Gun endpoint and every `/api` request/response of both browsers is
   recorded, then scanned for the markers. The report (console + `wire-report` attachment) lists which Gun records
   carried plaintext and which server calls carried only ciphertext (signaling relay, mailbox).

## Expected vs actual

Expected: no plaintext marker on the hub wire. **Actual (2026-09-21): the test currently fails as expected** —
`users/<pub>/talks/<id>`, `users/<pub>/receivedTalks/<author>/<id>` and `users/<pub>/incomingTalkClusters` are
written to the Gun graph, which syncs to the hub, and the hub relays them to the other connected client.
HTTP calls carry no plaintext. The test is marked `test.fail` so it documents the defect; when the defect is fixed
it will "pass unexpectedly" — remove the `test.fail` line then.
