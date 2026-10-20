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
   A user taps a pin to enter one deliberately. A busy Place may contain several invisible,
   capacity-bounded exchange cohorts while remaining one visible Place.
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

Every user has exactly one public location (product decision 2026-10-11). There are two kinds:

- **Resident:** the device's GPS, blurred to the selected area size. This is the default on phones.
- **Traveler ✈:** a point chosen on the map. GPS is never used. The website has no GPS, so web
  users are always Travelers. A Resident who travels to a map point is also marked ✈ while away.

The Traveler marker is room-roster and map-presence metadata, and it is self-declared.

The **area size** applies to either kind:
- **Close nearby:** about 400 m, used only to pick the room. The public point is still 1 km.
- **Neighborhood:** about 1 km.
- **Citywide:** about 10 km.
- **Regional:** about 50 km.

Settings show the area in the user's distance unit (km or miles, one choice for the whole app).

**Retired choices:**
- **"Location off"** became Traveler.
- **"Contacts only"** is not a location decision. It is a Talk audience (§3.5).

A saved retired value migrates once:
- **Location off** → Traveler; nothing is published until a point is chosen.
- **Contacts only** → Resident at Neighborhood, with the Contacts-only Talk audience on.

A larger area reduces the precision of the disclosure but cannot guarantee anonymity. Repeated
activity, a sparse room, map requests and network metadata can still reveal patterns. Citywide and
Regional are privacy floors: capacity handling must use opaque identity lanes rather than subdivide
them into a more precise public geographic assignment.

Settings show whether a local location fix is available and the approximate disclosed area, never
the latitude or longitude. The exact fix may remain in device-local location services or cache. It
is never echoed in the UI, in logs meant for sharing, in room names, or in public records.

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

**Implemented policy (2026-10-10, `src/shared/nearby-discovery-policy.ts`).**
- **Network-free principle (product owner, 2026-10-11).** Every provider works with whatever
  network is up, and any working network is used to reach as many room members as possible.
- **Cellular** is the only uplink switch. Off, discovery never uses mobile data; the hub is still
  reached over Wi-Fi/Ethernet.
- **LAN NSD** runs only while the active room has another member, a same-room radio sighting
  exists, or the hub is unavailable.
- **BLE** keeps a beacon advertising and scans in 30 s windows. After each empty window the
  quiet-singleton backoff doubles: offline 30 s → 10 min, online 60 s → 30 min.
  - Online, the beacon needs an already-granted permission.
  - Online beacons (and DNS-SD TXT) set an "online" flag (BLE bit 4, TXT `o`).
- **Wi-Fi Direct** does not depend on the hub.
  - Offline, discovery runs in scan windows and a group forms for any eligible peer the LAN does
    not reach, including an online one.
  - Online, it stays idle until an eligible OFFLINE same-room phone is seen. The online phone then
    links with it so the two can exchange Talks, leaving one minute after no offline phone remains.
    Relaying the offline phone onward to the hub (bridging) is deferred (product owner,
    2026-10-11).
  - Two online phones never group; the hub and its matchmade link upgrade are their route.
  - Every eligible phone, online or not, takes part in the host election, so all sides agree on
    one host.
- **Eligibility** is either a full-room-token proof bound to the rotating id (BLE v3, DNS-SD TXT
  `q`) or a rotating id that matches a signed roster member's
  `rotatingNearbyId(pub, room, epoch)`. A bare token prefix (BLE v2) never qualifies. Talk exchange
  still requires the signed roster/mesh path.

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

**Simulation results (2026-10-17, `docs/testing/nearby-capacity-experiment.md`).** The production
split rule, driven at 2, 498, 499, 10,000 and 1,000,000 people for C = 32, 64, 128, 256, 498 and
1000:

- C ≥ 128 keeps every room at or below C in every population; direct links stay at most K = 12 and
  reciprocal. A member reads at most 24 lineage transitions.
- C = 32 and 64 fail at a million people: two 50,000-seat stadiums sit below everyone's privacy
  floor, the binary identity lanes exhaust the 24-level depth, and 1,449 (C = 32) and 436 (C = 64)
  groups reach C + 1 with no split left, where the server refuses further joins. C = 32 also needs
  32,378 splits, over the server's 16,384 transitions per checkpoint. C = 128 already reaches
  depth 24 in those stadiums, so it is the smallest value with no margin left.
- A crowd in one place splits down from the world root through empty quadrants: 499 people in one
  city at C = 498 move 10 times each before settling (OPEN-68), and coalescing climbs back one
  level per 3-minute dwell (39 min for one city at C = 128; 15-21 min at a million).

So the simulation supports keeping `C` between 256 and 1000; 498 is inside that range. Real-device
cost per room (OPEN-40-G2.5) still decides the value.

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

This refinement initially applies only to automatic Nearby. The current Place protocol continues
to reject a new admission when its single audience is full and offer Nearby around its pin. Section
4.1 accepts visitable Place cohorts as a separately versioned extension; it must not be inferred by
reusing Nearby transitions or silently changing the meaning of an existing Place seat claim.

### 3.3 Implemented visitable-cohort control plane

The v2 control plane is implemented but activates only when a verified protocol manifest, the
client, and the index all advertise `nearby-visitable-cohorts-v2`. A legacy assignment never enables
it by itself. The implementation consists of:

- signed, expiring seat claims chained by stable public key, generation, and previous-claim hash;
- a separately signed, trusted experimental occupancy policy for target occupancy, cohort-count
  bound, and reservation lifetime, while the manifest's `C` remains the hard ceiling;
- bounded index state and summaries, serialized reserve/commit/cancel/release, deterministic
  winner selection, and claim-based reconciliation after index partitions;
- a client-side deterministic visit order with bounded recent history, full-target retry, one
  queued handoff at a time, safe default return, and committed-visit restoration before room startup;
- a write-ahead mixed-release migration that keeps v1 lineage rollback-readable and treats a v1
  identity-lane suffix as non-geographic forever.

The relay exposes signed policy, summaries, reservations, commits, releases, reconciliation, and
active-claim lookup. It deliberately does **not** expose a route for publishing bare transition
records: a transition contains an evidence digest rather than the signed claims themselves, so
accepting one from an arbitrary client would let it reshape the index without proving occupancy.
Indexes instead recreate transitions from verified reconciled claims. Transition creation is
deferred while any reservation at that level remains live, preventing a valid token from losing its
target between reserve and commit.

Native clients do not bypass their loopback embedded node for this control plane. When an upstream
hub is reachable, the embedded node forwards `/api/nearby-cohorts/*` metadata to the shared hub
index and preserves its exact HTTP status (`409` full/conflict and `503` unavailable are protocol
outcomes). When the hub is unavailable, the local index may continue only from verified cached
state and later reconcile signed claims; it must not pretend that an isolated local reservation is
globally authoritative.

