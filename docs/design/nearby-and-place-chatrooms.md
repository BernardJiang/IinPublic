# Nearby and place chatrooms

Status: **accepted product design, revised 2026-10-10**
Tracking: `OPEN-40`
Supersedes: `room-tree-routing.md`, the Global-first cascade, visible L1-L4 rooms, and numbered
`_part_N` rooms  
Related: Technical Specification §3.3, §6.1, §19.7, §19.14, and §29

## 1. Product model

IinPublic has three independent ways to reach people:

1. **Nearby** is one shared adaptive chatroom containing at most `C` online strangers. Its footprint
   grows when the network is sparse and is repartitioned geographically when occupancy exceeds `C`.
2. **Places** are user-created map destinations such as a restaurant, event, club, or community.
   A user taps a pin to enter one deliberately.
3. **Contacts** are direct relationships independent of room membership. TechSupport exists only
   here; it has no room presence, map pin, headcount, or capacity exemption.

There is no user-facing Global room, geographic tree, country/state hierarchy, L1-L4 navigation,
or numbered overflow room. Internal spatial-index buckets must not appear as rooms or pins.

Exactly one shared chatroom drives stranger discovery and Talk exchange at a time: the automatic
Nearby room, a Nearby room selected by traveling on the map, or one named Place. Contacts may
reconnect on demand without joining that room.

## 2. Nearby placement and privacy

Each user has a **declared encounter location**. It is a routing choice, not proof of physical
presence:

- A phone may start from its current GPS location, blurred to the chosen precision. Exact GPS stays
  in local process/device storage.
- A web user must choose and confirm a self-defined location on the map before joining stranger
  discovery. Browser geolocation may center the picker, but it is neither required nor silently
  published.
- A traveler deliberately moves the encounter location to another point and joins the shared
  Nearby chatroom covering that point. Returning home recomputes or restores the home room.

GPS can be spoofed and a map location can be fictional. IinPublic describes this as the area where
the user chooses to meet people, never as verified physical presence. BLE/LAN observations may add
useful proximity evidence but do not turn the location into an identity or truth claim.

Initial publication precisions are approximately 400 metres for **Close nearby**, 1 km for
**Neighborhood**, 10 km for **Citywide**, and 50 km for **Regional**. These control how precisely a
device may place the user, not a promise about physical radio range. The partition controller may
coalesce sparse groups into a broader shared group, but it must never publish a location more
precise than the user's choice.

Settings expose the actual trade-off:

- **Contacts only:** no stranger audience or stranger discovery.
- **Location off:** stop automatic location-based Nearby; Contacts and deliberately selected Places
  remain available.
- **Regional:** an approximately 50 km public area.
- **Citywide:** an approximately 10 km public area.
- **Neighborhood:** an approximately 1 km public cell.
- **Close nearby:** an approximately 400 m public cell, with an explicit home/work warning.

Settings must preview the approximate map area before applying a precision. A larger area reduces
the precision of the disclosure but cannot guarantee anonymity: repeated activity, a sparse room,
map requests, and network metadata can still reveal patterns. **Location off** is the strong choice
at a sensitive home or workplace; it stops GPS-derived Nearby presence and its stranger radio
advertisements rather than merely hiding the map drawing. Citywide and Regional are privacy floors:
capacity handling must use opaque identity lanes rather than subdivide them into a more precise
public geographic assignment.

The setting is global for automatic Nearby. IinPublic does not need to label or store a precise
home or work address merely to protect it: the user selects Citywide, Regional, or Location off,
and that disclosure ceiling applies wherever automatic Nearby runs. Settings show whether a local
location fix is available and the approximate disclosed area, never the latitude/longitude. The
exact fix may remain in device-local location services/cache; it is not echoed in UI, logs intended
for sharing, room names, or public records.

**Radio nearby is not a separate audience or location mode.** Bluetooth is one discovery-provider
switch, alongside Internet, LAN, and Wi-Fi Direct. Turning a provider on or off changes how the
device can find and reach eligible peers; it never changes active-room membership.

Hashing a predictable cell is obfuscation, not location secrecy. The UI must state the approximate
area revealed by each mode. Exact coordinates, accuracy, and GPS timestamps are never public.

Wi-Fi Direct range cannot define the chatroom: radio reach changes with walls and hardware,
and physical nearness is not transitive. The active shared room defines the eligible audience; BLE
can confirm and prioritize a currently reachable peer; LAN, Wi-Fi
Direct, direct Internet, and TURN are replaceable routes between the same endpoints.

