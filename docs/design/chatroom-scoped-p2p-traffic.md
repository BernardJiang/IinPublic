# Chatroom-Scoped P2P Traffic and Nearby Connectivity

Status: **partially superseded 2026-10-08** by `nearby-and-place-chatrooms.md`
Tracking: `OPEN-37`
Related: Technical Specification §3.3 and §23; `OPEN-36`; `docs/protocol/connectivity-v1.md`

> The one-active-room, global `C`, local `K`, safe-switch, and same-room authorization decisions
> remain authoritative. Global/tree navigation, FIFO geographic overflow, room-wide gossip, and
> forwarding enabled by default do not; the replacement uses Nearby geographic subdivision, map
> Places, and direct encrypted author-to-receiver Talk delivery.

## Decision

Chatrooms are the primary traffic partitions of IinPublic, not merely labels or UI groupings.
Every signed-in device has exactly one **active exchange room** at a time. Peer discovery, new
peer-link establishment, room presence, Talk announcements, Talk inventory reconciliation, and
gossip are restricted to that room.

Capacity is one **global protocol parameter** applied uniformly to every room. It is not stored in
room metadata and cannot be changed by a room creator, business, transport, or local peer. The
current production-release value is `C = 498`; experiments may override it only in an isolated
development/test network. A future change is a protocol-epoch transition, not a room-policy
update.

Creating a room grants no continuing authority. The creator is merely the first ordinary
participant and is subject to the same admission, FIFO eviction, blocking, and departure rules as
everyone else. A restaurant employee who publishes a restaurant room can later be evicted from
that room when it is full. IinPublic has no room owner, moderator, privileged member, or
creator-reserved seat.

Any user may publish a user-defined room descriptor. The P2P protocol does not adjudicate
trademarks, reserve human-readable names, or prove that a creator represents a named business.
Several room IDs may therefore use the same display name. The UI must distinguish them by stable
cryptographic room ID and may show local trust or identity evidence, but it must not present the
creator as the room's controller.

A user may belong to or remember several rooms, but inactive memberships do not create live
discovery subscriptions, background radio advertisements, peer connections, or Talk traffic. To
reach a different population, the user deliberately switches rooms. Reach therefore expands over
time under user control instead of multiplying in the background.

Existing contacts and direct conversations are not room broadcasts. They may reconnect on demand
when a message is pending or the user opens the conversation, but IinPublic must not keep a live
connection to every contact merely because the contact exists.

## Why this is necessary

One million online users contain:

```text
1,000,000 × 999,999 / 2 = 499,999,500,000 possible peer pairs
```

Attempting global discovery or pair establishment is impossible and would expose an unnecessary
global presence graph. A room capacity alone changes the candidate population from one million to
at most `C`, but a full mesh inside a 1,000-person room would still contain 499,500 pairs. The
design therefore uses two independent bounds:

1. **Global room capacity `C`** bounds who may discover and exchange with whom in every room. The
   current production value is `C = 498` active participants.
2. **Neighbor limit `K`** bounds actual live peer links per device. The initial target is
   `K = 8–16`, selected from current-room candidates.

At one million simultaneous users and `C = 498`, the population is divided into at least 2,009
room overlays. With `K = 12`, each device maintains at most 12 room-neighbor links instead of
999,999. A symmetric overlay has roughly six million undirected links across the entire
distributed population, never concentrated in one process, instead of roughly 500 billion
possible pair links. Per-device connection cost is `O(K)`; room gossip cost is `O(CK)` rather
than `O(C²)`.

These figures are bounds and planning targets, not a claim that one relay, LAN, or Wi-Fi Direct
group can carry the entire population. Physical transports remain smaller, replaceable paths
under the logical room overlay.

## Room semantics

### Membership, navigation, and active exchange are different

- **Known room:** a room shown in the hierarchy, map, history, or saved list.
- **Membership:** authorization and metadata that allow the user to enter a room.
- **Active exchange room:** the only room currently allowed to drive discovery and Talk traffic.
- **Direct conversation:** an on-demand pair channel independent of room broadcasting.

The Global node and oversized parent location nodes become navigation and discovery directories
when their active population exceeds capacity. They must not expose a million-member live roster
or form a global mesh. The user enters an eligible child location, business, event, or custom room
before exchanging Talks.

Confirmed automatic location selects the smallest blurred GPS-grid room as the default active
exchange room. It must not silently activate several overlapping location levels. Parent, child,
nearby business, saved, and travelled rooms are not simultaneously active. The user may manually
select a different room; a placeholder location must never select a false grid.

