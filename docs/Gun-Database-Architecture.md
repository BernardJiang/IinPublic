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

## 7. Database Size Estimation Formulas

### 7.1 Wire Format & Per-Record Overhead

Every message stored in the Gun graph traverses three cost layers:

| Layer | Size | What it is |
|---|---|---|
| Wire payload (plaintext JSON) | 150–250 bytes | `ConversationMessageWire` fields: `id, senderId, text, timestamp, channel, transport?, encryption?, prevSeen?, isFromChatbot?` |
| SEA.encrypt overhead | ~176 bytes | NaCl box seal → base64 expansion; applies only to non-`public` channels |
| Gun radisk node envelope | ~400 bytes | HAM CRDT metadata, JSON wrapping, node pointer, and graph links written to radisk |

**Total per message in Gun DB:**
- Encrypted (non-public channel, `direct-p2p` or `star-gun`): **~725–900 bytes ≈ 800B average**
- Plaintext (public channel): **~550–650 bytes ≈ 600B average**

### 7.2 Data Category Reference Sizes

| Data category | Size per unit | Gun path | Growth model |
|---|---|---|---|
| Talk definition (simple `tag`/`flow`) | ~400B | `talks/<talkId>` | One copy per unique talk — NOT duplicated per sender |
| Talk definition (complex `route` DAG) | up to ~5KB | `talks/<talkId>` | Multiple questions with branching logic and `contextHashId` fields |
| Answer record | ~300B | `conversations/<convId>/answers/<qId>` | Per `(talkId, questionId)` pair, includes `contextHash` + SEA sig |
| Conversation header | ~200B | `conversations/<convId>` + `users/<id>/conversations/<convId>` index | One per conversation |
| Conversation message (encrypted) | ~800B avg | `pairConversations/<pairId>/<convId>/messages/<msgId>` | **Primary growth driver** |
| Conversation message (plaintext) | ~600B avg | `conversations/<convId>/messages/<msgId>` | Public channel, `star-gun` mode only |
| Chatbot memory entry | ~200B | `talkAnswerTemplateByUser/<userId>/<identityKey>` | Per `(questionId, responseMode)` pair |
| Public profile index node | ~500B | `user-public-profile/<userId>` | Replicated from all chatroom members ever seen |
| Ledger event | ~350B | `ledger/<userId>/events/<seq>` | CIDv1 content ID + SEA sig + `prev` chain pointer + kind payload |
| KnownPerson record | ~100B | Inside SEA-encrypted `private/profile` blob | Per mutual contact with label, notes, rating |

### 7.3 Storage Formulas

**Per-conversation storage:**
```
S_conv(n, encrypted) = n × 800B + 200B (header)
S_conv(n, plaintext) = n × 600B + 200B (header)
```

**Talk-related storage** (combined sent + received, `a` = avg answers per talk):
```
S_talks(t, a) = t × 400B + t × a × 300B
             = t × (400 + 300a) bytes
```
For a `flow`/`route` talk with 4 questions: `a = 4`, giving `S_talks(t, 4) = t × 1,600B ≈ t × 1.6KB`.

**Ledger event storage** (`e ≈ 2t + C + m_sent` for a typical usage pattern):
```
S_ledger(e) = e × 350B
```
Event count breakdown: ~2 events per talk exchange (`TALK_CREATED`/`TALK_RECEIVED` + `TALK_ANSWERED`), 1 `MATCH_CREATED` per conversation, 1 `CONVERSATION_MSG` per outbound message sent.

**Total storage model:**
```
S_total = S_messages + S_ledger + S_talks + S_profiles + S_chatbot + S_misc

  S_messages = Σ_i (n_i × 800B)            [sum over all conversations, encrypted mode]
  S_ledger   = (2t + C + m_sent) × 350B
  S_talks    = t × (400 + 300a)B
  S_profiles = peers_seen × 500B
  S_chatbot  = unique_questions × 200B
  S_misc     ≈ 5–10KB                       [own profile, ledger indexes — effectively constant]
```