### Discovery-provider defaults

On a phone, every supported discovery provider is enabled by default: Internet encounter discovery,
LAN discovery, BLE presence, and Wi-Fi Direct discovery. Settings expose one independent switch for
each provider. A missing platform capability, denied OS permission, or browser sandbox disables only
that provider and explains why; it does not disable the others. An ordinary web browser therefore
normally has Internet discovery and WebRTC routes, but no native BLE, Wi-Fi Direct, or LAN-NSD
scanner.

Enabling discovery does not mean eagerly forming every possible connection. All provider sightings
are deduplicated to the same verified peer identity and active-room capability. The route selector
chooses LAN, direct Internet, Wi-Fi Direct, or relay without changing eligibility. Wi-Fi Direct must
never form an empty group and should form a group only when an eligible peer needs that route.
Scanning and advertising use bounded duty cycles/backoff, including a quiet singleton state, while
remaining discoverable often enough for a newcomer.

### One active-room definition across every provider

The client derives one signed `RoomPresence` before starting any provider. It binds the active room,
privacy precision, current travel generation, rotating discovery identifier, expiry, and signed
global policy version. Every provider represents that same room capability in the form its payload
allows:

| Provider | Room representation | Possible route after discovery |
| --- | --- | --- |
| Internet | Full signed presence under the active shared room | Direct WebRTC or TURN |
| LAN | Compact active-room token in local service discovery | WebRTC over the existing LAN |
| BLE | Compact rotating active-room token | Discovery and proximity evidence only |
| Wi-Fi Direct | Compact active-room token; credentials negotiated after membership proof | WebRTC over the Wi-Fi Direct IP link |

Range changes which provider can observe a peer; all providers require the same room and global `C`
policy. Several observations of the same eligible device become one logical peer: a
rotating discovery identifier may merge early observations, and authenticated SEA identity becomes
canonical after the handshake. Internet, LAN, and Wi-Fi Direct are route candidates attached to
that peer; BLE is evidence, not a Talk-body transport. Talk delivery and receipts are deduplicated
above the route layer.

A compact radio token is only a prefilter. Before exchanging Talks or forming/joining a Wi-Fi
Direct group, both sides verify the full signed presence, policy version, same-room membership, and
identity. This prevents a truncated-token collision from becoming access.

### The first user and the second arrival

For one user alone, location produces no match. The client still publishes one expiring presence so
the next user can find it. A phone also advertises that presence through enabled local providers on
a bounded, quiet-singleton schedule. It creates no connection and no empty Wi-Fi Direct group. A
completely offline first phone must continue bounded local advertising; otherwise an offline second
phone cannot find it.

If the second person is the only other online user, both users occupy the same broad root chatroom
regardless of the distance between their declared locations. Internet discovery therefore connects them. If their
devices are also physically within LAN, BLE, or Wi-Fi Direct reach, those providers report the same
pair and contribute routes/evidence to the one logical session. “Find each other in all possible
ways” does not imply that a radio can cross physical range or that a web browser gains native radio
APIs.

| First + second user | Available discovery | Result |
| --- | --- | --- |
| Web + web, online | Shared root-room roster | They find each other; WebRTC may select a LAN host path, direct Internet, or TURN. |
| Web + phone, online | Shared root-room roster | They find each other. The browser cannot scan native LAN/BLE/Wi-Fi Direct, but WebRTC may still select a same-LAN path. |
| Phone + phone, online and on one LAN | Internet, LAN, and possibly BLE/Wi-Fi Direct | Merge all observations into one peer; prefer the existing LAN and do not create an unnecessary Wi-Fi Direct group. |
| Phone + phone, online, physically close but not on one LAN | Internet plus BLE/Wi-Fi Direct | Merge observations; Wi-Fi Direct may become the local/free IP route without creating a second session. |
| Phone + phone, online but physically far apart | Internet only | They still find each other when the online population has no closer candidates. |
| Phone + phone, hub unavailable but on one LAN | LAN, and possibly BLE | Verify the same cached active-room capability, cap the roster at `C`, and exchange over LAN. Reconcile later. |
| Phone + phone, hub unavailable, no shared LAN, physically close | BLE/Wi-Fi Direct | Verify the same cached active-room capability, elect one group, and exchange over its IP link. |
| Web + phone or web + web, Internet index unavailable | No common cold-discovery provider in the current architecture | No new session until Internet discovery returns or a future browser-compatible rendezvous path exists. |
| More than `C` users in one room | Signed occupancy control | Split the room geographically; each user follows one shared child with at most `C` members. |
| Any pair deliberately in the same Place | Same Place scope through every supported provider | Apply Place membership; home or traveler location does not alter that explicit audience. |
| Contacts-only user + stranger | Stranger discovery is disabled | No stranger exchange. Existing Contacts use their independent authenticated path. |