### Capacity behavior

- Every room uses the same capacity `C` from the active global protocol epoch. Room data
  contains no capacity override.
- Compatible app releases use the same global epoch. An app that cannot validate or implement the
  active epoch must update rather than operate a conflicting capacity under the same network ID.
- Each client evaluates admission before publishing its current-room presence or accepting a
  candidate into its active set.
- An over-capacity room is split into finer child rooms where the hierarchy permits it.
- The client receives bounded child-room choices; it never downloads the complete parent roster.
- Presence from the same identity or its linked devices is deduplicated during deterministic
  active-set selection; linked installations do not receive extra room positions.
- Switching rooms is explicit. IinPublic may suggest a switch but does not silently broaden reach.

The existing FIFO/room-split product rules remain separate admission-algorithm concerns. Whatever
algorithm is chosen, it must use the same global `C` and preserve the bound presented to peer
discovery. FIFO gives the creator no protection: if the creator is the longest-staying active
participant when a new participant is admitted to a full room, the creator is evicted.

### Coordinator-free enforcement limit

No room participant is entitled to issue admission proofs or an authoritative roster. Each client
publishes its own signed, expiring presence and independently validates the current room view.
Without a coordinator or a consensus protocol, network partitions mean peers can temporarily see
different join sets and cannot guarantee one instantaneous, globally exact FIFO order. Therefore:

- `K` is a hard local safety bound: a client never maintains more than its allowed automatic
  neighbors.
- `C` is a hard local candidate/active-set bound and an eventual room convergence rule: a client
  never admits more than `C` current-room candidates, and peers with the same signed events and
  protocol epoch deterministically converge on the same set.
- A disconnected partition may temporarily contain another set of up to `C`. When partitions
  merge, duplicate/stale presence expires and the deterministic admission rule converges.
- Exact global `C` and exact global FIFO during a partition would require a coordinator or
  distributed consensus. This design deliberately does not disguise either as room ownership.

Scale safety depends on the per-device `C` and `K` bounds, so a temporary partition cannot cause a
device to discover one million users even when the global room view has not converged.

### Changing capacity from 498 to 1000

The room ID and room descriptor do not change. Increasing the global capacity does not create a
new room and does not evict anyone: the existing active set remains eligible and 502 additional
positions become available. Previously evicted users are not silently restored or given priority;
they may enter again under the normal rule. A creator receives no special treatment.

A release must not simply hard-code `1000` and continue meshing with clients that enforce `498`.
Those clients would disagree about positions 499–1000 and about FIFO eviction. Every production
release instead contains a small, generic **protocol-manifest engine** and pins the public
verification key authorized for the next release. The corresponding private key is kept offline
and is never compiled into or distributed with an application.

An authorized manifest is content-addressed and contains at least:

```text
networkId, sequence, previousManifestHash,
protocolEpoch, effectiveAt, minimumManifestEngine,
minimumRoomProtocol, chatroomCapacity,
requiredCapabilities, optionalCapabilities,
legacyEpochAllowedUntil, retirementMode,
nextReleasePublicKey(s), recoveryKeyPolicy,
signatureAlgorithm, signature
```

Release `N+1` carries a manifest signed offline by the next-release private key whose public half
was pinned by release `N`. That manifest commits the public key for release `N+2`. Any peer may
relay the public manifest chain; relaying it grants no authority because every recipient verifies
the signatures and hashes locally.

A release bundles the public signed manifests needed to reach it from the oldest release it still
expects to encounter. It does not bundle historical private keys. For example, release 3 can send
`M2` and `M3` to release 1: release 1 verifies `M2` with its pinned `K2.public`, learns
`K3.public` from `M2`, and then verifies `M3`. Applications may skip installation versions, but
verification never skips a manifest link. The receiver requests the complete suffix after its
stored checkpoint; the newer peer must not hide an incompatible manifest or supply a tailored,
downgraded policy merely because the receiver is old.

Before exchanging room presence or Talks, peers exchange their latest manifest sequence and hash:

1. A newer peer sends any missing manifests. The older client validates the chain starting at its
   pinned next-release public key, checks `networkId`, monotonic sequence, previous hash, activation
   time, engine compatibility, and locally compiled safety bounds, then persists the checkpoint.
2. During the distribution grace period, both releases continue epoch 1 with `C = 498`, while
   peers gossip the signed epoch-2 manifest.
3. At `effectiveAt`, every compatible client that has the manifest changes to epoch 2 with
   `C = 1000`. The active set is retained and 502 additional positions open.
