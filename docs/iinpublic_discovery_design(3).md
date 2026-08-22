# IinPublic Peer Discovery and Connectivity Design — Version 3

**Status:** Design proposal revised after product review

**Supersedes:** `iinpublic_discovery_design(2).md` for discovery and connectivity policy

**Authority:** Must be implemented consistently with `specs/iinpublic-technical-specifications.md`

**Scope:** Peer discovery, connectivity selection, user-facing network policy, and graceful fallback

### Open-source independence

IinPublic is an independently designed open-source application. Its source code, wire formats,
schemas, tests, and documentation must be published under the project's chosen open-source
license. Implementations must not copy proprietary source code, private APIs, undocumented wire
formats, protected assets, or product branding from other applications. Public documentation and
published research may inform requirements and threat analysis, but every IinPublic component must
have its own documented interface and provenance. Optional operating-system or vendor SDK adapters
must sit behind open IinPublic interfaces and must never become mandatory for interoperability.

## 1. Product intent

IinPublic should let two people find and communicate with each other without requiring either person to understand Bluetooth, Wi-Fi, cellular networking, NAT traversal, relays, DHTs, or peer-routing tables.

The application should combine available connectivity paths automatically while following four user-facing priorities:

1. **Free first** — avoid metered or explicitly charged connectivity when a free usable route exists.
2. **Fast first** — among routes with an equivalent cost class, prefer the route that gives the best usable performance.
3. **Battery aware** — avoid continuous expensive scanning, relaying, or high-power radios when a lower-cost route is sufficient.
4. **Direct Talk first** — prefer a direct connection between the two Talk participants over third-party forwarding.

These priorities are defaults, not absolute rules. Reliability, privacy, user choices, operating-system restrictions, and the needs of the current operation may override a lower-priority preference.

## 2. Identity rule

### 2.1 One IinPublic identity

IinPublic has one application identity namespace: the **SEA identity**.

The SEA public key identifies the IinPublic installation for:

- Talks and Talk authorship;
- messages and answers;
- signatures and application authorization;
- contacts, blocks, trust, credit, and reputation;
- local Gun ownership and encrypted application data;
- all user-visible identity references.

No transport-specific identifier is an IinPublic social or Talk identity.

```text
IinPublic identity = SEA identity
Talk author        = SEA identity
Message author     = SEA identity
Reputation subject = SEA identity
```

### 2.2 Associated connectivity identifiers

A SEA identity may have one or more associated connectivity identifiers. For example, libp2p uses an Ed25519 PeerID for transport security and routing when IPFS/libp2p distributes large files or carries mesh streams.

The libp2p PeerID is analogous to a verified network endpoint identifier. It is not used by the Talk system as the author, recipient, contact, or reputation identity.

Future connectivity systems may introduce other associated identifiers. They must remain subordinate to the SEA identity and must be cryptographically bound to it.

```text
                     SEA identity
                     (application)
                           |
             signed connectivity bindings
                           |
        +------------------+------------------+
        |                  |                  |
  libp2p PeerID      future radio ID    future transport ID
   (transport)         (transport)          (transport)
```

A transport identifier must never silently replace, alias, or be displayed as the SEA identity.

### 2.3 Connectivity binding

The SEA identity signs the association between itself and a connectivity identifier.

```ts
interface ConnectivityBinding {
  schemaVersion: number;
  seaPub: string;
  connectivityKind: 'libp2p' | 'other';
  connectivityId: string;
  addresses: string[];
  capabilities: string[];
  sequence: number;
  issuedAt: number;
  expiresAt: number;
  signature: string; // SEA signature over the canonical record
}
```

Verification of a libp2p session proves control of the libp2p key. Verification of the SEA-signed binding proves which IinPublic identity chose to associate with that transport key. Application messages still require SEA-level validation.

## 3. Multi-device boundary