When the hub is unreachable but same-room phones retain a direct authenticated mesh link, no phone
becomes the allocator. Each phone emits its own short-lived signed seat claim in bounded control
chunks. Receivers verify and re-originate only newly learned inner claims, so this reconciliation
does not depend on optional third-person Talk forwarding or on the Wi-Fi Direct group owner. Once a
phone has the same earliest `C+1` claims, it independently creates the same content-addressed
two-way cohort transition and selects its own replacement from the transition seed plus its stable
public identity. A portable capacity artifact carries those exact `C+1` signatures; a receiver
must reproduce the transition before applying it. Claim refresh keeps long-lived offline rooms
observable, and newly connected peers receive bounded snapshots.

On hub recovery, `/api/nearby-cohorts/peer-reconcile` accepts the portable artifact and descendant
claim chains, never a bare transition. The index verifies the historical claims at the decision
time, reconstructs the transition, applies its normal deterministic conflict ordering, and then
imports current descendants. Completely disconnected network components can still make temporary
different decisions; no implementation can promise instantaneous global capacity without shared
communication. Later signed-artifact reconciliation is the convergence boundary.

Automatic parent→child replacement is not a manual cohort visit. It follows the index's verified
capacity transition and carries no manual-selection proof; manual proofs remain restricted to
same-area, same-depth user choices. A three-phone Android 7/10/14 gate confirmed this distinction,
one shared index, a two-way `C=3` split, stable default placement, explicit visits, and Talk delivery
after receiver backgrounding.

The current offline Wi-Fi Direct credential join remains an Android 10+ transport. On the same
build, Android 10 and 14 formed an owner/client group with the hub unreachable and completed
bidirectional plus post-background Talk delivery; the available Android 7 phone could not join.
This is not evidence for a three-phone Wi-Fi Direct cohort, isolated BLE, or long-term battery cost.
The deterministic four-controller no-server flow, tamper rejection, bounded peer payloads, and
post-outage index import are automated; physical multi-phone validation remains required.

The flat UI is wired to the real traversal view-model. Runtime activation still requires migration
to supply a verified v2 default group; until then the existing v1 Nearby path remains authoritative
and the cohort controls truthfully show that no alternative group is available.

Automated gates cover 2, 498, 499, 10,000, and one million members, all four privacy modes,
geographic-to-cohort display invariants, concurrent admission/switches, restart, tamper/replay,
partition/reconnect convergence, geographic split/coalesce, and `K`-bounded direct scheduling. The
physical policy experiment remains separate: `498` is still an arbitrary experimental default and
must not be presented as an empirically optimal capacity.

### 3.4 People and density on the map (product decision 2026-10-11)

The map shows people so users can see where the crowd is:

- **★ me**, larger, drawn at my own public point, so I see exactly what others see of me.
- **Green dots:** members of my current room roster. I can exchange Talks with them.
- **Yellow dots:** everyone else in the visible area, outside my Nearby. They are shown from city
  zoom (10) upward.
- **Heat layer:** anonymous per-square headcounts, so density shows at every zoom.

**Public point.** The public point (`src/shared/public-location.ts`) is the only form in which a
location leaves the device. It is the centre of a grid square sized by the user's setting:
1 km for Close nearby and Neighborhood, 10 km for Citywide, 50 km for Regional. A poor GPS fix
moves to a coarser square. Only a quiet place set to Hide me (§3.5) publishes nothing.

Everyone in a square publishes the identical point, so the exact fix cannot be recovered from a
snapshot. A dot keeps its old square until the device is 15% of a square past the edge, which
limits the edge-crossing leak. Sparse squares can still single someone out; coarser settings are
the remedy.

`users/<id>/location` and a Talk's `authorLocation` use the same public point.

**Map presence.** Map presence (`src/shared/map-presence.ts`) is a signed record with a 3-minute
lifetime, refreshed every 60 s. It carries `{userId, pub, public point}` and no room id. Viewers
colour a dot green from their own room roster.

The hub index:
- verifies the signature;
- rejects any point that is not a grid centre;
- binds a live userId to its key;
- returns at most 500 dots per view, plus complete density squares (1/48 of the view per side).

### 3.5 Quiet places and Talk audience (product decision 2026-10-11)

**Quiet places** let a Resident go quiet automatically where they do not want to be seen precisely,
such as home or work.

- **Triggers:** a place with a radius (200 m – 2 km) where the device's own GPS fix falls, a daily
  schedule (for example 22:00 – 07:00), or **Quiet now**. Places apply only to Residents; a
  Traveler's chosen point is never "at home". The schedule and Quiet now apply to everyone.
- **Blur me more** (default) keeps the user visible but at the Regional area (about 50 km).
- **Hide me** leaves Nearby, removes the map dot and stops radio discovery.
- **Contacts stay reachable** in both cases.
- **Hide wins** when several triggers apply at once.
- **GPS refresh:** while the app is open, a Resident with at least one quiet place re-reads GPS every
  5 minutes, and once more when the app returns to the foreground. That is how arriving at a quiet
  place is noticed. Nobody else pays the battery cost. There is no background geofence, so a closed
  app is checked again at its next launch.

Blur is the default because hiding every evening from the same 1 km square outlines the home.
Settings say plainly that neither action is a guarantee.

Quiet places are stored only on the device. They are never published, synced or sent to the hub.
They are not encrypted at rest, because the only available key is stored beside them. This is a
deliberate exception to "IinPublic does not store a home or work address": the place never leaves
the device.

**Talk audience** (Settings → Talk Behavior) is one choice, independent of location:
- **Everyone in my room** (default).
- **Residents only:** no Talk exchange with room members marked ✈.
- **Contacts only.**

Contacts always pass. The audience applies to Talk offers both ways and to responses. Residents only
filters honest Travelers only: a spoofed GPS can claim Resident. It also excludes every website
user.

The **min/max distance Talk filter was removed**. The room already defines who is in range, and its
default 50-mile maximum hid Talks from members of the user's own room.

### 3.6 The room list (product decision 2026-10-11)

The flat room list replaces the retired chatroom tree.

- **Header:** "N online · M rooms". N counts distinct people in any room; TechSupport is a Contact
  and is never counted.
- **Your room first,** named after its area ("Around San Diego"). Then every other room with at
  least one person: Nearby groups and Places, flat, with no hierarchy.
- **Places near you:** below that, the nearest few live Places that are empty right now (§4.2), so
  an empty Place can still be found and entered from the list.
- **Sort:**
  - **Nearest** (default): by distance from where you appear (your blurred or chosen point).
  - **Busiest:** most people first.
  - **Most room:** fewest people first.

  Distance breaks ties. The list shows 30 rooms at a time, with "Show more rooms".
