# IinPublic Comprehensive Peer Discovery and Cross-Platform Bridge Design

**Status:** Design proposal  
**Target:** IinPublic peer-to-peer discovery, connectivity, and Talks bridging  
**Primary goals:** Redundancy, ease of use, privacy, resilience, cross-platform reach

## 1. Purpose

IinPublic should not depend on a single discovery mechanism or a single bootstrap server. `IinPublic.com` remains an important, first-class part of the system, especially for new installations and Internet-wide discovery, but it must not be a single point of failure or the root of peer identity trust.

The discovery subsystem should automatically combine every connectivity path available to a device:

- IinPublic.com bootstrap and rendezvous
- Previously known peers
- Local Wi-Fi / LAN discovery
- Bluetooth Low Energy discovery
- Wi-Fi Aware / Wi-Fi Direct where supported
- Peer gossip / peer introductions
- DHT or other decentralized Internet-wide peer discovery
- Optional relay peers for NAT/firewall traversal
- Platform bridges exposed through IinPublic Talks

For normal users, this complexity should be hidden behind a simple default mode. Advanced users can inspect and selectively enable or disable transports, discovery sources, privacy levels, and bridge behavior.

## 2. Design principles

### 2.1 Discovery is redundant

No single discovery provider is required after installation. Multiple providers run concurrently or opportunistically and feed candidates into the same peer registry.

```text
                         IinPublic App
                              |
                     Peer Discovery Manager
                              |
       +-----------+----------+----------+-----------+
       |           |          |          |           |
  IinPublic.com   Nearby     Local LAN   Known      DHT /
   bootstrap      BLE/WiFi    mDNS       peers      gossip
       |           |          |          |           |
       +-----------+----------+----------+-----------+
                              |
                         Peer candidates
                              |
                       Identity verification
                              |
                         Verified peers
                              |
                       Connection Manager
                              |
                            Talks
```

### 2.2 Discovery does not imply trust

Every discovery source is treated as untrusted, including IinPublic.com.

A discovery provider may say:

> Peer X may be reachable at address Y.

It may not establish:

> The endpoint at Y is definitely Peer X.

Peer identity is established only through cryptographic authentication after connection.

### 2.3 The simplest mode should work automatically

The default configuration should be approximately:

```text
Discovery:       Automatic
Nearby peers:    Enabled
Internet peers:  Enabled
LAN peers:       Enabled
Known peers:     Enabled
Peer gossip:     Enabled
Bridges:         Enabled when configured
Privacy:         Balanced
```

A user should normally install IinPublic, grant the required permissions, and never need to understand BLE, mDNS, NAT traversal, DHT, STUN, relay nodes, or peer tables.

### 2.4 Advanced configuration remains available

Power users can inspect:

- which discovery mechanisms found a peer;
- which transport is currently active;
- direct versus relayed status;
- connection latency and quality;
- bridge source/destination;
- privacy level;
- discovery permissions;
- bandwidth and battery policies.

## 3. Discovery architecture

### 3.1 Common provider interface

Every discovery mechanism should implement the same logical interface.

```ts
interface PeerDiscoveryProvider {
    id: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    status(): DiscoveryProviderStatus;
    onPeerCandidate(cb: (candidate: PeerCandidate) => void): void;
}
```

Suggested providers:

```text
IinPublicBootstrapProvider
KnownPeerProvider
LanMdnsProvider
BluetoothProvider
WifiAwareProvider
WifiDirectProvider
NearbyConnectionsProvider       // Android, if desired
MultipeerProvider               // Apple platforms, if desired
PeerGossipProvider
DhtProvider
RelayDiscoveryProvider
```

Platform-specific providers can be compiled or enabled only where supported.

### 3.2 PeerCandidate

All discovery mechanisms normalize their output into a common structure.

```ts
interface PeerCandidate {
    peerId?: string;
    ephemeralId?: string;
    addresses: CandidateAddress[];
    source: DiscoverySource;
    discoveredAt: number;
    expiresAt?: number;
    signedPeerRecord?: Uint8Array;
    capabilities?: string[];
    metadata?: Record<string, unknown>;
}
```

A candidate is not yet a trusted peer.

### 3.3 VerifiedPeer

After authenticated key exchange:

```ts
interface VerifiedPeer {
    peerId: string;
    publicKey: Uint8Array;
    verifiedAt: number;
    addresses: VerifiedAddress[];
    capabilities: PeerCapabilities;
    trust: PeerTrustState;
}
```

Only verified peers can participate in authenticated Talks, peer-record propagation, or trusted graph synchronization.

## 4. Discovery sources

### 4.1 IinPublic.com bootstrap and rendezvous

IinPublic.com remains a primary discovery source.

It provides:

- bootstrap peer addresses;
- current public relay candidates;
- coarse geographic rendezvous hints;
- protocol/version information;
- optional public topic/location rendezvous;
- service announcements;
- optional bridge directory information.

It should not be the root of peer identity.

Example:

```text
GET /api/v1/bootstrap?region=<coarse-cell>&version=<protocol-version>
```

Response contains short-lived candidate records rather than trusted identities.

If IinPublic.com is unavailable:

- known peers are tried;
- local discovery continues;
- nearby discovery continues;
- gossip continues through reachable peers;
- DHT discovery continues if available.

If IinPublic.com is compromised, peer authentication should still prevent the server from impersonating users.

### 4.2 Previously known peers

Persist successfully authenticated peer records locally.

At startup, try high-quality recent peers immediately.

Prioritize using:

- recent successful connections;
- direct connections over relays;
- low latency;
- recent signed records;
- matching geographic/topic relevance;
- peers with multiple valid addresses.

Known peers provide an extremely cheap and reliable fallback after initial network participation.

### 4.3 Local LAN discovery

