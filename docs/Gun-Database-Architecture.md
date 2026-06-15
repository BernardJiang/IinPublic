# IinPublic: Gun Database Architecture & Data Flow

## 1. What Is IinPublic?

**Not a chat app.** IinPublic is a **public self-definition through interaction platform**. A person's identity on the network is defined by three pillars:

| Pillar | Description | Persistence |
|---|---|---|
| **Profile Q&A** | List of questions + personal answers defining the user's public image. Visibility tiers: `public`, `contacts_only`, `private`. Some auto-generated (chatbot-reusable), some manual. | SEA-encrypted in private space; foundation index published publicly |
| **Talks** | Structured interaction templates in 4 types — `tag` (binary toggle/interest signal), `flow` (linear Q/A chain), `survey` (independent poll with aggregation), `route` (branching DAG with context-hash routing) | Full talk definition on public mesh (`talks/<id>`) |
| **Interactions** | Conversations triggered when a talk match — cryptographically verifiable, optionally encrypted message exchange | Dual storage: public mesh + pair-private; every event signed to ledger |

## 2. Identity & Encryption Layer (SEA)

Every user gets a Gun SEA keypair on first run. It is persisted as an AES-GCM encrypted custody record in localStorage:

- **`pub` / `priv`**: Signing keys — authorize ledger events, prove talk authorship
- **`epub` / `epriv`**: Ephemeral keys — generate per-pair shared secrets via `SEA.secret(peerEpub, myPair)` for message encryption

Custody mechanism: PBKDF2-SHA256 (150k iterations) from a per-device 32-byte secret → AES-GCM key → encrypt full `{pub,epub,priv,epriv}`. Exportable + importable recovery package.

localStorage keys: `iinpublic_key_custody_v1`, `iinpublic_key_custody_device_secret_v1`

## 3. Complete Gun Graph Reference

### 3.1 User Profiles (Public)

```
users/<userId>                          — core user record (stageName, location blur, languages, interests, pub, epub)
└── reputation                          — sub-node: { questionsAnswered, talksSent, matchesFound, friendsCount,
                                                   likedCount, dislikedCount, starRating, reviewCount,
                                                   ageVerified, blockCount, isHidden }
```

### 3.2 Profile Foundation (Discovery Index)

Separate from `users/` — optimized for peer discovery scans:

```
user-public-profile/<userId>
├── headshot?
├── languagesJson          # JSON string of language list
├── profileJson            # JSON string of QuestionAnswer[] with visibility filter applied
└── interestsJson          # JSON string of Tag[]
```

Why separate? Because `profile.public-profile` can be updated incrementally without rewriting the whole user record. The merge algorithm handles concurrent writes better.

### 3.3 Private User Space (SEA Encrypted)

Path: `gun.user(<userId>).private/<key>` — AES encrypted, owner-only readable.

```
private/profile
├── profile[]              # Full Q&A including private-visibility items
├── languages[]
├── interests[]
├── knownPeople[]          # Friend/relative/coworker list with labels, nicknames, ratings, notes
├── blockedUserIds[]
└── talkFilters            # Intake filters: distance range, allowed languages, blockDirtyWords,
                           #    allowedTalkTypes[], customBlockedTerms[]

private/chatrooms/<chatroomId>/<path>  — per-chatroom preferences (SEA encrypted)
```

### 3.4 Tags & Tag Index (Discovery)

Two-path system for interest-based user discovery:

```
user-tags/<userId>              →  { tags: Record<tagName, weight>, updated }
tag-index/<tagName>/<userId>    →  reverse index: given tag → set of tagged users
user-tags-delta/<userId>        →  delta envelope for incremental peer sync
```

### 3.5 Talk Definitions

```
talks/<talkId>
└── data: JSON.stringify({ id, title, authorId, type, isAdult, language, tags[], questions[],
                             createdAt, isTemplate, usageCount, expiresAt?, locationRadiusMiles? })

questions (serialized inside talk):
├── cidId                  # Content hash — stable across routing changes
├── text, answers[]
├── nextQuestionId?        # linear flow chaining
├── branchingLogic[]?      # route DAG edges: { answerId → nextQuestionId }
├── contextPath[]?         # ordered (questionId:answerId) steps for DAG traversal
└── contextHashId?         # 8-char FNV-1a hash of preceding chain — O(1) chatbot lookup

bulkJobs/<jobId>           →  broadcast job metadata { talkId, senderId, targetScope, status... }
```