### Required web encounter location

A web user must choose **Set encounter location on map** before participating in stranger discovery.
The selection is intentionally self-defined and may be fictional. The client previews and snaps it
to the selected Neighborhood or Close-nearby publication precision, stores it locally, and publishes
only the signed blurred encounter presence. **Use my current location** may center the choice when
browser geolocation is available, but requires confirmation. **Clear encounter location** leaves
Nearby stranger discovery. Choosing an encounter location is distinct from entering a named Place.
The confirmation states the approximate public area and that the map/tile provider may observe the
requested viewport and network address.

## 3. Adaptive shared chatrooms and capacity

One signed, versioned global capacity `C` limits every shared Nearby and Place chatroom. The current
value `498` is an arbitrary experimental default, not a proven optimum and not a room attribute. It
may change in a later signed protocol manifest after simulation and real-device evidence.

The automatic Nearby rule is:

1. While the total ordinary online population is at most `C`, all users share one broad Nearby
   group, so two users can find one another through Internet discovery regardless of distance.
2. When signed live occupancy proves a group has more than `C` members, a deterministic partition
   manifest replaces it with disjoint, geographically compact groups. Every member follows exactly
   one replacement derived from their blurred declared location before publishing new presence or
   radio advertisements.
3. Repartitioning continues only where capacity requires it until every active group has at most
   `C` members. Political borders, country databases, FIFO age, and visible `_part_N` rooms are
   never inputs.
4. Adjacent sparse groups that fit together may be replaced by one broader group after a sustained
   merge dwell. Split/merge hysteresis prevents churn. If the worldwide population eventually falls
   to two, they converge into one broad group.
5. A traveler selects a point on the map. The client resolves the active group covering that point
   and joins its shared roster with a traveler marker. If that branch later splits or merges, the
   saved travel point deterministically follows the correct replacement group. Return home resolves
   the current home point through the current partition manifest.
6. A client subscribes only to its active group plus bounded signed partition-control summaries. It
   never downloads a million-user broad-group roster after repartitioning.

The partition manifest is protocol control data, not a tree of chatrooms. Groups have no
user-visible parent, child, level, expandable node, or inherited room attributes. Repartitioning
replaces flat groups atomically; it does not create a navigation hierarchy.

### 3.1 Implemented flat transition lineage

The v2 runtime represents the manifest as bounded, independently verifiable lineage fragments
rather than making every phone download every active group:

- Every signed protocol checkpoint derives one opaque worldwide root group. With no replacement
  transition, every declared location resolves to that same group.
- A room instance is immutable. A C+1 set of fresh, distinct, signed presences creates a
  content-addressed `replace-group-with-groups` transition to four compact geographic replacements.
  Only the overflowing group is replaced.
- Four active sibling groups may create a `coalesce-adjacent-groups` transition after their complete
  combined signed roster remains unchanged and no larger than `C` for the global merge dwell. The
  replacement is a new room instance, so an old cached split cannot create a split/merge loop.
- A client fetches and caches only transitions that replace its current group. It verifies the
  checkpoint, transition hash, replacement IDs, signed evidence, capacity, and dwell before moving.
  The ordinary active-room controller stops the old exchange before starting the new one.
- Offline startup replays only that cached verified lineage. Wider connectivity may reveal a later
  transition; reconciliation is eventual and never presented as global instantaneous consensus.

Locations are snapped locally to the selected privacy precision before choosing a geographic
replacement. Once a partition becomes finer than that disclosure floor, further capacity splits
use a deterministic SEA-identity lane inside the already disclosed coarse area. The group still has
one common roster; the lane does not claim more precise GPS. Twenty-four bounded decisions provide
enough final lanes for the million-person dense-venue test. If the final depth or bounded group index
is exhausted, admission fails closed instead of allowing a room to exceed `C`.

The rendezvous index aggregates and serves this signed evidence but is not trusted to invent a
transition: clients re-verify the member signatures and content-derived replacement IDs. As with
the rest of Nearby control, this proves signed declarations and observed rosters, not honest GPS,
one-human-one-key identity, or instantaneous knowledge across a network partition.