- **Rows:**
  - A Nearby group is named by where it is from you ("0.6 mi W", or "Here" within 500 m). The
    nearest big city from the app's built-in city table is shown underneath as context
    ("near San Diego"). That table only knows major cities, so it is never used as the name.
  - A Place shows its own name, its type icon, and "Place · 0.6 mi W".
  - Nearby rows have no icon: a pin on every row carried no meaning.
  - Your own row is "Your room · near San Diego".
  - Rows that would read the same get "· 2", "· 3". Room ids are never shown.
  - The headcount reads "1 / 3 people", plus "· Full" when the room is full.
- **Title:** two lines, the room name, then "N users · M matches". Tap it to see the full text.
  While a room's member list is open, the title shows only the counts, because that screen has
  its own heading.
- **Full rooms** are shown greyed out and cannot be entered, because entering would force a split.
- **Tap a room** to enter it and see its member list:
  - Your own room just opens its members.
  - A Place is entered directly.
  - Another Nearby group is entered by traveling to its position. You become a Traveler ✈ in
    the group covering that point; 🏠 returns.
- **Map:** the same rooms appear as pins with headcounts. Tapping one does the same as tapping
  its row. Empty Places stay on the map as pins so they can be found and started.

**Where a room is:**
- A Place is at its public pin.
- A Nearby group is at the mean of its members' public map points (§3.4).

The hub cannot place a group from its partition path alone, because the hub cannot tell where the
geographic digits end and the identity-lane digits begin.

**Data source:** the hub serves `GET /api/active-rooms` from its in-memory room roster and the
map-presence index. Embedded phone nodes relay the request to the hub. The response shows no more
than the map already does: a position and a headcount per room.

**Map colours:** every other Nearby room is drawn as a dashed square in its own colour, with a
matching pin and a matching stripe on its list row. The colour is derived from the room id, so
everyone sees the same colour for the same room. Your own room keeps the solid green shading.

**Balanced lanes:** below a member's privacy floor, a split divides people by a lane hash rather
than by location. Each split carries a `laneThreshold`: the median lane hash of its own C + 1
signed witnesses. Members below the threshold take child "0" and the rest take "1", so the split
is roughly half and half (2 / 2 for C = 3) and less likely to split again. Every client
re-derives the threshold from the evidence and rejects a split whose threshold does not match.
Older splits without a threshold keep the legacy 1-in-4 identity digit.

**Known limit:** groups of the same area that differ only by identity lane cannot be targeted by
travel. Travel lands in your own lane.

### 3.7 Nearby v3: personal Nearby lists (accepted 2026-10-19, being implemented)

Status: **accepted** by the product owner on 2026-10-19, including retiring the yellow map dots and
Nearby room chat. Implementation is in progress (plan below). There is no official release yet,
so v3 replaces v2 outright: no protocol epoch, no compatibility with v2 phones, and the v2 code is
removed (product owner, 2026-10-19). Simulated in `docs/testing/nearby-gossip-experiment.md`. Tracking: `OPEN-70`.
When implemented it replaces §3 to §3.3 and the Nearby parts of §3.6. Places (§4) stay rooms, with
the changes in "Places in v3" below.

**Why.** Room capacity exists only to bound traffic. It never required two people to share the
same list of nearby people, and making them share one is what costs the most today:

- a crowd in one place splits down one quadtree level at a time (10–20 room moves each; OPEN-68)
  and merges back one level per 3-minute dwell;
- every split record carries C + 1 = 499 signed presences (540 KB at C = 498), and every 15 s
  heartbeat re-uploads the phone's whole cached chain (up to 7.5 MB);
- in an arena, 30 groups share one map square and a user cannot move to any of them (§3.6
  "Known limit").

**Model.** Nearby is no longer a room. Each person has their own **nearby list** of at most `C`
people. Two people's lists differ, and that is fine: if Adam's list has Eve and Eve's does not
have Adam, Adam's Talks still reach Eve. Once Eve answers and they become Contacts, she reaches him
directly. Places (below) and Contacts work as before.

#### C is a manifest value, not a constant

`C` (498 today) is the signed protocol manifest's `chatroomCapacity`, never a number in code. A
later manifest may raise or lower it when real devices or networks call for it. Code, the model and
the tests take `C` as a parameter; the unit gate runs at `C = 32`, the experiment at 498.

v3 makes changing `C` cheap. Lists are personal, so nobody has to agree on a room's membership:

- a phone that accepts a new manifest trims its list to the new `C` (keeping the best-ranked) or
  lets gossip fill the extra slots;
- phones still on the old value keep working with the new ones: a list of a different length is
  just another asymmetric list;
- no protocol epoch is needed, unlike v2, where `C` decides when rooms split.

The manifest also carries the other v3 tunables, so they can change the same way: the gossip
period, cards per swap, card lifetime, the hub's sample size per cell and the incoming limits. The
v2 floor of `C ≥ 128` (OPEN-69) comes from the split depth and does not apply to v3; v3 sets its
own range once device measurements exist.

#### Cards

A **card** is a signed, expiring record: public key, public point (§3.4, the centre of the
privacy-floor square), and a timestamp. The owner re-signs it every few minutes. It carries no room
id, no exact location and nothing private. A card replaces both the Nearby control presence and the
map-presence record. Compact, a card is about 250 bytes.

#### Ranking: distance, then my own hash order

A list holds the `C` best cards by:

1. **distance** between public points (people in the same square tie);
2. **my hash order**, `hash(my key, their key, daily beacon)`.

The hash makes everyone's order different, so in an arena different people list different 498s:
everyone stays reachable and nobody is on far more lists than anyone else. It also gives a stable
order for reaching beyond the first `C`: page 2 is the next 498 in my order.

The order is **public**: anyone can compute where they rank in my list. That lets a gossip partner
send me exactly the cards I would keep, which converges far faster than a secret order. The
simulation compares both. A public order can be gamed by generating keys until some rank first for
one victim. Two rules stop that:

- the **daily beacon**, an unpredictable value the hub signs for each UTC day (its key can be
  pinned by the signed protocol manifest), changes every order each day;
- only identities that existed **before** that beacon count first in dense ties. The hub signs the
  day it first saw each key, and the card carries that proof.

(Implemented 2026-10-20; see "Daily beacon and identity-age rule" under the implementation plan.)

An attacker then has to register fake accounts before knowing where they will rank, which brings
them back to their population share.

#### The hub: counts and introductions, not lists

The hub never stores or serves anyone's nearby list. It keeps:

1. **Statistics:** total users, users online, and online counts per cell of a geographic pyramid
   (the existing quadtree levels). It counts verified heartbeats and does not keep identities for
   counting. A per-minute Bloom filter stops one key from being counted twice. The pyramid also
   feeds the map's density heat layer.
2. **Introductions:** a bounded, rotating sample of recent cards per pyramid cell (64 in the
   model). Newcomers start from it. In a sparse area the sample holds most of the people there,
   because the hub cannot introduce lone people it does not know exist.