Use mDNS/DNS-SD or equivalent mechanisms where platform permissions allow.

Example service:

```text
_iinpublic._udp.local
```

LAN discovery is valuable on:

- home Wi-Fi;
- offices;
- conferences;
- hotels;
- campuses;
- community events.

The advertisement should reveal minimal information and should not expose a permanent user identity.

### 4.4 Bluetooth Low Energy

BLE is primarily a nearby discovery mechanism.

It should advertise:

```text
service: IINP
protocolVersion
rotatingEphemeralId
capabilityBits
```

It should not advertise:

- permanent PeerID;
- username;
- precise GPS location;
- long-lived public key fingerprint;
- personal profile information.

After BLE discovery, devices should upgrade to a faster available transport when appropriate.

### 4.5 Wi-Fi Aware / Wi-Fi Direct / platform nearby frameworks

Use platform-native direct-device networking when available.

Purpose:

1. discover nearby IinPublic peers;
2. establish a direct high-bandwidth path;
3. exchange authenticated peer identities;
4. carry Talks and graph synchronization without Internet infrastructure.

The implementation should hide platform differences behind the common Discovery Manager and Connection Manager.

### 4.6 Peer gossip

Authenticated peers can exchange signed peer records.

Example:

```text
Alice knows Carol.
Alice gives Bob Carol's signed PeerRecord.
Bob may attempt Carol's advertised addresses.
Carol must still authenticate cryptographically.
```

Gossip should be bounded and relevance-aware.

Do not exchange the entire peer database blindly.

Possible filters:

- recent peers;
- relevant geographic cells;
- relevant Talk/channel topics;
- bridge capabilities;
- healthy relay peers;
- peers specifically requested by ID.

### 4.7 DHT discovery

A DHT can provide decentralized Internet-wide lookup without making IinPublic.com mandatory.

Potential keys include:

```text
hash("iinpublic:peer:" + peerId)
hash("iinpublic:region:" + coarseGeohash)
hash("iinpublic:topic:" + topicHash)
```

Location keys must be coarse enough to avoid exposing precise user location.

The DHT should distribute signed peer records, not unsigned authoritative identity mappings.

### 4.8 Relay discovery

Some phones cannot establish direct Internet connections due to carrier-grade NAT, NAT behavior, firewalls, IPv4 scarcity, or platform restrictions.

IinPublic therefore needs optional relay candidates.

Relay discovery can come from:

- IinPublic.com;
- community-operated relays;
- peer gossip;
- DHT records;
- previously successful relay paths.

Relays transport encrypted traffic but should not be able to read Talk content.

## 5. Connection strategy

Discovery and transport selection are separate.

When multiple routes exist to the same peer, Connection Manager chooses the best path.

Example preference:

```text
1. Existing healthy direct connection
2. Local Wi-Fi / Wi-Fi Aware direct
3. Direct IPv6 Internet
4. Direct IPv4/NAT-traversed Internet
5. Wi-Fi Direct
6. Other nearby high-bandwidth transport
7. BLE data path for small traffic
8. Trusted/available relay
```

The exact preference can account for:

- latency;
- bandwidth;
- battery cost;
- metered cellular usage;
- stability;
- privacy;
- user preference.

Connections can migrate when a better transport becomes available.

Example:

```text
BLE discovery
     |
     v
BLE authenticated session
     |
     +---- Wi-Fi becomes available ----+
                                        v
                                  direct Wi-Fi path
                                        |
                                  same Talk continues
```

Talk identity must be independent of transport identity.

## 6. Peer identity and security

### 6.1 Device identity

Each IinPublic installation generates a long-term asymmetric key pair.

```text
private key -> secure OS keystore
public key  -> peer identity
PeerID      -> hash/encoding of public key or identity document
```

The private key should be non-exportable where practical.

### 6.2 Authenticated handshake

Connection establishment includes:

1. ephemeral key agreement;
2. exchange of long-term public identities;
3. challenge/response signatures;
4. transcript binding;
5. session-key derivation;
6. encryption and integrity protection.

Do not design custom cryptographic primitives. Use mature, reviewed libraries and established protocols.

### 6.3 Signed PeerRecord

A peer owns its reachability record.

```ts
interface PeerRecord {
    peerId: string;
    sequenceNumber: bigint;
    issuedAt: number;
    expiresAt: number;
    addresses: CandidateAddress[];
    capabilities: string[];
}
```

The peer signs this record with its identity key.

The same record can safely be transported via:

- IinPublic.com;
- peer gossip;
- DHT;
- LAN;
- QR code;
- Bluetooth;
- cached storage.

Recipients verify the signature before accepting it as belonging to the claimed PeerID.

### 6.4 Rotating nearby identifiers

Nearby advertisements must use rotating ephemeral identifiers.

```text
Permanent identity
      + local secret
      + time window
           |
           v
      ephemeral ID
```

Rotate frequently enough to reduce passive physical tracking.

Permanent identity is revealed only inside an authenticated/encrypted handshake.

### 6.5 Replay resistance

Use:

- nonces;
- handshake transcript binding;
- monotonically increasing peer-record sequence numbers;
- expiration times;
- message IDs/counters where needed.

Reject expired or stale signed peer records.

### 6.6 Malicious bootstrap protection

IinPublic.com is a discovery authority only for its own service information, not for user identity.

If it returns:

```text
Peer X -> 1.2.3.4:5000
```

that address remains a candidate until the remote endpoint cryptographically proves it controls Peer X's identity key.

### 6.7 Sybil resistance

Cryptographic identities are cheap to create, so identity is not equivalent to one human.

Keep separate concepts for:

```text
cryptographic identity
trust / reputation
human uniqueness
```

Possible anti-abuse signals:

- identity age;
- rate limits;
- successful interaction history;
- mutual-peer relationships;
- repeated real-world encounters;
- user reports/blocks;
- reputation;
- optional proof-of-work or other admission costs for abuse-sensitive operations.

Do not require strong identity verification merely for normal P2P communication unless a specific feature needs it.

## 7. DoS and malformed-peer protection

Anything received before authentication should be considered hostile.

Use strict limits for:

- packet size;
- handshake size;
- number of candidates per response;
- discovery requests per minute;
- simultaneous connection attempts;
- graph synchronization depth;
- Talk message size;
- Talk message rate;
- peer-record propagation;
- relay bandwidth.

The pre-authentication parser should be minimal.

Malformed inputs must fail closed without crashing the discovery service or application.

## 8. Privacy and location protection

IinPublic is location-oriented, so peer discovery can create additional privacy risks.

### Never broadcast automatically

- exact coordinates;
- stable permanent identity;
- full profile;
- contact information;
- stable social graph;
- exact location history.

### Coarse geographic rendezvous

Internet discovery may use coarse geographic cells rather than exact GPS coordinates.

For example:

```text
Current location
      |
      v
coarse geohash / region cell
      |
      v
IinPublic rendezvous key
```

The user can control whether regional Internet discovery is enabled.

### Location levels

Possible user-visible settings:

```text
Nearby visibility
  Automatic
  Nearby only
  Approximate area
  Precise location when explicitly shared
  Hidden
```

Precise location should remain an application-level user action rather than a requirement of peer discovery.

## 9. End-user configuration

The most important usability requirement is that normal users should not configure network technology manually.

### 9.1 Simple settings

Suggested primary UI:

```text
Peer Discovery

[ Automatic ]   Recommended

Find people through:
[x] Internet
[x] Nearby devices
[x] Local Wi-Fi
[x] People I've connected with before

Background discovery
[x] On

Privacy
[ Balanced ]

Bridges
[x] Use configured Talk bridges
```

### 9.2 Presets

Provide presets rather than dozens of switches.

#### Automatic

Use all safe available discovery methods and adapt to permissions/network conditions.

#### Private

```text
Nearby discovery:       restricted
IinPublic.com:           minimal
DHT geographic lookup:  off
Known peers:             on
Bridge auto-forwarding:  limited
```

#### Local / Event

Prefer BLE, Wi-Fi Aware, Wi-Fi Direct, and LAN discovery.

#### Internet only

Disable nearby discovery while retaining IinPublic.com, known peers, DHT, and relay paths.

#### Advanced

Expose individual providers, intervals, bandwidth, relay policy, and diagnostics.

### 9.3 Permission setup

During onboarding, explain permissions in terms of features instead of protocols.

Bad:

```text
Allow BLUETOOTH_SCAN?
```

Better application explanation:

```text
Find nearby IinPublic users

IinPublic can discover nearby people even when the Internet is unavailable.
This uses your phone's nearby-device capabilities.
```

Then request the OS permission.

Permissions should degrade gracefully. Denying nearby permission must not prevent Internet discovery.

## 10. Platform-Specific Discovery and Transport Architecture

IinPublic must treat Android, iOS/iPadOS, macOS, Windows, and Linux as equal participants in one transport-independent peer protocol. Platform APIs are optional helpers. No vendor-specific API is allowed to become a requirement for IinPublic interoperability.

### 10.1 Portability requirement

```text
REQ-DISCOVERY-PORTABILITY

No platform-specific discovery or transport provider shall be required
for IinPublic protocol interoperability.

Platform-specific APIs MAY be used as accelerated discovery or
transport paths.

Failure, removal, denial of permission, or unavailability of any
individual provider must not prevent IinPublic from attempting
alternative discovery and transport providers.
```

The architecture is therefore:

```text
                        IinPublic Protocol
             identity / Talks / routing / security
                               |
                        IinPublic Link
                               |
                        Transport Manager
                               |
       +-----------------------+-----------------------+
       |                       |                       |
  Standard transports    Platform helpers        Internet paths
       |                       |                       |
  BLE / LAN / mDNS       Google Nearby          IinPublic.com
  Wi-Fi Aware            Apple peer Wi-Fi       direct IP/QUIC
  TCP/UDP/QUIC           OS-specific APIs       relay / rendezvous
```

Everything above `IinPublicLink` must be unaware of the underlying transport.

```ts
interface IinPublicLink {
    peerId: string;
    transportId: string;
    send(frame: Uint8Array): Promise<void>;
    onFrame(cb: (frame: Uint8Array) => void): void;
    close(): void;
}
```

A Talk may continue while the underlying link changes from BLE to LAN, Wi-Fi Aware, direct Internet, or relay.

### 10.2 Capability negotiation

Every installation publishes only the transport capabilities that are currently available and permitted.

Example Android capability record:

```text
wifi-aware
google-nearby
ble
mdns
lan-ip
internet-direct
internet-relay
```

Example iPhone capability record:

```text
wifi-aware
apple-peer-wifi
ble
bonjour
lan-ip
internet-direct
internet-relay
```

Example Windows notebook capability record:

```text
ble
mdns
lan-ip
wifi-direct-if-supported
internet-direct
internet-relay
bridge-host
```

Example Linux desktop capability record:

```text
ble
mdns
lan-ip
wifi-direct-if-supported
internet-direct
internet-relay
bridge-host
```

Peers select the best common path. Platform-specific capabilities that do not intersect are ignored rather than treated as errors.

### 10.3 Android

Android should support multiple independent providers.

Preferred candidates:

```text
AndroidTransportManager

    WifiAwareTransport
    NearbyConnectionsTransport     // optional Google helper
    BleTransport
    LanMdnsTransport
    WifiDirectTransport            // optional fallback
    InternetTransport
    RelayTransport
```

