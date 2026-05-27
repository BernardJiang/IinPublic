# Survey: Blockchain and DAG Structures in P2P Messaging Networks

**Date:** 2026-05-25  
**Purpose:** Inform the design of IinPublic's interaction ledger — a tamper-evident, append-only history of all user interactions that enables automatic delta-sync between peers.

---

## 1. Why Blockchain / DAG for a Messaging Network?

A linear blockchain or a DAG is useful in a P2P messaging network for two orthogonal reasons that happen to reinforce each other:

**Provable timeline.** An append-only structure where each entry cryptographically references the previous one creates an unforgeable history. Anyone holding the log can verify that no entry was deleted, reordered, or silently edited. If a user modifies a talk and rebroadcasts it, the modification creates a new entry (with a new content hash) — the original remains in the log unchanged.

**Efficient delta sync.** Because entries are ordered and each peer can describe exactly which entries it already has (using a sequence number, a vector clock, or a Bloom filter), two peers that reconnect after a gap need only exchange entries the other is missing. They never re-transmit data they both already hold. This is structurally impossible with a mutable database like a plain Gun.js graph, where the only way to know "what changed" is to diff the entire state.

Together these properties give IinPublic a way to prove when a talk was created or answered, to detect forks (a user answering a talk they already answered with different content), and to make peer reconnection fast and bandwidth-efficient.

---

## 2. Survey of Relevant Systems

### 2.1 Secure Scuttlebutt (SSB)

**What it is:** A P2P social network protocol where every user has a personal append-only feed — a signed, hash-linked log of all their activity. The network uses a gossip protocol to replicate feeds between peers.

**Structure:** Each message in a user's feed contains: the user's public key, a sequence number, the hash of the previous message (`prev`), a timestamp, the message content, and a signature over the whole record. This makes the feed a singly-linked list, verifiable from any point. Feeds are identified by the user's public key.

**Delta sync:** Because feeds are append-only and entries are sequentially numbered, delta sync is trivially expressed: "give me all entries in feed `@pubkey` with sequence number greater than `N`." Two peers that meet after a period of separation exchange their highest known sequence numbers per feed, then transfer only the gap. No full-state comparison is needed.

**Deduplication:** Since the previous-hash (`prev`) field creates a cryptographic chain, duplicate entries are immediately detectable — an entry with the same `prev` as an existing entry is either a fork (Byzantine fault) or a retransmit. Retransmits are discarded.

**Relevance to IinPublic:** SSB is the closest existing system to what IinPublic needs. Each user's talk broadcasts, answers, matches, and messages could be modeled as entries in a personal SSB-style feed. The delta-sync mechanism maps directly onto the "two users meet again, exchange only new interactions" requirement.

