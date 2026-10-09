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

## Expected and current result

No plaintext marker may cross the hub boundary. Since 2026-10-09, authored/received Talk records and
the receiver's incoming-cluster envelope are SEA-encrypted inside the peerless worker Gun. Direct
mesh delivery carries the body endpoint-to-endpoint; server fallbacks may carry ciphertext only.
This is now a passing release gate rather than an expected-failure defect record.