Google Nearby Connections is an optional acceleration/helper layer. It may provide excellent nearby discovery and transport selection on devices with the required Google services, but IinPublic must not encode Google-specific semantics into Talk messages, peer identity, routing, or persistence.

If Google Nearby is missing or unavailable, Android should continue through Wi-Fi Aware, BLE, LAN/mDNS, direct Internet, IinPublic.com, known peers, DHT, and relays.

### 10.4 iOS and iPadOS

iOS/iPadOS should use Apple-supported networking facilities behind the same transport abstraction.

Suggested providers:

```text
AppleMobileTransportManager

    WifiAwareTransport             // where OS/device support permits
    ApplePeerWifiTransport         // Network.framework helper
    BleTransport
    BonjourLanTransport
    InternetTransport
    RelayTransport
```

AirDrop itself is not an IinPublic transport dependency. IinPublic should use developer-accessible Apple networking APIs rather than depending on AirDrop behavior or protocol compatibility.

Any Apple-specific peer-to-peer Wi-Fi feature is a helper transport only. If unavailable, BLE, Bonjour/LAN, direct Internet, IinPublic.com, known peers, DHT, and relays remain available.

### 10.5 macOS notebooks and desktops

macOS should be a full IinPublic node, not merely a web client.

A Mac has several advantages:

- usually longer uptime than a phone;
- stable Wi-Fi or Ethernet connectivity;
- fewer battery restrictions when plugged in;
- strong LAN presence;
- ability to act as a persistent Talk bridge;
- potential connectivity to both nearby Apple devices and standards-based peers.

Suggested providers:

```text
MacTransportManager

    BonjourLanTransport
    LanIpTransport
    BleTransport
    ApplePeerWifiTransport         // optional helper
    WifiAwareTransport             // where supported
    InternetTransport
    RelayTransport
    BridgeHostTransport
```

A Mac can therefore bridge transport domains:

```text
iPhone
   |
Apple nearby transport
   |
Mac
   |
Ethernet / Internet
   |
Windows / Linux / IinPublic.com / remote peer
```

The Mac does not translate Talk semantics. It forwards authenticated IinPublic Talk frames according to routing and bridge policy.

### 10.6 Windows notebooks and desktops

Windows should rely first on interoperable technologies rather than mobile-vendor frameworks.

Suggested providers:

```text
WindowsTransportManager

    LanMdnsTransport
    LanIpTransport
    BleTransport
    WifiDirectTransport            // hardware/driver dependent
    InternetTransport
    RelayTransport
    BridgeHostTransport
```

Windows discovery priorities are typically:

```text
same LAN / mDNS
        |
        +--> BLE nearby discovery
        |
        +--> Wi-Fi Direct when supported
        |
        +--> known peers
        |
        +--> IinPublic.com / DHT
        |
        +--> direct Internet / relay
```

Windows PCs are especially useful as persistent bridge nodes because users may leave them running, connected to Ethernet, with fewer mobile background restrictions.

Example:

```text
Android phone -- BLE --> Windows notebook -- Ethernet --> remote IinPublic peer
```

or:

```text
Local IinPublic Talk
       |
Windows desktop
       |
Telegram / Matrix / email bridge
```

### 10.7 Linux notebooks and desktops

Linux should use open, standards-based transports as the baseline.

Suggested providers:

```text
LinuxTransportManager

    AvahiMdnsTransport
    LanIpTransport
    BluezBleTransport
    WifiDirectTransport            // via supported system networking stack
    InternetTransport
    RelayTransport
    BridgeHostTransport
```

Linux is particularly valuable for:

- self-hosted relay nodes;
- community bootstrap nodes;
- bridge services;
- DHT participation;
- always-on home servers;
- development/testing nodes;
- LAN-to-Internet Talk routing.

A headless Linux system should be able to run a minimal IinPublic node without the desktop GUI.

```text
IinPublic Core
     |
Discovery / Transport Manager
     |
Talk router / bridge service
     |
optional GUI
```

### 10.8 Browser-only clients

A browser client must be treated separately from a native desktop client because browsers have restricted access to BLE, LAN discovery, arbitrary sockets, background execution, and local network facilities.

The browser should normally use:

```text
HTTPS / WebSocket / WebTransport where available
             |
        IinPublic.com
             |
      reachable IinPublic peers
```

A browser may gain access to nearby capabilities where browser APIs permit, but the core network must not assume those APIs exist.

For comprehensive discovery and bridging, native Android/iOS/macOS/Windows/Linux applications are preferred.

### 10.9 Cross-platform capability matrix

The exact runtime availability depends on OS version, device hardware, drivers, user permissions, and network policy. The matrix is therefore capability-oriented rather than guaranteed.

| Capability | Android | iOS/iPadOS | macOS | Windows | Linux |
|---|---|---|---|---|---|
| IinPublic.com bootstrap | Yes | Yes | Yes | Yes | Yes |
| Known-peer reconnect | Yes | Yes | Yes | Yes | Yes |
| Direct Internet IP | Yes | Yes | Yes | Yes | Yes |
| Relay transport | Yes | Yes | Yes | Yes | Yes |
| LAN IP | Yes | Yes | Yes | Yes | Yes |
| mDNS / DNS-SD | Yes | Bonjour | Bonjour | Yes | Avahi/Yes |
| BLE discovery | Yes | Yes | Yes | Yes, hardware dependent | Yes, hardware dependent |
| Wi-Fi Aware | Device/OS dependent | Device/OS dependent | Device/OS dependent | Do not assume | Do not assume |
| Wi-Fi Direct | Device dependent | Not baseline | Not baseline | Driver/hardware dependent | Stack/hardware dependent |
| Google Nearby Connections | Optional helper | Do not require | Do not require | Do not require | Do not require |
| Apple peer-to-peer Wi-Fi | No | Optional helper | Optional helper | No | No |
| DHT participation | Yes | Yes | Yes | Yes | Yes |
| Persistent bridge host | Limited by mobile OS | Limited by mobile OS | Excellent | Excellent | Excellent |
| Headless service node | No | No | Possible | Possible | Excellent |