This restores the defining chatroom property: every member sees the same room identifier, roster,
capacity, and Talk audience. It also exposes a mathematical trade-off. An exact personalized
“nearest 498” set cannot be a shared chatroom because neighboring users can have different 498th
neighbors. IinPublic therefore promises a **locality-optimized shared room** of at most `C`, not an
exact per-user k-nearest set. Here, “closest shared group” means that the partitioning algorithm
keeps each room geographically compact while satisfying the stronger common-roster and capacity
constraints; it does not mean that every member's individual closest `C - 1` people are inside.
At a partition boundary, the map may offer the adjacent room as a deliberate travel destination;
the app does not silently join two rooms and double traffic.

For example, let room capacity be two and place four users on a line at `A=0`, `B=4`, `C=5`, and
`D=9`. Exact one-nearest choices are `A→B`, `B→C`, `C→B`, and `D→C`; these cannot become disjoint
two-person rooms because A claims B while B claims C, and D also claims C. A shared-room partition
must instead make a group decision, such as `{A,B}` and `{C,D}`. B and C are closer than their room
partners but every membership is symmetric, every member sees the same roster, and capacity is
actually bounded. The geographic split/merge policy chooses that shared consistency deliberately.

During an Internet partition, phones may reconstruct only a cached active room from signed
LAN/BLE/Wi-Fi Direct evidence and reconcile split/merge state when wider control data returns. This
is eventual bounded convergence, not an instantaneous global consensus claim.

`C` bounds eligible room population but does not require a full mesh. A separate global
neighbor/concurrency limit `K` bounds simultaneous direct peer connections and schedules Talk
exchange across the room. Both `C` and `K` are global protocol-manifest parameters.

### 3.2 Mixed location precision and visitable crowd cohorts

Users may choose different location-disclosure floors. A replacement decision uses a member's
blurred declared point only while the replacement remains no more precise than that member's
selected Regional, Citywide, Neighborhood, or Close-nearby floor. A member who has reached their
floor must be assigned by a deterministic cryptographic cohort decision, not by finer coordinates.
Consequently, coarse privacy can reduce geographic matching quality in a dense area; the product
must state that trade-off rather than imply exact-nearest membership.

Capacity-only decisions below a privacy floor are **crowd cohorts**, not smaller geographic rooms.
They share the same displayed encounter area, and the map must remain clamped to the member's
chosen disclosure area. It must not draw an identity-derived cohort path as a smaller location.
Geographic replacement may keep its four-way spatial split; the first implementation should
evaluate two-way cohort splitting so a `C+1` crowd is not unnecessarily scattered into four mostly
empty groups.

A stable identity hash selects a member's default cohort, but it must not permanently trap the
member there. A user may explicitly choose **Meet another group** within the same encounter area,
visit one cohort at a time, and later **Return to my default group**. This is cohort travel, not map
travel: it changes neither the declared point, privacy floor, home location, nor map traveler state.
A deterministic per-identity permutation plus local visited-cohort history should avoid repeatedly
selecting the same cohort or moving everyone in lockstep.

Switching cohorts uses a bounded two-phase handoff: reserve capacity in a different cohort, stop
the old room's discovery and Talk exchange, commit the target membership, and release the old
presence. A failed or full target leaves the old room active. The hard limit remains `C`; a separate
signed experimental target occupancy or headroom policy may keep seats available for movement.
Join time must not choose cohorts because decentralized clocks and partitions do not provide a
trustworthy global arrival order, and first-`C` batching would leave later users isolated.

The UI shows one geographic area or population bubble even when it contains several cohorts. It may
report that the crowd is divided for performance and offer another-group/default-group actions, but
must not restore a room tree, overlapping pins, coordinate IDs, or `_part_N` navigation. `C` bounds
the candidate roster and eventual pair set; `K` remains the direct bound on simultaneous P2P links.