3. **Connection setup** (WebRTC signalling), as today.

The current yellow dots (everyone else in view) are retired: they would need the hub to serve every
public point. The heat layer shows the crowd instead.

#### Finding how far to look: pyramid plus 3×3 cells

A list must reach farther when the area is sparse and stop sooner when it is dense, without walking
500 million squares and without missing a crowd just across a cell edge. A newcomer's first cards
come from the pyramid:

1. Start at the finest level (the privacy-floor square).
2. Look at the **3×3 block of cells around me** at that level, not just my own cell. Any point
   within one cell width of me is inside the block, whatever the cell edges.
3. Take a sample of cards from the block's cells.
4. If the block holds at least `C` people, stop. Otherwise go up one level and repeat.

The cost is at most about 24 levels × 9 counts, whatever the size of the world. A lone person in the
desert climbs until the block reaches the nearest city. A lone person 3 km from an arena, but in a
different cell, gets the arena from the first block that contains it. The cards then go through
ranking, and gossip fills in the rest.

#### When the search runs

The pyramid search is not repeated on every heartbeat. It runs only:

1. at first start;
2. when my public point changes: I travel to a point on the map, or my GPS moves to another square
   (past the existing 15 % edge hysteresis, §3.4);
3. when my list has emptied, for example after a long time offline.

Otherwise gossip keeps the list current, and newcomers find me through it: a newcomer, someone
who moved, and someone whose card changed (a new name, the traveler flag) swap with the **three
nearest** people at once, so a small group sees them right away rather than one period later. In a
dense area the
search does not climb at all: the first 3×3 block already holds `C` people, so it stops at the
finest level. Only sparse areas climb, and only once per location change.

**Places near me** use the same pyramid, with Place counts per cell instead of people. Places are
public descriptors the hub already holds (§4.2), so this is an ordinary hub query. The list looks
at the 3×3 block at the finest level and climbs only while the block holds fewer Places than the
list shows (the nearest few). In a city with many Places it never leaves the finest level. Entering
a Place does not run the people search; the Place's own sample seeds its member list.

#### Gossip

Every gossip period (30 s in the model), each phone swaps cards with one person from its list:

1. Pick a person at random from the list.
2. Send a compact digest of the cards I hold (for example a Bloom filter of keys and freshness).
3. Each side sends up to 32 cards: its own fresh card, then the cards the other is missing or holds a
   much older copy of, ranked the way the other would rank them.
4. Merge, verify signatures, keep the freshest copy, drop expired cards, keep the top `C`.

A card nobody refreshes expires after 30 periods (15 minutes). A swap that gets no answer is asked
once more at once (a link may still be opening), and a second silence removes that person; only a
newer card of theirs brings them back. A link that cannot be opened (a delivery gives up) is no
proof that someone left — under load or behind a strict NAT a live phone can fail to connect — so
it only triggers that swap; the mailbox carries their Talks meanwhile (implementation note,
2026-10-19: dropping people on link failures emptied six live lists under load). A knock carries
the knocker's card, so the person knocked has the knocker on their list before the link is up.
Gossip uses whatever link exists: Internet, LAN, Bluetooth or Wi-Fi Direct. Offline, the phones I
can reach are my list: a phone that cannot reach the hub posts its signed card on a **local board**,
a Gun channel per level-10 map cell (about 39 km) under `p2p-signal`, which every node keeps in
memory only. Offline its Gun is peered only with the phones it found over LAN or Wi-Fi Direct, so
only they read it; each reads its own cell and the eight around it, merges the cards like
introductions and swaps with anyone new at once. Back online it stops posting
(`nearby-v3-local.ts`, `GunNearbyLocalBoard`).

**Beyond `C`:** "Show more people here" asks people on my list for cards ranked by my order,
skipping the ones I already hold. It is orderly and repeatable, but not guaranteed complete.

#### Delivering a Talk broadcast

A broadcast is a loop over my list in rank order, not a fixed set of live links:

1. Open a connection to the next person (direct, or through a relay hop if direct fails).
2. Exchange compact inventories, so only Talks they do not already have are sent. A person who
   already exchanged my Talks gets nothing again.
3. Close the connection unless a conversation needs it, and move on.

The same loop carries Talks for people who are not on my list (a contact group, a chosen audience),
after the listed ones; an answer opens a link to the Talk's author the same way. After two failed
connects to a person the loop leaves them to the mailbox for 5 minutes.

There is no fixed `K`. Concurrency adapts to the network: start with a few at a time, add more while
connections succeed quickly, halve on timeouts. A full pass over 498 people at 1–2 s per connection
and 8 at a time takes about 1–2 minutes. That is background work, so the UI shows progress
("Sent to 120 of 498").

**Receiving needs its own limit.** A list's size bounds what a person *sends*. What they *receive*
is the number of lists they are on, which nothing bounds directly. The hash order keeps it near `C`
on average, but each phone still accepts at most a fixed number of concurrent incoming connections
and new Talks per minute, and tells the rest to retry later with backoff.

#### Fake accounts and reputation (criteria decided, mechanics open)

Signatures stop anyone forging another person's card, but nothing stops someone creating many
accounts. The simulation shows the public hash order keeps fakes to their population share
(10.1 % for 10 %). That is still too much if one person runs thousands of accounts in one place,
and fakes can always create Places and push Talks.

**Credit criteria (product decision 2026-10-18).** An account is *reputable* when all of these
hold. Every threshold is a signed-manifest value, so it can change without a new release; the
numbers are still to be chosen.

1. **Open reputation.** Credit is visible to others (`settings-credit-visible` on, that is
   `Reputation.isHidden !== true`).
2. **Enough activity:** at least a set number of Contacts, of Talks sent, and of answers in the Me
   tab (the Q&A history).
3. **Few blocks:** fewer than a set number of people block the account.

Only reputable accounts can **create a Place** or **back** one (rule 4, "Places in v3" below). The
same credit could later also limit fresh accounts in crowds (most dense-tie list slots for reputable
accounts, a small share for the rest); that is not decided.

**Who decides: the user's own app, never the server (product decision 2026-10-18).**

- **Each app checks its own user.** It counts Contacts, Talks and Me-tab answers on the device,
  reads its own block count, and opens **New Room** (or **Back this Place**) only when every rule
  passes. No server rules on whether someone may create a Place.
- **Settings → Credit is read-only.** It shows the user their own numbers and whether each rule
  passes. The user cannot edit them.