### 3.6 Incoming Talk Index (Mesh Matching)

When talks are broadcast through the Gun mesh, they arrive at recipients' inboxes. Clusters group identical/related talks so the user sees "one topic" not hundreds of duplicates.

```
ownerIncomingTalkIndex/<receiverUserId>/<identityKey>
├── title, type, language
├── senders: { senderId: { senderName, lastTalkId, lastReceivedAt } }
├── talkIds                  # per-talker latest instance map
├── questionCount, latestTalkId, updatedAt
├── identityAliases          # tracks equivalent identityKeys (content-semantic grouping)
└── authorLocation?          # for radius-based recipient filtering
```

**Identity key** = content-derived hash. Same logical talk with edits or re-broadcasts from different senders coalesces into one cluster node. The merge function (`mergeIncomingTalkCluster`) handles incremental updates.

### 3.7 Conversation System (Two-Writer DAG)

Created when a talk match triggers:

```
conversations/<conversationId>
├── data: JSON.stringify({ participants:[userIdA, userIdB], talkId?,
    status:'active'|'matched'|'ignored'|'expired'|'withdrawn', createdAt, lastActivity })
└── messages/               →  message nodes (public mesh storage)

users/<userId>/conversations/<conversationId>
├── conversationId
└── otherUserId             # O(1) peer lookup within this convo

conversations/<convId>/answers/<questionId>  →  { answerId, userId }
```

### 3.8 Message Records — Dual Storage Architecture

**This is critical for the scalability question.** Messages are stored using ONE of two paths based on transport mode:

```
# Star-gun / server-relay mode (public mesh — everyone can see)
conversations/<convId>/messages/<msgId>

# Direct-p2p mode (pair-scoped — only A and B access this path)
pairConversations/<pairId>/<convId>/messages/<msgId>
```

where `pairId = [userIdA, userIdB].sort().join('__')` — deterministic collision-free pair key.

**Message wire format:**
```json
{
  "id": "<msgId>",
  "senderId": "<userId>",
  "text": "...",                  // plaintext OR SEA{...} ciphertext
  "timestamp": "ISO-8601",
  "channel": "public|known|mutual",
  "transport": "star-gun|server-relay|direct-p2p",
  "encryption": "sea-ecdh-v1",   // present when encrypted
  "prevSeen": "<otherMsgId>",     // DAG link — last message from OTHER participant
  "isFromChatbot": true
}
```

**Encryption**: When `channel !== 'public'` or transport is `direct-p2p`: text = `SEA.encrypt(plaintext, SEA.secret(peerEpub, myPair))`. Only holders of the matching ephemeral key pair can decrypt.

### 3.9 Interaction Ledger (Cryptographic Audit Trail)

Per-user event chain with CIDv1 self-certifying IDs and SEA signatures:

```
ledger/<userId>/events/<seq>   →  { id (CIDv1), seq, prev (CIDv1|null), kind, pubkey,
                                     timestamp, contentJson, sig }
ledger/<userId>/head           →  { seq, prevCid }          # feed head pointer
ledger/<userId>/state          →  { stateJson, updatedAt }   # broadcasted LedgerState

# Indexes for O(1) lookup:
ledger/<userId>/index/talkId/<talkId>
    →  { eventIds: "id1,id2,...", lastSeq }
ledger/<userId>/index/responseId/<responseId>
    →  { eventId, seq }
ledger/<userId>/index/withdrawn/<talkId>
    →  { withdrawnAt, eventId, gracePeriodMs }

# Delta-sync inbox (other peers push here):
ledger/<peerId>/inbox/<eventId>
    →  { eventJson, deliveredAt }
```

**Event kinds:** `TALK_CREATED`, `TALK_BROADCAST`, `TALK_RECEIVED`, `TALK_ANSWERED`
(outcome: match/mismatch/ignore), `TALK_SUPERSEDED`, `TALK_WITHDRAWN`, `TALK_RETRACTED`
(tombstone), `MATCH_CREATED`, `CONVERSATION_MSG`

### 3.10 Chatroom System