This refinement initially applies only to automatic Nearby. A full Place continues to reject a new
admission and offer Nearby around its pin. Allowing one visible Place to contain multiple visitable
cohorts is a separate product/protocol decision because it changes the current Place audience
semantics.

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
home encounter location    = confirmed GPS-derived or saved self-defined area
current encounter location = home or a deliberately selected travel area
active stranger audience   = shared Nearby leaf at that location, or one selected Place
traveler                    = current encounter location differs from home, or a Place is active
```

Selecting **Meet people around here** on the map changes the current encounter location and joins
the shared Nearby room covering that point. Joining a named Place instead stops Nearby discovery
before joining the Place's explicit audience. **Return home** recomputes or restores the home
encounter location and clears traveler state. A travel point or selected Place may persist across
restart, but the UI must keep that state visible.

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

When a full Place has a public pin, the UI offers **Meet people around _Place name_** as a separate,
deliberate action. It resolves the shared Nearby room at that already-public point; it does
not use or publish the visitor's GPS as the destination. The visit retains the home encounter
location, carries a traveler marker, survives restart, and follows later `C` changes. Return home
restores the home location and clears the visit.

### Flat list and map presentation

List view has exactly two flat sections:

1. **Your current group** — one Nearby or selected Place card, its description, traveler marker
   when applicable, headcount, and the global capacity ceiling.
2. **Places** — independent public Place cards. A Place is never rendered underneath Nearby or
   another Place. Empty state points to Map or Place creation.

There are no expand arrows, indentation levels, parent/child labels, coordinate IDs, split
generations, or numbered capacity shards. The UI may call a sparse worldwide audience **Broad
discovery** rather than Nearby when that distinction is available from verified control state.

Map view shows only the user's blurred encounter-area shading and public Place pins/population
bubbles. It never plots member coordinates. Tapping a Place opens that Place. Tapping empty map
space opens a **Nearby around this point** preview; joining changes the encounter location and marks
the user as a traveler. **Return Home** recomputes the current blurred home area. Internal partition
boundaries may affect the shaded group footprint, but no partition node is rendered as a pin or
navigable room. Global, TechSupport, country/state layers, raw coordinate IDs, and room hierarchy
remain absent.

## 5. Gun.js boundary

Gun remains the database, but network-visible Gun is a control plane rather than a room-wide Talk
body bus.

Network-visible records:

```text
places/by-id/<placeCID>/descriptor
places/by-map-cell/<mapCell>/<placeCID>/reference
room-presence/<roomId>/<userPubHash>/signed-expiring-presence
nearby-control/<policyVersion>/<roomId>/signed-occupancy-summary
nearby-index/<policyVersion>/<transitionId>/signed-group-replacements
place-presence/<roomId>/<userPubHash>/signed-expiring-presence
place-admission-claims/<roomHash>/<identityHash>/signed-expiring-seat-claim
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

The Nearby control graph stores signed, expiring room presences, bounded occupancy summaries, and
flat group-replacement transitions. A presence identifies the shared room, privacy precision,
policy version, travel generation, rotating discovery identifier, and short expiry. Clients verify
control evidence before following a repartition or coalescing transition and subscribe only to one active roster. This proves
signed declarations and occupancy observations, not physical location or Sybil resistance. BLE
proximity and future abuse controls may strengthen evidence without exposing exact GPS or claiming
the declared location is true.

Public profile fields are deliberate visibility-filtered mirrors. Private Me answers remain
encrypted. When an author sends a Talk, the receiver obtains the selected body from the author and
stores its received copy encrypted under the receiver's own key.

## 6. Direct Talk exchange and trust

The baseline is **direct endpoint-to-endpoint Talk exchange**. A phone does not forward another
person's Talk in the first implementation. Each device rotates through at most `K` concurrent room
peers, performs compact inventory negotiation, transfers selected bodies directly, and records
signed end-recipient acknowledgements. Unreachable delivery stays in the author's local queue for
a later direct opportunity.

The implemented scheduler uses the shared room's sorted identity set and a circle-method tournament.
Every phone independently derives the same pairings for each 30-second window. A window includes at
most `K` tournament rounds, so both endpoints choose each other, concurrent sessions remain bounded
by `K`, and a stable N-person roster covers every pair within `ceil((N-1)/K)` windows. A Talk send is
first committed to the author's encrypted peerless-Gun outbox per audience, receiver, Talk id, and
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

1. Introduce signed room presence, the adaptive flat partition manifest, Place IDs, and the Gun
   control schema.
2. Move owner-private Talk/Me repositories behind the encrypted storage interface.
   Pair-message history and signed ledgers use the same local boundary and direct endpoint sync.
3. Replace the existing geographic subdivision with flat group replacement/coalescing so a sparse
   population shares one broad room and every dense group stays at or below `C`.
4. Present one active group card, flat Place cards/pins, map-point travel, and Return Home.
5. Remove Global and TechSupport room membership/floors.
6. Make direct delivery scheduling authoritative and disable third-person forwarding by default.
7. Migrate saved legacy rooms without rebroadcasting old Talks, then retire legacy routing.
8. Verify with deterministic 2/499/500/10,000/million-user simulations and three-phone
   Internet/LAN/BLE/Wi-Fi Direct tests before selecting production precision, `C`, or `K`.
