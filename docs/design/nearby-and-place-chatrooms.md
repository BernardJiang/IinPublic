# Nearby and place chatrooms

Status: **accepted product design, 2026-10-08**  
Tracking: `OPEN-40`  
Supersedes: `room-tree-routing.md`, the Global-first cascade, visible L1-L4 rooms, and numbered
`_part_N` rooms  
Related: Technical Specification §3.3, §6.1, §19.7, §19.14, and §29

## 1. Product model

IinPublic has three independent ways to reach people:

1. **Nearby** is the one automatic active room. A location-enabled phone enters a small spatial
   cell derived locally from its current GPS and selected privacy precision.
2. **Places** are user-created map destinations such as a restaurant, event, club, or community.
   A user taps a pin to enter one deliberately.
3. **Contacts** are direct relationships independent of room membership. TechSupport exists only
   here; it has no room presence, map pin, headcount, or capacity exemption.

There is no user-facing Global room, geographic tree, country/state hierarchy, L1-L4 navigation,
or numbered overflow room. Internal capacity shards are implementation details and must not appear
as separate rooms or pins.

Exactly one room drives stranger discovery and Talk exchange at a time. Contacts may reconnect on
demand without becoming members of that room.

## 2. Nearby placement and privacy

Exact GPS stays in local process/device storage. The phone derives a spatial cell at the precision
the user has chosen and publishes only that cell/scope in presence and discovery.

Initial experimental scales are approximately 200-500 metres for **Close nearby** and about 1 km
for **Neighborhood**. These are release-wide protocol parameters, not promises about physical
radio range and not per-room settings. Real-device experiments must choose the production values.

Settings expose the actual trade-off:

- **Contacts only:** no stranger room or stranger discovery.
- **Radio nearby:** BLE discovery without publishing a map cell; no remote/map-based nearby reach.
- **Neighborhood:** an approximately 1 km public cell.
- **Close nearby:** an approximately 200-500 m public cell, with an explicit home/work warning.
- **Location off:** saved Contacts and manually selected Places only.

Hashing a predictable cell is obfuscation, not location secrecy. The UI must state the approximate
area revealed by each mode. Exact coordinates, accuracy, and GPS timestamps are never public.

Wi-Fi Direct range cannot define a stable room: radio reach changes with walls and hardware, and
physical nearness is not transitive. Location defines the eligible audience; BLE confirms and
prioritizes physically present peers; LAN, Wi-Fi Direct, direct Internet, and TURN are replaceable
routes between the same endpoints.

## 3. Capacity and spatial subdivision

One signed, versioned global capacity `C` applies to every Nearby and Place room. The current value
`498` is an experimental default, not a proven optimum and not a room attribute.

When a Nearby cell exceeds `C`:

1. A client verifies an ownerless overflow certificate from `C+1` distinct live signed presences.
2. The cell activates a finer spatial resolution.
3. Every participant derives the correct child from locally held GPS.
4. New arrivals select the child before publishing active presence, radio advertisements, or Talk
   availability.
5. Subdivision repeats until each client sees at most `C` eligible candidates.
6. Only when available location accuracy cannot separate a dense crowd may deterministic identity
   lanes provide final load shedding.

Subdivision is geographic, never FIFO-by-age: closer people remain together. Sparse cells may widen
their search scale under a hysteresis rule, while the UI reports the current approximate distance.
No hidden split is presented as a second chatroom.

`C` bounds the candidate population but does not by itself prevent a full mesh. A separate global
neighbor/concurrency limit `K` bounds simultaneous direct peer connections. Both `C` and `K` are
protocol-manifest parameters and may change between releases after simulation and hardware tests.

Without consensus, `C` is a hard per-client candidate bound and an eventual convergence rule, not
a promise of one instantaneous worldwide roster during a partition.

## 4. Place rooms and map travel

Any user may publish an immutable, signed, content-addressed Place descriptor containing a display
name, type, description, public map point, creator public key, and creation time. The signature
proves provenance only. It does not prove a trademark or business claim and grants no ownership,
moderation, reserved seat, rename, deletion, or admission power. Duplicate display names are
allowed and the UI labels these rooms **Community-created**.

A community pin is snapped to the selected public cell unless the creator deliberately confirms a
precise public business address. The application must never silently copy exact GPS into a Place.

The device keeps these values separate:

```text
home zone   = automatic Nearby cell derived from current GPS
active room = home Nearby room or one manually selected Place
traveler    = active Place lies outside the current home zone
```

Joining a pin stops the old room before joining the Place. **Return to Nearby** recomputes the home
cell from current GPS and clears the traveler state. A selected Place may persist across restart,
but the UI must keep the visit visible.

Place rooms also use `C`. They do not subdivide by the visitors' physical locations because remote
visitors deliberately chose the same destination. The initial simple rule is: when a Place is full,
do not create visible `_part_N` rooms; keep the entrant in their current room and offer the Nearby
room around that point.

