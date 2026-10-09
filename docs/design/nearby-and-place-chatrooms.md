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
The final full-room admission wording and fairness rule must be tested before release.

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
it does not encrypt plaintext automatically. Owner-private records must be SEA-encrypted. A first
migration may allow that ciphertext to replicate through Gun; the stronger target uses a local-only
encrypted Gun instance for private bodies and a separately peered Gun instance for public control
metadata. Room-public paths never contain full Talk bodies, answers, or conversations.

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

“Public Talk” means the author permits eligible room members to read it, not that a network observer
may read it. Every Talk is signed. Every connection is encrypted.

## 7. Migration from the current implementation

The current Global-first L1-L4 cascade, FIFO tile eviction, `_part_N` UI, TechSupport Global seed,
room-wide gossip flood, and plaintext generic Talk repository are migration debt. Until replaced,
they describe implementation status, not the accepted product design in this document.

Migration order:

1. Introduce versioned Nearby/Place room IDs and the Gun control schema.
2. Move owner-private Talk/Me repositories behind the encrypted storage interface.
3. Implement Nearby-first placement and geographic overflow certificates.
4. Replace tree/map UI with Nearby + Place pins + Return to Nearby.
5. Remove Global and TechSupport room membership/floors.
6. Make direct delivery scheduling authoritative and disable third-person forwarding by default.
7. Migrate saved legacy rooms without rebroadcasting old Talks, then retire legacy routing.
8. Verify with deterministic 10,000-user simulations and three-phone Internet/LAN/Wi-Fi Direct
   tests before selecting production cell sizes, `C`, or `K`.
