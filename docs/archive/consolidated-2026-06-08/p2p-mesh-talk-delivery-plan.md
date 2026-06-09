# Plan: Move all talk features onto the WebRTC mesh (server = discovery + signaling only)

Status: design sketch. Goal: delete star‑topology talk delivery. The Node server keeps
only **rendezvous** functions (who/where peers are) and **signaling** (WebRTC handshake +
STUN/TURN). No talk body, offer, response, incoming index, match, conversation, or
talk‑derived stat is created, relayed, or stored on the server.

---

## 1. Principles

1. **Server is a rendezvous, never a data path.** It answers "who is in room X" and forwards
   encrypted WebRTC signaling. Once a DataChannel is up, the server is out of the loop.
2. **Author‑owned / pair‑private data.** Talk bodies are owned by the author and sent over the
   mesh on demand; responses go pair‑to‑pair over a DataChannel.
3. **Receiver‑side policy.** Intake filtering (language, distance, content, adult, cutoff) is
   evaluated by the *receiver* on arrival, not by a server preview. This also removes the
   `broadcast-receiver-preview` HTTP round‑trip.
4. **Local‑first derivation.** Contacts, matches, talk history, and stats are computed locally
   from what a peer has sent/received — no server peer endpoints.
5. **Sparse overlay, not full mesh.** At N peers a full mesh is N² connections (1000 peers ≈
   500k channels). Peers connect to K neighbors and **gossip**; messages propagate epidemically.

---

## 2. What runs on the hub today (inventory to remove)

Talk delivery currently rides the Gun hub (`web-gun-service.ts` connects every browser to one
`/gun` peer; AXE disabled). Concretely:

| Concern | Current hub/server touchpoint |
|---|---|
| Broadcast announcement | `app.publishChatroomTalkAnnouncement` → Gun `chatrooms/<id>/announcements` (relayed by hub) |
| Per‑receiver offers | `registerReceiversOnServerForTalk` → `publishPeerTalkOfferToReceivers` (Gun `peerTalkOffers/<rid>`) |
| Talk body fetch | `loadIncomingTalkData` → `resolveTalkFromPeerMesh` / `talks/<id>` (Gun) |
| Audience preview | `previewReceiversOnServerForTalk` → `POST /api/talks/broadcast-receiver-preview` |
| Receiver resolution | `resolveBroadcastReceivers` → `GET /api/chatrooms/:id/members` |
| Star delivery (legacy) | `postRegisterReceiversForBroadcast` → `POST /api/talks/:id/register-receivers-for-broadcast`; server `incomingTalksMap` |
| Responses | `submitTalkResponsePairDirect` (Gun pair paths) + `subscribeToPairTalkResponses`; star: `talks/<id>/responses` |
| Matches / conversations | server `conversationsMap`; `POST /api/talks/:id/response` |
| Contacts / peer history | `GET /api/users/:id/peers`, `/peers/:peerId/relationship`, `/talk-history`, `/replies` (derived from server maps) |
| Stats | `recordTalkStatsResponse` + `stats-routes` indices |

Already present and reusable (the P2P substrate scaffolding):
`p2p-runtime.ts` (envelopes, signing, neighbor cache, discovery/signaling types),
`P2PPresenceClient`, `p2p-signaling-client.ts`, `p2p-webrtc-session.ts`,
`DirectP2PConversationTransport` (WebRTC DMs today), and the contacts view's **local fallbacks**
(`peerSummariesFromLocalConversations`, `peerSummariesFromLocalTalkExchanges`).

---

## 3. Target architecture

```
            ┌─────────────── server (minimum) ───────────────┐
            │  • Room roster (discovery): who is in room X     │
            │  • Presence: nearby peers, pub keys, TTL         │
            │  • WebRTC signaling relay (encrypted, TTL)       │
            │  • STUN/TURN config (NAT traversal)              │
            │  • Offline mailbox (encrypted, TTL) — fallback   │
            └──────────────────────────────────────────────────┘
                     ▲ rendezvous + handshake only
   peer A ──DataChannel── peer B ──DataChannel── peer C …  (sparse overlay)
     │  gossip(talk-announce) ─────────────►  │  ────────►  │
     │  ◄──── req/resp(talk-body) ──────────  │
     │  ◄──── pair msg(talk-response) ───────  (direct A↔responder)
```

New client module: **`PeerMeshService`** (sits beside `WebGunService`, eventually replaces it
for talk paths). Responsibilities:
- Maintain DataChannels to K neighbors in the current room (from the neighbor cache /
  bootstrap candidates), re‑establishing as membership changes.
- Typed, signed, framed messages over channels: `talk-announce`, `talk-body-request`,
  `talk-body`, `talk-response`, `presence-gossip`, `ack`.
- Gossip/forward with a seen‑set (dedupe by message id + TTL hops) so an announce reaches the
  whole room without a hub.
- Backpressure + flow control per channel; fall back to server mailbox for offline targets.

---

## 4. Server: keep vs remove