The implemented single-index admission rule is deliberately ownerless and easy to explain:

1. The first `C` live admissions observed by the room index hold active seats.
2. The creator is an ordinary participant and receives no priority or reserved seat.
3. A current member may refresh the same seat; leaving or expiry releases it.
4. Requests for one Place are serialized, so simultaneous `C+1` arrivals cannot all pass the same
   capacity check.
5. Admission uses a short-lived two-phase token. A reservation consumes one pending seat but is not
   room presence and starts no discovery, radio, or Talk exchange. The client reserves first, stops
   its old room, and only then commits active membership. A full-room rejection therefore leaves
   the current room, discovery, and Talk audience unchanged without briefly joining two rooms.

This is a safe first implementation, not a claim of decentralized consensus. During a network
partition, independent indexes may temporarily admit conflicting sets. The final multi-index
fairness/reconciliation rule needs portable signed admission evidence (or another deterministic
ownerless protocol), partition/reconnect tests, and user testing of the full-room wording before
release. Until that exists, no client may describe the first `C` rule as globally instantaneous.

When a full Place has a public pin, the UI offers **Nearby around _Place name_** as a separate,
deliberate action. It derives the ordinary verified Nearby path from that already-public point; it
does not use or publish the visitor's GPS as the destination. The visit retains the user's real
GPS-derived home, carries a traveler marker, survives restart by recomputing from the public point,
and follows later capacity refinements. Return to Nearby always recomputes the real home and clears
the visit. If the pin's Nearby cell is already the active home cell, the app stays home rather than
manufacturing a traveler state.

Map UI shows one shaded Nearby area plus meaningful Place pins. It does not show internal shards,
raw coordinate IDs, Global, TechSupport, or a geographic hierarchy.

## 5. Gun.js boundary

Gun remains the database, but network-visible Gun is a control plane rather than a room-wide Talk
body bus.

Network-visible records:

```text
places/by-id/<placeCID>/descriptor
places/by-map-cell/<mapCell>/<placeCID>/reference
room-presence/<roomId>/<userPubHash>/signed-expiring-presence
nearby-control/<opaque-root-scope>/<requested-generation>/<opaque-room-id>/overflow-certificate
public/protocol-manifests/<sequence>/signed-manifest
```

The authoritative private store holds owner data:

```text
users/<owner>/talks/<talkId>
users/<owner>/receivedTalks/<author>/<talkId>
users/<owner>/meQa/<questionCid>
users/<owner>/chatbotMemory/...
users/<owner>/contacts/...
pairs/<pairId>/...
```

Ownership, encryption, and replication are distinct. A SEA-authenticated namespace limits writers;
it does not encrypt plaintext automatically. Owner-private records must be SEA-encrypted. The web
runtime now routes its private repository API to a local-only, IndexedDB-backed worker Gun and keeps
the main-thread peered Gun for public control. On upgrade, an existing SEA-encrypted private record
is imported locally on first read; subsequent updates are local-only. The former plaintext incoming-
Talk cluster envelope follows the same rule. Ordinary pair-message history now lives in one bounded,
encrypted local envelope per conversation; authenticated DataChannels perform digest/backfill
directly between the two endpoints. Pair conversation metadata and deal confirmations use the same
endpoint-local rule. A first contact publishes a signed, recipient-bound, 24-hour wake-up containing
only routing identity and an encrypted conversation-id ping; after that wake-up opens both endpoints'
pair sessions, the complete metadata crosses their authenticated DataChannel. An encrypted offline
mailbox message can materialize the same minimal local thread if that wake-up was missed. Signed
interaction-ledger events, indexes, heads, and checkpoints also live only in the local encrypted
store. Peers exchange bounded signed ledger deltas on that same ordered DataChannel, and a frame may
contain only events authored by the identity that signed it, so a phone cannot become a third-party
ledger relay. First read can import former peered ciphertext and metadata during the mixed-release
window; no new message, ledger, or conversation-metadata body is written back there. Room-public
paths never contain full Talk bodies, answers, message bodies, ledger histories, match scores, or
deal state.

The Nearby control relay stores only bounded signed presence evidence and certificates. A control
presence identifies an opaque generation-zero root room, the participant's current opaque room,
the requested split generation, a signed protocol checkpoint, and a short expiry. At exactly
`C+1` distinct live public keys in that room, the relay bundles those signed claims into a portable
certificate. The relay does not learn or validate the underlying grid coordinates. Each phone
verifies every witness and derives the next geographic child from its own exact location before it
publishes normal room presence or advertises radio availability. Certificates form a branching
path by room ID rather than one global generation chain, so only an overflowing geographic child
subdivides. This proves signed occupancy claims, not physical location or Sybil resistance; BLE
proximity and future abuse controls may strengthen evidence without making coordinates public.

Public profile fields are deliberate visibility-filtered mirrors. Private Me answers remain
encrypted. When an author sends a Talk, the receiver obtains the selected body from the author and
stores its received copy encrypted under the receiver's own key.

