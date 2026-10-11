# Nearby and place chatrooms

Status: **accepted product design, revised 2026-10-10**
Tracking: `OPEN-40`
Supersedes: `room-tree-routing.md`, the Global-first cascade, visible L1-L4 rooms, and numbered
`_part_N` rooms  
Related: Technical Specification §3.3, §6.1, §19.7, §19.14, and §29

## 1. Product model

IinPublic has three independent ways to reach people:

1. **Nearby** is an adaptive encounter set containing at most the nearest `C` online strangers to
   the user's declared encounter location. Spatial cells are internal search-index buckets, not
   rooms or hard audience boundaries.
2. **Places** are user-created map destinations such as a restaurant, event, club, or community.
   A user taps a pin to enter one deliberately.
3. **Contacts** are direct relationships independent of room membership. TechSupport exists only
   here; it has no room presence, map pin, headcount, or capacity exemption.

There is no user-facing Global room, geographic tree, country/state hierarchy, L1-L4 navigation,
or numbered overflow room. Internal spatial-index buckets must not appear as rooms or pins.

Exactly one stranger audience drives discovery and Talk exchange at a time: the adaptive Nearby
encounter set or one deliberately selected Place. Contacts may reconnect on demand without joining
that audience.

## 2. Nearby placement and privacy

Each user has a **declared encounter location**. It is a routing choice, not proof of physical
presence:

- A phone may start from its current GPS location, blurred to the chosen precision. Exact GPS stays
  in local process/device storage.
- A web user must choose and confirm a self-defined location on the map before joining stranger
  discovery. Browser geolocation may center the picker, but it is neither required nor silently
  published.
- A traveler deliberately moves the encounter location to another point and receives a fresh
  nearest-`C` set. Returning home recomputes or restores the home encounter location.

GPS can be spoofed and a map location can be fictional. IinPublic describes this as the area where
the user chooses to meet people, never as verified physical presence. BLE/LAN observations may add
useful proximity evidence but do not turn the location into an identity or truth claim.

Initial experimental publication precisions are approximately 200-500 metres for **Close nearby**
and about 1 km for **Neighborhood**. These control location blur, not a maximum search radius or a
promise about physical radio range. The nearest-user search expands beyond the initial cell until it
finds all available users in a sparse network or enough candidates to select `C` in a dense one.

Settings expose the actual trade-off:

- **Contacts only:** no stranger audience or stranger discovery.
- **Neighborhood:** an approximately 1 km public cell.
- **Close nearby:** an approximately 200-500 m public cell, with an explicit home/work warning.
- **Location off:** saved Contacts and deliberately selected Places only.

**Radio nearby is not a separate audience or location mode.** Bluetooth is one discovery-provider
switch, alongside Internet, LAN, and Wi-Fi Direct. Turning a provider on or off changes how the
device can find and reach eligible peers; it never changes the nearest-user eligibility rule.

Hashing a predictable cell is obfuscation, not location secrecy. The UI must state the approximate
area revealed by each mode. Exact coordinates, accuracy, and GPS timestamps are never public.

Wi-Fi Direct range cannot define the encounter set: radio reach changes with walls and hardware,
and physical nearness is not transitive. Declared location and the global nearest-`C` policy define
the eligible audience; BLE can confirm and prioritize a currently reachable peer; LAN, Wi-Fi
Direct, direct Internet, and TURN are replaceable routes between the same endpoints.

### Discovery-provider defaults

On a phone, every supported discovery provider is enabled by default: Internet encounter discovery,
LAN discovery, BLE presence, and Wi-Fi Direct discovery. Settings expose one independent switch for
each provider. A missing platform capability, denied OS permission, or browser sandbox disables only
that provider and explains why; it does not disable the others. An ordinary web browser therefore
normally has Internet discovery and WebRTC routes, but no native BLE, Wi-Fi Direct, or LAN-NSD
scanner.

Enabling discovery does not mean eagerly forming every possible connection. All provider sightings
are deduplicated to the same verified peer identity and encounter-policy version. The route selector
chooses LAN, direct Internet, Wi-Fi Direct, or relay without changing eligibility. Wi-Fi Direct must
never form an empty group and should form a group only when an eligible peer needs that route.
Scanning and advertising use bounded duty cycles/backoff, including a quiet singleton state, while
remaining discoverable often enough for a newcomer.

### One encounter definition across every provider

The client derives one signed `EncounterPresence` before starting any provider. It binds the user's
blurred declared location, precision, current travel generation, rotating discovery identifier,
expiry, and signed global policy version. Every provider represents that same presence in the form
its payload allows:

| Provider | Encounter representation | Possible route after discovery |
| --- | --- | --- |
| Internet | Full signed presence in the hierarchical spatial index | Direct WebRTC or TURN |
| LAN | Compact location/policy token in local service discovery | WebRTC over the existing LAN |
| BLE | Compact rotating location/policy token | Discovery and proximity evidence only |
| Wi-Fi Direct | Compact location/policy token; credentials negotiated only after eligibility | WebRTC over the Wi-Fi Direct IP link |

Range changes which provider can observe a peer; all providers apply the same declared-location
ranking and `C` limit. Several observations of the same eligible device become one logical peer: a
rotating discovery identifier may merge early observations, and authenticated SEA identity becomes
canonical after the handshake. Internet, LAN, and Wi-Fi Direct are route candidates attached to
that peer; BLE is evidence, not a Talk-body transport. Talk delivery and receipts are deduplicated
above the route layer.

A compact radio token is only a prefilter. Before exchanging Talks or forming/joining a Wi-Fi
Direct group, both sides verify the full signed presence, policy version, mutual encounter-set
eligibility, and identity. This prevents a truncated-token collision from becoming access.

### The first user and the second arrival

For one user alone, location produces no match. The client still publishes one expiring presence so
the next user can find it. A phone also advertises that presence through enabled local providers on
a bounded, quiet-singleton schedule. It creates no connection and no empty Wi-Fi Direct group. A
completely offline first phone must continue bounded local advertising; otherwise an offline second
phone cannot find it.

If the second person is the only other online user, both users include each other regardless of the
distance between their declared locations. Internet discovery therefore connects them. If their
devices are also physically within LAN, BLE, or Wi-Fi Direct reach, those providers report the same
pair and contribute routes/evidence to the one logical session. “Find each other in all possible
ways” does not imply that a radio can cross physical range or that a web browser gains native radio
APIs.

| First + second user | Available discovery | Result |
| --- | --- | --- |
| Web + web, online | Expanding Internet spatial search | They find each other; WebRTC may select a LAN host path, direct Internet, or TURN. |
| Web + phone, online | Expanding Internet spatial search | They find each other. The browser cannot scan native LAN/BLE/Wi-Fi Direct, but WebRTC may still select a same-LAN path. |
| Phone + phone, online and on one LAN | Internet, LAN, and possibly BLE/Wi-Fi Direct | Merge all observations into one peer; prefer the existing LAN and do not create an unnecessary Wi-Fi Direct group. |
| Phone + phone, online, physically close but not on one LAN | Internet plus BLE/Wi-Fi Direct | Merge observations; Wi-Fi Direct may become the local/free IP route without creating a second session. |
| Phone + phone, online but physically far apart | Internet only | They still find each other when the online population has no closer candidates. |
| Phone + phone, hub unavailable but on one LAN | LAN, and possibly BLE | Rank the locally visible set with the same policy, cap it at `C`, and exchange over LAN. Reconcile with the wider index later. |
| Phone + phone, hub unavailable, no shared LAN, physically close | BLE/Wi-Fi Direct | Rank the visible set, verify the signed encounter policy, elect one group, and exchange over its IP link. |
| Web + phone or web + web, Internet index unavailable | No common cold-discovery provider in the current architecture | No new session until Internet discovery returns or a future browser-compatible rendezvous path exists. |
| More than `C+1` online users | Hierarchical search plus any locally visible providers | Retain at most the nearest mutually eligible `C`; farther candidates are not connected. |
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

## 3. Adaptive nearest-`C` selection

One signed, versioned global capacity `C` limits each user's Nearby encounter set. The current value
`498` is an arbitrary experimental default, not a proven optimum and not a room attribute. It may
change in a later signed protocol manifest after simulation and real-device evidence.

The target selection rule is:

1. Publish one signed, expiring presence under a hierarchical spatial index derived from the blurred
   declared encounter location. Index cells locate candidates; users never join them as rooms.
2. Search the local cell and progressively farther nonempty cells. Continue until either every live
   presence known to the index has been considered or unsearched cells cannot contain a candidate
   closer than the current `C`th result.
3. Rank by distance between published blurred areas, then by a symmetric cryptographic pair
   tie-breaker. Exact GPS is neither required nor published.
4. Retain at most the nearest `C` candidates. A stranger edge becomes active only when the selection
   is mutual, so neither endpoint can accumulate more than `C` stranger peers merely by being inside
   many other users' search results.
5. Apply replacement hysteresis and presence expiry so small GPS/roster changes do not constantly
   churn the `C`th position.

Therefore, when only two users are online they find each other through Internet discovery no matter
how far apart their declared locations are. When no more than `C+1` users are online, every user can
encounter every other user. As the population grows, the expanding query stops sooner; with millions
online, each user focuses on at most the nearest mutually eligible `C` rather than a worldwide
roster. Fixed-cell boundary misses disappear because a cell edge is an index boundary, not an
audience boundary.