Variables: `t` = total talks exchanged, `C` = total conversations, `n_i` = messages in conversation i, `m_sent` = outbound messages sent by this user, `a` = avg answers per talk, `peers_seen` = distinct users whose profiles were fetched.

### 7.4 Concrete Scenarios

**Scenario A — Light user:** 5 talks exchanged, 3 conversations with ~20 messages each

| Category | Calculation | Size |
|---|---|---|
| Conversation messages (encrypted) | 3 × 20 × 800B | 48.0 KB |
| Conversation headers | 3 × 200B | 0.6 KB |
| Talk definitions | 5 × 400B | 2.0 KB |
| Answer records | 5 × 4 answers × 300B | 6.0 KB |
| Ledger events | (10 talk + 3 match + 30 msg) × 350B | 15.1 KB |
| Chatbot memory | 10 unique questions × 200B | 2.0 KB |
| Public profile index (peers seen) | 5 peers × 500B | 2.5 KB |
| Own profile + misc (fixed) | — | 5.0 KB |
| **Total** | | **≈ 81 KB** |

**Scenario B — Active user:** 50 talks, 15 conversations averaging ~50 messages each

| Category | Calculation | Size |
|---|---|---|
| Conversation messages (encrypted) | 15 × 50 × 800B | 600.0 KB |
| Conversation headers | 15 × 200B | 3.0 KB |
| Talk definitions | 50 × 400B | 20.0 KB |
| Answer records | 50 × 4 answers × 300B | 60.0 KB |
| Ledger events | (100 + 15 + 375) × 350B | 171.5 KB |
| Chatbot memory | 50 unique questions × 200B | 10.0 KB |
| Public profile index (peers seen) | 50 peers × 500B | 25.0 KB |
| Own profile + misc (fixed) | — | 5.0 KB |
| **Total** | | **≈ 895 KB ≈ 0.9 MB** |

**Scenario C — Power user:** 200 talks, 50 conversations averaging ~200 messages each

| Category | Calculation | Size |
|---|---|---|
| Conversation messages (encrypted) | 50 × 200 × 800B | 8,000.0 KB |
| Conversation headers | 50 × 200B | 10.0 KB |
| Talk definitions | 200 × 450B (mix of simple + route) | 90.0 KB |
| Answer records | 200 × 5 answers × 300B | 300.0 KB |
| Ledger events | (400 + 50 + 5,000) × 350B | 1,925.0 KB |
| Chatbot memory | 200 unique questions × 200B | 40.0 KB |
| Public profile index (peers seen) | 100 peers × 500B | 50.0 KB |
| Own profile + misc (fixed) | — | 10.0 KB |
| **Total** | | **≈ 10,425 KB ≈ 10.2 MB** |

**Scenario D — Degenerate case:** 1,000+ concurrent conversations

At 1,000 conversations averaging 100 messages each:

| Component | Size |
|---|---|
| Messages | 1,000 × 100 × 800B = **78.1 MB** |
| Ledger events (outbound msgs ≈ 50%) | 50,000 × 350B = **16.8 MB** |
| Talk definitions + profiles + misc | ~2 MB |
| **Total** | **≈ 97 MB** |

At 10,000 conversations (see §5), this extrapolates to ~960 MB — approaching or exceeding typical browser IndexedDB limits (50–250 MB common practice, 2 GB maximum). The dominant cost term is `S_messages = C × n_avg × 800B`, which scales O(C·n) while all other categories scale O(C) or are bounded constants. This confirms the §5 design recommendations that message TTL and on-demand pagination are required above approximately the 500-conversation threshold, and that merkle-checkpoint pruning (§9) is essential for long-lived power users.

---

## 8. Data Ownership & Retention Policy

### 8.1 The Gun.js Replication Problem

Gun.js replicates every graph node a client subscribes to — there is no built-in scope boundary. When a user joins a chatroom and views other members' profiles, those nodes are written to their local radisk. When talks arrive in the `ownerIncomingTalkIndex`, the full cluster payloads — authored by others — are stored locally. Over time, a user's Gun database accumulates significant volumes of data they did not create and may no longer need.

This section defines a **tiered retention policy** that answers: *who owns what, and how long should a local node keep it?*