### 10.10 Desktop/notebook bridge role

Notebook and desktop systems should be preferred candidates for persistent bridging when available.

```text
                     IinPublic Talk
                           |
          +----------------+----------------+
          |                                 |
     mobile peers                    desktop bridge node
          |                                 |
  nearby / cellular            LAN + Internet + external API
                                            |
                              +-------------+-------------+
                              |             |             |
                           Telegram       Matrix        Email/etc.
```

Bridge selection can consider:

- uptime;
- power state;
- wired versus wireless network;
- metered versus unmetered connection;
- external-platform credentials;
- latency;
- bridge authorization;
- device trust;
- recent health score.

A desktop node should not automatically become a bridge merely because it is capable. Bridge participation must be explicitly authorized by the device owner or Talk policy.

### 10.11 Transport-to-transport forwarding

IinPublic nodes may forward a Talk across heterogeneous transports.

```text
Android A
   |
Google Nearby
   |
Android B
   |
LAN
   |
Windows C
   |
Internet / QUIC
   |
Mac D
   |
Apple nearby transport
   |
iPhone E
```

All hops carry the same IinPublic message identity and security metadata.

A forwarding node must not need to understand the application payload unless Talk policy explicitly requires bridge transformation.

### 10.12 Platform helper isolation

Each proprietary or OS-specific API must live in a replaceable adapter.

```ts
interface PeerTransport {
    id: string;
    isAvailable(): Promise<boolean>;
    startDiscovery(): Promise<void>;
    stopDiscovery(): Promise<void>;
    advertise(ad: DiscoveryAdvertisement): Promise<void>;
    connect(candidate: PeerCandidate): Promise<IinPublicLink>;
}
```

Examples:

```text
NearbyConnectionsTransport      -> Google-specific adapter
ApplePeerWifiTransport          -> Apple-specific adapter
WifiAwareTransport              -> standards-oriented adapter
BleTransport                    -> Bluetooth adapter
LanMdnsTransport                -> LAN discovery adapter
InternetTransport               -> IP transport adapter
RelayTransport                  -> IinPublic relay adapter
```

No platform adapter may own:

- IinPublic identity;
- Talk identity;
- encryption policy;
- message IDs;
- peer trust;
- routing semantics;
- bridge authorization.

Those belong to platform-independent IinPublic Core.

### 10.13 Startup behavior by platform

At startup, IinPublic probes capabilities rather than assuming them.

```text
Probe platform APIs
       |
       +--> permission granted?
       |
       +--> hardware available?
       |
       +--> service/runtime installed?
       |
       +--> network interface active?
       |
       v
Build ActiveTransportSet
```

Example Android:

```text
Nearby Connections     available
Wi-Fi Aware            available
BLE                     available
LAN                     available
Internet                available

Active: Nearby + Wi-Fi Aware + BLE + LAN + Internet
```

Example Windows desktop:

```text
BLE                     unavailable
Wi-Fi Direct            unavailable
LAN                     available
Ethernet                available
Internet                available

Active: LAN + Internet + known peers + IinPublic.com + DHT
```

Both remain fully valid IinPublic nodes.

### 10.14 User-facing platform simplicity

End users should not have to select technologies such as Nearby Connections, Wi-Fi Aware, Bonjour, BlueZ, or Wi-Fi Direct.

Default UI remains capability-oriented:

```text
Connectivity

[x] Find nearby IinPublic users
[x] Find users on my local network
[x] Find users through the Internet
[x] Reconnect to people I already know

[x] Allow this device to help bridge Talks
    Only while plugged in: [x]       // desktop/notebook optional policy

Mode: Automatic
```

Advanced diagnostics may expose the actual providers:

```text
Nearby
  BLE                     active
  Wi-Fi Aware             unsupported
  Google Nearby           active

Local network
  mDNS                    active
  LAN IP                  active

Internet
  IinPublic.com           active
  DHT                     active
  Relay                   standby
```

The main product rule is: **users choose desired behavior; IinPublic chooses the transport.**

## 11. Cross-platform bridging through Talks

Talks should be the common abstraction connecting IinPublic peers and external platforms.

A Talk is not tied to one transport or one external network.

```text
                   IinPublic Talk
                         |
       +-----------------+------------------+
       |                 |                  |
 IinPublic peers     Telegram bridge    Other bridge
       |                 |                  |
   P2P/Gun/etc.       bot/API/etc.        adapter
```

### 10.1 BridgeAdapter

Define a generic bridge interface.

```ts
interface TalkBridgeAdapter {
    id: string;
    platform: string;

    connect(config: BridgeConfig): Promise<void>;
    disconnect(): Promise<void>;

    receive(cb: (message: BridgeMessage) => void): void;
    send(message: TalkMessage): Promise<BridgeSendResult>;

    capabilities(): BridgeCapabilities;
}
```

Potential bridges:

```text
Telegram
Signal-like adapters where supported
Matrix
IRC
Discord
Slack
Email
SMS where platform/API permits
Web hooks / custom services
Other IinPublic installations
```

Availability depends on each platform's API and terms.

### 10.2 Talk as a bridge endpoint

A Talk can contain participants from multiple origins.

Example:

```text
Talk: San Diego Cycling

Alice       -> native IinPublic peer
Bob         -> native IinPublic peer
Carol       -> Telegram bridge
Dave        -> Matrix bridge
EventBot    -> web-service bridge
```

All messages enter the Talk message model and are then routed according to Talk policy.

### 10.3 Origin metadata

Every bridged message should carry immutable origin metadata.