A SEA identity is currently device-based. One person may therefore have multiple SEA identities across a phone, notebook, desktop, browser profile, or replacement device.

The v1 linking boundary is direct and pairwise. A link exists only when both SEA identities sign and
verify the relationship. It proves that the two keys approved a public assertion that they are
controlled together; it does not prove one physical/legal person, create a durable cluster ID, or
grant transitive trust.

Talk authorship, messages, Q&A, contacts, blocks, credit, and reputation remain attributable to
their original SEA identity. Linking alone authorizes neither private-data synchronization nor
identity recovery. Removing a link ends future use of that direct edge but cannot erase historical
correlation or data already copied. Discovery must therefore advertise and authenticate one SEA
identity at a time and must never synthesize a canonical person identity from link paths. See
`architecture/identity-v1-semantics.md`.

## 4. Public image scope

For the current product, **public image** means the user-visible material already centered in the Me tab:

- the user's question-and-answer list;
- credit and reputation information;
- contextual evidence supporting that credit or reputation where available.

It does not currently require a new public social graph, universal popularity score, follower system, or automatic personality profile.

Useful incremental improvements within this scope are:

1. Show the source Talk and question for each answer.
2. Show whether evidence is self-authored, received from another SEA identity, or imported from an external source.
3. Explain how a credit or reputation value was derived.
4. Let the user filter Q&A by topic, Talk, date, and public/private visibility.
5. Preserve correction, supersession, withdrawal, and retraction history without presenting stale answers as current.
6. Give users control over which eligible Q&A entries appear publicly.
7. Keep reputation contextual instead of collapsing all behavior into one unexplained number.

Any broader public-image feature requires a separate product decision.

### 4.1 Chatbot position in a Talk

The chatbot is a local application agent, not a network peer, transport identity, or independent
Talk author. It reads a Talk that the user's intake policy accepted, compares its questions with
the user's private answer memory, and either reuses an exact answer, prepares a differential draft,
or asks the user for missing answers. A submitted chatbot response remains attributable to the
user's SEA identity and carries provenance describing whether it was typed, reused, drafted, and
human-approved.

```text
Alice creates Talk -> Alice local Gun -> selective synchronization -> Bob local Gun
                                                               |
                                                               v
                                                        Bob intake policy
                                                               |
                                                               v
                                                        Bob local chatbot
                                                          /           \
                                                exact reusable     missing/change
                                                   answer             answer
                                                      |                 |
                                                      v                 v
                                               automatic if       ask Bob / draft
                                               policy permits          |
                                                      +--------+--------+
                                                               |
                                                     Bob SEA-signed response
                                                               |
                                                   pair-private Gun graph
                                                               |
                                                    Alice local Gun + match
```

Chatbot answer memory is private, device-owned Gun data. The chatbot must not publish private
memory merely because it found a semantically related public Talk. Automatic answering requires
the existing user policy; manual mode requires review. Network transport never changes chatbot
authorship or provenance.

## 5. Discovery architecture

### 5.1 Redundant discovery

No single discovery source is required after installation. Available providers feed normalized candidates into one discovery manager.

```text
IinPublic.com presence / roster ─┐
Known verified peers ────────────┤
libp2p DHT room rendezvous ──────┤
LAN / mDNS ──────────────────────┼─> Discovery Manager
Bluetooth discovery ─────────────┤        |
Platform nearby facilities ──────┤        v
Authenticated peer gossip ───────┘   Candidate Registry
                                             |
                                      SEA verification
                                             |
                                      Connection Planner
                                             |
                                         MeshSession
                                             |
                                           Talks
```

IinPublic.com remains a fast and important bootstrap source, but it does not establish user identity and must not be the only route available to an established network.

### 5.2 Normalized candidate

```ts
interface ConnectivityCandidate {
  seaPubHint?: string;
  connectivityKind: string;
  connectivityId?: string;
  addresses: string[];
  source: DiscoverySource;
  discoveredAt: number;
  expiresAt?: number;
  binding?: ConnectivityBinding;
  capabilities?: string[];
  costHints?: ConnectivityCostHints;
}
```

