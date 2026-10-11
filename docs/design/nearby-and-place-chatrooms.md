# Nearby and place chatrooms

Status: **accepted product design, revised 2026-10-10**
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
- **Neighborhood:** an approximately 1 km public cell.
- **Close nearby:** an approximately 200-500 m public cell, with an explicit home/work warning.
- **Location off:** saved Contacts and manually selected Places only.

**Radio nearby is not a separate audience or location mode.** Bluetooth is one discovery-provider
switch, alongside Internet, LAN, and Wi-Fi Direct. Turning a provider on or off changes how the
device can find and reach eligible peers; it never changes which room those peers must share.

Hashing a predictable cell is obfuscation, not location secrecy. The UI must state the approximate
area revealed by each mode. Exact coordinates, accuracy, and GPS timestamps are never public.

Wi-Fi Direct range cannot define a stable room: radio reach changes with walls and hardware, and
physical nearness is not transitive. Location defines the eligible audience; BLE confirms and
prioritizes physically present peers; LAN, Wi-Fi Direct, direct Internet, and TURN are replaceable
routes between the same endpoints.

### Discovery-provider defaults

On a phone, every supported discovery provider is enabled by default: Internet room discovery,
LAN discovery, BLE presence, and Wi-Fi Direct discovery. Settings expose one independent switch for
each provider. A missing platform capability, denied OS permission, or browser sandbox disables only
that provider and explains why; it does not disable the others. An ordinary web browser therefore
normally has Internet discovery and WebRTC routes, but no native BLE, Wi-Fi Direct, or LAN-NSD
scanner.

Enabling discovery does not mean eagerly forming every possible connection. All provider sightings
are deduplicated to the same verified peer identity and active-room capability. The route selector
chooses LAN, direct Internet, Wi-Fi Direct, or relay without changing room membership. Wi-Fi Direct
must never form an empty group and should form a group only when at least one eligible same-room peer
needs that route. Scanning and advertising use bounded duty cycles/backoff, including a quiet
singleton state, while remaining discoverable often enough for a newcomer.

### One location scope across every provider

The client derives one `ActiveDiscoveryScope` before starting any provider. It contains the opaque
active room identifier and capability plus the applicable protocol-manifest/room generation. A
Nearby scope comes from GPS or a manually selected home area; a Place scope comes from the Place the
user deliberately joined. Exact coordinates are not part of the scope sent to peers.

Every discovery provider represents that same scope in the form its payload allows:

| Provider | Scope representation | Possible route after discovery |
| --- | --- | --- |
| Internet | Full authenticated active-room scope | Direct WebRTC or TURN |
| LAN | Room-scoped rendezvous token in local service discovery | WebRTC over the existing LAN |
| BLE | Room-scoped, rotating presence token | Discovery evidence only |
| Wi-Fi Direct | Room-scoped service token; group credentials derived from the full capability | WebRTC over the Wi-Fi Direct IP link |

Range changes only which provider can observe a peer. It does not change eligibility. Two devices
in different active scopes ignore each other even when they are on the same LAN or within Bluetooth
range. Conversely, several observations of the same eligible device become one logical peer: a
rotating radio identifier may merge early observations, and the authenticated SEA identity becomes
canonical after the handshake. Internet, LAN, and Wi-Fi Direct are route candidates attached to
that peer; BLE is short-range evidence, not a Talk-body transport. Talk delivery and receipts are
deduplicated above the route layer.

The discovery token used in a small radio advertisement is only a prefilter. Before exchanging
Talks or forming/joining a Wi-Fi Direct group, both sides must prove the full active scope and
identity. This prevents a truncated-token collision from becoming cross-room access.

### The first user and the second arrival

For one user alone, location produces no immediate match. It still supplies the rendezvous scope
that a later user must independently derive. An online client publishes one expiring presence. A
phone also advertises the same scoped presence through its enabled local providers on a bounded,
quiet-singleton schedule. It creates no connection and no empty Wi-Fi Direct group. A completely
offline first phone must continue bounded local advertising; otherwise an offline second phone
cannot find it.

When a second user arrives, the following rules apply:

| First + second user | Available discovery | Result |
| --- | --- | --- |
| Web + web, online | Internet room roster | One peer session; WebRTC may select a LAN host path, direct Internet, or TURN. |
| Web + phone, online | Internet room roster | One peer session. The browser cannot advertise or scan native LAN/BLE/Wi-Fi Direct, but WebRTC may still select a same-LAN path. |
| Phone + phone, online and on one LAN | Internet, LAN, and possibly BLE/Wi-Fi Direct all observe the same identity | Merge observations; prefer the existing LAN. Do not form a Wi-Fi Direct group merely because it is available. |
| Phone + phone, online, physically close but not on one LAN | Internet plus BLE/Wi-Fi Direct | Merge observations; policy may choose Wi-Fi Direct as the local/free IP route without creating a second logical session. |
| Phone + phone, online but far apart | Internet only | Use direct WebRTC or TURN. Local providers find nothing. |
| Phone + phone, hub unavailable but on one LAN | LAN, and possibly BLE | Discover locally and exchange over the LAN; merge duplicate radio observations. |
| Phone + phone, hub unavailable, no shared LAN, physically close | BLE/Wi-Fi Direct | Confirm the full same-room scope, elect one group, then exchange over its IP link. |
| Web + phone, hub unavailable | No common cold-discovery provider in the current architecture | No new session until Internet discovery returns or a future browser-compatible rendezvous path exists. |
| Web + web, hub unavailable | No cold-discovery provider in the current architecture | No new session until Internet discovery returns or a future bootstrap/manual rendezvous path exists. |
| Any pair in different Nearby cells, capacity children, Places, or privacy modes | Sightings may occur, but scopes differ | Ignore the sighting; physical proximity never overrides the selected audience. |
| Any pair deliberately in the same Place | Same Place scope through every supported provider | Apply the same convergence and route-selection rules; home GPS and traveler status do not affect Place eligibility. |
| Contacts-only user + stranger | Stranger discovery is disabled | No stranger exchange. Existing Contacts use their independent authenticated path. |