4. A client encountering epoch 2 after being offline first obtains and verifies the manifest chain,
   applies it, and only then exchanges room traffic. It does not need a whole-app update when its
   existing manifest engine supports the parameter and safety range.
5. If the manifest requires newer executable behavior, exceeds the client's compiled safety
   bounds, or names a newer manifest-engine version, the client verifies that the update is
   authentic but fails closed for room exchange and asks the user to update the application.

### Compatibility behavior that must exist in release 1

The first production release does not need to predict release 10's features. It does need to ship
the permanent evolution rules that let it classify a future signed manifest:

- **Parameter-only change:** if the existing engine understands the field and its locally compiled
  safety range, apply it at activation without reinstalling.
- **Optional capability:** advertise supported capability IDs and use only the intersection allowed
  by the active manifest. Unknown optional features are ignored without changing core semantics.
- **Mandatory capability or newer room protocol:** continue validating and relaying the manifest
  control plane, but stop room discovery, presence, and Talk exchange; show Update required.
- **Explicit retirement:** after an authenticated cutoff, disable network participation for the
  retired epoch. Never erase or lock local data: Settings, export, identity recovery, and software
  update remain available.
- **Unknown field marked critical:** fail closed. Unknown non-critical fields may be retained and
  relayed unchanged.

At release 10, a manifest can therefore declare a higher `minimumRoomProtocol` or a required
capability that release 1 does not have. Release 1 does not need to understand the new feature; it
only needs to understand that the requirement is mandatory. It verifies the chain through `M10`,
enters local-only/update-required mode, and does not interpret release-10 room traffic as if it
were old traffic. The manifest engine remains usable even when the room data plane is retired so
the client can verify recovery, replacement, or update information.

An isolated release-1 population cannot know that release 10 exists until it receives the signed
chain. There are only two honest choices for the first release:

1. **Perpetual legacy availability (recommended):** old isolated peers can continue their legacy
   overlay. They stop current-network exchange as soon as they encounter and verify the retirement
   manifest.
2. **Renewable protocol lease:** release 1 contains an expiry and disables room exchange unless it
   periodically receives a newer signed authorization manifest, which peers may relay. This can
   guarantee eventual retirement by date, but it deliberately sacrifices indefinite offline use
   and can stop valid users whose devices remain isolated.

Release 1 chooses **perpetual legacy availability**. It has no local protocol lease. An isolated
release-1 population may continue its legacy overlay, but stops current-network room exchange as
soon as it receives and verifies a manifest that retires its epoch. A later manifest cannot make an
already-isolated client aware of that cutoff until an authenticated chain reaches it.

Clients persist the highest accepted sequence and manifest hash, reject rollback, and fail closed
on two different valid manifests for the same sequence instead of choosing whichever number is
higher. The normal next-release key should be one-time and rotated in every manifest. Because one
lost or compromised next key must not permanently strand the network, each release also pins a
separate threshold recovery policy (for example, two of three offline recovery public keys) that
can revoke/replace the next key. Ordinary release signing and recovery keys must be stored
separately.

This authenticates the **authorized protocol manifest**, not the remote application's binary. A
modified client can replay a valid public manifest or claim its epoch, so every honest client must
still validate presence, capacity, signatures, and messages rather than trust a version string.
Proving the exact binary running on another phone would require platform remote attestation and an
online trust service, which is a different, less decentralized design.

An isolated group of old clients that has never encountered the new signed manifest can continue
temporarily at 498. Once any compatible peer brings the chain, they converge without contacting a
central server. After epoch-2 activation, clients that refuse or cannot apply the valid manifest
remain a legacy fork and are not bridged into epoch-2 room broadcasts. Existing direct contacts
may still communicate through a separately compatible pair protocol.

## Discovery and connection lifecycle

### Entering a room

1. Persist the intended room and publish or validate signed, expiring active-room presence under
   the current global protocol epoch.
2. Stop advertising and discovering the old room.
3. Stop old room-gossip subscriptions and gracefully close old room-only neighbor links.
4. Keep durable Talk queues, receipts, seen-message IDs, and direct conversations; a room switch
   must not lose work.
5. Start Internet roster/rendezvous, LAN NSD, BLE presence, Wi-Fi Aware, and Wi-Fi Direct discovery
   for the new room only, subject to platform capability and the user's connectivity settings.
6. Select at most `K` authenticated neighbors and reconcile compact Talk inventories.

