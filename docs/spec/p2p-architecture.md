# P2P Architecture: Data Storage and Network Design

**Status:** Proposed  
**Date:** 2026-05-25  
**Replaces:** Star-topology Gun.js server model

---

## 1. Current Architecture: Star Topology

### How data is stored today

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

## 2. Proposed Architecture: P2P Relay Mesh

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

## 3. Data Storage and Distribution in the P2P Structure

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

## 4. Desktop Node.js Users as Super-Peers

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

## 5. Migration Considerations

The migration from star to P2P can be done incrementally:

1. **Phase A — Dual-mode server:** Keep the current server but add WebRTC signaling endpoints. Browser clients connect to both the server (for existing data) and to peers (for new data). Validate that direct peer sync works correctly.
2. **Phase B — Shift writes to client:** Move talk delivery fanout and conversation writes to client-side, using the peer mesh as transport. Server still holds `radata/` as a fallback read source.
3. **Phase C — Server becomes relay-only:** Strip all application data from the server. Remove `radata/`. Server holds only the ephemeral location index and signaling state. Desktop super-peer nodes absorb the durable-storage role.
4. **Phase D — Optional DHT bootstrap:** Replace or supplement the signaling server's user discovery with a DHT so the network can survive server downtime entirely.

The match logic (`src/shared/talk-engine.ts`) and SEA encryption survive unchanged — they were already designed to run on both sides. Content-addressing transitions from `talk-content-id.ts` (local SHA-256) to CIDv1 (dag-json, sha2-256, via `multiformats`) — the `talkId` format changes but the concept is the same. `talk-content-id.ts` is replaced in Phase G.

---

*See also: [SRS.md](./SRS.md) for full system requirements including the P2P architecture.*

---

## 6. Interaction Ledger: DAG-Based History and Delta Sync

> Background research: [blockchain-dag-survey.md](./blockchain-dag-survey.md)

### 6.1 Motivation

Gun.js's CRDT (HAM) resolves concurrent writes with last-write-wins and propagates state diffs efficiently — but it is fundamentally a **mutable graph**. There is no native concept of "give me everything that happened since we last spoke." When two users reconnect after a gap, Gun must diff the entire relevant graph state to find what changed, and there is no tamper-evident record of the order in which events occurred.

Two requirements demand a different structure:

1. **Provable timeline.** If Alice broadcasts a talk and later modifies it, the modification must be distinguishable from the original, and both versions must be attributable to Alice with timestamps she cannot retroactively alter.
2. **Automatic delta sync.** When Alice and Bob reconnect, they exchange only the interactions that are new to each other — no re-sending of talks both already hold, no full-state comparison.

The solution is an **interaction ledger**: a per-user append-only chain of signed interaction events, modeled after Secure Scuttlebutt (SSB) and using content-addressing unified with IPFS's CIDv1 scheme.

### 6.2 Ledger Structure

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

### 6.3 Content Addressing and Deduplication Rules

Every piece of application data is **content-addressed** before being recorded in the ledger:

All content addresses use **CIDv1** (dag-json codec, sha2-256) computed locally via the `multiformats` npm package. No IPFS daemon or network connection is required to compute a CID — it is purely a local hash with a standard envelope. The same CID that serves as the Gun.js path key would also address the content in IPFS if it were ever published there. This unifies the content-addressing scheme: text talks and media blobs share one identifier format, and the `talkId` of a talk containing embedded media automatically commits to the media's CID as part of its content.

**Canonical serialization requirement:** The talk or response object must be serialized with deterministic key ordering and no undefined fields before hashing, or structurally identical content can produce different CIDs. A canonical `JSON.stringify` with sorted keys and a defined field schema is sufficient.

**Talk identity:** `talkId = CIDv1(canonicalSerialize(talk))`. A user who modifies any talk field produces a new `talkId`. The original is never deleted from the ledger; the new version gets its own `TALK_CREATED` event. When the sender additionally emits `TALK_SUPERSEDED { oldTalkId, newTalkId }`, receivers can visually collapse the two versions in their inbox. Peers who have seen the original `talkId` are not re-sent it; they receive only the new event.

**Response identity:** `responseId = CIDv1(canonicalSerialize({ talkId, responderId, responseContentJson }))`. A modified answer produces a new `responseId` and a new `TALK_ANSWERED` event. The new response supersedes the old one for match-logic purposes; the old event is immutable in the ledger. A peer whose `seq` is behind the new event's `seq` receives it automatically on the next delta-sync.

**Message identity:** `messageId = CIDv1(canonicalSerialize({ conversationId, senderPubkey, content, seq }))`. Immutable once written.

**Question identity (chatbot cache granularity):** Each individual question within a talk gets its own `questionId = CIDv1(canonicalSerialize({ text, type, options }))` — derived from what the question *asks*, not from which talk it belongs to. This is the key that the chatbot uses for its per-question answer cache, independently of `talkId`. If Bob changes the routing between questions (which answer leads where) but not the question text or options, the `questionId` is unchanged — the chatbot can auto-fill Alice's previous answer. The `talkId` still changes because it covers the whole talk including routing logic. The two identities serve different purposes: `questionId` for chatbot reuse, `talkId` for match logic integrity.

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

### 6.4 Delta Sync Protocol

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
1. `id` matches the expected hash of `(seq + kind + content + prev + pubkey)`.
2. `prev` matches the `id` of the event at `seq - 1` in Alice's local copy.
3. `sig` is a valid SEA signature by `pubkey` over the event fields.

Only after all three checks pass does Alice append the events to her local ledger and update her `seq` for that feed. Invalid events are discarded and logged.

**Complexity:** O(Δ) — proportional only to the number of new events, not the total history. Two users who meet daily exchange only that day's interactions, regardless of how long they have known each other.

### 6.5 Versioning Semantics and Concurrent Edit Scenarios

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

This event is **advisory only**. It does not invalidate any answer or match that occurred against `oldTalkId`. Receivers use it solely to group the two talks in the UI (showing `newTalkId` as primary, `oldTalkId` as "earlier version"). If `TALK_SUPERSEDED` has not yet arrived (e.g., the edit propagated ahead of the supersession event), both talks appear in the inbox independently until the ledger sync catches up.

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

### 6.6 Conversation Sub-DAG

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

### 6.7 Chatbot Differential Answering and TALK_WITHDRAWN

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

### 6.8 Storage in Gun

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

### 6.9 Migration Phase for Ledger

The ledger is additive and can be introduced in a new migration phase without breaking the existing star-topology deployment:

**Phase E — Ledger bootstrap (parallel with Phase A–B):** Introduce the `InteractionEvent` type and the `LedgerService` (client-side). New interactions write both to the existing Gun paths (for backward compatibility) and to `ledger/<userId>/events/<seq>`. Existing interactions are not back-filled — the ledger starts from the day of deployment.

**Phase F — Delta sync in peer connections:** During peer handshake (Phase B+), add the `LEDGER_STATE` exchange before talk delivery. Peers that have not yet adopted the ledger fall back to full Gun sync; peers that both support the ledger use delta-sync only.

**Phase G — Ledger as sole source of truth:** Once all clients support the ledger, remove the duplicate writes to legacy Gun paths. The ledger's `index/talkId` and `index/responseId` sub-paths replace the current `incomingTalksByUser` and `talkAnswerTemplateByUser` patterns.

