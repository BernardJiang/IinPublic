# Software Requirements Specification — IinPublic

**Version:** 1.0  
**Date:** 2026-05-25  
**Author:** Hongyu Jiang  
**Status:** Living document

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Overview](#2-system-overview)
3. [Architecture](#3-architecture)
   - 3.1 Current Architecture (Star Topology)
   - 3.2 Target Architecture (P2P Relay Mesh)
   - 3.3 Migration Roadmap
4. [Functional Requirements](#4-functional-requirements)
   - 4.1 User Identity and Authentication
   - 4.2 Location and Chatrooms
   - 4.3 Talks System (REQ-TALK-*; REQ-CHATBOT-* for differential answering)
   - 4.4 Match and Conversation
   - 4.5 Reputation
   - 4.6 P2P Network Layer
   - 4.7 Desktop Node (Super-peer)
   - 4.8 Interaction Ledger (DAG-Based History and Delta Sync)
5. [Data Architecture](#5-data-architecture)
   - 5.1 Current Data Model
   - 5.2 P2P Data Model
   - 5.3 Ownership and Replication Rules
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [Security and Privacy](#7-security-and-privacy)
8. [Technology Stack](#8-technology-stack)
9. [Glossary](#9-glossary)

---

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements for IinPublic — a location-based, privacy-preserving social discovery platform. It serves as the single authoritative reference for product decisions, architecture choices, and implementation planning.

### 1.2 Product Description

IinPublic is a decentralized platform for real-world social discovery. Users create structured "talks" — interactive Q&A forms — and broadcast them to people nearby. When two users' answers to each other's talks meet mutual compatibility criteria, a match is created and a private conversation opens between them. The system prioritizes local, ephemeral discovery over persistent social graphs.

### 1.3 Intended Audience

This document is written for the development team, technical architects, and any future contributors. It assumes familiarity with TypeScript, Gun.js, and WebRTC fundamentals.

### 1.4 Scope

This SRS covers the web client (TypeScript SPA), the Node.js server, the P2P networking layer (current and proposed), the desktop super-peer client, and all data storage and replication concerns. It does not cover the Android client in detail, though architecture decisions here apply equally to it.

---

## 2. System Overview

IinPublic allows a user to:

- Create a profile with a public stage name, blurred GPS location, and optional headshot.
- Join location-based chatrooms organized in a geographic hierarchy (Global → Region → City → Subroom).
- Compose "talks" — structured Q&A flows (flow, tag, survey, or route type) — and broadcast them to nearby users.
- Receive incoming talks from others, answer them, and be matched when compatibility criteria are met.
- Open private encrypted conversations with matched users.
- Build reputation through community engagement, vouching, and age verification.
- Block users and manage their own visibility.

The platform's defining constraint is **local relevance**: users interact with people in their physical vicinity, not a global social graph. This shapes every architectural decision.

---

## 3. Architecture

### 3.1 Current Architecture: Star Topology

The current system is a Gun.js star topology. One central server acts as the hub; all browser clients are spokes. Every read and write passes through the server.

**Server responsibilities:**
- Hosts the Gun.js graph database with disk persistence (`radata/` folder).
- Serves all REST API routes: talk delivery, user management, conversations, stats, peer detail.
- Maintains the authoritative in-memory `incomingTalksMap` (`Map<userId, Map<leaf, cluster>>`), bypassing Gun for high-frequency fanout writes.
- Runs Socket.IO for chatroom membership and live presence.
- Performs server-side match logic by calling `checkIfMatch` from `src/shared/talk-engine.ts`.

**Browser responsibilities:**
- Runs a Gun client that syncs from the server over HTTP.
- Caches the personal data slice in IndexedDB via Gun's RAD adapter.
- Encrypts private fields (blocked users, known people, talk filters) with SEA before writing.
- Holds no server-side authority — all writes are forwarded to the server.

**Limitation:** The server is a single point of failure and a scaling bottleneck. All data lives on one machine. The architecture does not allow direct browser-to-browser communication.

### 3.2 Target Architecture: P2P Relay Mesh

The target architecture redistributes authority from the server to the peer mesh. The server becomes a lightweight signaling and presence service only. All application data lives on user devices and replicates directly between peers via WebRTC using Gun's mesh protocol.

**Server responsibilities (reduced):**
- Maintains an ephemeral, in-memory location index: `userId → { encryptedLocation, lastSeen }`. No disk persistence.
- Provides a `/api/nearby` endpoint returning a short list (20–50) of live peers within a configurable radius of the requesting user.
- Provides a WebRTC signaling channel (SDP offer/answer, ICE candidate exchange) for peers negotiating a direct connection.
- Handles initial user registration and SEA keypair verification.
- Holds no application data between restarts.

**Browser responsibilities (expanded):**
- Maintains a **neighborhood**: 3–5 active WebRTC peer connections to nearby users, established via Gun's `gun/lib/webrtc` adapter and `simple-peer`.
- Refreshes neighborhood from the server's `/api/nearby` endpoint when peers drop.
- Stores all own data and subscribed data in IndexedDB (Gun RAD), acting as a first-class graph node.
- Performs all match logic locally via `checkIfMatch` (already client-portable in `src/shared/`).
- Fans out talks directly to peer connections rather than posting to a server route.

**Neighborhood redundancy:** Neighborhoods overlap geographically. If user A is in Tokyo they connect to 30+ nearest peers. Some of those peers' neighborhoods overlap with peers in Osaka. Data propagates through this gradient without any node holding a complete global roster. Each node targets a minimum of 3 active peer connections; if one drops it re-queries `/api/nearby` for a replacement.

**What is unchanged:** The SEA keypair model, talk-engine match logic (`src/shared/talk-engine.ts`), location blurring, and the chatroom hierarchy. These modules are already cleanly separated and run on both sides. Content-addressing migrates from the local SHA-256 approach (`computeTalkIdFromTalkData` / `buildTalkIdentityKey` in `talk-content-id.ts`) to CIDv1 computed via the `multiformats` package — the identifier concept is the same, the format changes. See Phase G migration.

### 3.3 Migration Roadmap

Migration from star to P2P is incremental, preserving backward compatibility at each phase.

**Phase A — Dual-mode server.** Add WebRTC signaling endpoints to the existing server. Browser clients establish peer connections alongside their existing server connection. Validate Gun mesh sync between browsers without removing any server functionality.

**Phase B — Shift writes to client.** Move talk delivery fanout and conversation writes to the client, using the peer mesh as transport. Server `radata/` remains as a fallback read source. The `incomingTalksMap` server-side Map is replaced by Gun subscriptions on the peer mesh.

**Phase C — Server becomes relay-only.** Remove all application Gun paths from the server. Remove `radata/`. Strip all application API routes (talk delivery, conversation CRUD, stats). Server holds only the ephemeral location index and signaling state. Desktop super-peer nodes absorb durable-storage responsibilities.

**Phase D — Optional DHT bootstrap.** Replace or supplement the signaling server's peer discovery with a distributed hash table (using `gun/lib/nts` or a Kademlia-style bootstrap layer) so the network can survive full server downtime.

**Phase E — Interaction ledger bootstrap (parallel with Phases A–B).** Introduce the `InteractionEvent` type and `LedgerService` (client-side). New interactions write to both existing Gun paths (backward compatibility) and the new `ledger/<userId>/events/<seq>` paths. Pre-ledger history is not back-filled.

**Phase F — Delta sync over peer connections.** During the WebRTC peer handshake, add `LEDGER_STATE` exchange before talk delivery. Peers without ledger support fall back to full Gun sync; peers that both support the ledger switch to O(Δ) delta-sync automatically.

**Phase G — Ledger as sole source of truth.** Remove duplicate writes to legacy Gun paths. Replace `talk-content-id.ts` SHA-256 identifiers with CIDv1 (`multiformats`) for all entity IDs (`talkId`, `responseId`, `messageId`, `questionId`, event `id`). Ledger indexes (`index/talkId`, `index/responseId`, `index/withdrawn`) replace `incomingTalksByUser` and the per-talk `talkAnswerTemplateByUser` cache; the per-question cache (`byQuestion/<questionId>`) becomes the sole chatbot cache.

---

## 4. Functional Requirements

### 4.1 User Identity and Authentication

**REQ-AUTH-01:** A user creates an account with a stage name, blurred GPS location, optional headshot, preferred languages, and age verification status.

**REQ-AUTH-02:** Authentication uses Gun SEA (Security, Encryption, Authorization). Each user has a keypair generated and stored on their device. Private key material never leaves the device in plaintext.

**REQ-AUTH-03:** The user's public key acts as their persistent identity across sessions and devices.

**REQ-AUTH-04:** Private profile fields (blocked users, known people, talk filters) are SEA-encrypted under the user's keypair before being written to the graph. The server cannot read them.

**REQ-AUTH-05 (P2P):** On the peer mesh, the server validates that writes to a user's namespace carry a valid SEA signature. Peers forward only signed writes.

### 4.2 Location and Chatrooms

**REQ-LOC-01:** User GPS coordinates are blurred before storage using `LocationPrivacy.blurLocation` with a configurable radius (default 1000m).

**REQ-LOC-02:** Chatrooms are organized in a static hierarchy: Global → Region → City → Subroom. The `CHATROOM_HIERARCHY` tree in `src/shared/chatroom-hierarchy.ts` is authoritative.

**REQ-LOC-03:** A user joins the chatroom corresponding to their blurred location. Chatrooms split automatically when membership exceeds 1000 users (implemented in the Phase 1 `ChatroomManager`).

**REQ-LOC-04 (P2P):** The server's `/api/nearby` endpoint returns live peers within a configurable geographic radius. Clients use this list to establish their WebRTC neighborhood. No client receives the full global user list.

**REQ-LOC-05 (P2P):** Location registration with the server uses an encrypted location blob; the server never stores plaintext coordinates.

### 4.3 Talks System

**REQ-TALK-01:** A talk is a structured Q&A form with one of four types: **flow** (directed graph of questions), **tag** (checkbox list), **survey** (data collection, no match outcome), **route** (DAG with `next` pointers).

**REQ-TALK-02:** All four types share the `Talk` struct defined in `src/shared/types.ts`. Talk type determines runtime behavior, not storage format.

**REQ-TALK-03:** Nested arrays are not stored directly in Gun; `questionsJson` (serialized string) is written alongside `questions` arrays to work around Gun's array limitation.

**REQ-TALK-04:** Talk identity is a **CIDv1** (dag-json codec, sha2-256) computed locally from a canonical serialization of the talk's fields using the `multiformats` npm package. This enables deduplication across rebroadcasts — two peers that receive the same talk from different routes recognize it as identical without content inspection. See REQ-LEDGER-12.

**REQ-TALK-05:** A talk is broadcast to users in the sender's geographic neighborhood who pass the receiver's intake filters (`talkPassesIntakeFilters` in `src/shared/talk-intake-filters.ts`).

**REQ-TALK-06 (P2P):** Talk broadcast is performed by the originating client by writing to the Gun peer mesh. Delivery is fan-out through connected peers. There is no server-side `POST /api/talks/:id/received` route in the P2P model.

**REQ-TALK-07:** A receiver's `TalkIntakeFilters` (language, age gate, and other criteria) are checked before a talk is surfaced to the receiver's inbox. In the P2P model this check runs on the receiver's device.

**REQ-TALK-08:** Each question within a talk carries a `questionId = CIDv1(canonicalSerialize({ text, type, options }))` computed from the question's semantic content independently of the enclosing talk. Routing and match-flag fields are excluded from the `questionId` hash so that routing-only edits do not invalidate cached answers. See REQ-LEDGER-14.

**REQ-CHATBOT-01 — Per-question answer cache:** The chatbot's answer cache is keyed by `questionId`, not by `talkId`. The cache path is `talkAnswerTemplateByUser/<userId>/byQuestion/<questionId>`. An answer written to this cache when Alice answers any talk propagates to all future talks that contain a question with the same `questionId`, regardless of which user sent them or when.

**REQ-CHATBOT-02 — Differential answering:** When a new talk arrives, the chatbot classifies each question as auto-filled (cached answer found) or needs-input (no cached answer). Alice is presented only the needs-input questions as active inputs, with auto-filled answers shown alongside in a grayed, overridable state. If all questions are auto-filled, a review screen is shown before submission — silent auto-submit is not permitted when the user could reasonably want to verify.

**REQ-CHATBOT-03 — TALK_SUPERSEDED triggers cache seed:** When the chatbot receives a new talk T2 and the sender's ledger contains `TALK_SUPERSEDED { oldTalkId: T1, newTalkId: T2 }`, the chatbot pre-seeds its cache lookup for T2 using Alice's answers to T1 (if any) before running the differential algorithm. If Alice already submitted R1 to T1, the client shows a prompt: *"Bob updated this talk. Your previous answers are pre-filled — please review and answer any new questions."* If Alice had not yet submitted, the prompt reads: *"Bob updated his talk. Your draft answers have been carried over where applicable."*

**REQ-CHATBOT-04 — No silent re-submission after TALK_SUPERSEDED:** If the chatbot had previously auto-submitted R1 to T1 without Alice's manual review, a review step is always forced for T2 upon receiving TALK_SUPERSEDED — a change in the talk means the situation has materially changed and silent re-submission is not appropriate.

**REQ-CHATBOT-05 — Cache write-back:** On every talk submission (whether manual, semi-automatic, or chatbot-assisted), the client writes `answerCache[q.id] = answer` for every question in the submitted response, including questions that were auto-filled and left unchanged. This refreshes the cache entry and keeps the most recently used answer available for future talks.

### 4.4 Match and Conversation

**REQ-MATCH-01:** Match logic is implemented exclusively in `src/shared/talk-engine.ts` (`checkIfMatch`, `checkIfIgnore`). It must never be duplicated in routes or UI.

**REQ-MATCH-02:** A match occurs when both users' answers to each other's talks satisfy the mutual compatibility criteria defined in the talk graph. The match creates a `conversation` record.

**REQ-MATCH-03 (P2P):** Match checking runs client-side when a talk response is received. If a match is detected, the initiating client creates the conversation record in the Gun graph and notifies the other party via the peer mesh.

**REQ-CONV-01:** A conversation stores messages with content, timestamp, and sender identity.

**REQ-CONV-02:** Conversation messages are SEA-encrypted end-to-end between the two participants. Neither the server nor peers can read message content.

**REQ-CONV-03 (P2P):** Each participant's device stores the conversation locally in IndexedDB and replicates new messages to the other participant via their shared peer neighborhood.

### 4.5 Reputation

**REQ-REP-01:** Reputation is computed by `ReputationManager.updateReputation(rep, eventType, value?)` in `src/shared/reputation.ts`.

**REQ-REP-02:** Reputation events include: talk creation, answering a talk, matching, being blocked, vouching, and age verification.

**REQ-REP-03:** Age verification requires `AGE_VERIFICATION_THRESHOLD = 3` independent peer vouches to flip `ageVerified` to `true`.

**REQ-REP-04 (P2P):** Reputation data is stored on the user's own graph node and replicated to peers. Vouches are signed by the vouching user's SEA keypair to prevent forgery.

### 4.6 P2P Network Layer

**REQ-P2P-01:** Each browser client maintains a minimum of 3 and a target of 5 active WebRTC peer connections at all times.

**REQ-P2P-02:** Peer connections are established via the Gun `webrtc` adapter using `simple-peer` as the underlying WebRTC library.

**REQ-P2P-03:** When a peer connection drops, the client re-queries `/api/nearby` to find a replacement peer within 5 seconds.

**REQ-P2P-04:** The signaling server is the only server-side component that handles WebRTC SDP and ICE exchange. It does not store or inspect the payload of any Gun messages.

**REQ-P2P-05:** A client that cannot establish a direct WebRTC connection to a target peer (due to symmetric NAT) routes through a mutually reachable desktop super-peer. The signaling server tracks which peers have announced stable routable addresses.

**REQ-P2P-06:** Gun's CRDT merge rules govern conflict resolution when the same graph node is written by multiple peers. The last-write-wins timestamp in Gun's HAM (Hypothetical Amnesia Machine) is the tiebreaker. Application code must not assume write ordering.

### 4.7 Desktop Node (Super-peer)

**REQ-NODE-01:** A desktop Node.js app runs a full Gun instance with disk persistence (`radata/` on the user's local filesystem).

**REQ-NODE-02:** The desktop node connects to the signaling server, registers its location, and joins the same peer mesh as browser clients.

**REQ-NODE-03:** The desktop node announces a stable, routable address to the signaling server so it can be used as a TURN-like relay for browser peers behind restrictive NAT.

**REQ-NODE-04:** The desktop node's `radata/` persists the neighborhood's graph data, surviving browser cache evictions and providing durability for the peer mesh.

**REQ-NODE-05:** The desktop node speaks the same Gun Wire protocol as the browser client. No special protocol or API is required for interoperability.

**REQ-NODE-06:** On first launch, the desktop node bootstraps by connecting to the signaling server's `/api/nearby` endpoint and syncing from its returned peer list. Subsequent launches can bootstrap from locally cached peer addresses without server involvement.

### 4.8 Interaction Ledger (DAG-Based History and Delta Sync)

> Detailed design: [p2p-architecture.md §6](./p2p-architecture.md) · Background: [blockchain-dag-survey.md](./blockchain-dag-survey.md)

**REQ-LEDGER-01:** Each user maintains a personal **interaction ledger** — an append-only, hash-linked sequence of signed interaction events stored in Gun at `ledger/<userId>/events/<seq>`. The ledger provides a tamper-evident, provable timeline of all user interactions: talk creation, broadcasting, receiving, answering, matching, and messaging.

**REQ-LEDGER-02:** Each interaction event contains: a content-addressed `id` (**CIDv1**, dag-json codec, sha2-256, computed locally via `multiformats` from the canonical serialization of `seq + kind + content + prev + pubkey`), a monotonically increasing `seq` number, a `prev` pointer to the `id` of the preceding event, an event `kind`, the author's `pubkey`, a `timestamp`, a JSON-serialized `content` payload, and a SEA `sig` over all fields. Any peer receiving an event verifies all three: the CIDv1 `id`, the `prev` chain integrity, and the `sig`.

**REQ-LEDGER-03 — Talk versioning:** A user who modifies any field of a talk produces a new CIDv1 and therefore a new `talkId` (see REQ-LEDGER-12 and REQ-TALK-04). The modification is recorded as a new `TALK_CREATED` event in the ledger. The original talk and its ledger entry are immutable and remain accessible. Peers who have seen the original `talkId` are not re-sent the original; they receive only the new-`talkId` event if their ledger `seq` is behind.

**REQ-LEDGER-04 — Response versioning:** A user who modifies their answer to a received talk produces a new `responseId` — computed as `CIDv1(canonicalSerialize({ talkId, responderId, responseContentJson }))`. This triggers a new `TALK_ANSWERED` event. Peers whose ledger `seq` for this feed is behind the new event's `seq` receive it automatically during the next delta-sync. The new response supersedes the old one for match-logic purposes; the old response remains in the ledger history.

**REQ-LEDGER-05 — Deduplication:** A peer receiving a talk or response whose `talkId` / `responseId` is already present in its local ledger discards the duplicate without writing a new ledger event. No duplicate `TALK_RECEIVED` or `TALK_ANSWERED` events are created for content already held.

**REQ-LEDGER-06 — Delta sync protocol:** When two peers establish a WebRTC connection, they perform a ledger handshake: each sends a `LEDGER_STATE` message declaring the highest `seq` they hold per feed. Each peer then sends the other only events with `seq` greater than what the other declared. The exchange volume is O(Δ) — proportional to the number of new events, not total history.

**REQ-LEDGER-07 — Immutability enforcement:** Gun path `ledger/<userId>/events/<seq>` is written once and never overwritten. Because the event `id` is a hash of its content, Gun's last-write-wins HAM treats a re-write of the same `seq` as a no-op (identical state). Application code must never mutate a written ledger entry.

**REQ-LEDGER-08 — Conversation sub-DAG:** Conversation messages between two users use a two-writer DAG structure. Each message references both the sender's previous message (`seq`) and the last message the sender has observed from the other party (`prevSeen`). This gives a causal ordering that is mergeable after either party goes offline and reconnects, without a central sequencer.

**REQ-LEDGER-09 — Ledger indexes:** The system maintains two secondary indexes in Gun for fast lookup: `ledger/<userId>/index/talkId/<id>` maps a `talkId` to the `seq` of its `TALK_CREATED` event; `ledger/<userId>/index/responseId/<id>` maps a `responseId` to the `seq` of its `TALK_ANSWERED` event. These replace the current `incomingTalksByUser` and `talkAnswerTemplateByUser` patterns in the target architecture.

**REQ-LEDGER-10 — Migration compatibility:** During the migration period (Phases E–G as defined in p2p-architecture.md §6.9), new interactions write to both the legacy Gun paths and the new ledger paths. Peers that do not yet support the ledger continue to use the legacy paths; peers that both support the ledger switch to delta-sync automatically on connection. Back-filling of pre-ledger history is not required.

**REQ-LEDGER-11 — TALK_SUPERSEDED event:** When a user edits a talk and broadcasts the new version, they may emit a `TALK_SUPERSEDED { oldTalkId, newTalkId }` event into their ledger. This event is advisory: it does not invalidate any answer or match that occurred against `oldTalkId`, and peers that have already answered the old talk are not required to re-answer the new one. Receiver clients use this event to group the two versions in the UI and to trigger the chatbot differential answering flow (§4.3 REQ-CHATBOT-*). If `TALK_SUPERSEDED` has not yet arrived, both versions appear in the inbox independently until the ledger delta-sync catches up.

**REQ-LEDGER-12 — CIDv1 for all content addresses:** All content-addressed identifiers — `talkId`, `responseId`, `messageId`, and the `id` field of every `InteractionEvent` — are computed as **CIDv1** (dag-json codec, sha2-256) using the `multiformats` npm package. Computation is entirely local; no IPFS daemon or network connection is required. The canonical serialization of any object before hashing must use deterministic key ordering and must exclude undefined fields, so that structurally identical content always produces the same CID. This unifies the content-addressing scheme with IPFS (used for media blobs), so that any CID produced by IinPublic could also address the same content in IPFS without re-hashing. Text-only talks are never added to IPFS; their CIDv1 serves as a locally-computed identifier only.

**REQ-LEDGER-13 — TALK_WITHDRAWN event:** A talk author may emit `TALK_WITHDRAWN { talkId }` into their ledger to stop new delivery of that talk. Peers receiving this event in a ledger delta cease routing the named talk to users who have not yet received it. The ledger entry for the talk and all associated answers and matches remain immutable. Answers submitted before or after the TALK_WITHDRAWN event are still evaluated by the recipient's match logic, since the answerer acted in good faith. After a configurable grace window (default 24 hours), the talk author's client may demote new match notifications for the withdrawn talk from active to archival, but this carries no protocol enforcement. The standard post-edit workflow emits TALK_CREATED(T2), TALK_SUPERSEDED(T1→T2), and TALK_WITHDRAWN(T1) as consecutive ledger events before broadcasting T2.

**REQ-LEDGER-14 — Question-level identity:** Each question within a talk carries a `questionId = CIDv1(canonicalSerialize({ text, type, options }))`, derived from the question's semantic content (what it asks) independently of which talk it belongs to or how it is routed. If the question text and answer options are unchanged between T1 and T2, the `questionId` is the same even if routing or match-flag logic changed. This enables the chatbot's per-question answer cache to carry answers across talk versions. The full `talkId` continues to cover all fields including routing, so match logic integrity is unaffected.

---

## 5. Data Architecture

### 5.1 Current Data Model (Star Topology)

All data lives in the Gun graph on the server's `radata/` folder. Key paths:

| Gun Path | Owner | Contents |
|---|---|---|
| `users/<id>` | Server | Public user record |
| `user-public-profile/<id>` | Server | Headshot, languages, profile JSON |
| `user-talk-filters/<id>` | Server (encrypted) | Serialized `TalkIntakeFilters` |
| `user-blocks/<blockerId>/<targetId>` | Server | Block relationship |
| `talks/<id>` | Server | Talk definition, responses, stats |
| `incomingTalksByUser/<userId>/<key>` | Server | Incoming talk cluster (mirror) |
| `conversations/<id>` | Server | Conversation record |
| `talkAnswerTemplateByUser/<userId>/<key>` | Server | Answer template cache |

The server-side `incomingTalksMap` (in-memory `Map`) is authoritative for incoming talk clusters; the Gun path is a mirror only.

### 5.2 P2P Data Model

In the P2P model the same Gun paths exist but ownership is distributed. Each node in the graph is owned by whoever holds the signing SEA keypair for that namespace.

| Gun Path | Owner | Stored On |
|---|---|---|
| `users/<id>` | User | Author's device + subscribed peers |
| `user-public-profile/<id>` | User | Author's device + subscribed peers |
| `user-talk-filters/<id>` | User (encrypted) | Author's device only |
| `user-blocks/<blockerId>/…` | User (encrypted) | Author's device only |
| `talks/<id>` | Talk author | Author's device + peer mesh |
| `conversations/<id>` | Both participants | Both devices + shared peers |
| `talkAnswerTemplateByUser/<userId>/…` | User | Author's device |
| `ledger/<userId>/events/<seq>` | User (signed) | Immutable interaction event; author's device + subscribed peers |
| `ledger/<userId>/seq` | User | Current highest seq; author's device |
| `ledger/<userId>/index/talkId/<id>` | User | seq lookup by talkId; author's device |
| `ledger/<userId>/index/responseId/<id>` | User | seq lookup by responseId; author's device |
| `ledger/<userId>/index/withdrawn/<talkId>` | User | seq of TALK_WITHDRAWN event for talkId; author's device |
| `talkAnswerTemplateByUser/<userId>/byQuestion/<questionId>` | User | Per-question chatbot answer cache (Phase G+) |

The server's ephemeral location index is the only server-side state:

| Server Store | Contents | Persistence |
|---|---|---|
| In-memory location index | `userId → { encryptedLocation, lastSeen }` | None (memory only) |
| Signaling state | Active SDP/ICE sessions | None (per-session) |

### 5.3 Ownership and Replication Rules

**Authoritative ownership:** A Gun graph node is owned by the user whose SEA keypair signs it. Gun's SEA layer enforces this cryptographically — no peer can overwrite a node it does not own, regardless of which device it is running on.

**Replication scope:** A node replicates to all peers that have subscribed to its path. Subscription is driven by application logic (e.g., opening a conversation subscribes both participants to each other's message paths). Peers that have never subscribed to a path never receive its data.

**Local persistence:** Each device persists all data it has subscribed to in IndexedDB (browser) or `radata/` (desktop). Data persists across restarts. Browser engines may evict IndexedDB under storage pressure; desktop nodes are not subject to eviction.

**Conflict resolution:** Gun's HAM (Hypothetical Amnesia Machine) resolves concurrent writes using a last-write-wins rule with a machine timestamp. Application data structures are designed to be append-only where possible (message threads, reputation events) to minimize conflicts.

**Private data:** Fields encrypted with the user's SEA keypair (`user-talk-filters`, `user-blocks`) are stored in the graph as ciphertext. Peers store and forward the ciphertext without being able to read it. Decryption happens only on the key-holder's device.

---

## 6. Non-Functional Requirements

**NFR-PERF-01:** Talk delivery to all peers in a user's neighborhood must complete within 2 seconds under normal network conditions.

**NFR-PERF-02:** A new peer connection (from neighborhood refresh to first successful Gun message exchange) must complete within 5 seconds.

**NFR-PERF-03:** The server's `/api/nearby` endpoint must respond within 200ms for up to 100,000 registered live users.

**NFR-SCALE-01:** No single server must hold more than one hop's worth of connection state. The signaling server is horizontally scalable by sharding the location index geographically.

**NFR-SCALE-02:** Network capacity scales linearly with the number of desktop super-peer nodes. Adding a super-peer in a city increases that city's relay capacity without changing the server.

**NFR-AVAIL-01:** The peer mesh continues to operate for existing connected peers if the signaling server is unavailable. Only new arrivals that have no cached peer addresses are affected.

**NFR-AVAIL-02:** A desktop node must be able to reconnect to the mesh and resume syncing after an arbitrary offline period by replaying Gun deltas from its local `radata/`.

**NFR-STORE-01:** Browser clients should not exceed 50MB of IndexedDB storage under normal use. Graph data outside the user's active neighborhood is not retained.

**NFR-STORE-02:** Desktop nodes impose no hard storage limit but should implement a configurable pruning policy for graph data older than a configurable TTL (default: 30 days).

**NFR-LEDGER-01:** The TALK_WITHDRAWN grace window — the duration after which a talk author's client demotes new match notifications for a withdrawn talk from active to archival — must be configurable per deployment (default: 24 hours). This is a product tuning parameter with no protocol enforcement; peers that have not applied the grace window still process in-flight answers normally.

---

## 7. Security and Privacy

**SEC-01 — End-to-end encryption:** Conversation message content is encrypted end-to-end using the participants' SEA keypairs. No intermediate node (server, peer, super-peer) can read message content.

**SEC-02 — Private field encryption:** `talkFilters`, `blockedUserIds`, and `knownPeople` are written as SEA-encrypted ciphertext. The signing keypair is required to decrypt.

**SEC-03 — Location privacy:** GPS coordinates are blurred before any network write using `LocationPrivacy.blurLocation`. Raw coordinates never appear in the graph.

**SEC-04 — Peer write authorization:** Gun's SEA layer enforces that only the key-holder for a namespace can write to it. Peers that attempt to forge or overwrite a signed node are rejected by all receiving nodes.

**SEC-05 — Signaling privacy:** The WebRTC signaling channel exchanges SDP and ICE data only. The signaling server does not log or inspect the payload. SDP/ICE sessions are ephemeral.

**SEC-06 — No global user list:** The `/api/nearby` endpoint returns only a bounded, location-scoped slice of the live user index. No client can retrieve the full list of users.

**SEC-07 — Block enforcement:** Block relationships are enforced client-side. A blocked user's talks and messages are discarded before delivery to the blocking user's inbox. In the P2P model, the blocker's `user-blocks` data (encrypted) is checked locally on the receiver's device.

**SEC-08 — Age verification integrity:** Age verification vouches are signed by the vouching user's SEA keypair. Unsigned or self-signed vouches are rejected. The threshold of 3 independent vouches must come from 3 distinct keypairs.

---

## 8. Technology Stack

### Web Client

| Concern | Technology |
|---|---|
| Language | TypeScript |
| Bundler | Webpack 5 |
| Graph DB | Gun.js (client) with RAD (IndexedDB) |
| P2P transport | `gun/lib/webrtc` + `simple-peer` |
| Auth / encryption | Gun SEA |
| Content addressing | `multiformats` npm package (CIDv1, dag-json, sha2-256 — no IPFS daemon) |
| UI | Vanilla TypeScript, event-driven via `EventEmitter` |
| Testing | Jest (unit/integration), Playwright (E2E) |

### Server

| Concern | Technology |
|---|---|
| Runtime | Node.js, TypeScript |
| HTTP / API | Express.js |
| Real-time | Socket.IO |
| Graph DB | Gun.js (server) with RAD (disk, Phase A–B only) |
| Location index | In-memory Map (Phase C+) |
| Signaling | Custom WebSocket endpoints on Express |

### Desktop Node (Super-peer)

| Concern | Technology |
|---|---|
| Runtime | Node.js |
| Graph DB | Gun.js with RAD (disk, `radata/`) |
| P2P | Same `gun/lib/webrtc` stack as browser |
| Media storage | IPFS node (pins media CIDs referenced in neighborhood Gun nodes) |
| Packaging | (TBD — Electron or standalone Node binary) |

### IPFS (Media Only)

IPFS is used exclusively for large binary blobs (photos, video, audio). Text-only talks and all structured data live in Gun.js only. A media file is added to IPFS via `ipfs.add(blob)`, producing a CIDv1 stored as a field in the relevant Gun node. Desktop super-peers run an IPFS node to pin neighborhood content. Browser peers retrieve media via an IPFS HTTP gateway.

---

## 9. Glossary

**Talk** — A structured Q&A form created by a user and broadcast to nearby peers. Has one of four types: flow, tag, survey, route.

**Match** — The outcome when two users' answers to each other's talks satisfy mutual compatibility criteria, determined by `checkIfMatch` in `src/shared/talk-engine.ts`.

**Star topology** — Network architecture where all nodes communicate through a central hub (the current IinPublic server).

**P2P mesh** — Network architecture where nodes communicate directly with each other, using a signaling server only for initial connection establishment.

**Neighborhood** — The set of 3–5 active WebRTC peer connections a client maintains with geographically nearby users.

**Super-peer** — A desktop Node.js instance that participates in the P2P mesh with persistent disk storage and a stable routable address, acting as a relay for browser peers behind restrictive NAT.

**SEA** — Gun.js's Security, Encryption, Authorization layer. Provides keypair-based identity, data signing, and symmetric encryption.

**HAM** — Gun.js's Hypothetical Amnesia Machine. The CRDT conflict resolution algorithm that applies last-write-wins with a machine timestamp.

**RAD** — Gun.js's Radix storage adapter. Provides IndexedDB persistence in browsers and filesystem persistence in Node.js.

**Signaling server** — The server component responsible only for WebRTC SDP/ICE exchange and the location index in the P2P architecture.

**radata/** — The directory on disk where Gun's RAD adapter writes the graph as flat JSON files.

**incomingTalksMap** — The server-side in-memory `Map<userId, Map<leaf, cluster>>` that is the authoritative store for incoming talk clusters in the current star topology. Replaced by Gun peer mesh subscriptions in the P2P model.

**Interaction ledger** — The per-user append-only chain of signed interaction events that provides a tamper-evident timeline of all user interactions and enables O(Δ) delta sync between peers.

**InteractionEvent** — A single entry in the interaction ledger. Identified by a content-addressed `id`, linked to its predecessor via `prev`, and signed with the author's SEA keypair.

**Delta sync** — The process of exchanging only interaction events with `seq` greater than what the other peer already holds. Requires a `LEDGER_STATE` handshake to determine the gap before transferring any events.

**LEDGER_STATE** — The handshake message exchanged between two peers on connection, declaring the highest `seq` each holds per feed. Determines what events need to be transferred in each direction.

**talkId** — Content-addressed identifier for a talk, computed as **CIDv1** (dag-json codec, sha2-256) of the canonical serialization of the talk's fields via the `multiformats` npm package. A talk modification changes the `talkId`; the original `talkId` remains immutable in the ledger.

**responseId** — Content-addressed identifier for a user's answer to a specific talk, computed as `CIDv1(canonicalSerialize({ talkId, responderId, responseContentJson }))`. A modified answer produces a new `responseId`.

**seq** — Monotonically increasing sequence number within a user's interaction ledger. Used as the primary mechanism for delta-sync gap detection between peers.

**prev** — The `id` field of the immediately preceding event in a ledger feed. Together with `seq`, forms the hash-linked chain that makes the ledger tamper-evident.

**Conversation sub-DAG** — The two-writer directed acyclic graph structure used for conversation messages, where each message references the sender's previous message and the last message seen from the other party. Enables causal ordering without a central sequencer.

**CIDv1** — Content Identifier version 1. A self-describing content address in the format `multibase(multicodec + multihash(content))`. IinPublic uses dag-json codec with sha2-256. Computed locally via the `multiformats` npm package with no IPFS daemon required. Replaces the previous local SHA-256 as the standard content-addressing primitive for all identifiers (talkId, responseId, messageId, event id).

**TALK_SUPERSEDED** — An advisory `InteractionKind` event emitted by a talk's author when they publish an edited version. Carries `{ oldTalkId, newTalkId }`. Does not invalidate prior answers or matches. Triggers chatbot cache-seeding from the old talk's answers when the new talk arrives at the receiver.

**TALK_WITHDRAWN** — An `InteractionKind` event emitted by a talk's author to stop new delivery of the named talk. Peers cease routing the talk to users who have not yet received it. Does not affect match processing for in-flight answers. The standard post-edit workflow emits TALK_CREATED(T2), TALK_SUPERSEDED(T1→T2), and TALK_WITHDRAWN(T1) in sequence.

**questionId** — A CIDv1 identifier for a single question within a talk, computed from the question's semantic content (text, type, answer options) only — excluding routing and match-flag fields. Serves as the key for the chatbot's per-question answer cache. Stable across talk versions that share the same question wording, enabling the chatbot differential algorithm to carry answers forward.

**Chatbot differential answering** — The algorithm by which Alice's chatbot auto-fills questions in a newly received talk using the per-questionId answer cache, then presents only the unanswered or changed questions for Alice's manual input. Triggered proactively when TALK_SUPERSEDED signals that a talk Alice previously engaged with has been updated.

**Canonical serialization** — The deterministic process of converting a structured object to a byte string before CID computation: keys sorted lexicographically, no undefined or null fields included, consistent numeric encoding. Required so that structurally identical objects always produce the same CID.

---

*See also: [p2p-architecture.md](./p2p-architecture.md) for the detailed technical design of the P2P network layer · [blockchain-dag-survey.md](./blockchain-dag-survey.md) for the research survey informing the ledger design.*