A hierarchical sparse directory makes the two-user case possible without scanning every empty map
cell, and makes the million-user case possible without downloading every presence. During an
Internet partition a phone ranks only the signed candidates observable through LAN/BLE/Wi-Fi Direct,
keeps at most `C`, and reconciles when a wider index becomes reachable. This is an eventual bounded
rule, not a promise of one instantaneous worldwide nearest-neighbor answer during a partition.

`C` bounds the eligible stranger population but does not require a full mesh. A separate global
neighbor/concurrency limit `K` bounds simultaneous direct peer connections and schedules Talk
exchange across the encounter set. Both `C` and `K` are global protocol-manifest parameters.

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
active stranger audience   = nearest-C set around that location, or one selected Place
traveler                    = current encounter location differs from home, or a Place is active
```

Selecting **Meet people around here** on the map changes the current encounter location and produces
a fresh nearest-`C` set around that point. Joining a named Place instead stops Nearby discovery
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
deliberate action. It centers the adaptive nearest-`C` search on that already-public point; it does
not use or publish the visitor's GPS as the destination. The visit retains the home encounter
location, carries a traveler marker, survives restart, and follows later `C` changes. Return home
restores the home location and clears the visit.

Map UI shows the declared encounter area, the current approximate search reach needed to collect the
available nearest users, and meaningful Place pins. It does not show internal index buckets, raw
coordinate IDs, Global, TechSupport, or a geographic hierarchy.

## 5. Gun.js boundary

Gun remains the database, but network-visible Gun is a control plane rather than a room-wide Talk
body bus.

Network-visible records:

```text
places/by-id/<placeCID>/descriptor
places/by-map-cell/<mapCell>/<placeCID>/reference
encounter-presence/<policyVersion>/<precision>/<cell>/<userPubHash>/signed-expiring-presence
encounter-index/<policyVersion>/<parentCell>/<childCell>/nonempty-reference
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

The Nearby control graph stores only signed, expiring encounter presences and sparse spatial-index
references. A presence identifies a blurred self-declared area, precision, policy version, travel
generation, rotating discovery identifier, and short expiry. Parent-to-child references allow a
client to find nonempty regions without scanning the world; they are index hints and grant no room
membership. Clients verify presence signatures, expand the spatial query until the nearest-`C`
stopping condition is proven, and apply mutual selection locally. This proves a signed declaration,
not physical location or Sybil resistance. BLE proximity and future abuse controls may strengthen
evidence without making GPS exact or claiming the declared location is true.

Public profile fields are deliberate visibility-filtered mirrors. Private Me answers remain
encrypted. When an author sends a Talk, the receiver obtains the selected body from the author and
stores its received copy encrypted under the receiver's own key.

## 6. Direct Talk exchange and trust

The baseline is **direct endpoint-to-endpoint Talk exchange**. A phone does not forward another
person's Talk in the first implementation. Each device rotates through at most `K` concurrent
encounter-set peers, performs compact inventory negotiation, transfers selected bodies directly, and records
signed end-recipient acknowledgements. Unreachable delivery stays in the author's local queue for
a later direct opportunity.

The implemented scheduler currently uses a room's sorted identity set and a circle-method
tournament; the adaptive migration supplies the mutually selected encounter set instead.
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

“Public Talk” means the author permits eligible encounter/Place members to read it, not that a network observer
may read it. Every Talk is signed. Every connection is encrypted.

## 7. Migration from the current implementation

The current Global-first L1-L4 cascade, FIFO tile eviction, `_part_N` UI, TechSupport Global seed,
room-wide gossip flood, and plaintext generic Talk repository are migration debt. Until replaced,
they describe implementation status, not the accepted product design in this document.

Migration order:

1. Introduce signed encounter presence, the hierarchical spatial index, Place IDs, and the Gun
   control schema.
2. Move owner-private Talk/Me repositories behind the encrypted storage interface.
   Pair-message history and signed ledgers use the same local boundary and direct endpoint sync.
3. Replace fixed-cell membership/overflow certificates with adaptive nearest-`C` selection.
4. Replace tree/map UI with encounter location/reach, Place pins, travel, and Return home.
5. Remove Global and TechSupport room membership/floors.
6. Make direct delivery scheduling authoritative and disable third-person forwarding by default.
7. Migrate saved legacy rooms without rebroadcasting old Talks, then retire legacy routing.
8. Verify with deterministic 2/499/500/10,000/million-user simulations and three-phone
   Internet/LAN/BLE/Wi-Fi Direct tests before selecting production precision, `C`, or `K`.