```ts
interface TalkOrigin {
    platform: string;
    bridgeId?: string;
    externalConversationId?: string;
    externalMessageId?: string;
    externalSenderId?: string;
}
```

Do not present a bridged message as a cryptographically native IinPublic identity unless that identity has actually been linked and verified.

### 10.4 Identity linking

An external platform identity may optionally be linked to an IinPublic identity through an explicit verification flow.

Example:

```text
IinPublic Peer ABC
       |
       | user verifies ownership
       v
Telegram account XYZ
```

Until verified:

```text
Telegram:Carol
```

is distinct from:

```text
IinPublic Peer Carol
```

This prevents bridge-based impersonation.

### 10.5 Bridge loops

Cross-platform bridging can create message loops.

Example:

```text
IinPublic -> Telegram -> Matrix -> IinPublic -> ...
```

Every Talk message needs a globally unique message ID plus a route/history field or equivalent deduplication mechanism.

```ts
interface TalkEnvelope {
    messageId: string;
    origin: TalkOrigin;
    seenByBridges: string[];
    createdAt: number;
    payload: TalkPayload;
}
```

A bridge must not retransmit a message it has already processed.

### 10.6 Bridge permissions

Talk owners/moderators can configure:

```text
Telegram Bridge
[x] Receive messages
[x] Send messages
[ ] Allow file forwarding
[ ] Forward location
[x] Show platform badge
[x] Prevent anonymous external posting
```

Users should always be able to tell when content crossed an external platform boundary.

### 10.7 Bridge security boundary

End-to-end encryption has limits at a platform bridge.

If an IinPublic Talk forwards a message into Telegram, email, Slack, etc., that external platform receives a representation of the message.

Therefore the UI must clearly distinguish:

```text
Native IinPublic encrypted path
```

from:

```text
External bridge path
```

A Talk should support policies such as:

```text
Bridge security:
  Allow external bridges
  Ask before sending externally
  Never forward encrypted/private messages externally
```

## 12. Talks and discovery integration

Discovery can advertise capabilities without exposing Talk membership.

Example capabilities:

```text
supportsTalks
supportsFiles
supportsRelay
supportsBridge:telegram
supportsBridge:matrix
protocol:v3
```

After authentication, peers can negotiate richer capabilities.

A peer with bridge capabilities may act as an optional gateway for a Talk if policy allows.

Example:

```text
Phone A -- native P2P --> Phone B -- Telegram Bridge --> Telegram user
```

The bridge relationship must be explicit and visible to Talk participants.

## 13. Bridge redundancy

Bridges can also be redundant.

For a particular external Talk destination, more than one authorized bridge endpoint may exist.

```text
IinPublic Talk
     |
     +---- Bridge Node A ---- Telegram
     |
     +---- Bridge Node B ---- Telegram
```

Only one should normally forward a given message. Leader selection, deterministic routing, leasing, or message claiming can avoid duplicate delivery.

If Bridge A disappears, Bridge B can take over.

Do not rely on a single user's phone for a critical persistent bridge unless the Talk explicitly accepts that limitation.

## 14. Availability and fallback behavior

### Scenario A: Normal Internet

```text
IinPublic.com + known peers + DHT
           |
        direct P2P
```

### Scenario B: IinPublic.com unavailable

```text
known peers + nearby + LAN + gossip + DHT
```

### Scenario C: No Internet, same room

```text
BLE discovery
     |
Wi-Fi Aware / Wi-Fi Direct
     |
IinPublic Talk
```

### Scenario D: Same Wi-Fi, no Internet

```text
mDNS / LAN discovery
      |
local direct connection
```

### Scenario E: Cellular networks behind carrier NAT

```text
rendezvous / known peer
       |
NAT traversal attempt
       |
 direct if possible
       |
 relay fallback
```

### Scenario F: Native peer cannot reach external platform

```text
Talk
 |
reachable authorized peer with bridge
 |
external platform
```

## 15. Health scoring and route selection

Maintain health for discovery providers and candidate routes.

Possible metrics:

```text
lastSuccess
lastFailure
successRate
latency
connectionDuration
bytesTransferred
batteryCost
meteredCost
```

Providers should not be permanently disabled after temporary failures.

Use backoff and periodic retry.

Example:

```text
IinPublic.com timeout
     |
continue other providers immediately
     |
retry server later with exponential backoff
```

## 16. Battery and bandwidth management

Comprehensive discovery must not mean continuous expensive scanning.

Discovery Manager should adapt to application state.

### Foreground

Use aggressive discovery when the user is actively looking for people or opening a location Talk.

### Background

Use low-duty-cycle discovery, OS-supported background mechanisms, cached peers, and push/rendezvous mechanisms where appropriate.

### Charging / Wi-Fi

More aggressive peer maintenance and synchronization may be allowed.

### Metered cellular

Prefer compact discovery data and avoid unnecessary bulk synchronization.

## 17. Observability and diagnostics

Provide an advanced diagnostic screen.

Example:

```text
Discovery status

IinPublic.com      Connected     8 candidates
Known peers        Active        14 candidates
Local Wi-Fi        Active         2 candidates
Bluetooth          Active         1 candidate
Wi-Fi Aware        Unsupported
DHT                Connected      6 candidates

Verified peers:                  11
Direct connections:               4
Relay connections:                2
Talk bridges:                      1
```

For each peer:

```text
Peer ABC123
Identity: verified
Found by: IinPublic.com, gossip, BLE
Connected by: local Wi-Fi
Alternative paths: IPv6, relay
Last seen: 12 seconds ago
```

This is invaluable for development while keeping the normal UI simple.

## 18. Data model separation

Keep the following concepts separate:

```text
DiscoveryCandidate
        |
        v
VerifiedPeer
        |
        v
Connection
        |
        v
TalkParticipant
```