- **Block count.** When Adam blocks Eve, Adam's app adds one to Eve's block count; unblocking takes
  it back.
  - Adam knows whom he blocked. Eve sees only her number going up in Settings → Credit: she can
    guess who it was, but cannot prove it.
  - Block lists stay impossible to enumerate (`src/shared/block-pair.ts`). The count is stored
    without the blocker's identity; the existing pair hash lets it count each pair only once, so
    blocking, unblocking and blocking again cannot inflate it.
  - Adam's app sends the increment only if Adam is reputable himself, so a fake farm cannot push an
    honest person past the threshold.
- **Modified apps cannot be stopped.** The code is open, so anyone can build an app that skips the
  checks, and nothing in the network can prevent that. What the hub can do is decide what goes into
  **its own database**:
  - the hub registers a new Place (and counts a backing or a visit towards keeping it live) only
    when the request comes from a **genuine IinPublic app**, proven by the existing official-build
    credential (`src/shared/official-build-credential.ts`, Android key attestation, issued by
    `attestation-routes.ts`);
  - a Place the hub will not register is not listed or drawn for anyone else. Its creator can still
    share it directly.

  The identity design (`docs/IinPublic Identity & Key Architecture TODO.md` §16.6) allows requiring
  the credential for high-risk actions, and forbids adding official-build status to reputation.
  This rule is the first: it is not part of reputation, and community builds keep working for
  everything else.
- **Consequences to decide (deferred 2026-10-18; Android first):**
  - The website and the desktop apps have no platform attestation, so they cannot register Places
    unless another proof is found. Today the website can create Places.
  - Android key attestation fails on rooted phones, some custom ROMs and emulators.
  - iOS needs App Attest, which needs an Apple developer team (not set up).
- **Not prevented:** a genuine app on a farm of real phones, and real people who give their
  accounts to someone else. The thresholds and backing raise the cost; they do not make it
  impossible.

The thresholds must be chosen before v3 ships, because they decide who can create and keep Places.
These decisions are deferred (2026-10-18); work continues on the Android app first.

#### Map, list and headcounts

- **Map:** fits itself to the people on my list. Green dots are my list, ★ is me, the heat layer
  shows the crowd. An arena is one square with "498 of 10,000 here".
- **List:** "People near you" (my list), then "Show more people here". The overlapping Nearby
  groups ("Here · 2…") disappear. Places are listed as before.
- **Headcounts:** "498 near you · 12,345 online". The first number is my own list; the second is
  the hub's statistic. TechSupport stays a Contact and is never counted.

#### Places in v3

Places (§4) stay real rooms. They are how a business, an event or an interest group marks a spot on
the map and draws people in. The Place descriptor, pin, lifecycle and creation limits (§4.2) are
unchanged.

- **Entering a Place** switches my Talk audience from my nearby list to the Place's members, as
  today.
- **Members find each other the same way as Nearby**, scoped to the Place: the hub keeps the
  Place's headcount and a bounded sample of its members' cards, and members gossip cards tagged with
  the Place id. Inside a Place everyone is "at" the Place, so ranking is my hash order alone.
- **Up to `C` members:** everyone's list is everyone, so the Place behaves exactly like a shared
  room, including its chat feed (`chatrooms/<placeId>/messages`).
- **Above `C`:** each member sees their own 498, in their own order, and can page for more. A Place
  is **never full**. The v1 first-`C` seat claims, two-phase reservation and reconciliation losses,
  and the §4.1 cohort extension are no longer needed.
- **Creators have no powers**, as today.
- **Only reputable accounts create Places**, checked by the creator's own app, replacing the
  100-Contacts rule (§4.2; criteria under "Fake accounts and reputation"). The hub registers a
  Place only from a genuine IinPublic app.
- **Backed by other people (rule 4).** A new Place is not public until a set number of *other*
  reputable accounts back it by co-signing its descriptor within a set time (for example 7 days).
  Each backer's own app checks that its user is reputable, and the hub counts a backing only from a
  genuine app. Until then only the creator and people with its link see it. An unbacked Place
  expires.
- **Alive only while used.** A Place stays on the map and in lists only while enough distinct
  reputable people have entered it within the live window (§4.2 uses 30 days and "anyone"; v3
  counts distinct reputable visitors). Below that it disappears from the map and lists. Backing it
  again brings it back. Numbers are signed-manifest values, not yet chosen.

Nearby has no room id in v3, so Nearby has no shared chat feed; Talks and Contacts carry it.

**Implemented (2026-10-19).** A Place is a list scoped `place:<placeId>`:

- In a Place my card sits at the Place pin, snapped to the 1 km grid, so every member ranks the
  others by hash order alone (`position()` in `src/web/app/app.ts`). Entering a Place stashes my
  Nearby list; going back restores it (`NearbyV3Service.ensureList`).
- No seats: entering is a list switch plus a visit record (§4.2). The hub refuses roster calls
  for a Place (`PLACE_HAS_NO_ROSTER`); `place-admission-claims` and the `place-admission-evidence`
  module are gone.
- The hub counts Place-scoped card heartbeats. `placeCounts()` (the live cards there, or the
  window count for a crowd larger than the sample) feeds `GET /api/active-rooms`, and a card also
  marks the Place visited, which keeps it live. A Place empties in the list as soon as its people
  leave: the runtime notices a new scope or point within a second and reissues the card at once. The online total counts everyone once,
  whichever list they are on.
- The Place's chat feed (`chatrooms/<placeId>/messages`) is kept (`hasRoomChat`). A Place's
  headcount includes me; Nearby's does not. The room list shows "N people", never "Full", and
  "Sent to N of M" works in a Place too.
- A card that moves (into a Place, back to Nearby, to a new point) leaves the hub's old samples at
  once, so the hub stops introducing someone where they were.

#### What v3 removes

- the adaptive partition lineage, split and merge records and the server's partition store (§3.1);
- the cohort control plane (§3.3) and Place seat claims (§4);
- the Nearby part of `GET /api/active-rooms` and the map-presence index;
- the tournament `K`-link schedule for Nearby delivery.

#### Simulation results

`scripts/nearby-gossip-experiment.ts` (model `src/test/support/nearby-gossip-model.ts`), C = 498,
everyone arriving at once (the hardest start), 30 s gossip periods assumed. The model has no network
timing, NAT failures or connection cost.

- **Convergence:** lists reach 95 % of their true nearest-498 distance band in 1 round (498 people in
  one city), 4 (2,000), 8 (a 10,000-person arena), 7 (lone people across the US plus an arena) and
  5 (100,000 people in 40 cities plus a stadium): at most about 4 minutes.
- **Pyramid seeding is what makes lone people work.** With the 3×3-block pyramid, lone people across
  the US reach 95 % in 7 rounds. With a plain regional + worldwide sample they never get there in
  30 rounds, and 100,000 people need 22 rounds instead of 5.
- **Balance:** everyone is on 498 lists on average. The most-listed person is on 584 lists in the
  arena (1.2 × C), 795 in a 2,000-person city and 1,125 at 100,000 (2.3 × C): people at the centre
  of a crowd are nearest to more people. That is why receiving needs its own limit.
