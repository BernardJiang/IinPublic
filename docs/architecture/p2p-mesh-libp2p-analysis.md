# P2P Mesh Analysis -- libp2p Comparison and IPFS Strategy

**Last updated:** 2026-06-10
**Source:** Telegram DM, June 10, 2026
**Specs:** specs/iinpublic-technical-specifications.md section 23, section 19.13/14, Phase D section 24

---

## 1. Current Mesh Architecture

Server reduced to presence plus signaling only. Talk delivery flows P2P over WebRTC DataChannels.

### Overlay Construction
- Seeded from Socket.IO rosters (presence data only)
- Max K neighbors per peer (default 12, E2E uses 3). Sparse graph, not full mesh
- WebRTC DataChannel connections between browsers directly
- Glare avoidance via localeCompare initiator selection

### Unified Frame Envelope
All messages share one envelope type carried over DataChannels.

    P2PMeshFrame {
      kind: mesh-ping | talk-announce | talk-body-request | talk-body | talk-response | ack
      msgId: dedup key per emission
      roomId: scope guard drops cross-room frames
      originUserId / originPub: signer survives forwards
      recipientUserId optional: absent means flood, present means unicast
      ttlHops: default 8, decrements each forward, stops at 0
      payload: kind-specific data
      proof optional: SEA signature verified before processing
    }

Flood mode has no recipient. Forward to all neighbors minus inbound sender via split-horizon rule. Unicast has target and relay hops toward destination. Seen-set bounded at ~10k FIFO entries, cleared on room leave. Every frame verified via SEA signature before processing.

### Shipped Delivery Pipeline (Steps 1-6 and 8)
- **Step 1:** talk-announce flood with metadata -- Done
- **Step 2:** talk-body-request / talk-body unicast pull on demand -- Done
- **Step 3:** Receiver-side intake filtering for language, distance, adult content, age cutoff -- Done
- **Step 4:** talk-response unicast plus local checkIfMatch running deterministic conversation creation both sides independently without server fan-in -- Done
- **Step 5:** Local-only contacts derived from conversations and exchanges with zero server API calls -- Done
- **Step 6:** Encrypted TTL mailbox fallback for offline peers as server dead-drop storing ciphertext only -- Done
- **Step 8:** TalkLedgerStore in localStorage with outcomes, exchanged set, edge counters replacing server guards including per-identity suppression and rate limiting (daily quota 10, weekly quota 50) -- Done

### Steps 9-11: Designed Not Coded Yet
- **Step 9:** Change-of-mind versioning (REQ-LEDGER-04) -- designed in p0-steps8-11-ledger.md
- **Step 10:** Talk retraction teardown (REQ-LEDGER-15, section 20.7) -- designed in same file
- **Step 11:** Mutual exchange suppression per-tag identity tracking (REQ-LEDGER-16) -- designed in same file

Shared data model scaffolded by step 8 means no migration needed later since version, respondedAt, identityKey, and role fields already present.

### Step 7: The Big Deletion (Not Started)
Claude Code hit usage limit before beginning step 7 plus steps 9 through 11 implementation. Step 7 deletes all server-side talk delivery infrastructure including talk-delivery-routes, server maps (incomingTalksMap, talkResponsesMap, conversationsMap), peer routes, and Gun relay paths for talks. Step 8 landed first because deleting maps without client replacements creates unbounded rebroadcast risk per design note R-b. Now safe to proceed since step 8 is committed.

---

## 2. The Unified Ledger (Step 8)

TalkLedgerStore persisted to localStorage key `talkLedger`. Single JSON document with four indexed sections sharing version and timestamp fields:

- **outcomes:** keyed by responderId::talkId::authorId. Tracks who answered talks and how (matched / ignored / no-reply).
- **exchanged:** keyed by peerId::identityKey. Symmetric pair-identity record, both roles annotated.
- **edges:** keyed by peerId outbound only. Holds per-peer cooldown plus daily/weekly quota counters mirroring server limiter defaults exactly.
- **retracted:** keyed by talkId::authorId. Tombstones for deleted talks (step 10).

