# IinPublic Technical Specification

**Version:** 1.0  
**Date:** 2026-05-25  
**Author:** Hongyu Jiang  
**Status:** Living document

> This file merges three previously separate documents: the Software Requirements Specification, the P2P Architecture design, and the Blockchain/DAG Survey. Cross-references between them are now in-document anchor links.

---

## Table of Contents

**Part I — Software Requirements Specification**

1. [Introduction](#1-introduction)
2. [System Overview](#2-system-overview)
3. [Architecture](#3-architecture)
   - 3.1 Current Architecture (Star Topology)
   - 3.2 Target Architecture (P2P Relay Mesh)
   - 3.3 Migration Roadmap (Phases A–G)
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

**Part II — P2P Architecture: Data Storage and Network Design**

10. [Current Architecture: Star Topology (Detailed)](#10-current-architecture-star-topology-detailed)
11. [Proposed Architecture: P2P Relay Mesh (Detailed)](#11-proposed-architecture-p2p-relay-mesh-detailed)
12. [Data Storage and Distribution in the P2P Structure](#12-data-storage-and-distribution-in-the-p2p-structure)
13. [Desktop Node.js Users as Super-Peers (Detailed)](#13-desktop-nodejs-users-as-super-peers-detailed)
14. [Migration Considerations (Detailed)](#14-migration-considerations-detailed)
15. [Interaction Ledger: DAG-Based History and Delta Sync](#15-interaction-ledger-dag-based-history-and-delta-sync)
    - 15.1 Motivation
    - 15.2 Ledger Structure
    - 15.3 Content Addressing and Deduplication Rules
    - 15.4 Delta Sync Protocol
    - 15.5 Versioning Semantics and Concurrent Edit Scenarios
    - 15.6 Conversation Sub-DAG
    - 15.7 Chatbot Differential Answering and TALK_WITHDRAWN
    - 15.8 Storage in Gun
    - 15.9 Migration Phase for Ledger

**Part III — Survey: Blockchain and DAG Structures in P2P Messaging Networks**

16. [Why Blockchain / DAG for a Messaging Network?](#16-why-blockchain--dag-for-a-messaging-network)
17. [Survey of Relevant Systems](#17-survey-of-relevant-systems)
    - 17.1 Secure Scuttlebutt (SSB)
    - 17.2 Hypercore / Dat Protocol
    - 17.3 Matrix Event DAG
    - 17.4 IOTA Tangle
    - 17.5 IPFS Merkle DAG and Content Addressing
    - 17.6 Nostr
    - 17.7 Gun.js HAM and Existing CRDT in IinPublic
18. [Comparison Table](#18-comparison-table)
19. [Stack Decision: Runtime Infrastructure vs Design Pattern Sources](#19-stack-decision-runtime-infrastructure-vs-design-pattern-sources)
20. [Design Recommendation for IinPublic](#20-design-recommendation-for-iinpublic)
21. [Sources](#21-sources)

---

# Part I — Software Requirements Specification

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements for IinPublic — a location-based, privacy-preserving social discovery platform. It serves as the single authoritative reference for product decisions, architecture choices, and implementation planning.

### 1.2 Product Description

IinPublic is a decentralized platform for real-world social discovery. Users create structured "talks" — interactive Q&A forms — and broadcast them to people nearby. When two users' answers to each other's talks meet mutual compatibility criteria, a match is created and a private conversation opens between them. The system prioritizes local, ephemeral discovery over persistent social graphs.

### 1.3 Intended Audience

This document is written for the development team, technical architects, and any future contributors. It assumes familiarity with TypeScript, Gun.js, and WebRTC fundamentals.

### 1.4 Scope

This specification covers the web client (TypeScript SPA), the Node.js server, the P2P networking layer (current and proposed), the desktop super-peer client, and all data storage and replication concerns. It does not cover the Android client in detail, though architecture decisions here apply equally to it.

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

> Detailed design: [§15 Interaction Ledger](#15-interaction-ledger-dag-based-history-and-delta-sync) · Background: [§17 Survey of Relevant Systems](#17-survey-of-relevant-systems)

**REQ-LEDGER-01:** Each user maintains a personal **interaction ledger** — an append-only, hash-linked sequence of signed interaction events stored in Gun at `ledger/<userId>/events/<seq>`. The ledger provides a tamper-evident, provable timeline of all user interactions: talk creation, broadcasting, receiving, answering, matching, and messaging.

**REQ-LEDGER-02:** Each interaction event contains: a content-addressed `id` (**CIDv1**, dag-json codec, sha2-256, computed locally via `multiformats` from the canonical serialization of `seq + kind + content + prev + pubkey`), a monotonically increasing `seq` number, a `prev` pointer to the `id` of the preceding event, an event `kind`, the author's `pubkey`, a `timestamp`, a JSON-serialized `content` payload, and a SEA `sig` over all fields. Any peer receiving an event verifies all three: the CIDv1 `id`, the `prev` chain integrity, and the `sig`.

**REQ-LEDGER-03 — Talk versioning:** A user who modifies any field of a talk produces a new CIDv1 and therefore a new `talkId` (see REQ-LEDGER-12 and REQ-TALK-04). The modification is recorded as a new `TALK_CREATED` event in the ledger. The original talk and its ledger entry are immutable and remain accessible. Peers who have seen the original `talkId` are not re-sent the original; they receive only the new-`talkId` event if their ledger `seq` is behind.

**REQ-LEDGER-04 — Response versioning:** A user who modifies their answer to a received talk produces a new `responseId` — computed as `CIDv1(canonicalSerialize({ talkId, responderId, responseContentJson }))`. This triggers a new `TALK_ANSWERED` event. Peers whose ledger `seq` for this feed is behind the new event's `seq` receive it automatically during the next delta-sync. The new response supersedes the old one for match-logic purposes; the old response remains in the ledger history.

**REQ-LEDGER-05 — Deduplication:** A peer receiving a talk or response whose `talkId` / `responseId` is already present in its local ledger discards the duplicate without writing a new ledger event. No duplicate `TALK_RECEIVED` or `TALK_ANSWERED` events are created for content already held.

**REQ-LEDGER-06 — Delta sync protocol:** When two peers establish a WebRTC connection, they perform a ledger handshake: each sends a `LEDGER_STATE` message declaring the highest `seq` they hold per feed. Each peer then sends the other only events with `seq` greater than what the other declared. The exchange volume is O(Δ) — proportional to the number of new events, not total history.

**REQ-LEDGER-07 — Immutability enforcement:** Gun path `ledger/<userId>/events/<seq>` is written once and never overwritten. Because the event `id` is a hash of its content, Gun's last-write-wins HAM treats a re-write of the same `seq` as a no-op (identical state). Application code must never mutate a written ledger entry.

**REQ-LEDGER-08 — Conversation sub-DAG:** Conversation messages between two users use a two-writer DAG structure. Each message references both the sender's previous message (`seq`) and the last message the sender has observed from the other party (`prevSeen`). This gives a causal ordering that is mergeable after either party goes offline and reconnects, without a central sequencer.

**REQ-LEDGER-09 — Ledger indexes:** The system maintains two secondary indexes in Gun for fast lookup: `ledger/<userId>/index/talkId/<id>` maps a `talkId` to the `seq` of its `TALK_CREATED` event; `ledger/<userId>/index/responseId/<id>` maps a `responseId` to the `seq` of its `TALK_ANSWERED` event. These replace the current `incomingTalksByUser` and `talkAnswerTemplateByUser` patterns in the target architecture.

**REQ-LEDGER-10 — Migration compatibility:** During the migration period (Phases E–G as defined in [§15.9](#159-migration-phase-for-ledger)), new interactions write to both the legacy Gun paths and the new ledger paths. Peers that do not yet support the ledger continue to use the legacy paths; peers that both support the ledger switch to delta-sync automatically on connection. Back-filling of pre-ledger history is not required.

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

# Part II — P2P Architecture: Data Storage and Network Design

> **Status:** Proposed · **Date:** 2026-05-25

## 10. Current Architecture: Star Topology (Detailed)

The current system uses a Gun.js star topology: one central server, many browser clients, all data flowing through and stored on the server.

**Server side** has two distinct storage layers. The primary one is Gun.js's `radata/` folder — a flat-file Radix graph database on disk. Every Gun `put` eventually flushes a `.json` file there, keyed by the graph path. The active Gun paths are:

- `users/<id>` — public user record
- `user-public-profile/<id>` — headshot, languages, profile JSON
- `user-talk-filters/<id>` — serialized `TalkIntakeFilters`
- `user-blocks/<blockerId>/<targetId>` / `user-blocked-by/<targetId>/<blockerId>` — block graph
- `talks/<id>` — talk definition, responses, stats
- `incomingTalksByUser/<userId>/<identityKey>` — incoming talk clusters (Gun mirror only; server Map is authoritative)
- `conversations/<id>` / `users/<id>/conversations/<convId>` — conversation records
- `talkAnswerTemplateByUser/<userId>/<identityKey>` — cached answer templates

The second layer is a plain in-memory JavaScript `Map` — `incomingTalksMap` on the server — intentionally kept off Gun to avoid broadcasting every talk-delivery write to all connected clients. The server also holds Socket.IO room membership, which is transient.

**Browser (client) side** runs a Gun client that syncs from the server over HTTP and caches what it has seen locally in **IndexedDB** (via Gun's RAD adapter). Each browser holds a partial replica of the graph — the subset of data it has personally requested — persisted across page reloads. All writes go to the server first. Private user data (`blockedUserIds`, `knownPeople`, `talkFilters`) is SEA-encrypted with the user's keypair before being written, so the server stores ciphertext it cannot read.

**Summary:** The server is the single source of truth. The graph is fully replicated on the server; browsers are caches.

---

## 11. Proposed Architecture: P2P Relay Mesh (Detailed)

### Design goals

- The server acts only as a **signaling and presence** service; it holds no application data.
- All talk delivery, conversation messaging, and profile exchange happens **directly between browser peers** via WebRTC.
- No user needs to know the complete global user list — only a local neighborhood of nearby peers.
- The network stays alive through overlapping neighborhoods and redundant peer connections.

### The server's new role

The server becomes an ephemeral presence registry. It holds an in-memory (no disk persistence) location index: `userId → { encryptedLocation, lastSeen }`. It provides two things:

1. A **WebRTC signaling channel** — exchanges SDP offers/answers and ICE candidates between browsers that want to connect directly.
2. A **"who is near me?" endpoint** — returns a short list (20–50) of live user IDs within a configurable radius, refreshed on demand.

The server never writes to `radata/`. It is stateless between restarts and repopulates as users reconnect. All REST routes handling talk delivery, match logic, and conversation CRUD are removed from the server.

### Client-side neighborhood management

When a client connects it registers its blurred location with the server and receives a list of nearby live peers. It then establishes Gun peer connections directly to those browsers via WebRTC, using `gun/lib/webrtc` and `simple-peer`. As peers come and go the client refreshes its neighborhood list periodically.

Each client targets a minimum of 3–5 active peer connections at all times. If one drops it re-queries the server for a replacement. Neighborhoods naturally overlap: users in the same city peer with each other, and their overlapping neighborhoods span adjacent areas. Data propagates through this geographic gradient.

### Redundancy

Overlapping neighborhoods provide natural redundancy without requiring any node to maintain a global roster. If the signaling server goes down, peers that already know each other continue operating. New arrivals can bootstrap by connecting to any known stable node (desktop super-peers, published bootstrap addresses).

### What moves and what stays

| Concern | Current (Star) | Proposed (P2P) |
|---|---|---|
| Talk storage | Server `radata/` | Originating user's device + peers |
| Conversation messages | Server `radata/` | Participants' devices + shared peers |
| User profiles (public) | Server `radata/` | Author's device, replicated to subscribers |
| Private user data | Server (encrypted) | Author's device only (SEA encrypted) |
| Match logic | Server route | Runs client-side (already in `src/shared/talk-engine.ts`) |
| Incoming talk fanout | Server in-memory Map | Sender broadcasts via Gun to peer mesh |
| Location index | Server (full list) | Server (ephemeral, neighborhood slices only) |
| WebRTC signaling | N/A | Server (permanent, lightweight) |
| User auth / keypairs | Server session | SEA keypair on device; server validates signature |

---

## 12. Data Storage and Distribution in the P2P Structure

In the P2P structure, Gun's graph is no longer centralized — it is a CRDT (conflict-free replicated data type) that each node holds partially and syncs lazily with its peers.

### Per-user device storage

Each user's browser persists its own data and the data of recent peers in IndexedDB via Gun's RAD adapter. Stored on each device:

- **Authoritative writes:** everything the user has personally written — their profile, talk definitions, conversation messages, answer templates. Gun's SEA layer enforces that only the key-holder can write these nodes; a malicious peer cannot overwrite them even if holding a copy.
- **Subscribed data:** everything the user has subscribed to — conversations they participate in, talks they have seen, profiles of people they have interacted with. Gun's deduplication by content hash means storing the same node twice is harmless.
- **SEA keypair:** stored in `localStorage`, never leaves the device in plaintext.

### Location-based sharding (emergent)

Users in the same city peer with other city users. Their Gun graphs accumulate a dense, locally relevant slice of the global graph. A user in London never downloads Tokyo-only data because they never subscribe to it. This sharding is emergent, not enforced — it falls out of the neighborhood-based peering strategy.

### Conversation replication

When Alice and Bob are in a conversation, Alice's browser subscribes to Bob's `conversations/<id>/messages` path. Gun replicates new messages to Alice as Bob writes them, and Alice's IndexedDB gets a local copy. If Bob goes offline, Alice can still read the conversation from her own cache; when Bob reconnects his messages flow through whatever peers are currently between them.

### Server storage in the new model

A small in-memory store (or SQLite) for the location index only: `userId`, encrypted location blob, `lastSeen` timestamp, and signaling channel state. No `radata/`. The server is fully stateless between restarts.

---

## 13. Desktop Node.js Users as Super-Peers (Detailed)

When a user downloads and runs a native Node.js app they become a **super-peer** — a node with persistent disk storage, a stable IP, no browser sandbox limitations, and the ability to serve as a relay for WebRTC peers that cannot directly connect due to symmetric NAT or strict firewalls.

### How a desktop node operates

The Node.js instance runs Gun with disk persistence (`radata/` on the user's machine). It connects to the signaling server, announces itself in the location index, and peers with its neighborhood exactly like a browser does — but it stays online longer and stores data more durably. Its Gun graph on disk grows over time into a rich slice of the network relevant to its location.

### Super-peers as organic TURN relays

If Browser A cannot reach Browser B directly (NAT failure), both can connect to a nearby super-peer that is reachable by both, and the Gun message flows through it. The desktop nodes fill the TURN relay role organically — no dedicated TURN server is required. The signaling server can track which nodes have announced stable, routable addresses and prefer them as relay candidates when direct ICE fails.

### Data sharing between desktop and browser nodes

Data sharing is seamless because they speak the same Gun Wire protocol. A desktop node in Tokyo and a browser in Tokyo sync the same graph paths. The desktop node's `radata/` folder becomes a durable backup of the neighborhood's data, surviving browser cache evictions (browsers aggressively evict IndexedDB under storage pressure).

### Bootstrapping a new desktop node

On first run the app connects to the signaling server, receives its neighborhood list, and begins syncing the relevant graph slice from nearby peers. After a short warm-up period it has a dense local replica. If the central signaling server goes down, desktop nodes that already know each other continue operating. New nodes can bootstrap via any known super-peer's address — publishable via DNS, a DHT entry, or a hardcoded bootstrap list in the app binary (similar to BitTorrent trackers).

### Long-term network resilience

As more desktop nodes appear in a city, the signaling server becomes less critical. Nodes can discover each other peer-to-peer via a lightweight DHT layer (`gun/lib/nts` or a custom Kademlia implementation). The server transitions from essential infrastructure to a convenient onboarding helper for new arrivals.

---

## 14. Migration Considerations (Detailed)

The migration from star to P2P can be done incrementally:

1. **Phase A — Dual-mode server:** Keep the current server but add WebRTC signaling endpoints. Browser clients connect to both the server (for existing data) and to peers (for new data). Validate that direct peer sync works correctly.
2. **Phase B — Shift writes to client:** Move talk delivery fanout and conversation writes to client-side, using the peer mesh as transport. Server still holds `radata/` as a fallback read source.
3. **Phase C — Server becomes relay-only:** Strip all application data from the server. Remove `radata/`. Server holds only the ephemeral location index and signaling state. Desktop super-peer nodes absorb the durable-storage role.
4. **Phase D — Optional DHT bootstrap:** Replace or supplement the signaling server's user discovery with a DHT so the network can survive server downtime entirely.

The match logic (`src/shared/talk-engine.ts`) and SEA encryption survive unchanged — they were already designed to run on both sides. Content-addressing transitions from `talk-content-id.ts` (local SHA-256) to CIDv1 (dag-json, sha2-256, via `multiformats`) — the `talkId` format changes but the concept is the same. `talk-content-id.ts` is replaced in Phase G.

---

## 15. Interaction Ledger: DAG-Based History and Delta Sync

> Background research: [§17 Survey of Relevant Systems](#17-survey-of-relevant-systems)

### 15.1 Motivation

Gun.js's CRDT (HAM) resolves concurrent writes with last-write-wins and propagates state diffs efficiently — but it is fundamentally a **mutable graph**. There is no native concept of "give me everything that happened since we last spoke." When two users reconnect after a gap, Gun must diff the entire relevant graph state to find what changed, and there is no tamper-evident record of the order in which events occurred.

Two requirements demand a different structure:

1. **Provable timeline.** If Alice broadcasts a talk and later modifies it, the modification must be distinguishable from the original, and both versions must be attributable to Alice with timestamps she cannot retroactively alter.
2. **Automatic delta sync.** When Alice and Bob reconnect, they exchange only the interactions that are new to each other — no re-sending of talks both already hold, no full-state comparison.

The solution is an **interaction ledger**: a per-user append-only chain of signed interaction events, modeled after Secure Scuttlebutt (SSB) and using content-addressing unified with IPFS's CIDv1 scheme.

### 15.2 Ledger Structure

Each user maintains a personal interaction feed stored in Gun at `ledger/<userId>/<seq>`. Each entry (called an **interaction event**) has the following schema:

```typescript
interface InteractionEvent {
  id: string;          // CIDv1 (dag-json, sha2-256) of (seq + kind + content + prev + pubkey)
  seq: number;         // monotonically increasing, starts at 1
  prev: string;        // id of the previous event in this feed (null for seq=1)
  kind: InteractionKind;
  pubkey: string;      // author's Gun SEA public key
  timestamp: number;   // Unix ms — informational only, not used for ordering
  content: string;     // JSON-serialized event payload (type-specific)
  sig: string;         // SEA signature over (id + seq + prev + kind + content)
}

type InteractionKind =
  | 'TALK_CREATED'       // user created a talk; or modified one (new CID → new event)
  | 'TALK_BROADCAST'     // user broadcast a talk to their peer neighborhood
  | 'TALK_RECEIVED'      // user received a talk from a peer
  | 'TALK_ANSWERED'      // user submitted an answer; or modified one (new CID → new event)
  | 'TALK_SUPERSEDED'    // author signals that oldTalkId is replaced by newTalkId (UI advisory)
  | 'TALK_WITHDRAWN'     // author stops new delivery of talkId; existing answers still processed
  | 'MATCH_CREATED'      // a match was detected between this user and another
  | 'CONVERSATION_MSG';  // a message was sent in a conversation
```

The chain property: each event's `prev` field holds the `id` of the immediately preceding event. Verifying the chain from event `N` back to event 1 requires only hashing — no trusted third party. Any tampering with an intermediate event invalidates every `id` that follows it.

### 15.3 Content Addressing and Deduplication Rules

Every piece of application data is **content-addressed** before being recorded in the ledger.

All content addresses use **CIDv1** (dag-json codec, sha2-256) computed locally via the `multiformats` npm package. No IPFS daemon or network connection is required to compute a CID — it is purely a local hash with a standard envelope. The same CID that serves as the Gun.js path key would also address the content in IPFS if it were ever published there. This unifies the content-addressing scheme: text talks and media blobs share one identifier format, and the `talkId` of a talk containing embedded media automatically commits to the media's CID as part of its content.

**Canonical serialization requirement:** The talk or response object must be serialized with deterministic key ordering and no undefined fields before hashing, or structurally identical content can produce different CIDs. A canonical `JSON.stringify` with sorted keys and a defined field schema is sufficient.

**Talk identity:** `talkId = CIDv1(canonicalSerialize(talk))`. A user who modifies any talk field produces a new `talkId`. The original is never deleted from the ledger; the new version gets its own `TALK_CREATED` event. When the sender additionally emits `TALK_SUPERSEDED { oldTalkId, newTalkId }`, receivers can visually collapse the two versions in their inbox.

**Response identity:** `responseId = CIDv1(canonicalSerialize({ talkId, responderId, responseContentJson }))`. A modified answer produces a new `responseId` and a new `TALK_ANSWERED` event. The new response supersedes the old one for match-logic purposes; the old event is immutable in the ledger.

**Message identity:** `messageId = CIDv1(canonicalSerialize({ conversationId, senderPubkey, content, seq }))`. Immutable once written.

**Question identity (chatbot cache granularity):** Each individual question within a talk gets its own `questionId = CIDv1(canonicalSerialize({ text, type, options }))` — derived from what the question *asks*, not from which talk it belongs to. This is the key that the chatbot uses for its per-question answer cache, independently of `talkId`. If Bob changes the routing between questions but not the question text or options, the `questionId` is unchanged — the chatbot can auto-fill Alice's previous answer. The `talkId` still changes because it covers the whole talk including routing logic.

```typescript
interface TalkQuestion {
  id: string;       // CIDv1({ text, type, options }) — semantic identity for chatbot cache
  text: string;
  type: 'single' | 'multiple' | 'text' | 'boolean';
  options?: TalkAnswer[];
  // routing/match fields (next, isMatch, isIgnore, etc.) — part of talkId but NOT questionId
}
```

**Media blobs (photos, video, audio):** Added to IPFS via `ipfs.add(blob)`, producing a CID. That CID is stored as a field value in the talk or message content in Gun.js. The talk's own `talkId` commits to this CID because the media CID is part of the canonical serialization. Changing the media file → new IPFS CID → new talk content → new `talkId`.

### 15.4 Delta Sync Protocol

When two peers (Alice and Bob) establish a WebRTC connection, they perform a **ledger handshake** before exchanging any application data:

```
Alice → Bob:  { type: 'LEDGER_STATE', feeds: { [userId]: seq } }
Bob  → Alice: { type: 'LEDGER_STATE', feeds: { [userId]: seq } }
```

Each party's `LEDGER_STATE` message declares the highest `seq` they hold for every feed they carry. The peer with higher `seq` for a given feed sends the gap:

```
Bob → Alice:  { type: 'LEDGER_EVENTS', userId, events: [event_N+1, event_N+2, ...] }
```

Alice verifies each received event:
1. `id` matches the expected CIDv1 of `(seq + kind + content + prev + pubkey)`.
2. `prev` matches the `id` of the event at `seq - 1` in Alice's local copy.
3. `sig` is a valid SEA signature by `pubkey` over the event fields.

Only after all three checks pass does Alice append the events to her local ledger and update her `seq` for that feed. Invalid events are discarded and logged.

**Complexity:** O(Δ) — proportional only to the number of new events, not the total history. Two users who meet daily exchange only that day's interactions, regardless of how long they have known each other.

### 15.5 Versioning Semantics and Concurrent Edit Scenarios

#### Basic versioning rules

| Scenario | Result |
|---|---|
| User modifies a talk | New `talkId` (new CIDv1) → new `TALK_CREATED` event → peers who lack this `talkId` receive it; old `talkId` unchanged |
| User modifies an answer | New `responseId` (new CIDv1) → new `TALK_ANSWERED` event → peers whose `seq` is behind receive it; old answer immutable in ledger |
| User resends an unmodified talk | Same `talkId` → receiver's ledger already contains this event → delta-sync skips it |
| Two users who already matched | `LEDGER_STATE` handshake shows no gap → zero data exchange |
| User receives same talk from two peers | `talkId` already in ledger → second delivery discarded, no duplicate `TALK_RECEIVED` written |

#### TALK_SUPERSEDED event

When a sender edits a talk and wants receivers to know the old version is no longer the primary offer, they emit a `TALK_SUPERSEDED` event into their ledger:

```typescript
// content field of a TALK_SUPERSEDED event
{ oldTalkId: string, newTalkId: string }
```

This event is **advisory only**. It does not invalidate any answer or match that occurred against `oldTalkId`. Receivers use it solely to group the two talks in the UI (showing `newTalkId` as primary, `oldTalkId` as "earlier version"). If `TALK_SUPERSEDED` has not yet arrived, both talks appear in the inbox independently until the ledger sync catches up.

#### Concurrent edit scenarios: Bob edits T1 while Alice is answering T1

**Setup:** Bob broadcast talk T1. Alice received T1 and is composing her answer. Bob opens T1 to edit simultaneously. After both complete, the possible states are:

| # | What Bob does | What Alice does | Alice's ledger | Match outcome | Chatbot behavior | Conflict? |
|---|---|---|---|---|---|---|
| 1 | Edits → T2, broadcasts | Submits R1 to T1 before T2 arrives | RECEIVED(T1), ANSWERED(T1,R1) | T1+R1 checked; T2 later arrives as new talk | T2 triggers diff; Q's shared with T1 auto-filled from cache | None |
| 2 | Edits → T2, broadcasts | T2 arrives mid-answer; Alice finishes T1 anyway | RECEIVED(T1,T2), ANSWERED(T1,R1) | T1+R1 checked; T2 in inbox | T2 queued; diff against T1 answers when opened | None |
| 3 | Edits → T2, broadcasts | T2 arrives mid-answer; Alice switches to answer T2 | RECEIVED(T1,T2), ANSWERED(T2,R2) | T2+R2 checked; T1 unanswered | Diff: common Q's auto-filled from partial T1 draft | None |
| 4 | Edits → T2, broadcasts | Alice answers both T1 and T2 | RECEIVED(T1,T2), ANSWERED(T1,R1), ANSWERED(T2,R2) | Both checked independently; up to 2 matches | T2 auto-fills from T1 answers; review screen shown | None |
| 5 | Edits → T2 (race: R1 and T2 in flight simultaneously) | Submits R1 to T1 | R1 reaches Bob; T2 reaches Alice | T1+R1 checked on Bob's side; T2 new talk for Alice | T2 triggers diff vs T1 cache | None |
| 6 | Edits → T2 immediately after T1; **no** TALK_SUPERSEDED | Alice hasn't seen T1 yet | T1 and T2 both arrive in inbox | Whichever Alice answers first | Both shown as independent talks; no diff seeding | UI ambiguity only |
| 6b | Same; **with** TALK_SUPERSEDED(T1→T2) | Alice sees T2 as primary | T1 shown as "earlier version" | T2+R2 checked | Diff seeded from any prior T1 answers; review prompt shown | None |
| 7 | Edits → T2 | Alice modifies R1 → R1' after Bob moved to T2 | ANSWERED(T1,R1), ANSWERED(T1,R1') | R1' re-checked vs T1 if no prior match; existing match untouched | Cache updated with R1' answers; T2 auto-fill improved | None |
| 8 | Edits T1→T2 changing match criteria | Alice answered T1 (no match under T1's criteria) | ANSWERED(T1,R1) | R1 not re-evaluated against T2's criteria; Alice can answer T2 fresh | T2 diff: text/options same → auto-fill; routing-only changes invisible to chatbot | None |
| 9 | Edits → T2 after match already occurred on T1+R1 | Already in conversation | Existing conversation unaffected | T2 is new independent offer | T2 auto-fill from T1 answers; review step enforced (TALK_SUPERSEDED present) | None |

**Key invariants that keep all scenarios conflict-free:**

A talk is immutable once broadcast — Bob's edit always creates T2, never mutates T1. A submitted answer is immutable — Alice's modification creates R1', never mutates R1. A match record, once written, is never undone. `TALK_SUPERSEDED` is advisory and never retroactive. These four rules eliminate the "what is the authoritative state?" question entirely: there is always exactly one authoritative state for each (talk, response, match) — the one recorded in the immutable ledger.

### 15.6 Conversation Sub-DAG

Conversations between two users where both are writing concurrently use a **two-writer DAG** (inspired by Matrix's event DAG) rather than a linear chain. Each conversation message references the last message the **sender** has observed from the **other party**:

```typescript
interface ConversationMessage {
  id: string;          // CIDv1(canonicalSerialize({ conversationId, senderPubkey, seq, content, prevSeen }))
  seq: number;         // sender's local sequence number within this conversation
  prevSeen: string;    // id of the last message the sender has seen from the other party
  content: string;     // SEA-encrypted
  sig: string;
}
```

This gives a causal ordering: if Alice sends message 3 referencing Bob's message 5, it is known that Alice had seen through Bob's message 5 before composing message 3. Recipients can reconstruct a consistent timeline without a central sequencer, and the history is mergeable after either party goes offline.

### 15.7 Chatbot Differential Answering and TALK_WITHDRAWN

#### The question-level answer cache

The chatbot's answer cache is stored by `questionId`, not by `talkId`:

```
talkAnswerTemplateByUser/<userId>/byQuestion/<questionId>  →  cached answer value
```

This cache grows across all talks over time. Any answer Alice gives to any question with a given `questionId` — whether in T1, T2, or a completely different talk from a different user — populates the same cache entry. The chatbot draws on this accumulated history whenever a new question with a matching `questionId` arrives.

#### Chatbot differential algorithm

When Alice's chatbot receives a new talk (T2):

1. For each question `q` in T2, look up `answerCache[q.id]`.
2. Questions with a cached answer → mark **auto-filled**.
3. Questions without a cached answer → add to **needs-input** list.
4. Present accordingly:
   - **All auto-filled:** show a review screen with every answer pre-populated. Alice must explicitly confirm or override before submission. Do not auto-submit silently.
   - **Some need input:** show only needs-input questions as active fields; show auto-filled questions grayed out with an override affordance alongside them.
   - **None auto-filled:** standard answering flow, unchanged from today.
5. On submit, write `answerCache[q.id] = answer` for every question in the talk — including ones that were auto-filled and left unchanged — to refresh the cache timestamp.

**Special rule when TALK_SUPERSEDED(T1→T2) is present:** When Alice's client sees this event alongside a new talk T2, it seeds the chatbot's cache check from Alice's previous responses to T1 before running the algorithm above. If Alice already answered T1 and submitted R1, the chatbot proactively offers a UI prompt: *"Bob updated this talk. Your previous answers are pre-filled — please review and answer any new questions."* If Alice had not yet submitted, the prompt reads: *"Bob updated his talk. Your draft answers have been carried over where applicable."* If the chatbot auto-submitted R1 without Alice's review (fully-automated mode), a review step is always forced for T2 — a TALK_SUPERSEDED signal means something changed, and silent re-submission is inappropriate.

#### TALK_WITHDRAWN event

```typescript
// content field of a TALK_WITHDRAWN event
{ talkId: string }   // the talk being withdrawn (e.g. T1)
```

**Effect on delivery:** Peers who receive this event in Bob's ledger delta stop routing the named `talkId` to users who have not yet received it. They do not delete it from their own store (ledger is immutable), and they do not suppress answers already in transit.

**Effect on match processing:** None. Answers submitted to T1 before or after TALK_WITHDRAWN arrive are still evaluated against T1's match logic. Alice answered in good faith; that is honored. After a configurable grace window (default: 24 hours after the TALK_WITHDRAWN event's timestamp), Bob's client may stop surfacing new T1 match notifications as active alerts — treating them as archival — but this is a product tuning decision and carries no protocol enforcement.

**Effect on UI:** Receivers who have T1 in their inbox see it marked as withdrawn. If TALK_SUPERSEDED(T1→T2) is also present, T1 is collapsed under T2 as an earlier version.

#### Bob's complete post-edit workflow

After finishing the edit and deriving T2's CIDv1, Bob's client emits three consecutive ledger events:

```
seq M:   TALK_CREATED   { talkId: T2, questions: [...] }
seq M+1: TALK_SUPERSEDED { oldTalkId: T1, newTalkId: T2 }
seq M+2: TALK_WITHDRAWN  { talkId: T1 }
```

Then broadcasts T2 via the peer mesh. When these three events reach Alice via delta-sync:

- `TALK_CREATED(T2)` → T2 stored in Alice's Gun graph and incoming talk index.
- `TALK_SUPERSEDED` → Alice's chatbot seeds its cache from any prior answers to T1; UI collapses T1/T2.
- `TALK_WITHDRAWN` → Alice's client marks T1 as retracted; no further users in Alice's neighborhood are routed T1.

The three events are logically independent and can be emitted separately. Bob can SUPERSEDE without WITHDRAWING (keeps T1 circulating as an archived alternate), or WITHDRAW without SUPERSEDING (retracts T1 with no replacement), or issue all three together as the standard post-edit workflow.

#### Relationship between the three events

| Event | Primary concern | Retroactive? | Affects match? |
|---|---|---|---|
| TALK_CREATED(T2) | Publish new version | No | Yes — T2 now matchable |
| TALK_SUPERSEDED(T1→T2) | UI grouping + chatbot seeding | No | No |
| TALK_WITHDRAWN(T1) | Stop new deliveries of T1 | No | No — in-flight answers still processed |

### 15.8 Storage in Gun

Ledger entries are stored in Gun at deterministic paths:

```
ledger/<userId>/seq                       → current highest seq (integer)
ledger/<userId>/events/<seq>              → InteractionEvent JSON (immutable once written)
ledger/<userId>/index/talkId/<id>        → seq of the TALK_CREATED event for this talkId
ledger/<userId>/index/responseId/<id>    → seq of the TALK_ANSWERED event for this responseId
ledger/<userId>/index/withdrawn/<talkId> → seq of the TALK_WITHDRAWN event for this talkId

talkAnswerTemplateByUser/<userId>/byQuestion/<questionId> → cached answer for this question
talkAnswerTemplateByUser/<userId>/byTalk/<talkId>         → full response cache (legacy, Phase G)
```

Because each event is **immutable** after it is written (the `id` is a hash of its content), Gun's last-write-wins HAM never causes a conflict on these paths. A write to `events/<seq>` that already exists is a no-op — Gun will see identical state and suppress the update.

### 15.9 Migration Phase for Ledger

The ledger is additive and can be introduced in a new migration phase without breaking the existing star-topology deployment:

**Phase E — Ledger bootstrap (parallel with Phase A–B):** Introduce the `InteractionEvent` type and the `LedgerService` (client-side). New interactions write both to the existing Gun paths (for backward compatibility) and to `ledger/<userId>/events/<seq>`. Existing interactions are not back-filled — the ledger starts from the day of deployment.

**Phase F — Delta sync in peer connections:** During peer handshake (Phase B+), add the `LEDGER_STATE` exchange before talk delivery. Peers that have not yet adopted the ledger fall back to full Gun sync; peers that both support the ledger use delta-sync only.

**Phase G — Ledger as sole source of truth:** Once all clients support the ledger, remove the duplicate writes to legacy Gun paths. The ledger's `index/talkId` and `index/responseId` sub-paths replace the current `incomingTalksByUser` and `talkAnswerTemplateByUser` patterns.

---

# Part III — Survey: Blockchain and DAG Structures in P2P Messaging Networks

> **Date:** 2026-05-25  
> **Purpose:** Inform the design of IinPublic's interaction ledger — a tamper-evident, append-only history of all user interactions that enables automatic delta-sync between peers.

## 16. Why Blockchain / DAG for a Messaging Network?

A linear blockchain or a DAG is useful in a P2P messaging network for two orthogonal reasons that happen to reinforce each other:

**Provable timeline.** An append-only structure where each entry cryptographically references the previous one creates an unforgeable history. Anyone holding the log can verify that no entry was deleted, reordered, or silently edited. If a user modifies a talk and rebroadcasts it, the modification creates a new entry (with a new content hash) — the original remains in the log unchanged.

**Efficient delta sync.** Because entries are ordered and each peer can describe exactly which entries it already has (using a sequence number, a vector clock, or a Bloom filter), two peers that reconnect after a gap need only exchange entries the other is missing. They never re-transmit data they both already hold. This is structurally impossible with a mutable database like a plain Gun.js graph, where the only way to know "what changed" is to diff the entire state.

Together these properties give IinPublic a way to prove when a talk was created or answered, to detect forks (a user answering a talk they already answered with different content), and to make peer reconnection fast and bandwidth-efficient.

---

## 17. Survey of Relevant Systems

### 17.1 Secure Scuttlebutt (SSB)

**What it is:** A P2P social network protocol where every user has a personal append-only feed — a signed, hash-linked log of all their activity. The network uses a gossip protocol to replicate feeds between peers.

**Structure:** Each message in a user's feed contains: the user's public key, a sequence number, the hash of the previous message (`prev`), a timestamp, the message content, and a signature over the whole record. This makes the feed a singly-linked list, verifiable from any point. Feeds are identified by the user's public key.

**Delta sync:** Because feeds are append-only and entries are sequentially numbered, delta sync is trivially expressed: "give me all entries in feed `@pubkey` with sequence number greater than `N`." Two peers that meet after a period of separation exchange their highest known sequence numbers per feed, then transfer only the gap. No full-state comparison is needed.

**Deduplication:** Since the previous-hash (`prev`) field creates a cryptographic chain, duplicate entries are immediately detectable — an entry with the same `prev` as an existing entry is either a fork (Byzantine fault) or a retransmit. Retransmits are discarded.

**What IinPublic borrows:** The per-user append-only feed structure; hash-linked `prev` chain; sequence-number delta sync. SSB's own network protocol, gossip layer, identity system, and storage are all replaced by Gun.js — SSB is not deployed.

**Reference:** [Gossiping with Append-Only Logs in Secure-Scuttlebutt](https://www.researchgate.net/publication/348239763_Gossiping_with_Append-Only_Logs_in_Secure-Scuttlebutt)

---

### 17.2 Hypercore / Dat Protocol

**What it is:** Hypercore is a cryptographically secure, distributed append-only log maintained by the Holepunch team. It underpins the Dat and Beaker browser ecosystems.

**Structure:** Entries are appended sequentially. The log is verified using a Merkle tree (BLAKE2b-256 hash function) over all entries. Each entry's integrity can be checked independently using the Merkle proof for its position, without downloading the entire log. This makes sparse replication practical — a peer can download only the entries it cares about and still cryptographically verify them.

**Delta sync:** Hypercore peers describe what they have using a compact **bitfield** — a bitmask of which entry indices they hold. Two peers exchange bitfields and transfer only the complement. This is more general than a simple sequence-number comparison: it supports out-of-order appends and holes in the log.

**What IinPublic borrows:** The Merkle-tree proof model as a conceptual reference; the idea of bitfield-based sparse replication (not implemented now but noted for future large-log scenarios). Hypercore's own networking (Hyperswarm), storage engine, and transport are all replaced by Gun.js — Hypercore is not deployed.

**Reference:** [Hypercore Protocol](https://hypercore-protocol.github.io/new-website/protocol/) · [GitHub: holepunchto/hypercore](https://github.com/holepunchto/hypercore)

---

### 17.3 Matrix Event DAG

**What it is:** Matrix is a federated messaging protocol where every room's history is represented as a Directed Acyclic Graph (DAG) of signed events. Each event references one or more previous events (`prev_events`), forming a causal DAG rather than a linear chain.

**Structure:** An event contains: room ID, event type (state or timeline), sender identity, content, a list of `prev_events` (up to 2–3 recent events), and a signature. The DAG allows **multiple servers to append events concurrently** without coordination — they each pick the current "tips" of the DAG as their `prev_events`. Forks are allowed and merged deterministically using a consensus algorithm (State Resolution).

**Timeline vs. state events:** Matrix distinguishes between timeline events (messages, talk answers) and state events (membership, room settings). State events have a `state_key` and the most recent state event for a given key is the current state. Timeline events are immutable — even a "redacted" event leaves a tombstone in the DAG.

**Deduplication:** Events are identified by a content hash (the event ID). Any server that receives a duplicate (same event ID) discards it.

**What IinPublic borrows:** The two-writer conversation DAG pattern with `prevSeen` causal references (see `ConversationMessage` in §15.6). Matrix homeservers, federation protocol, and Server-Server API are not deployed — Matrix is a design pattern source only.

**Reference:** [Analysis of the Matrix Event Graph Replicated Data Type](https://arxiv.org/pdf/2011.06488) · [Matrix Specification](https://matrix.org/docs/spec/)

---

### 17.4 IOTA Tangle

**What it is:** IOTA's Tangle is a DAG-based distributed ledger designed for high-frequency, zero-fee transactions (originally targeting IoT devices). Each new transaction must validate two previous transactions before being appended, turning every participant into a validator.

**Structure:** The Tangle is a DAG where nodes are transactions/messages and directed edges represent "validates" relationships. There is no concept of blocks or miners. The layered architecture separates the network layer (peer discovery, gossip), communication layer (block/message DAG construction), and application layer (smart contracts, value transfer).

**What IinPublic borrows:** Nothing directly applicable. The IOTA model requires every participant to validate others' entries — unnecessary overhead for a single-author personal feed. The tiered architecture (network / communication / application) is a useful conceptual reference. IOTA is not deployed.

**Reference:** [IOTA Tangle 2.0](https://arxiv.org/pdf/2209.04959) · [From IOTA Tangle 2.0 to Rebased](https://pmc.ncbi.nlm.nih.gov/articles/PMC12157984/)

---

### 17.5 IPFS Merkle DAG and Content Addressing

**What it is:** IPFS (InterPlanetary File System) represents all data as a Merkle DAG where every node is identified by the cryptographic hash of its contents — a Content Identifier (CID). Two pieces of identical content produce the same CID and are stored exactly once across the entire network.

**Deduplication:** Since the CID is derived from content, deduplication is automatic and global. If Alice creates a talk with content hash `Qm...abc` and Bob has already received that talk from Carol, Bob discards the retransmit immediately on CID comparison — no content parsing required. IinPublic uses this principle for all identifiers via CIDv1.

**Merkle DAG versioning:** Changes to a data structure produce a new root CID that references the unchanged sub-nodes and a new node for the changed portion. This is essentially how Git works. Applied to IinPublic: a modified talk produces a new root CID (new `talkId`), but any unchanged sub-questions share their CIDs with the original.

**What IinPublic borrows:** IinPublic adopts CIDv1 (dag-json codec, sha2-256, computed locally via the `multiformats` npm package — no IPFS daemon) as the content-addressing scheme for all identifiers: `talkId`, `responseId`, `messageId`, `questionId`, and ledger event `id`. IPFS itself is deployed only for large binary blobs (photos, video, audio); all structured data remains in Gun.js.

**Reference:** [Merkle DAGs — IPFS Docs](https://docs.ipfs.tech/concepts/merkle-dag/) · [Content Identifiers (CIDs)](https://docs.ipfs.tech/concepts/content-addressing/)

---

### 17.6 Nostr (Notes and Other Stuff Transmitted by Relays)

**What it is:** Nostr is a minimal signed-event protocol for decentralized social messaging. Every event has an ID (SHA-256 of the serialized content), a public key, a `created_at` timestamp, a `kind` integer, optional `tags`, freeform content, and a Schnorr signature. Relays store and forward events; clients filter by pubkey, kind, and timestamp.

**Simplicity as a feature:** Nostr deliberately avoids P2P — it uses relay servers to avoid the NAT traversal and peer discovery complexity. Its event model is the simplest possible signed-event design: no chains, no DAG, just a signed blob with a timestamp.

**Deduplication:** Events are deduplicated by event ID (content hash). Relays that receive the same event ID twice store it once.

**What IinPublic borrows:** Nostr's event schema `{ id, pubkey, created_at, kind, content, sig }` is the lower bound — the minimum fields an interaction record needs. IinPublic's `InteractionEvent` extends this with a `prev` field for causal ordering. Nostr relay servers are not deployed; Nostr's lack of causal ordering is a mismatch for IinPublic's delta-sync requirement.

**Reference:** [The Nostr Protocol](https://nostr.how/en/the-protocol) · [Nostr Events Explained](https://nostr.co.uk/learn/nostr-events-explained/)

---

### 17.7 Gun.js HAM and Existing CRDT in IinPublic

**What it is:** Gun.js uses a state-based CRDT with last-write-wins conflict resolution via its HAM (Hypothetical Amnesia Machine) algorithm. Each graph node stores a hybrid logical clock (machine timestamp). When two peers sync, Gun compares state vectors and transfers only differing nodes.

**Current content addressing in IinPublic:** All entity identifiers (`talkId`, `responseId`, `messageId`, `questionId`, ledger event `id`) are **CIDv1** values (dag-json codec, sha2-256) computed locally via the `multiformats` npm package. This replaces the earlier `computeTalkIdFromTalkData` / `buildTalkIdentityKey` approach. Gun's own deduplication stops syncing a node once the remote peer's state matches the local hash.

**Gap:** Gun's CRDT is designed for mutable state (the latest value of a key wins). It does not natively model an append-only ordered history. Adding entries to a Gun list is typically done with timestamps as keys, which is fragile under clock skew. Gun has no native concept of "give me entries newer than sequence N in feed X."

**Role in IinPublic:** Gun remains the right transport and storage layer — its WebRTC mesh, SEA encryption, and RAD persistence are all valuable. The interaction ledger sits *above* Gun as an application-level data structure, using Gun paths to store ledger entries while adding the chain-linking and sequence-number logic that Gun alone does not provide.

**Reference:** [CRDT — GUN Database](https://amark-gun-58.mintlify.app/concepts/crdt) · [Conflict Resolution with Guns](https://github.com/amark/gun/wiki/Conflict-Resolution-with-Guns)

---

## 18. Comparison Table

| System | Structure | Delta sync | Dedup mechanism | Multi-writer | Role in IinPublic |
|---|---|---|---|---|---|
| Secure Scuttlebutt | Linear chain per user | Sequence number | `prev` hash chain | No (one writer per feed) | ✅ Pattern source: per-user ledger design |
| Hypercore | Linear log + Merkle tree | Bitfield | Merkle proof | No | ✅ Pattern source: sparse sync concept |
| Matrix Event DAG | Per-room DAG | Event ID set | Event ID (content hash) | Yes (multi-server) | ✅ Pattern source: conversation sub-DAG |
| IOTA Tangle | Global DAG | N/A (gossip) | Transaction hash | Yes (all users) | ⚠️ Not applicable — global consensus overkill |
| IPFS Merkle DAG | Content-addressed tree | CID comparison | CID (content hash) | Append-only | ✅ Runtime (media blobs) + CIDv1 scheme |
| Nostr | Flat signed events | Timestamp filter | Event ID | Yes (relay-mediated) | ✅ Pattern source: minimal event schema |
| Gun.js HAM | Mutable graph CRDT | State vector diff | Node hash | Yes | ✅ **Runtime infrastructure** |

---

## 19. Stack Decision: Runtime Infrastructure vs Design Pattern Sources

IinPublic uses **Gun.js and IPFS as its only runtime infrastructure**. Every other system surveyed above contributes a data-structure or protocol *idea* that is implemented on top of Gun.js — none of them are deployed or depended upon as running services. This distinction matters for contributors: reading about SSB or Matrix in this document does not mean those systems need to be installed, configured, or maintained.

### 19.1 Runtime infrastructure (actually deployed)

**Gun.js** is the graph database, real-time sync transport, identity layer (SEA keypairs), CRDT conflict resolution (HAM), and local persistence (RAD/IndexedDB or radata/ on disk). It handles all structured, mutable, or relationship data: user profiles, talk metadata, conversation records, ledger entries, presence, and the signaling location index. There is no substitute for Gun.js in this stack.

**IPFS** handles one thing Gun.js cannot: large binary blobs (photos, video, audio). A media file is added to IPFS, producing a CID (content identifier). That CID — a short base32 string — is stored as a field value inside a Gun.js node. Beyond that single field, the talk or message containing the media lives entirely in Gun.js. Desktop super-peers run IPFS nodes to pin content referenced by their neighborhood. Browser peers use an IPFS HTTP gateway for retrieval. IPFS is never used as a general data store for structured application data.

### 19.2 Design pattern sources (ideas borrowed, no deployment)

| System | What IinPublic borrows | What is discarded |
|---|---|---|
| **Secure Scuttlebutt** | Per-user append-only feed structure; hash-linked `prev` chain; sequence-number delta sync | SSB's own network protocol, gossip layer, identity system, storage — all replaced by Gun.js |
| **Hypercore** | Merkle-tree proof model as a reference; concept of bitfield-based sparse replication (not used now but noted for future large-log scenarios) | Hypercore's own networking (Hyperswarm), storage engine, and transport — all replaced by Gun.js |
| **Matrix event DAG** | Two-writer conversation DAG pattern with `prevSeen` causal references | Matrix homeservers, federation protocol, Server-Server API — none deployed |
| **IOTA Tangle** | Nothing applicable | Everything — global consensus is unnecessary for a single-author personal feed |
| **Nostr** | Minimal signed-event schema `{ id, pubkey, created_at, kind, content, sig }`, absorbed into `InteractionEvent` | Nostr relay servers — not deployed; Nostr's lack of causal ordering is a mismatch |

Running any of these systems alongside Gun.js would introduce a **second P2P network, a second identity system (all use Ed25519 keypairs, overlapping with Gun SEA), and a second storage layer** — complete redundancy with no benefit.

### 19.3 Overlaps and boundaries to maintain

**IPFS CID computation vs local SHA-256 for talk identity.** IinPublic switches from a locally-computed SHA-256 to a **CIDv1** (dag-json codec, sha2-256) computed locally using the `multiformats` npm package — no IPFS daemon required. This unifies the content-addressing scheme: the same identifier that names a talk in Gun.js is the address that *would* retrieve it from IPFS if the content were ever published there. For text-only talks, the CID is computed locally and the content lives only in Gun.js (never added to IPFS). A canonical serialization of the talk object (deterministic key order, no undefined fields) is required before hashing to ensure identical content always produces the same CID.

**Gun HAM and the ledger chain.** Gun's HAM resolves concurrent writes to the same path (last-write-wins). The ledger chain resolves ordering across different paths over time (causal sequence via `prev`). They operate at different levels and are complementary: Gun ensures each `ledger/<userId>/events/<seq>` path is consistently replicated across peers; the `prev` chain ensures the sequence of those paths is tamper-evident. If HAM produces a write collision on a given `seq` path (a Byzantine or clock-skew fault), the chain-verification step in the delta-sync protocol detects the broken `prev` link and rejects the bad event.

**IPFS pinning and Gun RAD persistence.** Desktop super-peers are responsible for both: persisting their neighborhood's Gun graph (via radata/) and pinning the IPFS CIDs referenced within it. These responsibilities map onto the same node type and the same concept of "being a reliable neighbor," but they are distinct storage systems. A CID that appears in a Gun node field is not automatically pinned in IPFS — pinning must be triggered explicitly by the super-peer when it processes a Gun node containing a CID field.

---

## 20. Design Recommendation for IinPublic

Based on the survey, the most appropriate architecture for IinPublic's interaction ledger is a **hybrid of Secure Scuttlebutt's per-user append-only chain and IPFS's content-addressed event IDs**, layered on top of the existing Gun.js transport.

**Per-user interaction feed:** Each user maintains a personal append-only log of interaction events. Each event is identified by a **CIDv1** (dag-json codec, sha2-256, computed locally via `multiformats`) of its content, and references the CIDv1 of the previous event in their feed (`prev`). The sequence number (`seq`) is implicit from the position in the chain but stored explicitly for efficient delta-sync queries.

**Event kinds:** TALK_CREATED, TALK_BROADCAST, TALK_RECEIVED, TALK_ANSWERED, TALK_SUPERSEDED, TALK_WITHDRAWN, MATCH_CREATED, CONVERSATION_MESSAGE. Each has a content-addressed CIDv1 derived from its payload. `TALK_SUPERSEDED` carries `{ oldTalkId, newTalkId }` and is advisory to the UI — it does not invalidate prior answers or matches against the old talk. `TALK_WITHDRAWN` carries `{ talkId }` and instructs peers to stop routing the named talk to users who have not yet received it; it does not affect answers or matches already in flight.

**Delta sync protocol:** When two users establish a peer connection, they exchange their current `seq` numbers per feed. Each then sends the other only events with `seq > known_seq`. This is the SSB model applied to Gun paths: `ledger/<userId>/events/<seq>`.

**Content-addressing for deduplication:** A talk's ID is a **CIDv1** (dag-json, sha2-256) computed locally via `multiformats`. A response's ID is `CIDv1(canonicalSerialize({ talkId, responderId, responseContentJson }))`. A modified talk or response produces a different CID and is treated as a new event; the old entry remains immutable in the ledger.

**Conversation DAG:** Conversations between two users use a two-writer DAG (Matrix-style): each message references the last message the sender has seen from the other party. This gives a causal ordering that works correctly when both parties are offline and resync later.

The detailed requirements that follow from this design are in [§4.8 Interaction Ledger](#48-interaction-ledger-dag-based-history-and-delta-sync) and the full implementation plan is in [§15 Interaction Ledger Design](#15-interaction-ledger-dag-based-history-and-delta-sync).

---

## 21. Sources

- [Gossiping with Append-Only Logs in Secure-Scuttlebutt](https://www.researchgate.net/publication/348239763_Gossiping_with_Append-Only_Logs_in_Secure-Scuttlebutt)
- [Secure Scuttlebutt — ssb-server](https://github.com/ssbc/ssb-server)
- [Hypercore Protocol](https://hypercore-protocol.github.io/new-website/protocol/)
- [holepunchto/hypercore](https://github.com/holepunchto/hypercore)
- [Analysis of the Matrix Event Graph Replicated Data Type](https://arxiv.org/pdf/2011.06488)
- [Matrix Specification](https://matrix.org/docs/spec/)
- [IOTA Tangle 2.0](https://arxiv.org/pdf/2209.04959)
- [From IOTA Tangle 2.0 to Rebased (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12157984/)
- [Merkle DAGs — IPFS Docs](https://docs.ipfs.tech/concepts/merkle-dag/)
- [Content Identifiers (CIDs) — IPFS Docs](https://docs.ipfs.tech/concepts/content-addressing/)
- [The Nostr Protocol](https://nostr.how/en/the-protocol)
- [CRDT — GUN Database](https://amark-gun-58.mintlify.app/concepts/crdt)
- [Conflict Resolution with Guns](https://github.com/amark/gun/wiki/Conflict-Resolution-with-Guns)
- [DAG — A potential game changer in M2M communication](https://www.bearingpoint.com/files/DAG_Technology.pdf?download=0&itemId=562844)