- **Data:** about 64 cards sent per person per gossip period, about 1.9 MB per hour at 250 bytes per
  card, versus up to 1.7 GB per hour for the current v2 heartbeat once rooms split.
- **Public vs secret order:** the same distance quality, but a public order lets partners send
  exactly the cards I would keep. With a secret order, the arena's exact first page is only 34 %
  found after 30 rounds (99 % with the public order).
- **Fake accounts:** 10 % fake accounts that pass on no honest cards and push only each other end up
  with 10.1 % of honest lists under the public order (their fair share; honest recall 99 %), but
  29 % under the secret order, which cannot target. Grinding keys against one victim is not
  modelled; the daily beacon and identity-age rule above are the defence.
- **Churn:** after 20 % leave without a goodbye and as many arrive, newcomers reach 84–90 % within
  20 rounds. Departed people's cards hold about 16 % of slots until they expire at 15 minutes. A
  shorter card lifetime starved the lists (they could not keep 498 fresh cards by gossip alone), so
  the broadcast loop's failed contacts are what clear them in practice.

Results: `docs/testing/nearby-gossip-experiment.md`. Unit gate:
`src/test/unit/nearby-gossip-personal-lists.test.ts`.

#### Implementation plan (2026-10-19)

Android first. Each phase lands with unit tests; phases 3–6 also with phone-path journeys and a
real-phone run.

1. **Core and hub — done (2026-10-19).**
   - Shared: `nearby-v3-config.ts` (C and every tunable from the manifest, `extensions['nearby-v3']`),
     `nearby-v3-card.ts` (signed cards), `nearby-v3-ranking.ts` (distance, then
     `hash(viewer, member, beacon)`), `nearby-v3-pyramid.ts` (cells, 3×3 blocks, the climb),
     `nearby-v3-list.ts` (the list, digests, gossip offers), `nearby-v3-gossip.ts` (swap messages).
   - Hub: `NearbyV3Hub` (`src/server/services/nearby-v3-hub.ts`) with `POST /api/nearby/v3/card`,
     `POST /api/nearby/v3/introductions` and `GET /api/nearby/v3/stats`; phones forward these to
     the hub.
   - Phone: `NearbyV3Service` (`src/web/services/nearby-v3-service.ts`): card reissue and heartbeat,
     introductions only on start / move / empty list, one swap per period, a silent person leaves
     the list, the incoming limit, the list saved across restarts. Not wired into the app yet.
   - Tests: `nearby-v3-core`, `nearby-v3-hub` (includes 300 people converging on the real modules)
     and `nearby-v3-service`.
2. **Peer link — done (2026-10-19).** A person on my list can reach me even when I am not on
   theirs: a signed knock (`nearby-v3-knock.ts`) on my own signalling channel asks me to open the
   pair's link, subject to my incoming limit (`NearbyKnockGate`). A block stops Talks only (both
   sides filter them), never card gossip or knocks: otherwise the blocker would vanish from the
   blocked person's list at the moment of the block and give himself away. Gossip rides the
   mesh as one-hop `nearby-gossip` frames. Journey `phone-path/08`.
   A knock goes two ways (2026-10-19): on Gun's `p2p-signal`, which reaches phones on the same
   LAN, and through the hub's knock mailbox (`POST /api/nearby/v3/knocks`, read by a long poll on
   `GET /api/nearby/v3/knocks/<channel>`; `nearby-knock-mailbox.ts`). A phone's embedded node
   reaches the hub over HTTP only, so before the mailbox no knock ever crossed between two phones;
   it went unnoticed while both sides had each other's card. The hub verifies each knock, keeps at
   most 32 per recipient for one minute, in memory only.
3. **Broadcast loop and the app's Nearby (in progress).** Nearby is the local scope
   `NEARBY_V3_ROOM_ID` (`nearby-v3`): its members are my list, the hub keeps no roster for it, and
   it has no chat. The app's mesh runs in personal mode there: links open only to pinned peers and
   to people with queued Talks, in list order, as many at a time as the adaptive limit allows
   (grows per delivered Talk, halves on a failed link); a link knocks when it opens; a person
   whose link fails twice after the knock grace leaves the list. A newcomer swaps with the nearest
   person at once, and an empty list asks the hub again every 5 s, doubling. Still to do:
   "Sent to N of M".
4. **UI — done (2026-10-19).** Map: green dots for my list, ★ for me, the heat layer from
   `GET /api/nearby/v3/stats`, fitted to me and my list; no yellow dots, no tile grid. List: the
   Nearby row is "People near you"; its open list ends with "Show more people here" (one more page
   of `C`, filled by swaps with three people on my list; a move goes back to `C`). Headcounts:
   "N near you · M online" — N is my list without me, M the hub's count; the room-list header uses
   M too. A Nearby broadcast shows "Sent to N of M" under the Nearby row, counting delivery acks.
   Nearby has no chat feed. Web e2e `stage2-two-user/95-nearby-screens`.
5. **Places on lists.** Place-scoped cards, the hub's per-Place sample, chat kept for Places;
   seat claims and cohorts go.
6. **Removal of v2 — done (2026-10-19)** (no epoch switch, no compatibility): the partition
   lineage, cohort control plane and its mesh frame, control presence, micro-rooms, capacity splits
   and evictions, room routing, map presence and the Nearby part of the room list (now Places
   only), with their server stores, routes and tests (unit and web e2e). The map's people layer
   already draws the list (green dots, ★ me) and the hub's heat; the tile grid and travel by map
   point remain until step 4. Found and fixed on the way (each with a unit test): renamed cards
   and knock cards reach peers at once, announcing to the three nearest, swap retry and a 15 s
   swap timeout (WebRTC alone may take 10 s), link failures probe instead of dropping, stale knocks
   (sent while I was away) no longer stop a returning phone from knocking back, a knock restarts a
   stale session, the broadcast loop and answers reach people outside the list.

Daily beacon and identity-age rule — done (2026-10-20). The hub has an attestor key
(`NearbyAttestor`, `src/server/services/nearby-attestor.ts`; key and seed in
`nearby-attestor-<port>/key.json`, created on first start). It signs:

- each UTC day's **beacon**, `HMAC(seed, day)`: nobody can predict it before the day starts, and it
  is the same after a restart (`GET /api/nearby/v3/beacon`, and in every heartbeat answer);
- per key, an **age proof**: the UTC day the hub first saw a card for that key. The hub keeps
  `<day> <sha256(pub)>` lines in `first-seen.log`, never the keys. The proof comes back with each
  heartbeat; the phone signs it into its next card (`NearbyCard.age`), so nobody can strip it.

Ranking (`nearby-v3-ranking.ts`) is distance, then **keys the hub saw before today first**, then
`hash(viewer, member, beacon)`. A key ground today against today's beacon is new today, so in a
dense tie it ranks behind everyone who already existed. Shared code: `nearby-v3-attestation.ts`.

