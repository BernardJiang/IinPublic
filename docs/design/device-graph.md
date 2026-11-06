# The device graph: one database behind all four tabs

Status: **draft for owner review, 2026-11-01.** TODO: OPEN-106. The data structures are specified in
`docs/specs/iinpublic-technical-specifications.md` §31 (2026-11-02), which wins where this draft differs. Builds on
`docs/design/data-sharing-privacy-rules.md` and `docs/design/device-core-architecture.md`.

## Goal

The Chatrooms, Contacts, Talks and Me tabs are four views of one graph. Moving between tabs follows
a stored edge. Nothing is copied between tabs, and each piece of text exists once on a device.

Today the four-tab navigation (`src/web/ui/graph-focus.ts`, `src/core/tag-graph.ts`) rebuilds its
edges in memory from separate logs: exchanges, answer history, My Talks and conversations. Each log
holds its own copy of names, titles and question text. It looks like a graph on screen, but the
database holds lists.

## Three kinds of data

Communication and storage are separate problems, so the design separates them.

| Layer | Holds | Who can read it | How it is protected |
|---|---|---|---|
| **Private graph** (`local/`) | Everything in this document | Me | Never leaves the device, encrypted at rest (below) |
| **Pair** (`pair/`, mailbox, mesh) | Copies sent to one person | That person and me | Signed by the sender, encrypted with our shared secret |
| **Public** (`public/`, cards) | What I choose to publish | Anyone | Signed by me, not encrypted |

**Nobody ever reads another person's graph.** Two users never share a graph. Each has their own, and
they exchange signed, encrypted messages. The receiver verifies a message, decrypts it, and writes
the result into their own graph as nodes. "Each question exists once" therefore means once per
device. Two devices arrive at the same key for the same question, because the key is a hash of the
text.

## How encryption and the graph work together

### Keys

`SEA.pair()` creates two key pairs (P-256):

- `pub` / `priv`: ECDSA, for signing. Proves who wrote something.
- `epub` / `epriv`: ECDH, for encrypting between two people.

`pub` and `epub` are public. `priv` and `epriv` never leave the device.

### Talking to another person

ECDH gives two people the same secret without sending it. My `epriv` with your `epub` produces the
same value as your `epriv` with my `epub`, and nobody watching can compute it from the public keys.

```
Me:  secret = SEA.secret(your epub, my pair)
     box    = SEA.encrypt(content, secret)     AES-GCM
     signed = SEA.sign(box, my pair)           where a message needs proof of sender
     send it over the mesh, the direct link or the mailbox

You: secret = SEA.secret(my epub, your pair)   the same secret
     check my signature, decrypt, write nodes into your own graph
```

This already works: direct messages (`gun-message-store.ts`), Talk responses
(`pair-response-crypto.ts`) and the mailbox (`mailbox-envelope.ts`). The design does not change it.
The only thing needed is the other person's `epub`, which arrives with their Talk (`authorEpub`) or
their directory record, and is pinned on the Person node in this design.

### Why nothing needs my private key to be shared

My graph is not what travels. When I answer your Talk, I do not grant access to my `me` node. I
build a response, encrypt it for you, and send it. You store what you received as your own edge
("this person answered this question this way"). If I lose interest or block you, your copy stays
with you, as it would with any message. Retraction is a signed request that peers honour.

### Encrypting the private graph

Encrypting each value with my own key breaks the graph:

- Links would have to stay readable for traversal, which exposes the whole shape: who, which Talk,
  which place.
- Hash keys are not secret. Anyone can hash "Do you play tennis?" and test for that key.
- An identical question must encrypt the same way to deduplicate, which removes much of the point.