**Reference:** [Gossiping with Append-Only Logs in Secure-Scuttlebutt](https://www.researchgate.net/publication/348239763_Gossiping_with_Append-Only_Logs_in_Secure-Scuttlebutt)

---

### 2.2 Hypercore / Dat Protocol

**What it is:** Hypercore is a cryptographically secure, distributed append-only log maintained by the Holepunch team. It underpins the Dat and Beaker browser ecosystems.

**Structure:** Entries are appended sequentially. The log is verified using a Merkle tree (BLAKE2b-256 hash function) over all entries. Each entry's integrity can be checked independently using the Merkle proof for its position, without downloading the entire log. This makes sparse replication practical — a peer can download only the entries it cares about and still cryptographically verify them.

**Delta sync:** Hypercore peers describe what they have using a compact **bitfield** — a bitmask of which entry indices they hold. Two peers exchange bitfields and transfer only the complement. This is more general than a simple sequence-number comparison: it supports out-of-order appends and holes in the log.

**Relevance to IinPublic:** The bitfield-based approach is valuable if IinPublic's interaction log is ever sparse (e.g., a user wants to sync only talk-related entries, not message entries). For the simpler case where logs are dense and ordered, a sequence number is sufficient. Hypercore's Merkle tree verification model is a good reference for how to build the root hash that summarizes the ledger state at any point.

**Reference:** [Hypercore Protocol](https://hypercore-protocol.github.io/new-website/protocol/) · [GitHub: holepunchto/hypercore](https://github.com/holepunchto/hypercore)

---

### 2.3 Matrix Event DAG

**What it is:** Matrix is a federated messaging protocol where every room's history is represented as a Directed Acyclic Graph (DAG) of signed events. Each event references one or more previous events (`prev_events`), forming a causal DAG rather than a linear chain.

**Structure:** An event contains: room ID, event type (state or timeline), sender identity, content, a list of `prev_events` (up to 2–3 recent events), and a signature. The DAG allows **multiple servers to append events concurrently** without coordination — they each pick the current "tips" of the DAG as their `prev_events`. Forks are allowed and merged deterministically using a consensus algorithm (State Resolution).

**Timeline vs. state events:** Matrix distinguishes between timeline events (messages, talk answers) and state events (membership, room settings). State events have a `state_key` and the most recent state event for a given key is the current state. Timeline events are immutable — even a "redacted" event leaves a tombstone in the DAG.

**Deduplication:** Events are identified by a content hash (the event ID). Any server that receives a duplicate (same event ID) discards it. The DAG structure prevents loops because each event's references must point to already-known events.

**Relevance to IinPublic:** The DAG model is appropriate if multiple users are co-authoring state (e.g., a conversation where both participants can write). For IinPublic's per-user interaction ledger, a linear chain (like SSB) is simpler and sufficient, since only one user writes to their own feed. The Matrix model becomes relevant for the **conversation** sub-DAG — where both Alice and Bob are appending messages and need a consistent causal ordering without a central sequencer.

**Reference:** [Analysis of the Matrix Event Graph Replicated Data Type](https://arxiv.org/pdf/2011.06488) · [Matrix Specification](https://matrix.org/docs/spec/)

---

### 2.4 IOTA Tangle

**What it is:** IOTA's Tangle is a DAG-based distributed ledger designed for high-frequency, zero-fee transactions (originally targeting IoT devices). Each new transaction must validate two previous transactions before being appended, turning every participant into a validator.

**Structure:** The Tangle is a DAG where nodes are transactions/messages and directed edges represent "validates" relationships. There is no concept of blocks or miners. The network uses a P2P gossip protocol for propagation. The layered architecture separates the network layer (peer discovery, gossip), communication layer (block/message DAG construction), and application layer (smart contracts, value transfer).

**Relevance to IinPublic:** The IOTA model is best suited for high-throughput, fee-less value transfer between many parties. For IinPublic's use case — a relatively low-volume personal interaction log — the overhead of requiring each entry to validate two previous entries from other users is unnecessary complexity. However, the Tangle's zero-fee, P2P-native design philosophy is directly aligned with IinPublic's goals, and the tiered architecture (network / communication / application) is a useful reference for how to structure IinPublic's own layering.

**Reference:** [IOTA Tangle 2.0](https://arxiv.org/pdf/2209.04959) · [From IOTA Tangle 2.0 to Rebased](https://pmc.ncbi.nlm.nih.gov/articles/PMC12157984/)

---

### 2.5 IPFS Merkle DAG and Content Addressing

**What it is:** IPFS (InterPlanetary File System) represents all data as a Merkle DAG where every node is identified by the cryptographic hash of its contents — a Content Identifier (CID). Two pieces of identical content produce the same CID and are stored exactly once across the entire network.

**Deduplication:** Since the CID is derived from content, deduplication is automatic and global. If Alice creates a talk with content hash `Qm...abc` and Bob has already received that talk from Carol, Bob discards the retransmit immediately on CID comparison — no content parsing required. IinPublic uses this principle for all identifiers via CIDv1.

**Merkle DAG versioning:** Changes to a data structure produce a new root CID that references the unchanged sub-nodes and a new node for the changed portion. This is essentially how Git works. Applied to IinPublic: a modified talk produces a new root CID (new `talkId`), but any unchanged sub-questions share their CIDs with the original.

**Relevance to IinPublic:** IinPublic adopts CIDv1 (dag-json codec, sha2-256, computed locally via the `multiformats` npm package — no IPFS daemon) as the content-addressing scheme for all identifiers: `talkId`, `responseId`, `messageId`, `questionId`, and ledger event `id`. This replaces the earlier local SHA-256 approach (`computeTalkIdFromTalkData`). Extending CID discipline to all interaction events gives the full Merkle DAG deduplication property across all data types, not just talk definitions.

**Reference:** [Merkle DAGs — IPFS Docs](https://docs.ipfs.tech/concepts/merkle-dag/) · [Content Identifiers (CIDs)](https://docs.ipfs.tech/concepts/content-addressing/)

---

### 2.6 Nostr (Notes and Other Stuff Transmitted by Relays)

**What it is:** Nostr is a minimal signed-event protocol for decentralized social messaging. Every event has an ID (SHA-256 of the serialized content), a public key, a `created_at` timestamp, a `kind` integer, optional `tags`, freeform content, and a Schnorr signature. Relays store and forward events; clients filter by pubkey, kind, and timestamp.

**Simplicity as a feature:** Nostr deliberately avoids P2P — it uses relay servers to avoid the NAT traversal and peer discovery complexity. Its event model is the simplest possible signed-event design: no chains, no DAG, just a signed blob with a timestamp.

**Deduplication:** Events are deduplicated by event ID (content hash). Relays that receive the same event ID twice store it once. Clients that receive a duplicate discard it client-side.

**Relevance to IinPublic:** Nostr's event schema is a useful lower bound — the minimum fields an interaction record needs. IinPublic's interaction events need at least: ID (content hash), pubkey, created_at, kind (talk_created, talk_answered, match, message), and content. The difference from Nostr is that IinPublic's events form a chain (each references `prev`) to enable the ordered delta-sync that Nostr does not provide.

**Reference:** [The Nostr Protocol](https://nostr.how/en/the-protocol) · [Nostr Events Explained](https://nostr.co.uk/learn/nostr-events-explained/)

---

### 2.7 Gun.js HAM and Existing CRDT in IinPublic

**What it is:** Gun.js uses a state-based CRDT with last-write-wins conflict resolution via its HAM (Hypothetical Amnesia Machine) algorithm. Each graph node stores a hybrid logical clock (machine timestamp). When two peers sync, Gun compares state vectors and transfers only differing nodes.

**Current deduplication in IinPublic:** All entity identifiers (`talkId`, `responseId`, `messageId`, `questionId`, ledger event `id`) are now **CIDv1** values (dag-json codec, sha2-256) computed locally via the `multiformats` npm package. This replaces the earlier `computeTalkIdFromTalkData` / `buildTalkIdentityKey` approach. Gun's own deduplication stops syncing a node once the remote peer's state matches the local hash.

**Gap:** Gun's CRDT is designed for mutable state (the latest value of a key wins). It does not natively model an append-only ordered history. Adding entries to a Gun list is typically done with timestamps as keys, which is fragile under clock skew. Gun has no native concept of "give me entries newer than sequence N in feed X."

**Relevance to IinPublic:** Gun remains the right transport and storage layer for IinPublic — its WebRTC mesh, SEA encryption, and RAD persistence are all valuable. The interaction ledger proposed in this document sits *above* Gun as an application-level data structure, using Gun paths to store ledger entries while adding the chain-linking and sequence-number logic that Gun alone does not provide.

**Reference:** [CRDT — GUN Database](https://amark-gun-58.mintlify.app/concepts/crdt) · [Conflict Resolution with Guns](https://github.com/amark/gun/wiki/Conflict-Resolution-with-Guns)

---

## 3. Comparison Table

| System | Structure | Delta sync | Dedup mechanism | Multi-writer | Fits IinPublic? |
|---|---|---|---|---|---|
| Secure Scuttlebutt | Linear chain per user | Sequence number | `prev` hash chain | No (one writer per feed) | ✅ Best fit for per-user ledger |
| Hypercore | Linear log + Merkle tree | Bitfield | Merkle proof | No | ✅ Good for sparse sync |
| Matrix Event DAG | Per-room DAG | Event ID set | Event ID (content hash) | Yes (multi-server) | ✅ Good for conversation sub-DAG |
| IOTA Tangle | Global DAG | N/A (gossip) | Transaction hash | Yes (all users) | ⚠️ Overkill for personal log |
| IPFS Merkle DAG | Content-addressed tree | CID comparison | CID (content hash) | Append-only | ✅ Dedup model for all events |
| Nostr | Flat signed events | Timestamp filter | Event ID | Yes (relay-mediated) | ⚠️ No causal ordering |
| Gun.js HAM | Mutable graph CRDT | State vector diff | Node hash | Yes | ⚠️ No append-only history |

---

## 4. Stack Decision: Runtime Infrastructure vs Design Pattern Sources

IinPublic uses **Gun.js and IPFS as its only runtime infrastructure**. Every other system surveyed above contributes a data-structure or protocol *idea* that is implemented on top of Gun.js — none of them are deployed or depended upon as running services. This distinction matters for contributors: reading about SSB or Matrix in this document does not mean those systems need to be installed, configured, or maintained.

### 4.1 Runtime infrastructure (actually deployed)

**Gun.js** is the graph database, real-time sync transport, identity layer (SEA keypairs), CRDT conflict resolution (HAM), and local persistence (RAD/IndexedDB or radata/ on disk). It handles all structured, mutable, or relationship data: user profiles, talk metadata, conversation records, ledger entries, presence, and the signaling location index. There is no substitute for Gun.js in this stack.

**IPFS** handles one thing Gun.js cannot: large binary blobs (photos, video, audio). A media file is added to IPFS, producing a CID (content identifier). That CID — a short base32 string — is stored as a field value inside a Gun.js node. Beyond that single field, the talk or message containing the media lives entirely in Gun.js. Desktop super-peers run IPFS nodes to pin content referenced by their neighborhood. Browser peers use an IPFS HTTP gateway for retrieval. IPFS is never used as a general data store for structured application data.

### 4.2 Design pattern sources (ideas borrowed, no deployment)

| System | What IinPublic borrows | What is discarded |
|---|---|---|
| **Secure Scuttlebutt** | Per-user append-only feed structure; hash-linked `prev` chain; sequence-number delta sync | SSB's own network protocol, gossip layer, identity system, storage — all replaced by Gun.js |
| **Hypercore** | Merkle-tree proof model as a reference; concept of bitfield-based sparse replication (not used now but noted for future large-log scenarios) | Hypercore's own networking (Hyperswarm), storage engine, and transport — all replaced by Gun.js |
| **Matrix event DAG** | Two-writer conversation DAG pattern with `prevSeen` causal references | Matrix homeservers, federation protocol, Server-Server API — none deployed |
| **IOTA Tangle** | Nothing applicable | Everything — global consensus is unnecessary for a single-author personal feed; zero-fee design is inspiring but Gun.js's CRDT already achieves fee-free sync |
| **Nostr** | Minimal signed-event schema `{ id, pubkey, created_at, kind, content, sig }`, already absorbed into `InteractionEvent`; future compatibility bridge is possible | Nostr relay servers, relay network — not deployed; Nostr's lack of causal ordering is a mismatch |

Running any of these systems alongside Gun.js would introduce a **second P2P network, a second identity system (all use Ed25519 keypairs, overlapping with Gun SEA), and a second storage layer** — complete redundancy with no benefit.

### 4.3 Overlaps and boundaries to maintain

**IPFS CID computation vs local SHA-256 for talk identity.** IinPublic switches from a locally-computed SHA-256 to a **CIDv1** (dag-json codec, sha2-256) computed locally using the `multiformats` npm package — no IPFS daemon required. This unifies the content-addressing scheme: the same identifier that names a talk in Gun.js is the address that *would* retrieve it from IPFS if the content were ever published there. For text-only talks, the CID is computed locally and the content lives only in Gun.js (never added to IPFS). For talks with embedded media, the media CID is a field in the talk content, and computing the talk's own CIDv1 automatically commits the `talkId` to the photo bytes — no extra logic required. A canonical serialization of the talk object (deterministic key order, no undefined fields) is required before hashing to ensure identical content always produces the same CID.

**Gun HAM and the ledger chain.** Gun's HAM resolves concurrent writes to the same path (last-write-wins). The ledger chain resolves ordering across different paths over time (causal sequence via `prev`). They operate at different levels and are complementary: Gun ensures each `ledger/<userId>/events/<seq>` path is consistently replicated across peers; the `prev` chain ensures the sequence of those paths is tamper-evident. If HAM produces a write collision on a given `seq` path (a Byzantine or clock-skew fault), the chain-verification step in the delta-sync protocol detects the broken `prev` link and rejects the bad event.

**IPFS pinning and Gun RAD persistence.** Desktop super-peers are responsible for both: persisting their neighborhood's Gun graph (via radata/) and pinning the IPFS CIDs referenced within it. These responsibilities map onto the same node type and the same concept of "being a reliable neighbor," but they are distinct storage systems. A CID that appears in a Gun node field is not automatically pinned in IPFS — pinning must be triggered explicitly by the super-peer when it processes a Gun node containing a CID field.

---

## 5. Design Recommendation for IinPublic

Based on the survey, the most appropriate architecture for IinPublic's interaction ledger is a **hybrid of Secure Scuttlebutt's per-user append-only chain and IPFS's content-addressed event IDs**, layered on top of the existing Gun.js transport.

**Per-user interaction feed:** Each user maintains a personal append-only log of interaction events. Each event is identified by a **CIDv1** (dag-json codec, sha2-256, computed locally via `multiformats`) of its content, and references the CIDv1 of the previous event in their feed (`prev`). The sequence number (`seq`) is implicit from the position in the chain but stored explicitly for efficient delta-sync queries.

**Event kinds:** TALK_CREATED, TALK_BROADCAST, TALK_RECEIVED, TALK_ANSWERED, TALK_SUPERSEDED, TALK_WITHDRAWN, MATCH_CREATED, CONVERSATION_MESSAGE. Each has a content-addressed CIDv1 derived from its payload. `TALK_SUPERSEDED` carries `{ oldTalkId, newTalkId }` and is advisory to the UI — it does not invalidate prior answers or matches against the old talk. `TALK_WITHDRAWN` carries `{ talkId }` and instructs peers to stop routing the named talk to users who have not yet received it; it does not affect answers or matches already in flight.

**Delta sync protocol:** When two users establish a peer connection, they exchange their current `seq` numbers per feed. Each then sends the other only events with `seq > known_seq`. This is the SSB model applied to Gun paths: `ledger/<userId>/events/<seq>`.

**Content-addressing for deduplication:** A talk's ID is a **CIDv1** (dag-json, sha2-256) computed locally via `multiformats` — replacing the previous local SHA-256. This unifies the content-addressing scheme with IPFS. A response's ID is `CIDv1(talkId + responderId + responseContentJson)`. A modified talk or response produces a different CID and is treated as a new event; the old entry remains immutable in the ledger.

**Conversation DAG:** Conversations between two users use a two-writer DAG (Matrix-style): each message references the last message the sender has seen from the other party. This gives a causal ordering that works correctly when both parties are offline and resync later.

The detailed requirements that follow from this design are captured in [SRS.md §4.8](./SRS.md) and the implementation plan is in [p2p-architecture.md §6](./p2p-architecture.md).

---

## 6. Sources

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