A candidate is only a claim that a connectivity path may exist. It is not a verified SEA identity.

### 5.3 Gun-authoritative synchronization boundary

Gun.js is the authoritative local database and default graph synchronization engine for Talks,
questions, answers, Me-tab evidence, credit/reputation inputs, chatrooms, conversations, and the
interaction ledger. Durable application objects must not have their only authoritative copy in a
`PeerMeshService` memory cache, transport frame, mailbox, or localStorage compatibility mirror.

The Discovery Manager feeds candidates to a Connection Manager. The Connection Manager exposes
usable peer paths to Gun through transport adapters. Gun Wire then exchanges authorized graph
deltas over whichever permitted route works.

```text
Application objects
       |
       v
local Gun (authoritative)
       |
       v
Gun Wire / selective graph synchronization
       |
       v
Connection Manager
       |
       +-- WebSocket over LAN / Internet
       +-- Gun-over-libp2p stream adapter
       +-- Wi-Fi Direct / Wi-Fi Aware IP path
       +-- peer-forwarded encrypted path
       +-- Bluetooth adapter for constrained traffic, if implemented
```

`PeerMeshService` remains useful for small signed control messages, discovery gossip, optional
multi-hop forwarding, offers, requests, receipts, and transition compatibility. It must converge
toward coordinating Gun synchronization rather than becoming a second authoritative replication
protocol for complete Talk bodies.

libp2p DHT, mDNS, bootstrap multiaddresses, Circuit Relay v2, and DCUtR remain available where they
provide measurable value. libp2p is not required for Gun CRDT behavior; its roles are discovery,
connectivity, NAT traversal, relay streams, and the IPFS/Helia content layer.

## 6. Discovery sources

### 6.1 IinPublic.com

Use the public service for fast cold-start rendezvous, presence, room rosters, and short-lived service information. Treat all returned endpoints and transport identifiers as untrusted until the remote peer proves its SEA binding.

### 6.2 Previously verified peers

Persist recently successful, verified connectivity bindings locally. At startup, retry suitable known peers without waiting for central discovery.

Prefer records that are:

- unexpired and correctly signed;
- recently successful;
- reachable through more than one address;
- historically direct and stable;
- relevant to the active room or requested peer.

### 6.3 LAN and mDNS

Use libp2p mDNS or the platform equivalent to find local peers. LAN discovery must expose minimal data and should advertise an expiring transport hint rather than a stable user-visible identity.

### 6.4 Bluetooth and nearby facilities

Bluetooth Low Energy, Wi-Fi Aware, Wi-Fi Direct, Google Nearby, Bonjour, and Apple-supported peer networking may be used where supported.

Their first role is discovery. After two peers find each other, the connection planner should upgrade to an appropriate data path when possible.

Nearby advertisements must not include:

- username or profile;
- Talk history;
- exact location;
- stable SEA public key in plaintext;
- a long-lived correlatable identifier.

Use rotating, expiring nearby identifiers and reveal the SEA binding only during an authenticated exchange.

Platform adapters are accelerators behind common open interfaces:

- Apple: Wi-Fi Aware, Network.framework peer-to-peer networking, Bonjour, Core Bluetooth,
  and optional user-initiated share-sheet/AirDrop import or export. AirDrop is not a background
  IinPublic transport and is never required for interoperability.
- Android/Google: Android Wi-Fi Aware, Wi-Fi Direct, NSD/mDNS, Bluetooth LE, and optional Google
  Nearby Connections. Google Nearby is not required on devices without Google services.
- Desktop: ordinary LAN TCP/WebSocket, mDNS/Bonjour, libp2p, and optional OS Bluetooth APIs.
- Cross-platform baseline: ordinary IP, standards-based Wi-Fi Aware where mutually supported,
  documented BLE GATT/L2CAP framing if implemented, and Internet connectivity.

