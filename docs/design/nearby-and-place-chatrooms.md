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