### 8.2 Tiered Retention Model

#### Tier 1 — Cryptographic Root (Never delete, immutable)

These records form the foundation of identity and chain integrity. Their loss is irreversible.

| Record | Location | Why permanent |
|---|---|---|
| SEA keypair custody | localStorage `iinpublic_key_custody_v1` | Loss = permanent identity loss with no recovery path |
| Device secret | localStorage `iinpublic_key_custody_device_secret_v1` | Required to decrypt keypair custody record |
| Ledger head pointer | `ledger/<myId>/head` | Provides verification anchor for current chain tip |
| Merkle checkpoint events | `ledger/<myId>/checkpoints/<seq_N>` | These are the pruning summary records — see §9 |
| CIDv1 hashes of my authored content | Ledger index `ledger/<myId>/index/talkId/<talkId>` | Content-addressing integrity requires my CID claims to remain self-consistent |

#### Tier 2 — Mine + Pair-Confidential (Retain indefinitely unless user explicitly wipes)

Data the user authored or co-created in a bilateral private context. Loss degrades experience permanently; no re-fetch is possible.

| Record | Gun path | TTL |
|---|---|---|
| My talk definitions | `talks/<talkId>` where `authorId === myId` | Indefinite |
| Pair-scoped conversation messages | `pairConversations/<pairId>/<convId>/messages/<msgId>` | Indefinite, or merkle-checkpointed per §9 after full-detail window |
| Conversation headers and answer records | `conversations/<convId>`, `conversations/<convId>/answers/<qId>` | Indefinite |
| My ledger events (own chain) | `ledger/<myId>/events/<seq>` | Full detail for last M=500 events; older ranges: merkle-checkpointed (§9) |
| Chatbot memory (my chosen answers) | `talkAnswerTemplateByUser/<myId>/<identityKey>` | Indefinite |
| Private encrypted profile | `gun.user(<myId>).private/profile` | Indefinite |
| Per-user conversation index | `users/<myId>/conversations/<convId>` | Indefinite (small fixed-size per conversation) |

#### Tier 3 — Other Users' Public Data (Bounded TTL: 7 days after last interaction)

Data replicated from other nodes that the local client fetched. All records are authoritative on the public mesh and can be re-fetched on demand.

| Record | Gun path | TTL | Re-fetch trigger |
|---|---|---|---|
| Others' talk definitions | `talks/<talkId>` where `authorId !== myId` | 7 days since last answer/view | Loaded on-demand when incoming talk modal opens |
| Other users' public profiles | `users/<userId>`, `user-public-profile/<userId>` | 7 days since last profile view | Fetched per contacts-view render |
| Chatroom presence records | `chatrooms/<chatroomId>/users/<userId>` | 7 days since last active session | Re-populated on next chatroom join |
| Other users' tag indexes | `tag-index/<tagName>/<userId>`, `user-tags/<userId>` | 7 days since last tag search | Rebuilt per-query |
| Answered/dismissed incoming talk clusters | `ownerIncomingTalkIndex/<myId>/<identityKey>` | 7 days after answer or dismissal | Outcome is already in own ledger; cluster is redundant |
| Others' ledger inbox events | `ledger/<myId>/inbox/<eventId>` | **Immediate** after ingestion | Inbox is a delivery buffer (see §4 Phase 4); delete after `applyEvent` succeeds |
| Chatroom visit records | `chatrooms/<chatroomId>/visits/<visitEventId>` | 7 days | Audit data not needed locally |

#### Tier 4 — Session State (Ephemeral; survives restart only for UX continuity)

Transient coordination state. Safe to delete on any storage-pressure event or cache clear.

| Record | Location | Lifecycle |
|---|---|---|
| Active WebRTC session state | In-memory `P2PWebRTCSession` | Cleared on disconnect; never persisted to Gun |
| Connected neighbor cache | In-memory only | Cleared on page unload |
| Polling cursors | In-memory `P2PConversationRelayClient.lastNonce` | Reset per session |
| Temporary answer buffers | DOM state in `talk-response-dialog.ts` | Cleared on dialog close |
| Transport mode flag cache | localStorage `transport_mode` | Refreshed from `GET /api/debug/storage` at every boot |