**Keep (minimum):**
- `chatroom-routes`: room join/leave + roster read (discovery). Trim to roster only.
- Presence endpoints (`P2PPresenceClient`: heartbeat, nearby, ack) — discovery.
- Signaling endpoints in `system-routes` (offer/answer/ICE relay, TTL’d, ciphertext‑only).
- STUN/TURN config endpoint (new, tiny) for NAT traversal.
- Encrypted **offline mailbox** (new, TTL, metadata‑only) — connection fallback when a target
  peer is offline. Bodies are ciphertext; server cannot read.
- Non‑talk public data if you choose to keep it server‑side for now: public profile,
  reputation, techsupport. (Out of scope for "talk features"; can migrate later.)

**Remove (star talk path):**
- `talk-delivery-routes` entirely (`/received`, `/register-receivers-for-broadcast`,
  `/response`) and the server `incomingTalksMap`, `talkResponsesMap`, `conversationsMap`.
- `POST /api/talks/broadcast-receiver-preview` (preview → receiver‑side).
- `peer-routes` (`/peers`, `/relationship`, `/talk-history`, `/replies`) → derived locally.
- `stats-routes` talk aggregation (see §6.8).
- Gun relay of `talks/*`, `peerTalkOffers/*`, `incomingTalksByUser/*`,
  `chatrooms/*/announcements`, `chatrooms/*/talks`, conversation messages. (Today
  `shouldSkipServerGunPersist` already refuses to *persist* these; the mesh removes the *relay*.)

---

## 5. New mesh message protocol (over DataChannel)

Reuse `createRelayEnvelope` / signed‑proof model from `p2p-runtime.ts`. Frame:

```
{ v:1, kind, msgId, roomId, ttlHops, senderPub, proof, payloadCiphertext? , payload? }
```

| kind | payload | routing |
|---|---|---|
| `talk-announce` | { talkId, authorId, title, type, qCount, contentHash } | gossip to neighbors, forward by seen‑set |
| `talk-body-request` | { talkId, authorId } | unicast toward author (or any holder) |
| `talk-body` | { talkId, talkData } (ciphertext) | unicast reply |
| `talk-response` | { talkId, answers, outcome } (pair ciphertext) | unicast author |
| `presence-gossip` | { peerId, pub, room, ts } | gossip |
| `ack` / `receipt` | { msgId } | unicast |

Announce carries only metadata + content hash; the body is pulled on demand
(`talk-body-request`/`talk-body`) so popular talks aren't duplicated needlessly and the author
stays the source of truth.

---

## 6. Feature‑by‑feature migration

### 6.1 Discovery & connection (foundation)
- Keep room roster + presence on server. On entering a room, fetch roster, pick K bootstrap
  neighbors via `getP2PBootstrapCandidates` / neighbor cache, run signaling, open DataChannels.
- Deliverable: `PeerMeshService.joinRoom(roomId)` yields a live neighbor set + send/recv.

### 6.2 Broadcast (replaces `publishChatroomTalkAnnouncement` + offers)
- Sender emits one `talk-announce` to its neighbors; gossip floods the room. **No per‑receiver
  offers** — drop `publishPeerTalkOfferToReceivers` from the delivery path (keep the sign‑once
  helper for any unicast case).
- Each receiver, on `talk-announce`: run **receiver‑side intake filter**
  (`talkPassesIntakeFilters` from `talk-intake-filters.ts`); if it passes, `talk-body-request`
  the author, then register locally and run the chatbot
  (`registerSelfAsReceiverOfIncomingTalk` + `maybeAutoChatbotReplyToAnnouncer`, both already
  exist and are hub‑independent once fed from the mesh).
- Cost: **O(talks)** sender work, O(edges) gossip — no O(users×talks) writes.

### 6.3 Incoming index
- `ownerIncomingTalkIndex` stays **local only** (already classified `encrypted-user-owned`).
  Populated from mesh `talk-body`, not from `peerTalkOffers` or server.

### 6.4 Responses & matches (replaces pair Gun paths + `subscribeToPairTalkResponses`)
- Responder sends `talk-response` directly to the author over their DataChannel (or via mailbox
  if author offline). Author keeps a **single local response inbox** keyed by talk — replaces
  the O(receivers) per‑pair Gun subscriptions (the other O(N) hot spot).
- Match logic stays in `src/shared/talk-engine.ts`; conversation creation becomes local on both
  sides when a mutual match is observed.

### 6.5 Contacts / peer history
- Drop `peer-routes`. The contacts view already has local derivations
  (`peerSummariesFromLocalConversations`, `peerSummariesFromLocalTalkExchanges`,
  `peerSummariesFromKnownPeople`); make those the only source. Match‑% chip (just added) is
  already computed from local stats.

### 6.6 Intake filtering / audience preview
- Move to receiver (§6.2). The compose‑time "audience preview" becomes a **local estimate**
  from the known room roster, or is dropped. Removes `previewReceiversOnServerForTalk` and the
  `broadcast-receiver-preview` endpoint. (Note: the stage1 `eligibleReceivers` test asserts the
  *modal rendering* via `confirmBroadcastAudience` directly — it survives; only the server
  preview source goes away.)