When a nearby technology supplies an IP path, prefer running the existing Gun Wire protocol over
that path. Only introduce a native Gun transport adapter when the platform cannot expose a usable
IP/WebSocket or libp2p stream.

### 6.5 DHT

For the first version, use the approved libp2p DHT room-provider rendezvous model. Do not add geographic or topic-wide DHT indexes until their enumeration and location-privacy risks are separately reviewed.

### 6.6 Discovery gossip

An authenticated peer may introduce another peer by forwarding a bounded, signed, unexpired connectivity binding.

This is reasonable third-party assistance because it distributes discovery information rather than carrying another person's Talk.

Gossip must be:

- bounded by count, size, expiry, and hop policy;
- relevant to the active room, requested SEA identity, or recent relationship;
- deduplicated;
- rate-limited;
- rejected when the SEA signature or connectivity binding is invalid.

## 7. Connection policy

### 7.1 Policy dimensions

Every candidate route is evaluated using at least:

```ts
interface RouteAssessment {
  monetaryCost: 'free' | 'metered' | 'possibly-charged' | 'unknown';
  directness: 'direct' | 'network-relay';
  estimatedLatencyMs?: number;
  estimatedBandwidthKbps?: number;
  batteryCost: 'low' | 'medium' | 'high';
  stability: number;
  privacyClass: 'local' | 'internet-direct' | 'encrypted-relay';
  alreadyConnected: boolean;
}
```

### 7.2 Default selection rule

The default planner should behave approximately as follows:

1. Reuse an existing healthy direct connection when it is adequate.
2. Prefer free routes over metered routes.
3. Within the same cost class, prefer direct routes.
4. Among comparable direct routes, prefer the faster stable route.
5. Avoid a high-battery route when a lower-power route meets the current operation's needs.
6. Use an encrypted network relay when direct connection is unavailable.
7. Before starting a route that may incur monetary cost, obtain user permission unless an existing user policy already allows it.

This is a multi-factor policy rather than a rigid transport list. For example:

- Free Wi-Fi that is unusably slow may lose to user-approved cellular.
- BLE may be excellent for discovery but inappropriate for a large file.
- An already-open cellular path may temporarily consume less battery than repeatedly scanning for Wi-Fi.
- A direct local path should normally beat an Internet relay.

### 7.3 Operation-aware routing

The planner may select differently depending on the operation:

| Operation | Preferred characteristics |
|---|---|
| Presence/discovery | Small payload, low duty cycle, low battery |
| Text Talk/message | Direct, reliable, low latency |
| Large IPFS attachment | Free, high bandwidth, stable |
| Background synchronization | Free, low battery, deferrable |
| Urgent user action | Reliable and fast, with metered permission if needed |

### 7.4 Metered-network permission

If no suitable free route exists and the next route may consume paid or metered data, show a plain-language choice:

```text
Use cellular data?

No free connection is currently available. IinPublic can continue this Talk
using cellular data, which may count against your plan.

[Use once] [Always allow for Talks] [Wait for free connection]
```

Do not ask repeatedly when the user has already established a matching policy. Provide a Settings control to change it later.

### 7.5 Direct Talk and peer mesh forwarding

Version 1 should attempt to carry a Talk directly between its participants first. When a direct route is unavailable, IinPublic may use either network infrastructure such as libp2p Circuit Relay or the already-implemented application mesh, in which ordinary IinPublic peers forward SEA-signed `P2PMeshFrame`s through the sparse overlay.

```text
Allowed in v1:
A ── direct ── B
A ── encrypted network relay ── B
A ── ordinary user C forwarding the Talk ── B
```

Peer mesh forwarding is **enabled by default** because it increases reachability and preserves the behavior already implemented in `PeerMeshService`. A forwarding peer transports an already SEA-signed frame; it is not treated as the Talk author. End-to-end/pair-encrypted payloads remain unreadable to the forwarding peer, while public Talk bodies retain their existing visibility semantics.