- A phone learns the attestor key from its hub and keeps it. A signed manifest may pin the accepted
  keys (`extensions['nearby-v3'].attestorKeys`); then a phone accepts no other.
- Swaps carry the sender's beacon, so phones that cannot reach the hub still agree on the day's
  order; a beacon is taken only if it verifies and is for today.
- Without today's beacon a phone falls back to the UTC date; without a verifiable age proof a card
  counts as new. Both only weaken the defence, never break a list.

Not done: pinning the production attestor key in a signed manifest (an operator release step), and
the credit rules for fake accounts (deferred, above).

#### Open questions before implementation

- Real connection cost per contact over mobile data (Wi-Fi and offline Wi-Fi Direct measured
  2026-10-20: ~4 s per contact one at a time, ~2.5 s for the receiver to accept a Talk).
- (Settled 2026-10-20: incoming limits — 8 connections and 24 new Talks a minute from people who are
  not contacts; an offer over the limit goes unanswered and the sender retries. Manifest values.)
- The credit model for fake accounts (above).
- Whether 30 s gossip periods are affordable on battery; the model counts cards, not radio time.
- (Settled: no migration. There is no official release yet, so v3 replaced v2 outright.)

## 4. Place rooms and map travel

Any user may publish an immutable, signed, content-addressed Place descriptor containing a display
name, type, description, public map point, creator public key, and creation time. The signature
proves provenance only. It does not prove a trademark or business claim and grants no ownership,
moderation, reserved seat, rename, deletion, or admission power. The UI labels these rooms
**Community-created**. Who may create one, how many may exist, and when an unused one disappears
are in §4.2.

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

> **Superseded by "Places in v3" (§3.7, implemented 2026-10-19).** A Place is never full: the
> first-`C` seat claims, two-phase reservations, partition reconciliation and the "Nearby around a
> full Place" offer below were removed. The rest of this section is kept as history.

Place rooms also use `C`. They do not subdivide by the visitors' physical locations because remote
visitors deliberately chose the same destination. The initial simple rule is: when a Place is full,
do not create visible `_part_N` rooms; keep the entrant in their current room and offer the Nearby
room around that point. This remains the complete rule for the current v1 Place-admission protocol
and for clients that cannot verify the later cohort extension.

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

### 4.1 Decision: one visible Place may contain visitable exchange cohorts

**Accepted product direction, staged behind a new signed protocol version:** a sufficiently busy
Place may contain several invisible exchange cohorts. The Place remains one immutable descriptor,
one map pin, and one deliberate destination. Cohorts are runtime capacity scopes, not child Places,
map regions, owner-created rooms, or attributes stored in the Place descriptor. The global signed
protocol manifest enables the behavior for all Places; the creator cannot enable, disable, name,
moderate, reserve, or choose a cohort.

This extension exists for large restaurants, conferences, festivals, and stadiums where rejecting
everyone after the first `C` would make the Place increasingly useless. It does not promise that
every visitor at the Place can be reached at once. Its promise is narrower: a visitor can meet one
capacity-bounded group at a time and deliberately visit other groups over time. The current v1
first-`C` admission, creator equality, expiring claims, deterministic partition reconciliation,
and **Nearby around _Place name_** fallback remain unchanged until a client and index both verify
the new manifest and cohort evidence.

#### Audience and movement semantics

- The **active Place cohort**, not the aggregate Place, is the Talk audience. A sender offers Talks
  only to the at-most-`C` people in that cohort. There is no Place-wide broadcast, aggregate roster,
  automatic cross-cohort forwarding, or third-person relay.
- A visitor has at most one active stranger audience and one active Place cohort under a stable
  signing identity. Joining a Place still stops Nearby first. Changing cohorts keeps the same Place,
  public pin, traveler state, and location disclosure; it changes only the eligible stranger set.
- A stable identity and immutable cohort epoch determine the visitor's default cohort and a
  repeat-avoiding order for alternatives. The default provides a predictable return point, not a
  permanent assignment. **Meet another group at this place** visits one available cohort;
  **Return to my default group** attempts the identity-derived default.
- Movement uses the same safety shape as current Place entry: reserve a target seat, stop the old
  cohort, commit the target, and release the old claim. A full, stale, offline, or unverifiable
  target leaves the old cohort active. A reservation is not presence and exchanges no Talks.
- The sender may re-offer their own eligible Talks after entering another cohort according to the
  ordinary Talk rules. The client does not carry other people's Talks, answers, rosters, or
  conversations between cohorts. Previously received owner-private data remains local.
- Cohort capacity is the same global `C`; direct simultaneous connections remain bounded separately
  by global `K`. Aggregate Place attendance may exceed `C`, but it does not become one P2P mesh.

Place cohorts are not geographic. They must never inspect visitor GPS, change the Place pin, draw a
smaller map area, or imply physical proximity within the Place. They also must not reuse Nearby's
geographic replacement records. A Place-specific, versioned control record derives opaque cohort
IDs from the Place CID, policy epoch, and an immutable transition seed. New cohorts may be opened
only from bounded, verified occupancy/headroom evidence under the global policy, not by the Place
creator or an unsigned client request. An experimental target occupancy below hard `C` may preserve
switching headroom, but `C` is always the fail-closed ceiling.

#### Signed seat claims and convergence

The existing v1 claim remains valid only for the legacy single Place audience and is not silently
reinterpreted. A future Place-cohort claim must bind at least:

```text
protocol/policy version + Place CID + opaque cohort ID + cohort epoch
stable public identity + user handle + global C
selection generation + previous-selection claim hash
stable cohort-entry time + observation time + expiry
```

The selection generation and previous-claim link let indexes converge on one active cohort for one
signing key. On reconnect, the highest valid linked generation wins; a same-generation fork uses a
content-hash tie-breaker and is abuse evidence. Superseded claims consume no seat. Within each
cohort, the current ownerless rule remains: deduplicate by stable public key, verify freshness and
scope, order by stable cohort-entry time with a content-derived tie-breaker, and retain the first
`C`. Merge order must not affect either the active-cohort choice or the winner set.

Two indexes separated by a network partition can still admit temporarily conflicting occupants.
Reconciliation is eventual, just as it is for current Place admission. A confirmed loser is removed
on heartbeat and may try another verified Place cohort; if none can be verified, the existing
Contacts-only state and **Meet people around _Place name_** option remain the safe fallback. A
failed switch never converts the old committed seat into a reconciliation loss merely because the
target reservation failed.

#### Presentation