### 6.7 Chatbot
- Unchanged. It operates on talk data + memory; feed it from mesh announcements instead of Gun
  announcements. `maybeAutoChatbotReplyToAnnouncer` already does the dedupe.

### 6.8 Stats
- Server talk stats can't exist without seeing talks. Options: (a) drop global stats, (b)
  privacy‑preserving gossip aggregation (peers periodically gossip counters; anyone can tally),
  (c) opt‑in only. Recommend (a) for v1, revisit later.

### 6.9 Offline delivery (the hard case)
- Mesh delivers only to online peers. For offline targets, write a ciphertext envelope to the
  server **mailbox** (`mailbox/<recipientPub>`, TTL, metadata‑only); recipient drains on next
  connect, then it’s deleted. This is "connection fallback," not a data path the server can read.

---

## 7. Topology & scale (1000 × 1000)

- **Do not full‑mesh.** Each peer keeps K (≈8–16) neighbor channels chosen by
  `scoreP2PNeighbor` (recency, room overlap, latency, contact). Announce floods via gossip with
  TTL + seen‑set; expected coverage of the room in O(log N) hops.
- Talk bodies are **pulled** (request/response), so a 1000‑peer room broadcasting 1000 talks
  doesn't pre‑push 1M bodies — bodies move only to peers that pass intake and open the talk.
- Responses are unicast author‑ward; author’s single inbox is O(responders) messages, not
  O(responders) subscriptions.
- Supernode/relay‑assist: low‑capability peers (mobile/iOS per `P2P_PLATFORM_DESCRIPTORS`) lean
  on neighbor relays or the mailbox.

---

## 8. Incremental rollout (keep tests green at each step)

Flag: `P2P_MESH_TALKS` (default off; star remains until the end).

1. **Mesh transport up.** `PeerMeshService` + signaling + DataChannel ring in a room; a debug
   `mesh-ping` round‑trips. No feature change. Test: 3 browsers ping across the mesh.
2. **Announce over mesh** (behind flag), still also Gun — verify receivers get both; then make
   mesh authoritative when flag on. Test: find‑similar broadcast via mesh, concurrent again
   (no hub to saturate → revert the sequential workaround from `efe36744`).
3. **Body pull + receiver intake filter.** Port intake e2e specs to receiver‑side; delete
   `broadcast-receiver-preview` use.
4. **Responses over mesh + single inbox.** Replace `subscribeToPairTalkResponses`. Verify
   matches/conversations.
5. **Contacts local‑only.** Delete `peer-routes`; point contacts at local derivations.
6. **Offline mailbox** for the offline‑peer case.
7. **Delete star.** Remove `talk-delivery-routes`, server talk maps, Gun talk relay, the
   `P0_DIRECT_TALK_DELIVERY`/star branches, and `usesDirectTalkDelivery` forks. Flip default on.

Each phase is independently shippable and testable; star is the fallback until step 7.

---

## 9. Test impact

- `find-similar-people`: once announce+responses are on the mesh (step 2/4), remove the
  sequential‑deliver workaround and go concurrent again — the hub‑saturation reason is gone.
  Multi‑browser‑per‑user already models real peers, so it becomes the natural mesh test.
- Star‑mode integration suites (`talk-loop`, `peer-routes`, `system-routes`) shrink/delete as
  their endpoints go away; replace with mesh transport + receiver‑filter unit/integration tests.
- New: mesh transport tests (gossip coverage, seen‑set dedupe, body pull, offline mailbox drain,
  neighbor churn).

---

## 10. Risks & open questions

- **NAT traversal**: needs reliable STUN and a TURN fallback; without TURN some pairs can’t
  connect and must use the mailbox (latency).
- **Gossip storms / dedupe correctness**: seen‑set sizing, TTL hops, and fanout K need tuning;
  bad params either flood or under‑deliver.
- **Trust/abuse**: every mesh message is signed (`verifySignedP2PEnvelopeProof`); blocked peers
  must be dropped at the channel layer (neighbor cache already models `blocked`).
- **Eventual consistency**: a peer that was offline sees talks via mailbox drain; define TTL and
  "missed while offline" semantics.
- **Stats loss**: confirm product is OK dropping/relaxing global talk stats (§6.8).
- **Mobile/background**: iOS can’t hold long‑lived channels in background — relies on
  mailbox + notification‑assisted wake (already in the platform descriptors).

---

## 11. First concrete PR (suggested)

`PeerMeshService` skeleton + `P2P_MESH_TALKS` flag + room DataChannel bring‑up using the existing
signaling client, with a `mesh-ping` debug round‑trip and a 3‑browser e2e that asserts a message
gossips A→B→C without any `talks/*` or `peerTalkOffers/*` Gun write. That proves the rendezvous‑
only server model before any feature moves.