Users must be able to restrict forwarding independently from their own Talks:

```text
Help connect other IinPublic users       ON   (default)
Allow forwarding on Wi-Fi                ON   (default)
Allow forwarding on cellular data        OFF  (default)
Pause forwarding in low-battery mode      ON   (default)
Monthly cellular forwarding limit         0 MB (default)
```

Disabling forwarding means the device stops acting as an intermediate hop for third-party frames. It must still be able to originate and receive the user's own Talks, send ACKs/responses, and gossip discovery records subject to the discovery policy.

Forwarding policy must be checked before selecting intermediate neighbors and again before transmitting a third-party frame. A route already carrying a user's own active Talk should not be torn down merely because third-party forwarding is disabled.

## 8. Version 2: advanced peer-relay policy

Basic sparse-mesh Talk forwarding already exists and remains a version 1 capability. Version 2 may add a more deliberate peer-relay role with stronger accounting, service guarantees, incentives, and route control.

Its intended scenario is:

```text
A cannot connect directly to B
A can connect to C
B can connect to C
C may relay encrypted Talk traffic between A and B
```

Before those version 2 extensions, the project must define:

- explicit opt-in by the middle peer;
- bandwidth, battery, and metered-data limits;
- whether both Talk participants must consent;
- end-to-end encryption that prevents C from reading content;
- route setup, expiry, failure, and migration;
- loop prevention and duplicate suppression;
- abuse, traffic amplification, and denial-of-service controls;
- whether relaying earns credit and how gaming is prevented;
- visible direct/relayed status for A, B, and C.

External-platform bridges are outside the current discovery scope.

## 9. Battery policy

Comprehensive discovery must not mean continuous scanning.

### Foreground

When the user is actively looking for people, opening a room, or sending a Talk, briefly increase discovery intensity and route probing.

### Background

Use cached verified peers, operating-system-supported background mechanisms, low-duty-cycle scans, and rendezvous notifications. Avoid keeping every radio active.

### Charging and unmetered Wi-Fi

Allow broader synchronization, DHT maintenance, attachment prefetching permitted by policy, and more aggressive peer health checks.

### Low battery

Reduce scan frequency, pause third-party mesh forwarding when the user's policy enables that protection, defer non-urgent large synchronization, and preserve the user's own active conversations where possible.

Battery policy must not silently convert a free route into a metered route without applying the metered-network permission policy.

## 10. User-facing connectivity interface

### 10.1 Simple settings

```text
Connectivity

Mode
[ Automatic — recommended ]

Connection priorities
[x] Prefer free connections
[x] Prefer direct connections
[x] Save battery when possible

Help the mesh
[x] Forward Talks for other users
[x] Forward on Wi-Fi
[ ] Forward on cellular data
[x] Pause forwarding when battery is low

Cellular data
[ Ask before use ]

Find people through
[x] Internet
[x] Nearby devices
[x] Local Wi-Fi
[x] People connected with before

Background discovery
[x] On
```

Users normally express intent. They should not need to select BLE versus Wi-Fi Aware versus mDNS.

### 10.2 Presets

- **Automatic:** Apply free-first, direct-first, speed, and battery-aware planning.
- **Data saver:** Never use metered connectivity without a per-use confirmation; disable third-party forwarding on metered routes; defer large transfers.
- **Fastest:** Prefer performance within the user's allowed cost policy.
- **Local/Event:** Prefer nearby and LAN discovery; Internet remains a fallback if allowed.
- **Private:** Restrict unsolicited discovery and reveal less before authentication.
- **Advanced:** Expose individual providers, diagnostics, relay use, scan frequency, and saved permissions.

### 10.3 Connection explanation

The Talk UI should expose a compact status when relevant:

```text
Direct · Wi-Fi · Free
Direct · Cellular · Metered
Encrypted relay · Internet
Waiting for a free connection
```

Do not show a transport-specific PeerID as the other person's identity.

### 10.4 Permission language

Explain the feature before the operating-system permission:

```text
Find nearby IinPublic users

Nearby access lets IinPublic discover people around you even when the Internet
is unavailable. Your name, profile, and exact location are not advertised.
```

Denying a permission disables only the affected provider.

## 11. Diagnostics

Advanced diagnostics should show:

- discovery providers and their states;
- candidates per provider;
- verified SEA-to-connectivity bindings;
- current route, directness, cost class, latency, and battery class;
- third-party frames forwarded, bytes forwarded, and the active forwarding policy;
- alternative routes;
- last failure and retry time;
- why a route was selected;
- whether cellular permission was granted once or persistently.

Example:

```text
Talk with Bob
Identity: SEA verified
Current route: Direct Wi-Fi
Reason: Free, direct, 24 ms, stable
Alternatives: Cellular direct (permission required), encrypted relay
Found through: Known peer, mDNS, peer gossip
```

## 12. Security and privacy requirements

- Treat every pre-authentication input as hostile.
- Bound candidate count, address count, record size, gossip fanout, and parsing work.
- Verify SEA signatures and expiry before caching connectivity bindings.
- Reject stale sequence numbers and replayed handshake nonces.
- Do not publish precise location through discovery.
- Do not expose stable SEA identity in nearby radio advertisements.
- Apply blocks at the application identity layer regardless of which connectivity ID or route is used.
- A change of transport identifier must not evade a SEA-level block.
- A compromised bootstrap provider must not be able to impersonate a SEA identity.
- Unknown transport capability fields must fail safely without crashing older clients.

## 13. Availability scenarios

### Normal Internet

Use IinPublic.com and known peers as fast paths; form a direct connection where possible.

### IinPublic.com unavailable

Use running libp2p peers, DHT room rendezvous, mDNS, known verified peers, and bounded discovery gossip.

### Same LAN, no Internet

Discover through mDNS and connect locally.

### Same room, no LAN or Internet

Use permitted nearby discovery and an available direct nearby data path.

### Cellular behind carrier NAT

Attempt supported direct traversal, then use an approved encrypted network relay. Apply the user's metered-data policy.

### No free route

If the action can wait, queue it. If the user is actively attempting the action, ask whether to use a potentially metered route.

## 14. Implementation plan

### Phase 0 — specification alignment

- Add normative discovery requirements to the technical specification.
- State that SEA is the sole application identity.
- Define subordinate connectivity bindings.
- Make local Gun the authoritative store and graph convergence engine for all durable application data.
- Narrow `PeerMeshService` toward control, forwarding, offers, requests, receipts, and migration compatibility.
- Retain SEA envelopes where explicit application receipts or forwarding require them.
- Retain libp2p only for discovery/connectivity/NAT/relay and IPFS where it adds value.
- Correct obsolete implementation-status notes.

### Phase 1 — unified discovery manager

- Wrap hub presence, room roster, libp2p DHT, mDNS, bootstrap multiaddresses, and known peers as providers.
- Normalize candidates and retain discovery-source provenance.
- Add expiry, bounds, health, backoff, and diagnostics.

### Phase 2 — verified connectivity records

- Version the existing SEA↔libp2p binding record.
- Add sequence, expiry, addresses, and capabilities.
- Persist recently successful verified bindings.
- Add bounded authenticated discovery gossip.

### Phase 3 — policy-based connection planner

- Score cost, directness, speed, battery, stability, and current operation.
- Add metered-network permission states.
- Prefer and migrate to better direct routes without interrupting Talk identity.
- Record human-readable selection reasons.
- Add a default-on peer-forwarding policy with separate Wi-Fi, cellular, battery, and byte-budget controls.
- Enforce forwarding policy in `PeerMeshService.forwardFrame()` without affecting locally originated or locally addressed frames.