List and map view continue to show one Place card and one pin. They never expose cohort IDs,
numbers, a tree, `_part_N`, or overlapping pins. When verified aggregate control data is available,
the Place may say, for example, **1,240 people · 3 groups**. This is a bounded, possibly stale
summary, not a downloadable aggregate roster. The current-group card says **Meeting one group at
_Place name_** and shows that cohort's headcount and `C` ceiling.

The Place-specific actions are **Meet another group at this place**, **Return to my default group**,
and the existing **Meet people around _Place name_**. The first two stay inside the named Place;
the last leaves it for Nearby at the public pin. Wording must explain that changing groups does not
change or refine location. A legacy or unverifiable full Place keeps the current simple message and
Nearby fallback instead of advertising cohorts it cannot safely enter.

#### Abuse and resource limits

- Cohort hopping intentionally lets a person meet more than `C` visitors over time; it is not a
  privacy or moderation boundary. Apply a signed-manifest cooldown/backoff and bounded recent-visit
  history so one client cannot enumerate every cohort continuously or create radio churn.
- Stable-key deduplication prevents aliases under one key from consuming multiple seats, but keys
  are cheap. Cohort claims do not prove one human, honest clocks, physical presence, or resistance
  to Sybil seat exhaustion. The UI and capacity experiments must not claim otherwise.
- Cohort creation and aggregate summaries are bounded by verified live claims, expiration, a
  protocol maximum cohort count, and garbage collection after a stable empty dwell. Clients fetch
  summaries and the active cohort roster only, never every cohort roster.
- A Place remains ownerless. Cohorts add no moderator, trademark enforcement, creator priority, or
  power to exclude a participant. Blocking and Contacts-only policy continue to apply per user.

#### Mixed-release migration

The original Place room ID becomes the **legacy cohort** during migration. V1 clients continue to
use its unchanged signed claims, first-`C` winner rule, and full-room Nearby fallback. They neither
parse nor advertise additional cohorts. A capable client enters cohort mode only when the signed
manifest, index, and client all support the Place-cohort version; otherwise it behaves exactly as
v1. New cohort room IDs use a separate namespace so an old client cannot mistake one for a Place
descriptor or join it without verifying its transition.

V2 clients may treat the legacy cohort as one eligible cohort, subject to its existing `C`, but
must not evict or silently redistribute its v1 occupants merely to balance newer cohorts. No Talk,
answer, or conversation history migrates between cohorts. The global release policy may stop new
v1 admissions only after the normal signed mixed-release retirement process; cohort support is not
a per-Place flag and requires no descriptor rewrite.

#### Acceptance criteria for implementation

1. Before activation, a Place with at most `C` visitors behaves exactly as v1. After activation,
   low occupancy remains one cohort; creators and ordinary visitors receive identical admission
   priority in either version.
2. Under the cohort protocol, 10,000 simulated visitors produce bounded opaque cohorts, every
   active cohort remains at or below `C`, and no client downloads the aggregate roster.
3. Two indexes given the same signed claims in different orders converge on one cohort per stable
   key and the same at-most-`C` winner set per cohort; expired, forked, tampered, and wrong-policy
   claims fail closed.
4. A successful visit performs reserve/stop/commit/release and exposes exactly one active stranger
   audience. Full, offline, expired, or unverifiable targets leave the old cohort and Talk audience
   unchanged.
5. Talks reach only the active cohort. Switching neither rebroadcasts third-party content nor
   reveals or refines the visitor's location.
6. One Place card and pin represent all cohorts. UI and accessibility tests distinguish switching
   Place cohorts, entering Nearby at the pin, and returning home without exposing internal IDs.
7. V1 clients retain the legacy first-`C` behavior and Nearby fallback in a mixed release; v2-only
   records cannot be accepted as v1 claims or downgrade the signed global policy.
8. Churn, expiration, partition/reconnect, rapid-switch abuse, cohort garbage collection, and the
   separate `C`/`K` limits pass automated scale tests before the feature is enabled in production.

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

### 4.2 Place lifecycle and creation limits (product decision 2026-10-13)

An empty Place must stay reachable, but anyone can create one, so unused Places must not pile up.

> **v3 proposal (§3.7):** only reputable accounts create Places (checked by their own app), a Place
> goes public only once other reputable accounts back it, and it stays live only while enough
> distinct reputable people use it. The hub registers Places, backings and visits only from genuine
> IinPublic apps (official-build credential).

- **Live Places.** A Place is *live* while someone is in it or someone entered it in the last
  30 days (`PLACE_LIVE_WINDOW_MS`). Its `lastActiveAt` starts when the hub accepts it (the signed
  creation time is the creator's own claim, so a backdated one cannot dodge the limits) and moves
  forward on each entry or heartbeat the hub sees, written at most once an hour per Place. Only live Places
  are listed and drawn. An expired Place is not deleted: its creator still sees it, a direct link
  still opens it, and entering it makes it live again.
- **Map.** The map draws every live Place in view. An empty one is dimmed with "0" and is drawn only
  from city zoom (about 9) inward; farther out, Places group into clusters as before.
- **List.** Rooms with people come first (§3.6); then **Places near you** lists the nearest five
  empty live Places.
- **Who may create.** A user needs at least 100 Contacts (`PLACE_CREATE_MIN_CONTACTS`; 3 in local
  debug builds and Android debug APKs) before **New Room** opens the form. Contacts are private and
  SEA-encrypted, so only the user's own app can count them; this is an app-side rule, not one the
  hub can enforce.
- **How many.** The hub refuses a new Place when:
  - the creator's key already has a live Place (one per person) — `PLACE_CREATOR_LIMIT`;
  - a live Place with the same name (ignoring case and spacing) is in the same ~1 km cell — the
    app offers to join that one instead — `PLACE_NAME_TAKEN`;
  - the cell already has five live Places (`MAX_LIVE_PLACES_PER_CELL`) — `PLACE_CELL_FULL`.

  A device-wide limit is not enforced: the hub cannot tell devices apart.
- **Trademarks.** The creation form reminds the user that names and descriptions must respect
  trademark and other laws, and that a Place grants no business claim.
- **After creating.** The creator enters the new Place at once, so it starts with one person.
- **Phones.** An embedded phone server publishes the new Place at the hub first and saves it locally
  only after the hub accepts it; if the hub is unreachable, creation fails. Phones list the hub's
  Places together with their own.

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
place-cohort-index/<policyVersion>/<placeCID>/<transitionId>/signed-cohort-control
place-cohort-selections/<placeHash>/<identityHash>/<selectionHash>/signed-selection
place-cohort-admission-claims/<placeHash>/<cohortHash>/<identityHash>/signed-expiring-seat-claim
public/protocol-manifests/<sequence>/signed-manifest
```

The three `place-cohort-*` paths are reserved for the accepted, not-yet-enabled v2 extension in
section 4.1. V1 clients neither read nor write them. Implementations must bound selection history,
cohort summaries, and expired claims; listing a Place must never require walking all three graphs.

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