### 8.3 Pruning Without Breaking Chain Integrity

The critical constraint on Tier 2 pruning is **ledger chain integrity**. The ledger's `prev` field creates a hash-linked sequence: event seq 201 contains the CIDv1 of event 200, which contains the CIDv1 of event 199. Deleting any individual event in the middle severs these pointers and makes the range unverifiable by any peer.

**Naive pruning (breaks integrity):** Delete events 100–200, keep 1–99 and 201+. Event 201 now points to a CID that no longer exists locally. Peer reconciliation and audit protocols fail silently.

**Correct approach: pruning-point markers.** Before deleting any event range, write a single signed merkle checkpoint that summarizes the entire pruned range (see §9 for the full protocol). The checkpoint carries a merkle root committing to all deleted events' CIDs. The chain remains verifiable: seq 201 points to seq 200 (or the checkpoint that replaced it), and any event in the pruned range can be proven to have existed via a O(log N) merkle proof path against the checkpoint's root.

---

## 9. Blockchain-Style Integrity Preservation During Trim

### 9.1 The Core Insight

Bitcoin and similar blockchains solve exactly this problem: they must prove old transactions existed and were valid without requiring every node to hold full history forever. The solution is **simplified payment verification (SPV)**: instead of storing old blocks, store a merkle root that commits to all of them. Any individual transaction can be proven in O(log N) steps against the root.

IinPublic's interaction ledger uses the same structural ingredients — an append-only chain of CIDv1-identified events with `prev` pointers — making this pattern directly applicable to both ledger pruning and conversation message pruning.

### 9.2 Merkle Checkpoint Design for Ledger Events

**Checkpoint frequency:** Every N = 100 ledger events, write one checkpoint.

**Checkpoint structure** (stored at `ledger/<userId>/checkpoints/seq_<N>`):

```json
{
  "checkpointSeq": 100,
  "rangeStart": 1,
  "rangeEnd": 100,
  "merkleRoot": "<SHA-256 hex of sorted CIDv1 array>",
  "count": 100,
  "computedAt": "ISO-8601",
  "sig": "<SEA signature over all above fields>"
}
```

**Merkle root computation:**
```
input   = [event_seq1.id, event_seq2.id, ..., event_seq100.id]   // CIDv1 strings
ordered = lexicographic_sort(input)                               // deterministic across re-computations
root    = SHA-256(JSON.stringify(ordered))
```

The checkpoint is written as a ledger event of kind `CHECKPOINT_CREATED` carrying its own `prev` pointer to event seq N. It is signed with the user's SEA signing key, making it a first-class member of the chain that any peer can verify against the user's public key.

**Pruning window:** Keep the last M = 500 events in full detail. Any event at position `(currentHead.seq − seq) > 500` may be deleted from the Gun graph after its checkpoint has been written and confirmed.

### 9.3 Event Range Verification Protocol

When a peer or auditor requests proof that event E (with CIDv1 `cid_E`) existed in Alice's ledger and Alice has pruned that range:

1. Alice locates the checkpoint for the 100-event window containing E's seq.
2. Alice provides:
   - The checkpoint node (merkle root + SEA sig + range metadata).
   - A merkle proof path for `cid_E` within that 100-event sorted array (7 hash values, O(log₂ 100) ≈ 7 steps).
3. The verifier:
   - Checks the checkpoint SEA signature against Alice's known `pub` key.
   - Verifies that `cid_E` hashes to a leaf consistent with the provided proof path and the root.
4. Both pass → the event is cryptographically proven to have existed, without Alice storing it.

Proof path length: 7 hashes for N=100. Even at N=1,000, proof length is only 10 hashes. Verification cost is O(log N) regardless of how many events were pruned.

### 9.4 Applying the Pattern to Conversation Messages

Messages are the dominant storage category (§7.4). The same checkpoint approach applies: every K = 50 messages in a conversation, compute a message checkpoint:

```
pairConversations/<pairId>/<convId>/checkpoints/<checkpoint_seq>:
{
  "checkpointSeq": 50,
  "rangeStart": 1,
  "rangeEnd": 50,
  "merkleRoot": "<SHA-256 of sorted array of [msgId + SHA-256(ciphertext)] pairs>",
  "count": 50,
  "computedAt": "ISO-8601",
  "sig": "<SEA signature>"
}
```

The message merkle root commits to both **message IDs** (conversation ordering) and **ciphertext hashes** (content integrity). After pruning, any party with the checkpoint can prove:

- That message `msgK` existed in this conversation (ID in the merkle tree).
- That its ciphertext had a specific SHA-256 hash at commit time (content integrity, not content disclosure).
- When it was committed (checkpoint timestamp + SEA sig).

What cannot be proven retroactively: the plaintext. Only the encrypted form's hash is stored in the checkpoint. This is a deliberate privacy property — pruned messages are provably committed but not reconstructible.

**Retention window for messages:** Keep the last K_retain = 200 messages per conversation in full detail. Messages older than position 200 from the current head are pruned after their checkpoints are written.

### 9.5 Storage Savings Analysis

| Pruned unit | Before pruning | After (checkpoints only) | Reduction |
|---|---|---|---|
| 100 ledger events | 100 × 350B = 35.0 KB | 1 checkpoint × 256B = 0.25 KB | **99.3%** |
| 500 ledger events (5 checkpoints) | 500 × 350B = 175.0 KB | 5 × 256B = 1.3 KB | **99.3%** |
| 50 conversation messages | 50 × 800B = 40.0 KB | 1 checkpoint × 512B = 0.5 KB | **98.8%** |
| 200 messages (4 checkpoints) | 200 × 800B = 160.0 KB | 4 × 512B = 2.0 KB | **98.8%** |

Checkpoint size breakdown:
- Merkle root (SHA-256 as hex string): 64 bytes
- SEA signature (NaCl detached sig → base64): ~128 bytes
- Metadata fields (range seqs, count, timestamp): ~64 bytes
- **Total per ledger checkpoint: ~256 bytes**
- **Total per message checkpoint (adds ciphertext hash pairs): ~512 bytes**

**Net storage for Scenario C (power user, §7.4) with pruning applied:**

| Component | Without pruning | With pruning | Saving |
|---|---|---|---|
| Ledger events (5,450 total → keep 500 full, 4,950 → 49 checkpoints) | 1,925 KB | 175 KB + 12.5 KB = 188 KB | −1,737 KB |
| Messages (50 convs × 200 msgs → keep 200 full per conv, prune none at this scale) | 8,000 KB | 8,000 KB | 0 (within window) |
| **Total** | **10,425 KB** | **~8,688 KB** | **−17%** |

For a longer-lived power user with 50 conversations × 2,000 messages each:

| Component | Without pruning | With pruning (keep 200 full) | Saving |
|---|---|---|---|
| Messages | 50 × 2,000 × 800B = 78.1 MB | 50 × 200 × 800B + 50 × 36 × 512B = 7.7 MB | **−90%** |
| Ledger | 18.9 MB | 0.19 MB (500 full + checkpoints) | **−99%** |
| **Total** | **~97 MB** | **~9.9 MB** | **−90%** |

### 9.6 Integration with Existing Architecture

These sections cross-reference the rest of this document:

- The ledger `prev`-chain structure is defined in **§3.9 Interaction Ledger**. Checkpoints are written as a new event kind (`CHECKPOINT_CREATED`) that participates in the same chain.
- CIDv1 content addressing (used for event IDs and as the leaf values in the merkle tree) is the same scheme already documented in **§3.9**.
- The delta-sync protocol (**§4 Phase 4**) must recognize pruned ranges: when peer B requests event E and A has pruned it, A returns a merkle proof rather than the raw event node.
- The `ledger/<userId>/state` broadcast (**§3.9**) is unchanged — it carries only `{seq, prevCid}` for the current chain head.
- Per the **§8.3** constraint, a Tier 2 pruning operation MUST write and confirm the merkle checkpoint before deleting any event range. This ordering prevents a crash-between-checkpoint-and-delete from producing an unverifiable gap in the chain.