```
chatrooms/<chatroomId>
├── users/<userId>           →  { isActive: bool }
├── visits/<visitEventId>    →  visit audit trail entries
├── visitCount               →  running number
├── uniqueVisitors/<userId>  →  presence flag (dedup)
└── uniqueVisitorCount       →  running number

chatroomRoles/<chatroomId>/<userId>
→  { chatroomId, userId, role:'owner'|'moderator'|'member'|'guest',
     assignedAt (unix ms), assignedBy (userId) }
```

Private per-user chatroom prefs stored SEA-encrypted at `gun.user().private/chatrooms/...`

### 3.11 Blocks

```
user-blocks/<blockerId>/<blockedId>        →  block record + timestamp
user-blocked-by/<blockedId>/<blockerId>    →  reverse lookup (who blocked me)
```

## 4. Two-Person Interaction Data Flow (Complete Pipeline)

### Phase 1: A sends a talk, B receives it

```
A creates talk "Coffee in SF?" (type: flow)
  │
  ├─→ talks/<talkId>          [PUBLIC mesh — anyone can discover]
  │
  ├─→ ledger/A/events/seq++   [AUDIT — TALK_CREATED event signed and chained]
  │   { talkId, title, type:'flow', language:'en' }
  │
  └─→ Gun mesh broadcast → delivered to B
      │
      └─→ ownerIncomingTalkIndex/B/<identityKey> [B's INBOX — merged into cluster]
          sender field updated: { A.id: { name, lastTalkId, receivedAt } }
          │
          └─→ ledger/B/events/seq++    [AUDIT — TALK_RECEIVED]
              { talkId, senderId:A }
```

### Phase 2: B answers → Match → Conversation

```
B answers "Yes, Friday" → outcome: match
  │
  ├─→ conversations/<convId>/answers/Q1   [ANSWER stored per-question]
  │   { answerId:'yes_friday', userId'B' }
  │
  ├─→ ledger/B/events/seq++              [AUDIT — TALK_ANSWERED, outcome:match]
  │
  ├─→ conversations/<convId>             [CONVERSATION created on mesh]
  │   { participants:[A,B], talkId, status:'matched', ... }
  │
  ├─→ users/A/conversations/<convId>     [INDEX — A's conversation list]
  ├─→ users/B/conversations/<convId>     [INDEX — B's conversation list]
  │
  └─→ ledger/B/events/seq++              [AUDIT — MATCH_CREATED]
      { talkId, conversationId, otherUserId:A }
```

### Phase 3: A ↔ B exchange messages (Two-writer DAG)

```
A sends "Sounds good" (channel:'mutual', SEA encrypted):
  │
  ├─→ pairConversations/A__B/<convId>/messages/msgA1   [PAIR-PRIVATE — direct-p2p mode]
  │     { id:msgA1, senderId:A, text:"SEA{...encrypted...}", prevSeen:null }
  │
  └─→ (if also star-gun fallback) → conversations/<convId>/messages/msgA1

B sends "Bring cash" (channel:'known', SEA encrypted):
  │
  ├─→ pairConversations/A__B/<convId>/messages/msgB1 [PAIR-PRIVATE]
  │     { id:msgB1, senderId:B, text:"SEA{...encrypted...}", prevSeen:"msgA1" }
  │
  └─→ (if also star-gun fallback) → conversations/<convId>/messages/msgB1

Both subscribe to changes via Gun .on() callbacks — messages arrive in real time.
prevSeen links form a mergeable DAG for offline convergence.
```

### Phase 4: Delta-sync (Ledger propagation)

```
A broadcasts: ledger/A/state → { B.userId → A.latestSeq, ... }
B reads A's state → compares with own peerState[A.userId]
B pushes missing events → ledger/B/inbox/<missingEventIds>
A subscribes to ledger/A/inbox → ingests + verifies remote events
```

## 5. Scalability Analysis: Tom Meets 10,000 People

### What actually occupies space on Tom's Gun node?

| Data | Growth Model | Example (10K people) | Local or Mesh? |
|---|---|---|---|
| **Tom's own profile** | O(1) | ~5 KB always | Private SEA-encrypted + public index |
| **Tom's own ledger events** | O(events per talk action) | ~20K–50K events at 2–5 each | Public mesh (`ledger/Tom/events/`) |
| **Jerry's profile (cached)** | O(1) per recently-viewed user | One page-load fetch, evicted by GC naturally | Public mesh — NOT pinned locally |
| **Tom's conversations with Jerry** | O(1) conversation header | ~200 bytes each × 10K = ~2 MB | Public mesh + personal index at `users/Tom/conversations/` |
| **Messages with Jerry** | O(msgsPerConv × 10K) | Critical growth vector | **Dual storage** — see below |
| **Remote ledger events (delta-sync)** | O(peersTomActivelySyncsWith × theirSeqDelta) | Selective — Tom only syncs active conversations' peers | Pushed to `ledger/Tom/inbox/` by interested peers |
| **Talk definitions read by Tom** | O(unique talks answered) | Bounded — even 10K people reuse same talk templates | Public mesh — one copy per talkId, NOT per person |