Steps 9 through 11 activate these sections without data migration since fields already scaffolded in pure module talk-ledger.ts with unit tests covering compareResponse, shouldSuppress, applyEvent, applyEdgeGate, and eviction logic.

---

## 3. libp2p vs Current Mesh Comparison

### Layer Mapping
- **Peer Routing:** PeerMeshService neighbor select maps to Identify + ping protocols in libp2p
- **Gossip Protocol:** Custom TTL with split-horizon logic is more efficient than standard pubsub simple flooding found most p2p libraries
- **Transport:** WebRTC DataChannel via server signaling currently; libp2p provides multi-transport layer (WebSocket, WebRTCs, CircuitRelay)
- **Identity:** SEA signing pairs currently versus Ed25519 PeerID standard in libp2p
- **Discovery:** Single Socket.IO roster source currently versus DHT (Kademlia) + mDNS in libp2p
- **NAT Traversal:** STUN via ICE candidates manually currently versus Auto-NAT with adaptive fallbacks in libp2p

### Gaps libp2p Fills

**1. Discovery independence.** Current stack fails if hub goes offline since Socket.IO is sole discovery source. Mesh collapses into isolated clusters with no way to rediscover peers. Phase D planned DHT bootstrap to fix this problem but not implemented yet -- essentially rebuilding Kademlia-based distributed discovery that libp2p already provides.

**2. NAT traversal robustness.** Manual ICE plus STUN only today. libp2p has auto-NAT detection with multiple fallback strategies including circuit relays when hole punching fails. Fixes chronic E2E flakiness where split-browser Chromium WebRTC connections hang behind strict NATs.

**3. Protocol isolation.** Single DataChannel carries all frame types now. libp2p negotiates per-stream so one stuck response path does not block announces or pings since independent protocols multiplexed over same transport session with backpressure isolation.

### Current Mesh Advantages We Keep

- **Hop-limiting plus deduplication efficiency:** Better than naive pubsub flooding especially large rooms. TTL-based early termination saves network traffic compared to convergence-based approaches typically used by standard p2p libraries.
- **SEA crypto familiarity:** Team understands and maintains ECDH pair cipher, ledger signing. Entire surface mapped, tested, documented thoroughly by developers who built the original codebase.
- **TalkLedgerStore ordering logic:** Versioned timestamps, rate limits, LRU eviction policies are domain-specific concerns no general-purpose library would provide built-in.

### Redundancy Assessment

Overlap concentrated in connection management code: approximately 150 lines per concern area for offer handling, ICE exchange routing, DataChannel error recovery and retry logic scattered across files including p2p-webrtc-session.ts (~800 lines total) and system-routes.ts signaling endpoints. libp2p handles these automatically via standardized protocol registration reducing maintenance burden long term without losing custom gossip quality advantages already designed, implemented, shipped, tested, and verified in production.

---

## 4. Integration Strategy (libp2p + SEA + Gun)

### Architecture After Migration

    App Logic: PeerMeshService, P2PMeshFrame frames
        |
        | wraps send / forward logic unchanged
        v
    libp2p stream handler at /iinpublic/mesh/1.0.0
        +-- WebSocket transport
        +-- CircuitRelay fallback when NAT blocks direct

### Protocol Registration Sketch

In peer-mesh-service.ts register handler replacing ~800 lines WebRTC negotiation code:

    libp2p.handle(/iinpublic/mesh/1.0.0, async ({stream}) => {
      frame = JSON.parse(await readMessage(stream))
      if (!verifyOrigin(frame, peerId)) return  // SEA check unchanged
      if (seen.has(frame.msgId)) return         // dedup unchanged
      seen.add(frame.msgId)
      forwardFrame(frame)                        // forwarding logic unchanged
    })

### Identity Binding Decision

Recommendation: Keep SEA as application crypto. libp2p handles transport security underneath transparently via noise handshake with Ed25519 PeerIDs separate from SEA signing pairs used for domain identity, frame signatures, and ECDH pair cipher derivation. Two cryptographic namespaces coexist without mixing concerns.

### What Changes versus What Stays

**Replaced:**
- p2p-webrtc-session.ts file (~800 lines WebRTC connection management)
- Server signaling endpoints (/api/p2p/signaling, conversation-relay, discovery routes)