External participants have a parallel model:

```text
ExternalIdentity
        |
        v
BridgeConnection
        |
        v
TalkParticipant
```

This prevents network-address information, identity, transport state, and Talk membership from becoming entangled.

## 19. Suggested implementation phases

### Phase 1: Unify current discovery

- Create `PeerDiscoveryManager`.
- Convert existing IinPublic.com discovery into `IinPublicBootstrapProvider`.
- Add `KnownPeerProvider`.
- Normalize candidates into `PeerCandidate`.
- Separate discovery from identity verification.
- Add diagnostics.

This phase should not substantially change existing user behavior.

### Phase 2: Local redundancy

- Add LAN/mDNS discovery.
- Add BLE discovery.
- Add platform-native nearby transport where practical.
- Add rotating ephemeral nearby identifiers.
- Add authenticated peer handshake.

At this point nearby users can find each other even if IinPublic.com is unreachable.

### Phase 3: Peer gossip

- Implement signed PeerRecord.
- Exchange bounded peer records among authenticated peers.
- Cache validated records.
- Add health and expiration logic.

### Phase 4: Internet decentralization

- Add DHT provider.
- Add NAT traversal.
- Add relay discovery and encrypted relay transport.
- Allow community relay/bootstrap nodes.

IinPublic.com remains useful but is no longer structurally required for an established network.

### Phase 5: Talk bridges

- Define `TalkBridgeAdapter`.
- Implement message origin metadata and deduplication.
- Add first external bridge.
- Add bridge permission UI.
- Add explicit security-boundary indicators.

### Phase 6: Redundant bridges

- Multiple bridge-capable peers per Talk.
- Failover.
- Duplicate suppression.
- Bridge health scoring.
- Policy-based bridge selection.

## 20. Recommended first bridge

Choose the first bridge based on API stability and development usefulness rather than trying to support many platforms immediately.

The first implementation should validate:

- external participant identity representation;
- inbound message conversion;
- outbound message conversion;
- attachment handling;
- duplicate prevention;
- loop prevention;
- user-visible platform badges;
- permissions;
- failure/retry semantics.

Once `TalkBridgeAdapter` is stable, adding additional external platforms becomes much easier.

## 21. Core architectural rule

The entire system can be summarized as:

```text
Discovery tells us WHERE a peer may be.
Cryptography tells us WHO the peer is.
Connection Manager decides HOW to reach it.
Talks define WHAT communication belongs together.
Bridges decide WHERE ELSE a Talk may reach.
Gun/IinPublic data defines WHAT is synchronized.
```

IinPublic.com participates strongly in the first category, but it does not control the others.

## 22. Desired end-user experience

For a normal user:

1. Install IinPublic.
2. Grant the desired nearby/network permissions.
3. IinPublic.com immediately helps bootstrap the app.
4. Nearby, LAN, remembered-peer, gossip, and decentralized discovery happen automatically.
5. The app chooses the best available connection without requiring network configuration.
6. A Talk continues as the device switches between Wi-Fi, cellular, nearby direct links, or relay paths.
7. External-platform participants can join through authorized Talk bridges.
8. Users can always see when a message originates from or is being sent to an external platform.
9. Advanced users can inspect and override discovery, privacy, transport, and bridge policies.

The target is not merely "serverless discovery." The target is a resilient discovery fabric in which centralized infrastructure, decentralized Internet discovery, physical proximity, local networking, prior relationships, and cross-platform bridges cooperate rather than compete.

## 23. Product Goal: Build a Public Image Through Talks

The networking system exists to support IinPublic's higher-level product goal: **a person builds a public image through communication in Talks**.

IinPublic is therefore not primarily a peer-discovery product, a private messenger, or a generic mesh network. Discovery, transport redundancy, bridging, and cryptographic identity are infrastructure that make meaningful Talk participation possible across places, devices, networks, and platforms.

A useful mental model is:

```text
             person / persistent identity
                       |
              participates in Talks
                       |
       +---------------+---------------+
       |               |               |
   asks/answers      creates       responds/helps
   questions          Talks          other people
       |               |               |
       +---------------+---------------+
                       |
                interaction history
                       |
        context + relationships + evidence
                       |
                       v
                  PUBLIC IMAGE
```

The public image should emerge from communication and behavior rather than being only a self-written profile. A profile may state what a person claims about themselves; Talks provide evidence of what the person discusses, knows, contributes, asks, answers, supports, disagrees with, and repeatedly engages with.

### 23.1 Public image is not a popularity score

The design should avoid collapsing a person into a single rating, follower count, or global reputation number. Public image should be a graph of contextual evidence.

Examples include:

```text
Person
  |
  +-- Talks about FPGA / hardware
  |      +-- answered questions
  |      +-- received useful replies
  |      +-- recurring participants
  |
  +-- Talks about cycling
  |      +-- local interactions
  |
  +-- neighborhood Talks
  |      +-- recommendations
  |      +-- help offered
  |
  +-- software-development Talks
         +-- technical questions
         +-- solutions
         +-- collaborations
```

Different observers may form different views of the same person from different subsets of this graph. IinPublic should preserve that context instead of declaring one universal reputation.

### 23.2 Talks are the primary social object

A Talk is more than a transport session or chat thread. It is a persistent, addressable communication object that can connect people, topics, places, contexts, and later interactions.

```text
Talk
  +-- TalkID
  +-- participants / audiences
  +-- creator and signed contributors
  +-- topic / tags / context
  +-- optional location context
  +-- messages / questions / answers
  +-- references to related Talks
  +-- visibility policy
  +-- bridge policy
  +-- provenance
  +-- timestamps
```

The same Talk identity must survive changes in transport. A Talk discovered through IinPublic.com and continued through BLE, Wi-Fi Aware, LAN, cellular Internet, a desktop bridge, or a relay remains the same Talk.