## 6. Direct Talk exchange and trust

The baseline is **direct endpoint-to-endpoint Talk exchange**. A phone does not forward another
person's Talk in the first implementation. Each device rotates through at most `K` concurrent room
peers, performs compact inventory negotiation, transfers selected bodies directly, and records
signed end-recipient acknowledgements. Unreachable delivery stays in the author's local queue for
a later direct opportunity.

The implemented scheduler uses the room's sorted identity set and a circle-method tournament.
Every phone independently derives the same pairings for each 30-second window. A window includes at
most `K` tournament rounds, so both endpoints choose each other, concurrent sessions remain bounded
by `K`, and a stable N-person roster covers every pair within `ceil((N-1)/K)` windows. A Talk send is
first committed to the author's encrypted peerless-Gun outbox per room, receiver, Talk id, and
revision hash. The scheduled author sends only that receiver a bounded `talk-announce` inventory
offer. If the receiver does not already hold the revision and its intake policy accepts the offer,
it requests the body across the same authenticated DataChannel. The receiver ACKs the body only
after its encrypted incoming-Talk cluster write completes. That end-recipient ACK removes exactly
that outbox entry; a lost ACK is repaired when the receiver ACKs a later inventory offer for the
revision it already has. Reload, a missed window, or a failed connection therefore leaves a local
retry, not a third-phone or server-mailbox dependency.

In authoritative mode, a recipient-addressed frame is sent only on the matching direct edge. The
app does not register the old Talk-body mailbox fallback. The mailbox can still ingest envelopes
from mixed releases and remains available to other pair-private features such as offline direct
messages and responses; it is not part of ordinary Talk-body delivery.

Third-person forwarding is deferred, not prohibited. Existing forwarding machinery may remain
behind an experimental feature flag, disabled by default, and must never be required for baseline
delivery. If enabled later it must preserve the original author signature, end-to-end encryption,
deduplication, hop/rate/byte budgets, user settings, and end-recipient acknowledgements.

These uses of “relay” remain distinct:

- a Gun/bootstrap relay carries public control metadata;
- a TURN service carries encrypted packets between the two endpoints;
- third-person forwarding uses Carol's device to carry Alice's Talk to Bob and is deferred.

All stranger connections are encrypted. Public keys are public and are exchanged automatically in
the signed room handshake; that does not create a friendship. An ephemeral encrypted session
protects the first exchange from passive observers while the peer remains **Unknown**. Becoming a
Contact pins the stable identity and enables durable pair state, private conversations, offline
delivery policy, and future reconnection. Trust changes; basic transport protection does not.

The implemented `iinpublic-p2p-v2` DataChannel bootstrap sends only a stable SEA-signed identity,
stable user id, and fresh P-256 ECDH public offer in plaintext. Both endpoints derive an AES-256-GCM
key through HKDF-SHA256 over a transcript that binds the conversation, both stable identities, both
ephemeral keys, and both random session nonces. Each side must decrypt the other's transcript-id
confirmation before Talk inventory, bodies, answers, ledgers, conversation control, attachments, or
DMs can flow. Every ciphertext wrapper remains SEA-signed and nonce/timestamp checked. Replayed
offers derive a different transcript on the fresh peer, changed/tampered ciphertext fails GCM, and
legacy plaintext application frames are discarded rather than negotiated as a fallback.

When a user promotes an Unknown peer to Contact, the current stable `pub` (and available `epub`) is
stored in the user's encrypted known-person record. Edits keep that original pin. A later live
handshake whose signed stable key differs from the pin fails closed; removing and deliberately
re-verifying the Contact is required to accept a replacement identity.

“Public Talk” means the author permits eligible room members to read it, not that a network observer
may read it. Every Talk is signed. Every connection is encrypted.

## 7. Migration from the current implementation

The current Global-first L1-L4 cascade, FIFO tile eviction, `_part_N` UI, TechSupport Global seed,
room-wide gossip flood, and plaintext generic Talk repository are migration debt. Until replaced,
they describe implementation status, not the accepted product design in this document.

Migration order:

1. Introduce versioned Nearby/Place room IDs and the Gun control schema.
2. Move owner-private Talk/Me repositories behind the encrypted storage interface.
   Pair-message history and signed ledgers use the same local boundary and direct endpoint sync.
3. Implement Nearby-first placement and geographic overflow certificates.
4. Replace tree/map UI with Nearby + Place pins + Return to Nearby.
5. Remove Global and TechSupport room membership/floors.
6. Make direct delivery scheduling authoritative and disable third-person forwarding by default.
7. Migrate saved legacy rooms without rebroadcasting old Talks, then retire legacy routing.
8. Verify with deterministic 10,000-user simulations and three-phone Internet/LAN/Wi-Fi Direct
   tests before selecting production cell sizes, `C`, or `K`.