The second arrival exposes one unresolved boundary case. Two people may be physically adjacent but
derive neighboring fixed-grid cells. Strict same-scope enforcement correctly prevents radio paths
from silently broadening the audience, but it also means those people do not meet. Per-device GPS
hysteresis prevents movement flapping but cannot make two initial fixes converge. Before release,
the product must choose and test one deterministic, bounded boundary policy (for example, a
privacy-declared neighboring-cell rendezvous) rather than letting BLE secretly bypass room logic.

### Manual web location

A web user who cannot or does not want to use browser geolocation may choose **Set home area on
map**. The selected point is local routing input, equivalent to a GPS fix: the client previews and
snaps it to the selected Neighborhood or Close-nearby cell, stores the choice locally, and publishes
only the resulting opaque room presence. The user can replace it with the current device location or
clear it. Choosing a home area is distinct from clicking a Place, which remains an explicit traveler
visit. The confirmation must state the approximate public area and that the map/tile provider may
observe the requested viewport and network address.

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

Subdivision is geographic, never FIFO-by-age: closer people remain together. Sparse cells widen
through the same deterministic grid, while the UI reports the active cell's real approximate
diameter. No hidden split is presented as a second chatroom.

The initial sparse-area policy is deliberately conservative and release-wide:

1. The client observes only roster snapshots for its one active generation-zero Nearby
   room. It never subscribes to the parent and child at the same time.
2. A room containing only the local participant for three continuous minutes widens by one level.
   Each level doubles cell width, so adjacent sparse base cells deterministically converge on the
   same coarser grid cell when they share that parent.
3. A widened room holding at least 12 participants for one continuous minute narrows by one level.
   Counts between 2 and 11 reset both dwell clocks; a transition also resets them. This dead band
   and the unequal dwell times prevent rapid boundary oscillation.
4. Widening stops after three levels (8x cell width): approximately 4.5 km diagonal in Close nearby
   or 11.3 km in Neighborhood. These are experimental ceilings, not radio-range claims.
5. A capacity-split child never drives sparse widening. A small child roster can be the result of a
   proven dense parent and is not evidence that the area is sparse.
6. A transition uses the ordinary stop-before-start active-room switch. The old room, discovery,
   advertisements, and direct stranger links stop before the replacement scope begins.

Level zero keeps the original Nearby room-ID format for compatibility. Wider IDs carry an explicit
`w1`-`w3` level; their opaque digest still contains no coordinate. The device recomputes map bounds
locally and immediately updates the shaded area and reach label. Sparse state and dwell timestamps
remain device-local. The thresholds and ceiling must be revisited by the capacity experiment; they
are global build policy, never creator-controlled room attributes.

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

The implemented admission rule is deliberately ownerless and easy to explain:

1. The first `C` live admissions observed by the room index hold active seats.
2. The creator is an ordinary participant and receives no priority or reserved seat.
3. A current member may refresh the same seat; leaving or expiry releases it.
4. Requests for one Place are serialized, so simultaneous `C+1` arrivals cannot all pass the same
   capacity check.
5. Admission uses a short-lived two-phase token. A reservation consumes one pending seat but is not
   room presence and starts no discovery, radio, or Talk exchange. The client reserves first, stops
   its old room, and only then commits active membership. A full-room rejection therefore leaves
   the current room, discovery, and Talk audience unchanged without briefly joining two rooms.

Every reservation and active heartbeat also carries a signed, expiring seat claim binding the
Place, stable public identity, global `C`, stable stay-entry time, current observation, and expiry.
Claims are public control metadata under
`place-admission-claims/<roomHash>/<identityHash>`; they contain no Talk or answer bodies. A stable
identity occupies at most one seat even if it presents several user handles. After indexes reconnect,
each verifies the portable claims, keeps the earliest `C` stay-entry times (room/public-key hash is
the deterministic tie-breaker), and reaches the same winner set independent of merge order.

During a network partition, independent indexes may still temporarily admit conflicting sets; this
is eventual deterministic convergence, not consensus or an instantaneous worldwide roster. A claim
outside the winning `C` is removed from the Place on its next heartbeat, falls back to Contacts-only,
and receives an explicit explanation plus the existing optional **Nearby around _Place name_**
action. Missing, malformed, or temporarily unverifiable evidence fails closed but does not falsely
eject the client as a reconciliation loser. Embedded phones forward the signed claim to the hub and
must propagate the hub's reconciliation loss instead of hiding it behind best-effort relay behavior.
Signing prevents forgery and one-key alias duplication; it does not prove honest clocks, physical
presence, or Sybil resistance. Those limitations remain explicit inputs to abuse controls and the
capacity experiment.

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
place-admission-claims/<roomHash>/<identityHash>/signed-expiring-seat-claim
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