### 23.3 Discovery should optimize for relevant Talks as well as peers

The Discovery Manager should eventually support two related searches:

```text
findPeer(peerId)
findTalk(criteria)
```

A user normally should not need to think in terms of network peers. The product-level experience should be closer to:

```text
"What is being talked about around me?"
"Who is talking about FPGA development?"
"Are there Talks relevant to this location?"
"Continue the Talk I participated in yesterday."
```

The networking layer may discover devices, but the application should surface relevant Talks and people according to the user's visibility and privacy policies.

### 23.4 Public-image evidence and provenance

Anything used to construct public image must retain provenance. IinPublic should distinguish at least:

```text
SELF-ASSERTED
    profile information supplied by the person

AUTHORED
    Talks/messages cryptographically authored by the person

OBSERVED INTERACTION
    participation visible in a Talk

ENDORSED / REFERENCED
    another participant references or endorses an interaction

DERIVED
    locally calculated summaries/tags based on visible evidence

EXTERNAL / BRIDGED
    content imported from another platform through a Talk bridge
```

Bridged content must never silently become equivalent to native cryptographically signed IinPublic content. The UI and data model must preserve the source platform, bridge, original identifier when available, and the strength of identity binding.

### 23.5 Identity continuity across devices

Because public image accumulates over time, device identity and person identity cannot be identical concepts.

```text
                    Person Identity
                         /   |   \
                        /    |    \
                  Android  iPhone  Desktop
                     key     key      key
```

A person should be able to authorize multiple device keys under a persistent identity. Losing or replacing a phone should not destroy the person's Talk history or public image. Device additions, removals, and key rotations must be signed and auditable.

This also allows a desktop or notebook to act as an always-on bridge without giving it unrestricted authority over every aspect of the person's identity.

### 23.6 Cross-platform Talks expand the public communication graph

Talk bridges are strategically important because a person's communication may occur across multiple systems. A Talk can connect IinPublic participants with authorized external platforms while preserving source boundaries.

```text
                   IinPublic Talk
                         |
          +--------------+--------------+
          |              |              |
      IinPublic       Web/desktop    External bridge
       phones            peers            |
          |                                +-- future platform A
          |                                +-- future platform B
          |                                +-- email/web gateway
          |
       native signed
       participation
```

The bridge's purpose is not to make all platforms indistinguishable. It is to allow communication to cross boundaries while retaining provenance and permissions.

### 23.7 User control over public-image contribution

Easy configuration is a product requirement. Users should not need to configure transports, but they must understand and control what contributes to their public presence.

Recommended top-level controls:

```text
Discovery
  Nearby discovery                         ON
  Internet discovery                       ON

Public presence
  Let others discover my public Talks      ON
  Let nearby users discover my presence    ON/OFF

Talk participation
  Default new Talk visibility              [Public / Limited / Private]
  Allow my public participation to appear
  in my public image                       ON

Bridges
  Allow external-platform bridges          ASK

Advanced networking
  Automatic                                ON
```

Transport-specific controls belong under Advanced settings. The normal user should express social/privacy intent, while IinPublic chooses BLE, Wi-Fi Aware, Nearby Connections, Bonjour/mDNS, QUIC, relays, and other mechanisms automatically.

### 23.8 Privacy boundary: discovery is not publication

A critical rule is:

```text
being discoverable != publishing identity
being connected    != publishing a Talk
participating      != making everything public
```

Nearby radio discovery must continue using rotating ephemeral identifiers. A stranger detecting an IinPublic device nearby should not automatically receive the person's persistent identity, complete Talk history, or public-image graph.

The application reveals information only according to the Talk's visibility policy and the person's public-presence policy after the appropriate authenticated protocol steps.

### 23.9 Abuse resistance for public image

Once Talks influence public image, attackers have incentives to manipulate them. The design must account for:

- fake identities and Sybil networks creating artificial agreement or popularity;
- coordinated endorsements or attacks;
- forged bridged messages;
- replayed/decontextualized old Talks;
- spam intended to associate unwanted topics with a person;
- impersonation across external platforms;
- malicious edits that alter historical meaning.

Mitigations should emphasize verifiable provenance rather than a central authority deciding reputation. Signed authorship, immutable message identifiers, contextual links, bridge provenance, block/report controls, rate limiting, and locally computed views are preferred building blocks.

### 23.10 Architectural consequence

The stack should therefore be understood as:

```text
                 PUBLIC IMAGE / PERSON GRAPH
                            |
                    Talks + relationships
                            |
                  Talk routing / bridging
                            |
                authenticated peer identity
                            |
                  IinPublic Link abstraction
                            |
                   Connection Manager
                            |
                    Discovery Manager
                            |
  +-----------+-----------+-----------+-----------+
  |           |           |           |           |
IinPublic   Nearby       LAN         DHT        Known
   .com     radio       mDNS       /gossip      peers
                            |
              Android / iOS / macOS /
                 Windows / Linux
```

This ordering is intentional. The discovery system is not the product goal. Its job is to make the Talk graph resilient enough that communication—and therefore the evidence from which a person's public image develops—can continue across network failures, physical proximity, device changes, operating systems, and external-platform boundaries.

## 24. Updated design principle

The system can now be summarized as:

```text
Discovery tells us WHERE communication is possible.
Cryptography tells us WHO authored an interaction.
Connection Manager decides HOW to carry it.
Talks preserve WHAT was communicated and its context.
Bridges extend WHERE a Talk can reach while preserving provenance.
The Talk graph shows HOW people interact over time.
A person's public image emerges from that communication graph.
```

IinPublic.com remains an important bootstrap and discovery participant, but no single transport, platform vendor, server, or bridge defines the person's identity or owns the Talk graph.
