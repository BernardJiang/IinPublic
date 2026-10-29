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
   SharedWorker sockets are captured through their separate Chromium network targets. Before the
   exchange, each participant writes a known public probe that the audit must observe; an empty
   worker capture cannot produce a passing privacy result.

## Expected and current result

No plaintext marker may cross the hub boundary. Authored/received Talk records and
the receiver's incoming-cluster envelope are protected by the core's sharing policy. Direct
mesh delivery carries the body endpoint-to-endpoint; server fallbacks may carry ciphertext only.
This is now a passing release gate rather than an expected-failure defect record.

Since 2026-10-25 (OPEN-91 P2) the spec also fails if any frame the browsers send to the hub writes or
asks for a soul in a private namespace (`local/`, and the old `pairs/` and `deliveryJournal/` homes of
the sender's response copy and delivery journal). Before P2 there were five on every run: Jerry's
pair response, its payload and its journal entry, and the same souls asked for by Tom — the hub could
see who answered whom and when.

The policy regression also deliberately writes an unknown namespace, plaintext pair/room content,
and SEA-signed private answer memory. The unknown record must be readable locally, but no probe
marker or private soul may appear on the wire. This catches accidental replication even when
normal app writers happen to use the right namespace.