**Kept exactly as-is:**
- All frame types in p2p-mesh-protocol.ts (ping, announce, body-request/body, response)
- SEA crypto operations (ECDH derivation, encryption, signing)
- Gun distributed database via WebSocket replication with IndexedDB adapter
- Custom forwarding logic (split-horizon, TTL decrement, room scoping, seen-set dedup)
- TalkLedgerStore ordering rules (versioning, rate limiting, LRU eviction)

**Added:**
- Protocol handler registration wrapping existing mesh methods via libp2p stream API
- Optional circuit relay fallback capability automatically available
- Eventually Phase D discovery uses built-in libp2p DHT instead custom implementation

### Gun Coexistence

Gun stays exactly the same. Zero changes required. libp2p provides better peer communication channels for mesh gossip frames and pairwise conversation messages only. WebSocket replication path remains active independently handling state synchronization perfectly well without any modification needed. This is a transport-layer swap only, not a database replacement.

---

## 5. IPFS = Free libp2p Transport Layer

Adding IPFS for file sharing brings libp2p as core dependency automatically. One dependency satisfies both requirements: distributed content-addressed storage AND improved p2p transport backbone.

### Benefits of This Approach

- **Native CID alignment:** talkId and responseId already use CIDv1. IPFS handles these natively so the same content-addressing primitives extend from talks/files consistently across both domains.
- **libp2p node available immediately:** Access via node.libp2p API. Register custom protocol handler at /iinpublic/mesh path without separate installation step or extra bundle overhead since it is bundled already.
- **File sharing becomes trivial:** Upload a file, get hash, send hash via existing talk-response frame. Receiver fetches exact bytes reliably from whichever peer has them regardless original sender online status.

### Practical Next Steps for Implementation

1. Pick browser-compatible IPFS library matching webpack bundler setup (e.g., ipfs-http-client or @web-std/ipfs depending on requirements)
2. Initialize IPFS node alongside existing SEA + Gun bootstrap sequence during app startup maintaining full compatibility with current codebase
3. Tap into node.libp2p underneath and register custom protocol handler at /iinpublic/mesh/1.0.0 wrapping existing PeerMeshService methods via libp2p stream API replacing WebRTC DataChannel calls
4. Keep all application layers unchanged: gossip framing, SEA crypto, TalkLedgerStore ordering, Gun persistence paths remain exactly as designed and verified in current codebase


---

## 6. Review notes (2026-06-10, merged into SRS §25 + TODO P1)

**Status corrections vs sections 1 above (the analysis predates the 2026-06-10 work):**

- **Step 7 IS shipped** (commits 73b093e0 + aa4f1a30 + 1d47b334): server talk maps, peer-routes,
  response/stats endpoints, edge limiters deleted; `talks/*` author persistence moved to
  `myAuthoredTalks` localStorage; `p2pMeshTalkBodies/*` Gun rendezvous replaced by per-recipient
  mailbox posts; dead `chatrooms/*/announcements` subscription removed. Pending one local
  full-suite E2E confirmation.
- **Steps 9-11 remain open** (designed in `docs/design/p0-steps8-11-ledger.md`); the libp2p/IPFS
  epic (TODO P1) is sequenced after them.
- **"Step 1/Step 2" labels in §1's pipeline list** are off-by-one vs TODO numbering (announce
  flood is TODO step 2; body pull is step 3); harmless, but TODO numbering is canonical.
- **Library choice:** prefer **Helia** (current js-ipfs successor, webpack-compatible) over the
  suggested `ipfs-http-client` (requires an external daemon — wrong fit for browser peers) or
  `@web-std/ipfs`. Decision recorded as REQ-IPFS-01.
- **Adopted with refinements** in SRS §25: SEA-signed `userId↔PeerID` binding records
  (REQ-LIBP2P-02, reusing §24.2's replay/TTL threat model), encrypt-before-add privacy rule
  (REQ-IPFS-03 — IPFS content is world-readable), and the matched-talk auto-share link with
  deterministic idempotent message ids (REQ-IPFS-04, requested feature).
- **Mailbox carries links, never bytes** (REQ-IPFS-05) — the 64 KiB envelope cap makes this
  structural.