The switch is a state transition, not two simultaneous memberships. If startup of the new room
fails, the client remains visibly disconnected from room exchange rather than silently restoring
the old room and broadening traffic.

### Room-scoped discovery tokens

Raw room IDs, exact coordinates, user IDs, stage names, and SEA public keys must not be placed in
BLE advertisements or public Wi-Fi discovery records. Each transport advertises a short-lived,
opaque room rendezvous token derived from an authorized active-room capability. The token rotates
regularly and expires with active-room presence.

A radio sighting is only a discovery hint. Before a candidate becomes a mesh neighbor, both sides
must prove:

- valid signed current-room presence for the same room and global protocol epoch;
- control of their SEA identity and advertised transport binding; and
- compliance with block, rate, capacity, and protocol-version checks.

Candidates from another room are discarded before connection negotiation. The common candidate
contract's `roomIds`/room-scope field must be populated and verified; an empty room scope is not
eligible for automatic room-mesh connection.

### Sparse overlay

The room mesh never tries to connect every pair. Neighbor selection should balance stability,
latency, transport cost, device capability, and overlay diversity. Gossip uses bounded fanout,
hop TTL, message IDs, a seen set, backpressure, and rate limits. Talk bodies are pulled only after
the receiver accepts metadata through its intake policy.

The roster and discovery services return candidates in bounded pages or samples. They do not make
all `C` members simultaneously negotiate with a newly arrived peer. Connection churn must use
jitter and exponential backoff.

## Talks, inventories, and switching rooms

- A Talk broadcast is stamped with the author's active room, global protocol epoch, and accepted
  manifest sequence/hash at announcement time. A receiver missing that checkpoint synchronizes
  and verifies the manifest chain before processing the room announcement.
- The same signed Talk object keeps a stable object ID across Internet, LAN, Wi-Fi Aware, and
  Wi-Fi Direct paths; multipath arrival is deduplicated.
- Peers exchange compact inventory/checkpoint summaries and request only missing accepted objects.
- Pending room broadcasts remain associated with their originating room. Switching rooms does not
  rebroadcast them into the new room.
- A user who wants to reach another population switches to that room and deliberately broadcasts
  there. The UI should make the current audience unmistakable before sending.
- Responses and resulting one-to-one conversations may continue after either user leaves the
  original room because they are pair-private traffic, not continued room reach.

## Transport policy beneath the room

Chatrooms decide **who is eligible**. The route manager decides **how eligible peers communicate**.
It may keep redundant paths available while selecting one path for each delivery:

1. Reuse an existing healthy, unmetered path.
2. Prefer a same-LAN direct route when available.
3. Use Wi-Fi Aware or Wi-Fi Direct when a local path is needed and supported.
4. Use unmetered Internet.
5. Use a metered Internet route only under the user's saved policy.

Path changes never change the room, identity, Talk ID, authorization, or receipt semantics.
Wi-Fi Direct is a cluster transport, not the room itself: one room may contain several Direct
groups connected by sparse authenticated bridge peers, and hardware client limits remain lower
than logical room capacity.

Wi-Fi Direct group credentials must be generated per room session/epoch and rotated. The radio
record carries only a short rotating room correlation prefix; a client derives the full credential
from its active room scope and still requires signed same-room SEA presence before processing room
data. An open public room's transport credential is not an authorization boundary—a modified app
may know the room—so every message remains locally authenticated and room-scoped. The user's
ordinary home/work Wi-Fi SSID and password are never requested or shared.

BLE remains discovery/control-plane only. It is not a bulk Talk transport.

## Permissions and background behavior

Android runtime permissions are requested once during an explicit Nearby Exchange setup, not per
peer, per Talk, or per route change. The persistent product setting is separate from the operating
system grant:

- `Off`
- `While IinPublic is open`
- `Always`, using a user-started `connectedDevice` foreground service

The foreground service owns native discovery and route state. The Activity/WebView renders status
but is not the lifetime owner. Its ongoing notification identifies the active room and transport
and offers Pause and Stop. Location used for the chatroom map remains a separate permission and
does not imply permission to advertise nearby continuously.

No implementation can guarantee uninterrupted background radio access: the user can revoke a
permission, disable a radio, force-stop the app, or the operating system can stop work. Every
exchange therefore persists its outbox, checkpoint, and receipt state and resumes idempotently.

## User experience

The Chatrooms tab and persistent nearby status must show exactly one active audience, for example:

> Exchanging in **Convention Hall A** · 386/498 people

Switching rooms explains the effect plainly:

