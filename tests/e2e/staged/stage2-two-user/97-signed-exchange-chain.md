# 97 — Signed exchange chain: two browsers prove the exchange, a tampered event is reported after restart

covers: SPEC-31.13, SPEC-31.5, SPEC-31.9

OPEN-108 slice 6 (web stage2). Two real browser profiles on the same hub, one graph link between
them (the page-hosted Gun-over-WebRTC link of §31.9, REQ-GRAPH-30..34):

1. Tom authors a tag Talk (graph id from `newGraphTalkId`) and offers it to Jerry over the graph
   link (`offerTalkForE2e` → `graph.offer` → a numbered, hash-linked, signed pair-log entry).
2. Jerry's core applies the offer; the arrival is a `talk` graph event on her side
   (`expectGraphEvent`).
3. Jerry answers MATCH through the real responder path (`submitTalkResponsePairDirect` →
   `graph.answer` → her own signed entry back to Tom).
4. Tom sees the `answer` graph event; Jerry's answer is durable in her device graph
   (`expectGraphAnswerHistory`).

**Each side proves the other's signed entry and acknowledgement (REQ-GRAPH-43..45):**

- Tom's `__iinpublic_graph_status()` shows `chain.ok === true` (his own event chain verifies,
  REQ-GRAPH-40/41) and an open link to Jerry whose `lastAck.n >= 0` — Jerry's signed
  acknowledgement of Tom's log entries (her time against his entry's, `skewMs` attached).
- Jerry's status shows `chain.ok === true` as well.

All assertions are durable reads (core status / graph answer history), never toasts.

**A tampered local event is reported after restart (REQ-GRAPH-41):**

5. Both pages are quiesced with `manualCleanup()` (stops the mesh and every poll timer, so the
   worker's radisk flushes its last batch and schedules no further writes).
6. The spec rewrites one field of Tom's OWN event — the Talk version event `local/ev/<talkId>`,
   `title` → `HACKED …` — directly in the worker's IndexedDB (`gun-idb`/`nodes`, the radisk JSON
   file; the leaf at key `local/ev/<id>\x1btitle` holds `{':': value, '>': state}`). The event's
   `device` is checked against Tom's device id (parsed out of the event id) before the write, so
   the tampered event is provably one his device chained and signed.
7. Tom's page is reloaded (same browser context: localStorage identity + worker IndexedDB
   survive; the `injectIdbClear` init script is a once-per-context no-op here). The worker boots
   from the tampered store, the identity is re-installed, and
   `__iinpublic_graph_status().chain` must report `ok === false`, `chainBreaks: 1`, the tampered
   event's `seq` as `firstBadSeq`, reason `sig` — reported, never repaired.

**Harness seam decisions:**

- *Restart layer:* a plain `page.reload()` inside the same context, not a SIGKILL + persistent
  profile (spec 37's seam). The graph status re-reads and re-verifies every stored event on each
  call, so a worker restart over the durable IndexedDB is the layer the check actually reads;
  no re-login is needed because the context keeps localStorage (identity) and IDB (the graph).
- *Tamper vector:* IndexedDB, not a Gun `put`. The page has no Gun since OPEN-91 P6 (the worker
  owns the only instance), and the worker RPC splits paths on `/`, so it cannot address the
  single-soul nodes the device graph writes. Writing IDB directly also proves the check catches
  edits that bypass every app-layer write path.
- *Quiesce before tamper:* `manualCleanup()` on both pages first. The worker's radisk keeps the
  event in memory; any later Gun write would flush the original value back over the tampered
  record within ~250ms. With the mesh and timers stopped there are no more writes, so the
  tamper is still on disk when the reload's worker reads it.