### Phase 4 — user interface and diagnostics

- Add simple connectivity settings and presets.
- Add connection status to Talks when it is relevant.
- Add permission prompts for possibly charged connectivity.
- Add advanced provider and route diagnostics.

### Phase 5 — native nearby discovery

- Harden desktop LAN/mDNS.
- Add Android nearby discovery providers.
- Add Apple-platform nearby discovery providers.
- Add rotating nearby identifiers and permission-denied tests.
- Upgrade nearby discovery to the best available direct data path.

### Phase 6 — Gun transport convergence

- Move authored and received Talk bodies from compatibility localStorage/memory caches into local Gun.
- Define authorized Gun paths for room-public, user-private, and pair-private data.
- Implement Gun Wire over libp2p streams only if ordinary Gun WebSocket peers cannot use the selected path.
- Add temporary Gun peers for Wi-Fi Direct/Wi-Fi Aware IP endpoints.
- Keep BLE discovery-first; build a Gun BLE adapter only after measured need and protocol review.
- Send application acceptance receipts only after the receiver commits and rereads the Gun record.
- Remove duplicate Talk-body synchronization only after migration and rollback tests pass.

### Deferred

- Person-level semantics across multiple device SEA identities: further design discussion required.
- Geographic/topic-wide DHT indexes: privacy review required.
- Advanced peer-relay guarantees, incentives, and accounting beyond basic mesh forwarding: version 2.
- External-platform Talk bridges: outside current scope.
- Broader public-image graph beyond Me-tab Q&A and credit/reputation: separate product decision.

## 15. Acceptance criteria

Version 1 discovery and connectivity are complete when:

1. Every user-visible author, participant, contact, block, and reputation reference uses SEA identity.
2. A libp2p PeerID is accepted for an IinPublic peer only through a valid SEA-signed binding.
3. Every durable Talk, answer, Q&A record, conversation, chatroom record, and ledger event has an authoritative local Gun representation.
4. Hub, DHT, mDNS, known-peer, and gossip candidates enter one bounded registry.
5. With the hub down, already established peers can rediscover and communicate through approved decentralized sources.
6. Same-LAN peers can discover each other without Internet access.
7. Denying nearby permission does not break Internet discovery.
8. A free usable route is preferred over a metered route.
9. A metered route is not newly used without matching user permission.
10. A direct route is preferred over a relay when cost and usability are comparable.
11. Large transfers prefer free, stable, high-bandwidth routes.
12. Low-battery mode reduces discovery work without silently violating the user's cost policy.
13. Peer mesh forwarding is enabled by default, preserves the original SEA author, and can be disabled independently for cellular use or battery protection.
14. The UI explains whether the current path is direct, relayed, free, metered, or waiting.
15. No transport-specific identifier is presented as the person's IinPublic identity.
16. The chatbot reads only authorized local data, attributes submitted answers to the user's SEA identity, and records answer provenance.
17. The same authorized Gun graph converges over each supported transport without transport-specific application schemas.
18. Vendor-specific adapters can be disabled or omitted without preventing standards-based IinPublic interoperability.
19. No proprietary implementation or undocumented third-party protocol is copied into the open-source codebase.

## 16. Core rule

```text
SEA says WHO the IinPublic participant is.
Connectivity bindings say WHICH transport endpoints belong to that SEA identity.
Discovery says WHERE a usable path may exist.
Connection policy chooses HOW to connect: free, fast, battery-aware, and direct-first.
Gun holds WHAT durable application data exists and synchronizes its authorized graph.
Talks and chatbot-assisted answers remain SEA-authored and transport-independent.
Peers may help discover other peers and forward signed Talk frames in version 1,
subject to user-controlled cellular, battery, and forwarding policies.
Platform adapters provide paths; none owns the application data model.
```