> Switch to Hall B? IinPublic will stop discovering and broadcasting in Hall A. Your existing
> contacts and conversations will remain.

There is no per-person approval dialog. Identities remain hidden until normal IinPublic policy
allows them to be shown, such as a compatible Talk match. Users can pause nearby exchange without
leaving the room, and can leave/switch the room without changing their one-time permission grants.

Recommended settings:

- Nearby exchange: Off / While open / Always
- Active-room selection: manual, with optional coarse-location suggestions
- Route selection: Automatic by default
- Metered data: Never / Talks only with a byte limit / Everything
- Forward for other people: Wi-Fi only by default
- Battery-aware forwarding and scanning
- Identity reveal only after a permitted match
- Diagnostics showing room, route, bytes, retries, and permission/radio gaps

## Required invariants

1. A device has at most one active exchange room.
2. No room-discovery candidate is connected before same-room authorization succeeds.
3. A device maintains at most `K` automatic room-neighbor links.
4. The same global capacity `C` bounds every client's candidate/active set in every room; no room
   may override it. Coordinator-free partitions converge but cannot guarantee an instantaneous
   globally exact count.
5. Switching rooms stops old-room discovery before new-room discovery begins.
6. Inactive memberships create no radio advertisement, roster subscription, or Talk gossip.
7. The same object received over redundant paths is committed and acknowledged once.
8. Wi-Fi Direct credentials are dynamic and room/session scoped, never app-wide constants.
9. Existing contacts do not create always-on connections; direct pair links are demand driven.
10. Permission or transport loss cannot lose a queued Talk or produce a false delivery receipt.

## Validation

- Unit tests: active-room state machine, admission/capacity bounds, candidate room rejection,
  neighbor cap, switch ordering, multipath deduplication, checkpoint resume, and dynamic credential
  expiry.
- Browser/native integration: two rooms on one hub/LAN prove no cross-room roster, signaling,
  Talk, or presence leakage; switching moves traffic and preserves direct conversations.
- Synthetic scale: model one million users partitioned into 498-person rooms and assert that
  candidate enumeration and link attempts remain `O(NK)`, with no global fanout or global roster.
- Abuse tests: forged/expired presence, incompatible or forked protocol epochs,
  Sybil candidate floods, rapid room switching, stale advertisements, replayed credentials, and
  over-capacity admission.
- Android hardware: foreground, background, locked screen, radio loss, app process recreation,
  LAN↔Wi-Fi Direct↔Internet route changes, and at least two simultaneous room partitions.

## Implementation status (2026-10-05)

- `ActiveExchangeRoomController` persists exactly one active audience and orders every switch as
  stop-old → membership move → start-new. Signed expiring presence, hub queries, LAN NSD, BLE,
  Wi-Fi Direct, mesh frames, and manifest checkpoints are room scoped and fail closed on missing or
  mismatched scope.
- Global `C` is 498 and `K` defaults to 12 (bounded to 8–16 in production policy). Candidate and
  neighbor collections are locally bounded; the synthetic million-user proof never creates a
  global roster. Capacity is absent from room metadata and create UI.
- Room roles, owner-derived identifiers, owner-only mutation/deletion, and owner-gated challenge
  configuration are retired. User-defined rooms receive random cryptographic IDs; duplicate names
  are allowed and creators enter as ordinary participants.
- Release-1 ships the manifest verifier, monotonic archive/checkpoint storage, full suffix relay,
  compatibility and activation engine, ordinary next-key rotation, and separately pinned recovery
  authorization. Changing the recovery policy itself requires the previous recovery threshold.
- Android native discovery is owned by a `connectedDevice` foreground service. Mode, active room,
  and bounded radio checkpoints survive Activity/process recreation; Pause/Stop act natively.
  Cached advertisements expire fail-closed after 20 minutes if no live page refreshes them.
- Route eligibility reads Android validated/metered path state and applies the saved policy before
  deciding whether the Internet hub suppresses local Direct discovery. Wi-Fi credentials are
  per-room/session and never advertised or reused app-wide.
- Verification includes unit/integration/abuse coverage, a closed-form one-million-user topology
  test, Android compilation, and a real three-phone pass covering two simultaneous isolated rooms,
  no delivery on switch alone, deliberate rebroadcast, concurrent propagation, radio loss, and
  resynchronization of a Talk created while the receiver was offline.

The remaining platform limitation is explicit: Android may revoke permission, disable a radio, or
force-stop the app. The service resumes only a still-live checkpoint; it never continues an expired
room advertisement merely to appear always connected.
