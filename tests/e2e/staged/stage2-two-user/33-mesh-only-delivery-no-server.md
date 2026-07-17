# 33 — Mesh-only delivery, no server talk-delivery path

covers: SPEC-19.4, SPEC-3.12  <!-- auto-seeded; refine by hand -->

**What it proves:** After the P0 step-7 migration, talk delivery, matching, and conversation
creation are entirely peer-to-peer (mesh / pair-direct over Gun). The server no longer has a
talk inbox or an incoming-talks fetch endpoint, and the client never calls one.

**Flow:**
1. Bootstrap two users, MeshA and MeshB, on separate browsers.
2. Attach a `page.on('request')` recorder to BOTH pages before anything happens, capturing every
   `/api/*` request.
3. MeshA authors a `flow` talk (caches its body, records it in `myTalks`).
4. The talk is delivered to MeshB purely through the LOCAL Gun IN index using the
   `seedIncomingTalkForE2e` seam — no server inbox POST, no WebRTC hop.
5. MeshB answers MATCH via `submitTalkResponsePairDirect`; with no live WebRTC channel the
   response falls back to the encrypted server mailbox (ciphertext only).
6. MeshA drains its mailbox and ingests the response, creating the conversation locally.

**Assertions:**
- MeshB's incoming-talk cluster is present in `app.getLocalIncomingClustersForE2e()` (the local
  Gun `incomingTalksByUser` index) — proving delivery came from local Gun, not an `/api` fetch.
- The matched conversation exists on BOTH sides in `localStorage.myConversations`, and the
  deterministic conversation id is identical on both.
- Neither page issued ANY request to a talk-delivery endpoint
  (`/api/talks/:id/received`, `/api/talks/:id/response`, `/api/incoming-talks`,
  `/api/users/:id/incoming-talks`). The observed `/api` calls are dumped on failure.
- Probing the removed endpoints returns HTTP 404
  (`POST /api/talks/:id/received` and `GET /api/users/:id/incoming-talks`).

**Load-bearing part:** the network-log assertion (step 9) plus the 404 probes (step 10). Delivery
uses the local-Gun seed seam for determinism, so the transport claim is carried by "no
talk-delivery traffic was observed and those endpoints no longer exist."