**Proposed: encrypt the storage underneath Gun, not the values inside it.** Gun passes whole chunks
to a pluggable store (`opt.store`, used by the worker's `idbAdapter`; `rfs.js` on Node). A store
adapter encrypts each chunk with AES-GCM before it reaches disk and decrypts it on read. Inside Gun
everything stays plain, so links and traversal work normally, and on disk nothing is readable:
values, keys or shape.

The chunk key is random, per device, and held by the Android Keystore, which the app already uses
(`BackgroundAgentStore.kt`, `NativeCustodyBridge.kt`). The website needs its own decision, because a
browser has no equivalent (see Decisions).

This is simpler and stronger than today, where `local/private/` holds ciphertext beside plain-text
copies of the same Talks (`myTalks`, `appData`). The encrypted Talk copy can then go.

Limits to state plainly:

- It protects data at rest: a stolen disk image or an app-data copy without the Keystore key. It does
  not protect against code running inside the unlocked app.
- Each flush encrypts up to a whole chunk (1 MB). Measure on the FRD.
- The embedded node must have the chunk key to run in the background, so it is not behind a
  passphrase.

### Rule for anything crossing the boundary

No hash of question, answer or place text may reach the hub in the clear. A hash of guessable text
reveals the text. Hashes of private nodes appear only inside encrypted payloads.

## Talk exchange by Gun sync

Owner direction, 2026-11-01: a Talk reaches the receiver as nodes through Gun's sync, not as one JSON
string. The receiver's chatbot compares keys and reads its saved answers directly.

**Today** a Talk travels as JSON (`talkData`, `questionsJson`) in a mesh frame or an encrypted mailbox
envelope. The receiver parses it, hashes each question, and looks in its answer maps. Gun does not
carry it.

**Gun's chat example** (`node_modules/gun/examples/basic/chat.html`) is one shared node:

```js
chat = gun.get('note');
chat.set(text);                    // writer adds a node
chat.map().on(function show(data, id) { … });   // every subscriber receives it, in real time
```

Nothing is pushed to a named person, and no message format is needed. It has no encryption or
identity either: anyone connected reads and writes everything.

### What encryption changes

| Gun part | Effect of encryption |
|---|---|
| Sync, per-field merge, conflict resolution | None. They use soul, key and timestamp, which stay readable |
| Keys and souls | Readable by every relay, so they must reveal nothing |
| Values | Opaque. A random IV makes the same text encrypt differently every time |
| Comparing values | Impossible without decrypting |
| Signing (`~pub` space) | Only the owner can write; anyone can read and verify |

So sync survives encryption, but direct comparison does not survive on the wire. A plain question
hash in a key would let any relay test guesses, and a pair-keyed hash could not be compared with my
stored keys without rehashing them all. The comparison happens on the device, one small decrypt per
step, then a direct key read.

### Proposed flow

A Talk is written **once**, in Adam's signed space, encrypted with a random key `K` for that Talk.
Each receiver gets `K` through a grant encrypted with the pair secret. The Gun wiki's 1-to-1 pattern
and `examples/basic/private.html` describe this same grant idea.

```
~adam/talks/<tag>            { head: SEA[K]{type, title, steps} }
~adam/talks/<tag>/<n>        { ref:  SEA[K]{question hash, answer hashes, next, match},
                               text: SEA[K]{question and answer text} }
pair/<pairId>/grants/<tag>   { key:  SEA[pair secret]{K, Talk id} }
~eve/answers/<tag>           { body: SEA[pair secret]{answers} }
```

`<tag>` is a random id, so a relay cannot recognise a shared Talk from its content hash.

1. Eve holds a live subscription to her pairs' `grants`, as in the chat example. A first contact uses
   the existing knock channel (`p2p-signal/<nearbyKnockChannel>`) to open the pair.
2. A grant arrives. Eve decrypts `K` and subscribes to `~adam/talks/<tag>`.
3. For each step Eve decrypts `ref` only, then reads `q/<hash>` and `me/<context>` directly. Her graph
   already has the node, so `text` is decrypted only for a question she has not seen.
4. Once every step has arrived, she writes the Talk into her graph as links and checks its id.
5. Her chatbot writes `~eve/answers/<tag>`. Adam's subscription receives it.

Withdrawing a Talk from one person means a new `K` for the rest.

The cost per Talk: one set of nodes plus one grant per receiver. Encrypting a full copy per receiver
would mean about 4,000 writes for one Talk to 498 people.

### Owner decisions, 2026-11-01

- **The hub is a seed only.** It introduces two users so they can connect. It never carries or
  stores Talk content. TechSupport is the one exception and may keep TechSupport data.
- **No offline delivery.** Two users exchange data only while connected, over the internet, Wi-Fi,
  Wi-Fi Direct or Bluetooth. If they cannot connect, nothing is exchanged.
- **The mesh is Gun's transport.** WebRTC and the other links carry Gun messages between peers. They
  are not a second network beside Gun.
- **Screen off is not a limit.** Node keeps running, and the background agent already holds the key
  pair and runs SEA with the screen off (`background-talk-agent.ts`, native-app spec 40).
- **Public versus private is open.** Either everything is encrypted, or everything is public except
  questions and answers the user marks manual.

### Experiments, 2026-11-01

Scripts lived in the session scratchpad. No app code changed.

| Test | Setup | Result |
|---|---|---|
| Live sync | Two Gun peers over an in-memory link, no hub | Arrived in 52 ms |
| Connect with no subscription | Peer A holds 5 nodes, B connects and asks nothing | **B received 0 nodes**. An exact-key read then fetched one |
| Subscription made before connecting | B subscribes, A writes while apart, then they connect | B caught up on all writes |
| Flooding | A–B, A–C, B–D. Only D subscribes | **B, C and D all stored the write**, and D got it two hops away |
| Conflict | Both write one node while apart | Merged field by field, both sides equal |
| Forgery | Writing into another user's `~pub` space, with no key or with my key | Rejected: `Unverified data`, never stored |
| Chained write | `get(a).get(b).put()` with no stored parent | **Stalled**, with `root.stun` left set. Exact souls wrote at once |
| SEA, Mac Node | Median of 7 | Sign 0.17 ms, verify 0.1 ms, encrypt 200 B 0.07 ms, secret 0.31 ms |
| SEA, PH-1 WebView (Chrome 156) | App's own `window.SEA`, throwaway keys | Sign 0.7 ms, encrypt 0.5 ms, secret 1.1 ms. A 3,000-message conversation (247 KB) 126 ms |
| SEA, FRD WebView (Chrome 101) | Same | Sign 2.4 ms, encrypt 2.3 ms, secret 1.9 ms. The same conversation 150 ms |
| Talk over real WebRTC | Two Chromium pages, data channel as Gun's only link | 3-question Talk as signed, encrypted nodes, then grant, Eve's lookup (3 of 3 hits, 1–2 ms) and answer back: **6 ms round trip** |
| Reconnect | Adam writes while the channel is closed, then a new channel | Eve answered after relinking |
| Third peer | Carol linked to Adam only | **Carol stored the Adam–Eve Talk nodes and grant** (12.6 KB of ciphertext) |
| Wire size, in Node | Plain nodes against signed, encrypted nodes | 0.8 KB against 6.4 KB per Talk |

### What the experiments mean

1. **The design works mechanically.** Gun sync carries a Talk as nodes over a direct link, and the
   receiver answers by key lookup without parsing a Talk body.
2. **Gun does not sync whole databases.** It sends live writes to connected peers and answers what a
   peer asks for. Each side must subscribe, on connect, to the souls it cares about: its pairs'
   grants, and the Talk and answer nodes they point to. Writes made while apart then catch up.
3. **Gun floods every connected peer**, so a direct mesh repeats the hub problem at a smaller scale.
   An outgoing filter must send a pair's souls only to that pair's link, and must not relay other
   people's souls onward. The sharing policy has the right hook (`mesh.say`), but audience
   enforcement is not built (rule 3 of `data-sharing-privacy-rules.md`).
4. **Encryption is not the bottleneck.** The slowest phone signs or encrypts in about 2 ms. The
   7.9 s private write in OPEN-101(a) is not crypto, so its cause is elsewhere, most likely the
   shared write queue and storage waits. Still to find.
5. **Exact souls only.** Chained writes stall, as `data-layer-alternatives-to-gun.md` already found.
6. **Public or private is a privacy choice, not a speed choice.** Encrypted nodes cost about 8 times
   the bytes and a few milliseconds per Talk. On the FRD, granting one Talk to 498 people would cost
   about 2 s of key work, or about 1 s with pair secrets cached.

### Not yet tested

- Gun inside the phone's embedded Node. One attempt was declined because it restarted the app.
- WebRTC between real phones, and Wi-Fi Direct and Bluetooth as Gun links. Bluetooth carries no data
  today (`bleDataTransport: false`).
- Many peers at once, up to 498 in Nearby.
- Radisk persistence and the reverse-edge write volume.
- The outgoing audience filter.

## Node types

All souls sit under `local/`. Short names are used here. An arrow means a Gun link. Each node has a
stable key, so writing twice changes nothing.

### Content

```
q/<hash>      { text, language }             question or tag word, once
a/<hash>      { text }                       answer text, once
```

### Talks

```
talk/<cid>            { type, title, start or 0..n: →step, tag: →q, accepts: →q, author: →person,
                        createdAt, madeAt: →where }
talk/<cid>/<n>        { q: →q/<hash>, 0..n: →choice, rules for this step }
talk/<cid>/<n>/<m>    { a: →a/<hash>, next: →step, match, ignore }
```

### People

```
person/<pub>     { pub, epub, name, firstSeen }                anyone I have met or exchanged with
contact/<pub>    { person: →person/<pub>, labels, nickname, notes, rating, addedAt, blocked }
```

A person exists once they appear. A contact is the private relationship I add to a person, so being
a contact is an edge, not a second record. Names are stored here only, so a rename touches one node.

### Places

```
cell/<id>        { latitude, longitude, precisionMeters, parent: →cell/<wider id> }
room/<id>        { name, kind, anchor: →cell/<id> }
where/<id>       { cell: →cell/<id>, room: →room/<id>, at, exact: { latitude, longitude } }
```

A cell is one square of the existing public grid (`public-location.ts`, `room-tiles.ts`), so GPS
joins the graph as a shared node: everything that happened in the same square links to the same
cell. Going up `parent` gives tile and city, which is what the map needs.

GPS is recorded when something happens: creating a Talk, an answer, an exchange, or an outing sample.
It is not a continuous track, which keeps the battery and privacy cost down. `exact` stays on the
device. Only the blurred point on a signed Nearby card ever leaves. A Traveler ✈ point is stored as
a chosen location and marked so it is never mistaken for real GPS.

### Answers and exchanges

```
me/<context>   { q: →q/<hash>, a: →a/<hash>, talk: →talk/<cid>, after: →me/<previous>,
                 at: →where, mode }                            my answer
ex/<id>        { with: →person/<pub>, talk: →talk/<cid>, dir, outcome, on, at: →where,
                 outing: →outing/<id> }                        one exchange with one person
ex/<id>/<n>    { q: →q/<hash>, a: →a/<hash> }                  what they answered, step by step
conv/<id>      { with: →person/<pub>, talk: →talk/<cid> }      a conversation
outing/<id>    { label, startedAt, endedAt, 0..n: →where }
```

**The exchange is the centre of the graph.** It joins a person, a Talk, a place and a time, which is
the fact all four tabs care about.

### Reverse edges

Gun links run one way, and the tabs need both directions. Each write also adds the reverse entry:

```
q/<hash>/me        { <context>: →me/<context> }     my answers to this question, by context
q/<hash>/talks     { <cid>: →talk/<cid> }           Talks that ask it
q/<hash>/ex        { <id>: →ex/<id>/<n> }           people's answers to it
person/<pub>/ex    { <id>: →ex/<id> }               my exchanges with them
talk/<cid>/ex      { <id>: →ex/<id> }               who exchanged this Talk
cell/<id>/ex       { <id>: →ex/<id> }               what happened here
room/<id>/ex       { <id>: →ex/<id> }
```

These are what make traversal a database read: each is one key lookup, however large the graph is.

## The four tabs as reads

| Tab | Read |
|---|---|
| Chatrooms | `cell` and `room` around me, with `cell/<id>/ex` for who I met here |
| Contacts | `contact` nodes, with `person/<pub>/ex` for history |
| Talks | `talk` nodes |
| Me | `me` nodes, grouped by the `q` link |

| From → to | Path |
|---|---|
| Me → Contacts (who answered this?) | `q/<hash>/ex` → `ex` → `with` |
| Me → Talks (who asked it?) | `q/<hash>/talks` |
| Me → Chatrooms (where did I answer?) | `me/<context>.at` → `where.room` or `cell` |
| Talks → Contacts | `talk/<cid>/ex` → `with` |
| Talks → Me | Step's `q` → `q/<hash>/me` |
| Talks → Chatrooms | `talk/<cid>/ex` → `at`, or `talk.madeAt` |
| Contacts → Talks | `person/<pub>/ex` → `talk` |
| Contacts → Me (what do we share?) | `person/<pub>/ex` → `ex/<id>/<n>.q` → `q/<hash>/me` |
| Contacts → Chatrooms (where did we meet?) | `person/<pub>/ex` → `at` |
| Chatrooms → Contacts | `cell/<id>/ex` or `room/<id>/ex` → `with` |
| Chatrooms → Talks | Same, → `talk` |
| Chatrooms → Me | Same, → `talk`, then that Talk's steps → `q/<hash>/me` |

Tag likes are not a separate graph. "Who likes tennis" is `q/<tennis>/ex` with a positive outcome.

## Event log model (owner direction, 2026-11-02)

**Every record is an event.** There are no event types. A question, an answer, a tag, a chat message
and a Talk are all events or content that events point to. A Talk is a series of questions.

**Nothing is stored twice (owner, 2026-11-02, "almost like a git repo").** When the same Talk
arrives a second time, or the chatbot gives the same answers a thousand times, the device stores only
what is new: who, when, where and how. The content itself is stored once.

The goal is a foundation, not a new feature set: anything built later adds fields and links without
changing what is stored. A Talk stored as one JSON string cannot grow links to people, places or
other Talks; a node can.

### Two kinds of record, as in git

Git stores each file once under the hash of its content (a *blob*), each folder once as a list of
blob hashes (a *tree*), and each change as a small *commit* that points to a tree and says who and
when. Committing the same files again adds only a commit.

| Git | Here | Key | Holds | Written |
|---|---|---|---|---|
| blob | content | `c/<hash>` | one text: a question, a choice, a tag word | once per device |
| tree | Talk | `t/<hash>` | the Talk's question keys and choices (its `computeTalkCIDv1` content); title, routing and match rules sit in a small revision record | once per device |
| tree | answer set | `s/<hash>` | question hash → chosen choice hash, for one Talk | once per distinct set |
| commit | event | `ev/<id>` | who, when, where, how, and links to the above | once per happening |

Content records are named by their hash, so writing the same content twice writes the same key with
the same value: nothing grows. They never change. Only events grow, and an event is a few short
fields.

```
ev/<id> {
  when:  1793600409000           time from the author's device
  who:   →person/<pub>           optional
  where: →cell/<id>              optional
  how:   { mode, link }          optional: chatbot or manual; mesh, Wi-Fi Direct, Bluetooth
  talk:  →t/<hash>               the Talk this event is about
  gave:  →s/<hash>               the answers given
  re:    →ev/<id>                the event it answers or replies to
  text:  "…"                     private text kept in the event, e.g. a chat message
  …any other named link added later
}
```

### Example: Bob's chatbot and Adam's Talk

Adam's Talk has 3 questions. Bob's chatbot answers it automatically.

```
Adam writes once     c/q1 "Do you play tennis?"   c/yes "Yes"   c/no "No"   … (5 texts)
                     t/T  { q1: [yes, no], q2: [weekly, daily], q3: [yes, no] }   + revision { title, routing, rules }
                     ev/A1 { when, where: café, talk: T }                       "I sent T"

Bob receives T       stores c/… and t/T (once, the first time)
                     ev/B1 { who: adam, when, where, how: mesh, talk: T }       "T arrived from Adam"
Bob's chatbot        s/S  { q1: yes, q2: weekly, q3: yes }                       (once)
                     ev/B2 { re: B1, gave: S, how: chatbot, when }              "I answered"
```

The same Talk later arrives from Eve, then from 998 more people, and the chatbot answers the same:

```
                     ev/B3 { who: eve, when, where, talk: T }
                     ev/B4 { re: B3, gave: S, how: chatbot, when }
                     …
```

Each arrival adds two small events. The question text, the Talk and the answer set are not written
again. A different Talk that also asks "Do you play tennis?" points to the same `c/q1`.

The two events of one arrival can be one event (`{ who, when, where, talk: T, gave: S }`) when the
chatbot answers at once. Whether to keep them separate (arrival and answer at different times) is to
be decided.

### What today's code already does

The incoming Talk cluster (`ownerIncomingTalkIndex`, `IncomingTalkClusterWire`) already keeps one Talk
body with a `senders` map. But each sender keeps only the latest arrival (overwritten, no place), the
body is a JSON string, and the answers, the Me tab, the chatbot memory and about 18 other collections
copy the text again: on C10 one question's text was stored 10 times in 7 collections.

### Rules

1. **Content is named by its hash** and never changes; the same content always lands on the same key.
2. **Events never change.** A changed answer is a new event with `re` pointing to the old one. Two
   devices never write the same key, so sync merges without conflicts.
3. **Readers ignore fields they do not know**, so an old app version can read a newer event.
4. **Ids sort by time:** `<ms>-<device>-<counter>`. A day index (`log/<day>`) allows time-range reads.
5. **`when` is stored in the record.** Gun keeps its own timestamp for every field (`_['>']`), but
   that is Gun's merge clock: it can be re-stamped, and Gun reserves `_`.
6. **Derived facts are not stored as truth.** "Bob matched" follows from `t/T`'s rules and `s/S`. It
   may be cached, but the records decide.
7. **Private text is not hashed into shared content.** Chat messages and manual answers stay in the
   event's `text`. A short text's hash can be guessed by hashing candidates ("yes", a phone number).

### Mapped onto the earlier node types

| Earlier draft | Here |
|---|---|
| `q/<hash>`, `a/<hash>` | `c/<hash>` |
| `talk/<cid>` and its steps | `t/<hash>` |
| `me/<context>` | My answer events and their `s/<hash>` |
| `ex/<id>` | An arrival event and its answer event |
| `conv/<id>` and messages | Message events with `text`, linked by `re` or a conversation id |
| `frame/<id>` | Dropped: one event per arrival already carries who, where and how once |
| Reverse edges and `log/<day>` | Unchanged: rebuildable indexes over events |

## Current design against the event log

| | Current design | Proposed event log |
|---|---|---|
| Unit of storage | Snapshots in about 18 collections, mostly one JSON string per record | One small event per record, one shape for all |
| History | Partial and overwritten. One exchange record per person, Talk and direction; one answer-history record per Talk; chatbot memory keeps answer events with use counts; outings keep location samples | Complete and append-only |
| When | Some timestamps per record | Every event |
| Where | Room id and name on exchanges, location samples on outings, nothing per answer | Every event, from a grid cell, exact optional |
| Who | Copied names and ids in each record | Link to one person node |
| How | Partial: answer mode, chatbot flag | Every event: link, answer mode |
| Text | Repeated in many collections | Once per device |
| Adding a new kind of link later | A new collection or a JSON format change | A new field on new events |
| Reads | In-memory maps, fast after loading everything at start-up | Projections, one read each; a full rebuild walks the log |
| Writes | Whole records, some whole maps | One event plus a few projection entries |
| Sync between people | JSON bodies over mesh frames and mailbox | Events and content through Gun, per pair |
| Conflicts | Overwrites, last writer wins | None: unique event keys |
| Storage growth | Bounded by pruning and caps | Grows with every event: needs a retention rule |
| Deleting | Remove the record | Hard: append-only, Gun tombstones, copies on peers |

### Pros of the event log

- One complete, honest history of who, what, when, where and how, which the owner asked for, and
  which statistics, outings and the map can all read.
- Fits Gun well: append-only events with unique keys never conflict, and syncing is a union.
- Content is stored once by hash; a repeat arrival or chatbot answer adds only a small event.
- New features add fields and links without migrating what exists.
- One source of truth. Every tab and the chatbot are rebuildable views, which removes the copied logs
  and the bugs between them.
- Device sync and backup become "send the events I have not sent".
- Privacy can be decided per event.

### Cons and risks

- **Unbounded growth.** A busy user could write thousands of events a day, and Radisk rewrites a
  chunk of up to 1 MB on each flush. Needs retention, compaction into summaries, and measurement.
- **Two writes per event** (event and projections) with no transaction. Needs a repair on start-up.
- **Location in every event** is the most sensitive data the app would hold. Precision and retention
  must be decided, and exact points must never leave the device.
- **Deletion conflicts with append-only.** "Delete my answer" becomes a superseding event, and copies
  already synced to the other person stay with them.
- **Clocks differ between phones.** `when` is the device clock, so cross-device order is approximate.
- **Shared events cost crypto and bytes.** Signed, encrypted nodes were about 8 times larger in the
  2026-11-01 test.
- **Migration** from today's records can only create approximate events: the old data has no
  per-question time or place.

## To specify before coding

1. **Field names** every app version agrees on (`when`, `who`, `where`, `how`, `talk`, `gave`, `re`,
   `text`), and the exact layout of `t/<hash>` (order, choices, `next`, match, ignore) and `s/<hash>`.
2. **Arrival and answer:** two events (spec REQ-GRAPH-21): the arrival is private, the answer goes to
   the author.
3. **Ids and time:** id format, per-device counter, and ordering across phones whose clocks differ.
4. **What each hash covers:** settled 2026-11-02, see spec §31.3 (the question is the key, a Talk is
   an event, every edit is a new event, exact text with a grammar filter, full-length hashes).
5. **Shared and private:** which events leave the device, to whom, signed or encrypted. The decision
   between all encrypted and public except manual answers is still open.
6. **Indexes:** the exact list (Me, Contacts, Talks, Chatrooms, chatbot memory, statistics), what each
   holds, and how it is rebuilt from events.
7. **Retention and deletion:** how long events stay, the storage budget per phone, and what "delete"
   promises when copies already synced.
8. **Location:** precision of `where`, how long exact points stay, and the Traveler ✈ case.
9. **Sync:** what each side subscribes to on connect, how it catches up, and the outgoing audience
   filter that keeps a pair's events on that pair's link.
10. **Talk ids:** how a Talk's content hash is checked when it arrives as events.
11. **Migration** of existing data, and what is lost: today's records have no per-question time or
    place.
12. **Targets to measure on the FRD:** events per day, write and read times at 10,000 and 100,000
    events, and start-up time.
13. **Tests:** two-user journeys asserting on the other user's side, an index rebuild, sync catch-up,
    and an old reader ignoring a new field.

## Costs and risks

- **Write volume.** One exchange writes a node plus several reverse entries, and each field is a
  Radisk row. Radisk rewrites its chunk on each flush, so batch these in one write. Measure at
  10,000 Talks on the FRD before building past the first phase.
- **Reads.** A screen makes one read per link, and `gunGraphStore` reads wait at least 30 ms. GUI
  views stay synchronous through an in-memory cache filled on demand.
- **Hard to change later.** Soul names and reverse edges become a stored format. Version them.
- **Consistency.** A node and its reverse edges are not one transaction, and the app can die between
  them. Traversal must tolerate a missing target, and a start-up repair rebuilds reverse edges.
- **Deleting.** Removing a Talk or a person means removing edges, then sweeping unlinked content.
  Gun keeps a tombstone row in the chunk, so a delete needs a defined promise.
- **Device sync** (`docs/design/device-sync-data-inventory.md`) must export these nodes, including
  edges and tombstones, and needs a matching update.

## Decisions for the owner

**Answered 2026-11-03** (see spec §31.12): shared data encrypted, readable by the receivers'
public keys; no encryption on the website; exact GPS 30 days; keep the signed `prev` timeline;
people keep the user ID design (several IDs per person, each with its public key); 1 GB database limit with trimming developed later; deletes of
answers and Talks propagate to contacts; no backward compatibility. Items 1–4, 6 and 7 below are
settled by this (4 as user ID, not `pub`); 5 stands as proposed.


1. **Encryption at rest.** Chunk encryption with a Keystore key, replacing the encrypted Talk copy.
2. **Website.** A browser has no Keystore. Options: leave the graph unencrypted as today's `local/`
   collections are, keep a key in the browser (weak), or ask for a passphrase at start.
3. **Exact GPS.** Keep `exact` for how long? Proposed: exact for 30 days for the map, then only the
   cell remains.
4. **Person key.** `pub` is cryptographic, but the app identifies people by user id, and linked
   devices share a person. Proposed: key by `pub`, keep `userId` as a field, and link identities.
5. **People's answers.** Keep what others answered as `ex/<id>/<n>` so Contacts can show it. This is
   their data on my device, which the author already receives. Proposed: keep, with a retraction
   removing it.
6. **Talk delivery.** Gun sync over direct links, decided above. Open: everything encrypted, or
   everything public except manual questions and answers.
7. **Spelling, language, first-question labels and shared contexts:** as listed in OPEN-106.