### Key insight: The actual storage bottleneck is message history.

In **direct-p2p mode** (the target architecture), messages go to `pairConversations/<pairId>/<convId>/messages/` — these are pair-scoped graph paths that only Tom and Jerry access. Gun's replication protocol means other peers don't receive them. However, the Hub Gun server IS a peer and will store everything unless the p2p-runtime flag `shouldSkipServerGunPersist()` intercepts it.

From the runtime config:
```typescript
messageBodyStorage: 'gun-local',  // default — only client-side storage
receiptsStorage: 'gun-local',     // same for receipts
```

And the server service checks:
```typescript
if (shouldSkipServerGunPersist(path, flags, options)) return;
```

So in production with `gun-local` mode, **10K conversations' message history lives only on Tom's and Jerry's respective devices, NOT replicated to the hub or other peers.** The Hub stores the conversation header (participants, status) but not individual messages.

### Estimated storage on Tom's node at 10K people:

| Component | Size estimate | Notes |
|---|---|---|
| Private profile data | ~5 KB | Fixed |
| KnownPeople records | ~1 MB | ~100 bytes per KnownPerson × 10K = ~1 MB max |
| Conversation headers (index) at `users/Tom/conversations/` | ~2 MB | ~200B × 10K conversations |
| Own ledger events | ~5–10 MB | ~300 bytes/event × 30K events ≈ ~9 MB |
| Messages (average case) | **~50–300 MB** | If avg 50 msgs/conv at 200B each: 10K × 50 × 200B ≈ 100 MB. Varies wildly. |
| Others' ledger inbox events | ~1–5 MB | Selective delta-sync from active peers only |
| Talk definitions (duplicates avoided) | ~1–5 MB | Reused templates — 10K people might use 200 unique talks |

**Total estimate: ~60–320 MB on Tom's localStorage/IndexedDB at 10K conversations.**

The dominant term is message history, and it scales linearly — each additional person costs only their own conversation's messages plus a few hundred bytes of index overhead.

### What Tom does NOT store locally:

- **Jerry's full profile** beyond what Gun naturally caches from the last fetch — profiles are fetched on-demand, not pinned
- **Talk content for talks Tom didn't answer** — talk definitions are shared state (one `talks/<id>` per unique talk), not duplicated per conversation
- **Messages with people who used star-gun transport and whose conversations are stale** — Gun's gc can trim rarely-accessed nodes

### Design recommendations:

1. **Message TTL / pagination**: For 10K people, Tom shouldn't hold the full message stream live. The UI should page through `conversations/<convId>/messages/` on demand rather than pre-subscribing to all.
2. **Profile fetch caching, not pinning**: `users/<userId>` records are fetched per-view and naturally evict from Gun's internal cache. No explicit retention policy needed for profiles.
3. **Ledger inbox pruning**: After Tom ingests a remote event from `ledger/Tom/inbox/<eventId>`, that inbox entry should be purged to prevent unbounded growth.
4. **Incoming talk cluster merging**: The cluster system already solves the "same talk from 50 people" problem — one node in Gun per identityKey regardless of sender count.

## 6. Persistence Architecture

- **Server Hub Gun** (production): `radisk: true`, persistent JSON file on disk, WebSocket/WebRTC mesh hub for client synchronization
- **Client Gun** (browser): `localStorage: true` + Web Worker bridge (`/worker.js`) backing IndexedDB — better capacity and durability than plain localStorage
- **SEA Private Space**: AES-GCM encrypted values stored on mesh at `gun.user().private/<path>` — readable only by owner's SEA pair, invisible to other peers (they see garbage ciphertext)
- **Direct-P2P fallback**: When the Hub is down, pair-scoped paths under `pairConversations/` still exist locally — Tom and Jerry each have their own partial graph that merges deterministically via message DAG linking on reconnection
