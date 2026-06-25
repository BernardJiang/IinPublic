# S3 — Cross-platform Native Clients with libp2p

> **Status:** Design (no code yet). **Builds on:** §25 (libp2p Transport Migration & IPFS
> Content Layer), §23 (Mesh Talk Delivery). **Sequenced after:** §25 L1–L3 (Helia/libp2p node
> bootstrap, mesh stream handler behind `MeshSession`, DHT+mDNS discovery) are already in-tree —
> see `src/web/services/web-content-node-service.ts`, `src/web/services/p2p-libp2p-mesh-session.ts`,
> `src/web/services/p2p-room-discovery.ts`.
> **Goal of S3:** ship a native desktop (and later mobile) shell that runs a *real* libp2p node
> with raw TCP/QUIC listeners and a **Circuit Relay v2 server**, so:
>   1. native nodes eliminate the browser's WebRTC-only constraint (raw sockets, no STUN/TURN/ICE), and
>   2. browser peers behind NAT can reach each other **through** a native node acting as a relay.
>
> This document is the implementation contract. Each numbered subsection below is buildable in
> isolation; concrete TypeScript interfaces are given verbatim and should be copied into the files
> named in §G.

---

## A. Shell choice — Electron vs Tauri

### A.0 The decisive constraint

The entire value of S3 is **running js-libp2p with real socket transports** (`@libp2p/tcp`,
`@libp2p/quic`) plus a `circuitRelayServer` service. A browser/webview JavaScript context
**cannot open raw TCP/QUIC listeners** — it is limited to WebRTC + WebSocket-client. Therefore the
native shell must provide an OS-level runtime that can:

1. open listening sockets (TCP/QUIC) and accept inbound dials, and
2. run the **existing** `js-libp2p` stack so the application-layer contract from §25
   (`P2PMeshFrame`, SEA binding verification, seen-set dedup, split-horizon TTL) stays
   **byte-identical** (REQ-LIBP2P-01 / REQ-LIBP2P-05).

Requirement (2) is the lever: `src/web/services/web-content-node-service.ts`,
`p2p-libp2p-mesh-session.ts`, and `p2p-room-discovery.ts` are all written against a structural
`Libp2pLike` interface (`handle` / `dialProtocol` / `contentRouting`). A native shell that runs the
**same js-libp2p instance** with a different transport config reuses 100% of that code. A shell that
runs a *different* libp2p (rust-libp2p) must re-implement the mesh protocol, SEA binding
verification, and seen-set in another language — violating "byte-identical."

### A.1 Tradeoff table

| Criterion | **Electron** | **Tauri (Rust backend)** | Notes / weight for S3 |
|---|---|---|---|
| Runs js-libp2p with raw sockets | ✅ Node.js main process opens TCP/QUIC directly | ⚠️ Rust webview cannot run JS sockets; needs a **Node sidecar** binary or **rust-libp2p** | **Decisive.** S3 = real sockets running our stack |
| Reuse of existing TS libp2p code | ✅ ~100% (`web-content-node-service.ts` drops in) | ❌ rust-libp2p ⇒ re-port mesh proto, SEA verify, seen-set to Rust; sidecar ⇒ reuse but reintroduces Node | Heavy weight — §25 byte-identical mandate |
| Installed binary size | ❌ ~85–120 MB (bundled Chromium + Node) | ✅ ~3–10 MB (system WebView2/WebKit) | Real but secondary for a desktop companion node |
| Memory footprint (idle) | ❌ ~120–200 MB | ✅ ~40–80 MB | Secondary |
| Security model | ⚠️ Node in main process = full FS/exec; mitigate via `contextIsolation`, no `nodeIntegration` in renderer, strict CSP, IPC allowlist | ✅ Rust core, capability/allowlist (`tauri.conf.json`), no JS↔OS by default | Manageable on Electron with discipline (§F) |
| JS↔native bridge surface | ✅ Single process; libp2p **in** Node main, renderer talks via typed `ipcMain`/`contextBridge` (1 hop) | ⚠️ Sidecar path = webview ⇄ Rust IPC ⇄ Node stdio (2 hops, 2 serialization boundaries) | Fewer hops = smaller key-exposure surface (§F) |
| Need a full Node.js runtime? | **Yes — and we want it** (it is what runs js-libp2p) | Tries to avoid Node, but our stack *is* Node-shaped; avoiding Node means rust-libp2p | The "avoid Node" Tauri win does not apply here |
| Mobile (iOS/Android) | ❌ not supported | ✅ Tauri 2.x mobile | Real Tauri win — but blocked by the same socket/runtime issue on mobile (see A.3) |
| Auto-update, code-sign, notarize | ✅ mature (`electron-updater`) | ✅ supported, younger ecosystem | Parity enough |

### A.2 Recommendation — **Electron for the native-desktop node (Phase 1)**

Choose **Electron**. The one criterion that dominates S3 — *run our existing js-libp2p stack with
raw TCP/QUIC sockets and a Circuit Relay server, byte-identical to the browser app* — is satisfied
natively and cheaply by Electron's Node.js main process and **only awkwardly** by Tauri (a Node
sidecar reintroduces the Node runtime Tauri exists to avoid, adds an IPC hop, and widens the
key-handling surface; rust-libp2p forces a second implementation of the mesh protocol that §25
explicitly forbids diverging).

Tauri's genuine advantages — binary size, idle memory, mobile — are real but secondary for a
**desktop companion relay node** whose job is to stay resident and relay traffic. We accept the
~100 MB footprint.

**libp2p deps vs full Node:** we need the **full Node runtime**, not just the libp2p deps, because
the libp2p TCP/QUIC transports and the DHT/relay services depend on Node's `net`/`dgram`/`dns` and
the worker/event-loop model. There is no "libp2p-only" subset that runs without Node.

### A.3 Mobile is deferred and explicitly out of Phase 1

Mobile cannot reuse the Electron answer (no Electron on iOS/Android) and cannot run js-libp2p with
raw sockets inside a webview either. The monorepo structure (§B) isolates the platform shells so a
**future** `native-mobile/` Tauri-2-mobile + **rust-libp2p** shell can be added without touching the
shared node logic — it interoperates purely through the wire protocol (`/iinpublic/mesh/1.0.0`) and
the signed **`Libp2pBindingRecordV2`** in Gun (§C). Phase 1 ships desktop only; mobile peers remain
browser-PWA peers that *benefit* from native relays (§E/§F) without themselves being native nodes.

---

## B. Monorepo structure — `~/IinPublic/native-desktop/`

A small workspace **inside the existing repo** (not a separate repo) so the shared node logic can
`import` directly from `src/` without publishing a package. Uses npm workspaces.

```
~/IinPublic/
├── src/                              # EXISTING web/server/shared app (unchanged by S3)
│   ├── shared/                       #   p2p-runtime.ts, p2p-mesh-protocol.ts, types.ts …
│   └── web/services/                 #   web-content-node-service.ts, p2p-libp2p-mesh-session.ts,
│                                     #   p2p-room-discovery.ts  ← consumed, not forked
│
├── native-desktop/                   # NEW — npm workspace root for the native shell
│   │
│   ├── package.json                  # workspace root; declares the three packages below
│   ├── tsconfig.base.json            # shared TS config; paths → "@iinpublic/shared": "../src/shared"
│   │
│   ├── shared-node/                  # ── platform-AGNOSTIC libp2p node logic (the reusable core)
│   │   ├── package.json              #    name: @iinpublic/native-shared-node
│   │   ├── src/
│   │   │   ├── createNativeLibp2pNode.ts   # builds js-libp2p w/ tcp+quic+circuitRelayServer
│   │   │   ├── nativeMeshHost.ts           # registers /iinpublic/mesh/1.0.0 (reuses Libp2pMeshRuntime)
│   │   │   ├── relayProvider.ts            # issues circuit-relay-v2 reservations to browser peers
│   │   │   ├── bindingPublisher.ts         # writes Libp2pBindingRecordV2 to Gun (SEA-signed)
│   │   │   ├── nodeSupervisor.ts           # lifecycle: start/stop/health/restart, status snapshot
│   │   │   └── index.ts
│   │   └── test/                           # jest unit tests (run under root `npm test`)
│   │
│   ├── electron-shell/               # ── Electron-SPECIFIC packaging + process wiring
│   │   ├── package.json              #    name: @iinpublic/electron-shell
│   │   ├── electron-builder.yml      #    code-sign / notarize / auto-update config
│   │   ├── src/
│   │   │   ├── main.ts               #    Electron main: boots shared-node in-process, owns Node
│   │   │   ├── preload.ts            #    contextBridge → typed, allow-listed IPC surface only
│   │   │   ├── ipc-contract.ts       #    shared IPC channel names + payload types (renderer↔main)
│   │   │   └── windows.ts            #    BrowserWindow that loads the EXISTING webpack SPA
│   │   └── resources/                #    icons, entitlements.mac.plist
│   │
│   └── mobile-shell/                 # ── PLACEHOLDER (Phase 2, Tauri 2 mobile + rust-libp2p)
│       └── README.md                 #    documents the wire-protocol-only interop contract
│
└── docs/design/S3-native-libp2p-shell.md   # this file
```

**Boundary rules (enforced in review):**

- `shared-node/` MUST NOT import from `electron`, `@tauri-apps/*`, or any DOM/webview global. It
  imports only from `@iinpublic/shared` (`src/shared`) and `js-libp2p`/`helia`. This is what lets a
  future rust shell ignore it and a future Node-sidecar Tauri reuse it verbatim.
- `electron-shell/` is the **only** package allowed to touch `electron`, the filesystem keystore, and
  process lifecycle. It depends on `shared-node`.
- The renderer `BrowserWindow` loads the **unchanged** webpack SPA. The SPA detects it is running
  inside the native shell via the preload-exposed `window.iinpublicNative` bridge and routes
  `ensureLibp2pNode()` to the in-process native node instead of the browser Helia node (§D.4).

---

## C. `Libp2pBindingRecord` schema extension (Circuit Relay multiaddr field)

### C.1 Current shape (in-tree, `src/web/services/p2p-libp2p-mesh-session.ts`)

```ts
type Libp2pBindingRecord = {
  userId: string;
  seaPub: string;
  peerId: string;
  addresses: string[];   // currently published EMPTY in browser (publishLocalBinding)
  issuedAt: string;
  proof: SignedP2PEnvelopeProof;
};
```

### C.2 S3 extension — `Libp2pBindingRecordV2`

Add this to **`src/shared/p2p-runtime.ts`** (shared so both the browser SPA and `shared-node/`
publish/consume the identical type). `v2` is additive and forward-compatible: consumers treat a
missing `v` as `1` and an absent `relayAddrs`/`nodeKind` as the old browser-only binding.

```ts
/** Node runtime kind — lets a dialer choose direct-socket vs relay vs webrtc-signaling. */
export type Libp2pNodeKind = 'browser' | 'native-desktop' | 'native-mobile';

/**
 * A Circuit Relay v2 reservation this peer holds. `relayAddr` is the full dialable multiaddr a
 * third party uses to reach THIS peer THROUGH the relay, i.e. it terminates in
 * `/p2p/<relayPeerId>/p2p-circuit/p2p/<thisPeerId>`.
 */
export interface Libp2pRelayReservation {
  /** Relay node's PeerId (the hop). */
  relayPeerId: string;
  /** Full circuit multiaddr to reach this peer via the relay. */
  relayAddr: string;
  /** ISO expiry copied from the relay's reservation voucher; consumers drop expired entries. */
  expiresAt: string;
}

export interface Libp2pBindingRecordV2 {
  /** Schema version. Absent ⇒ legacy v1 (browser-only, no relay/nodeKind). */
  v: 2;
  userId: string;
  seaPub: string;
  peerId: string;
  /**
   * Directly-dialable transport multiaddrs (e.g. `/ip4/.../tcp/4001`, `/ip4/.../udp/4001/quic-v1`,
   * `/dns4/.../tcp/443/wss`). Non-empty ONLY for native nodes or public WSS peers; pure browser
   * peers publish `[]` (they are reachable only via relay/webrtc-signaling).
   */
  addresses: string[];
  /** Circuit Relay v2 reservations through which this peer is reachable when not directly dialable. */
  relayAddrs: Libp2pRelayReservation[];
  /** Runtime kind of the publishing node. */
  nodeKind: Libp2pNodeKind;
  /** True when THIS node runs a `circuitRelayServer` and offers reservations to others. */
  isRelayProvider: boolean;
  issuedAt: string;
  /** Binding TTL (replay/Sybil defence, §24.2). Consumers reject `now > expiresAt`. */
  expiresAt: string;
  proof: SignedP2PEnvelopeProof;
}
```

**Signing payload** (extends `bindingSigningPayload` in `p2p-libp2p-mesh-session.ts`; the new fields
are covered by the SEA signature so a tampering relay cannot forge `relayAddrs`):

```ts
function bindingSigningPayloadV2(
  record: Omit<Libp2pBindingRecordV2, 'proof'>,
): Record<string, unknown> {
  return {
    type: 'libp2p-user-peer-binding',
    v: 2,
    userId: record.userId,
    seaPub: record.seaPub,
    peerId: record.peerId,
    addresses: record.addresses,
    relayAddrs: record.relayAddrs,
    nodeKind: record.nodeKind,
    isRelayProvider: record.isRelayProvider,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  };
}
```

### C.3 Example JSON

Native desktop node (directly dialable + acts as a relay):

```json
{
  "v": 2,
  "userId": "0xA1B2…seaPubUserId",
  "seaPub": "AbCd…seaPublicKey",
  "peerId": "12D3KooWNativeDesktopPeerIdAlice",
  "addresses": [
    "/ip4/203.0.113.7/tcp/4001",
    "/ip4/203.0.113.7/udp/4001/quic-v1",
    "/dns4/relay-alice.iinpublic.net/tcp/443/wss"
  ],
  "relayAddrs": [],
  "nodeKind": "native-desktop",
  "isRelayProvider": true,
  "issuedAt": "2026-06-24T18:40:00.000Z",
  "expiresAt": "2026-06-24T19:40:00.000Z",
  "proof": {
    "peerId": "12D3KooWNativeDesktopPeerIdAlice",
    "pub": "AbCd…seaPublicKey",
    "timestamp": "2026-06-24T18:40:00.000Z",
    "nonce": "f3a9…",
    "payloadHash": "9c1d…",
    "signature": "SEA…signature"
  }
}
```

Browser peer behind NAT (reachable only via Alice's relay):

```json
{
  "v": 2,
  "userId": "0xC3D4…seaPubUserBob",
  "seaPub": "EfGh…seaPublicKeyBob",
  "peerId": "12D3KooWBrowserPeerIdBob",
  "addresses": [],
  "relayAddrs": [
    {
      "relayPeerId": "12D3KooWNativeDesktopPeerIdAlice",
      "relayAddr": "/dns4/relay-alice.iinpublic.net/tcp/443/wss/p2p/12D3KooWNativeDesktopPeerIdAlice/p2p-circuit/p2p/12D3KooWBrowserPeerIdBob",
      "expiresAt": "2026-06-24T19:10:00.000Z"
    }
  ],
  "nodeKind": "browser",
  "isRelayProvider": false,
  "issuedAt": "2026-06-24T18:42:00.000Z",
  "expiresAt": "2026-06-24T18:57:00.000Z",
  "proof": { "peerId": "12D3KooWBrowserPeerIdBob", "pub": "EfGh…seaPublicKeyBob", "timestamp": "2026-06-24T18:42:00.000Z", "nonce": "1b7c…", "payloadHash": "44ef…", "signature": "SEA…sigBob" }
}
```

---

## D. Browser dial-upgrade flow

When a browser peer wants to talk to another peer, it reads that peer's `Libp2pBindingRecordV2` from
Gun and picks the cheapest reachable path **in priority order**: direct socket → circuit relay →
WebRTC signaling (legacy fallback).

### D.1 Diagram

```
 read Gun binding  →  verify SEA proof + TTL
 (LIBP2P_BINDINGS_KEY/<otherUserId>)
        │
        ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ binding.addresses.length > 0 ?  (peer is directly dialable)   │
 └──────────────────────────────────────────────────────────────┘
        │ yes                                  │ no
        ▼                                      │
 node.dialProtocol(addr,                       │
   /iinpublic/mesh/1.0.0)                       │
        │ ok → via:'direct' ✔                  │
        │ fail ↓                                ▼
        └────────────────►┌──────────────────────────────────────┐
                          │ binding.relayAddrs has fresh entry?   │
                          └──────────────────────────────────────┘
                                  │ yes                    │ no
                                  ▼                         │
                          node.dialProtocol(relayAddr,      │
                            /iinpublic/mesh/1.0.0)           │
                                  │ ok → via:'circuit-relay' ✔
                                  │ fail ↓                   ▼
                                  └───────►┌──────────────────────────────┐
                                           │ FALLBACK: WebRTC signaling    │
                                           │ (existing p2p-webrtc-session, │
                                           │  via createFallbackMeshSession)│
                                           │ → via:'webrtc-signaling'       │
                                           └──────────────────────────────┘
```

### D.2 Concrete interface — add to `P2PRoomDiscoveryService` (`p2p-room-discovery.ts`)

```ts
export type PeerDialVia = 'direct' | 'circuit-relay' | 'webrtc-signaling' | 'unreachable';

export interface PeerDialUpgradeResult {
  peerId: string;
  via: PeerDialVia;
  /** Open libp2p stream when via is 'direct' | 'circuit-relay'; null for webrtc/unreachable. */
  stream: Libp2pStream | null;
  /** Multiaddr actually used (direct or relay), for diagnostics. */
  dialedAddr: string | null;
}

export interface BindingResolver {
  /** Reads + SEA-verifies + TTL-checks the peer's binding; null if absent/invalid/expired. */
  resolve(otherUserId: string, otherPub: string): Promise<Libp2pBindingRecordV2 | null>;
}

export interface PeerDialUpgrader {
  /**
   * Attempt to open `/iinpublic/mesh/1.0.0` to `otherUserId`, upgrading through the priority
   * ladder (direct → circuit-relay). Returns via:'webrtc-signaling' WITHOUT a stream to signal
   * the caller should hand off to the existing WebRTC MeshSession fallback.
   */
  dialPeerWithUpgrade(args: {
    otherUserId: string;
    otherPub: string;
    protocol?: string; // default LIBP2P_MESH_PROTOCOL
  }): Promise<PeerDialUpgradeResult>;
}
```

### D.3 Reference algorithm (implementable as `P2PRoomDiscoveryService.dialPeerWithUpgrade`)

```ts
async dialPeerWithUpgrade({ otherUserId, otherPub, protocol = LIBP2P_MESH_PROTOCOL }) {
  const libp2p = (await this.ensureLibp2p()) as Libp2pLike | null;
  const binding = await this.bindingResolver.resolve(otherUserId, otherPub);
  if (!libp2p || !binding) {
    return { peerId: '', via: 'webrtc-signaling', stream: null, dialedAddr: null };
  }

  // 1) direct sockets first
  for (const addr of binding.addresses) {
    try {
      const stream = await libp2p.dialProtocol(addr, protocol);
      return { peerId: binding.peerId, via: 'direct', stream, dialedAddr: addr };
    } catch { /* try next addr */ }
  }

  // 2) circuit-relay reservations (skip expired)
  const now = Date.now();
  for (const r of binding.relayAddrs) {
    if (Date.parse(r.expiresAt) <= now) continue;
    try {
      const stream = await libp2p.dialProtocol(r.relayAddr, protocol);
      return { peerId: binding.peerId, via: 'circuit-relay', stream, dialedAddr: r.relayAddr };
    } catch { /* try next relay */ }
  }

  // 3) legacy WebRTC signaling fallback (no stream — caller hands off to existing MeshSession)
  return { peerId: binding.peerId, via: 'webrtc-signaling', stream: null, dialedAddr: null };
}
```

**Wiring:** `getOrCreateLibp2pMeshSession` (existing) currently only resolves a bare `peerId` and
calls `node.dialProtocol(peerId, …)`. S3 replaces `resolveRemotePeerId()` + the `sendMeshFrame`
dial with a call to `dialPeerWithUpgrade`. When the result is `via:'webrtc-signaling'`, the existing
`createFallbackMeshSession` path (already wired in `app.ts:1268`) takes over — **no new fallback code
is needed**, only the upgrade ladder in front of it.

### D.4 Native-shell short-circuit

Inside the Electron shell the renderer's `ensureLibp2pNode()` resolves to the **in-process native
node** (via the preload bridge), which already has direct TCP/QUIC dialers. The same
`dialPeerWithUpgrade` runs, but step 1 (direct) succeeds far more often because the native node can
dial raw sockets the browser could never reach.

---

## E. Native-node shortcut flow (skip WebRTC entirely)

When **both** the local node and the peer are native (`nodeKind` ∈ `{native-desktop, native-mobile}`
with non-empty `addresses`), there is no NAT/webview constraint — dial TCP/QUIC directly and never
touch WebRTC signaling.

```
 local native node                              peer native node
 (has TCP/QUIC dialers)                         (Libp2pBindingRecordV2,
        │                                        addresses:[tcp,quic], nodeKind:native-*)
        ▼
 resolve binding (Gun) ──── verify SEA proof + TTL ────►
        │
        ▼
 nodeKind === 'native-*' && addresses.length > 0 ?
        │ yes
        ▼
 node.dialProtocol('/ip4/…/udp/…/quic-v1',          ┌───────────────────────────┐
                   '/iinpublic/mesh/1.0.0') ───────►│ inbound stream handler     │
        │  Noise handshake (Ed25519 PeerID)          │ (nativeMeshHost, reuses    │
        │  ── NO STUN / NO ICE / NO WebRTC ──        │  Libp2pMeshRuntime)        │
        ▼                                            └───────────────────────────┘
 send P2PMeshFrame (newline-delimited JSON)  ───────►  verify + dedup + dispatch
```

This is the cheapest path and the primary reason native nodes exist. It is already structurally
expressed: `Libp2pMeshSession.sendMeshFrame` calls `node.dialProtocol(...)`; on a native node the
dialed multiaddr is a real socket, so the *same code* yields a direct connection with zero WebRTC.

---

## F. Sequence diagram — browser sends a talk through a native Circuit Relay

Scenario: **Bob (browser, behind symmetric NAT)** broadcasts a talk into a room.
**Carol (browser, behind NAT)** is a recipient. Neither can WebRTC-connect directly (both symmetric
NAT, no TURN). **Alice (native-desktop)** runs a Circuit Relay v2 server and holds reservations for
both. The talk flows Bob → Alice(relay) → Carol over `/iinpublic/mesh/1.0.0`.

```
 Bob (browser)        Gun graph            Alice (native relay)       Carol (browser)
     │                   │                       │                        │
     │ 1. publish binding V2 (relayAddrs=[Alice])│                        │
     │──────────────────►│                       │                        │
     │                   │◄── 1'. Carol publishes binding V2 (relayAddrs=[Alice]) ──│
     │                   │                       │                        │
     │ 2. read Carol binding (resolve+verify SEA proof, TTL ok)           │
     │◄──────────────────│                       │                        │
     │                   │                       │                        │
     │ 3. dialPeerWithUpgrade(Carol):            │                        │
     │    addresses=[] → skip direct             │                        │
     │    relayAddrs[0] = /…/p2p/Alice/p2p-circuit/p2p/Carol              │
     │                                           │                        │
     │ 4. dialProtocol(relayAddr, /iinpublic/mesh/1.0.0)                  │
     │     ── Noise handshake to Alice ──►        │                        │
     │                                           │ 5. relay forwards circuit
     │                                           │    stream to Carol      │
     │                                           │───── HOP ──────────────►│
     │                                           │   (Noise: Bob⇄Carol     │
     │                                           │    end-to-end; Alice     │
     │                                           │    cannot read frames)   │
     │                                           │                        │
     │ 6. send P2PMeshFrame{kind:'talk-announce',│                        │
     │    proof:SEA-signed by Bob}  ────────────────────────────────────►│
     │                                           │                        │ 7. verify SEA origin
     │                                           │                        │    (frame.originUserId
     │                                           │                        │     == Bob's seaPub) ✔
     │                                           │                        │ 8. seen-set dedup, then
     │                                           │                        │    receiver intake filter
     │                                           │                        │    (talkPassesIntakeFilters)
     │                                           │                        │
     │ 9. talk-body-request (Carol → Bob, same circuit, reverse) ◄────────│
     │◄──────────────────────────────────────────────────────────────────│
     │ 10. talk-body (ciphertext) ───────────────────────────────────────►│
     │                                           │                        │ 11. render incoming talk
```

**Invariants preserved across the relay (all already in §23/§25 code):**

- Alice (the relay) sees only Noise-encrypted circuit bytes — the **`P2PMeshFrame` is SEA-signed and
  the pair payload is SEA-encrypted end-to-end**; the relay is a dumb hop, never a data path
  (§23.1 principle 1 still holds — the relay forwards ciphertext, it does not originate/store talk
  data).
- Frame verification (`verifySignedP2PEnvelopeProof`), seen-set dedup, TTL/split-horizon forwarding,
  and receiver-side intake filtering are **unchanged** — the relay only changes the transport
  multiaddr, not the application layer (REQ-LIBP2P-01).

---

## G. Security considerations — key management across the JS↔native bridge

The hard rule: **Gun SEA private keys MUST stay in the process that owns application identity and
MUST NOT cross the JS↔native IPC boundary or hit disk in plaintext.** Two key namespaces exist and
must not be conflated (REQ-LIBP2P-02):

| Key | Owner | Crosses IPC? | Persistence |
|---|---|---|---|
| **SEA pair** (app identity: frame signing, ECDH pair cipher, binding signature) | renderer (web crypto / SEA), same as today | **Never** | OS keychain via safeStorage, ciphertext only |
| **Ed25519 PeerID** (transport security only — Noise handshake) | native node (main process) | PeerID *public* only | main-process keystore; private key never to renderer |

### G.1 Where the SEA key lives

Keep the SEA pair exactly where it is today: **in the renderer** (the webpack SPA), held in the
existing `sea-gun` runtime and `WebUserService.putPrivateUserData` SEA store. The native node does
**not** need the SEA private key — it only needs the **PeerID** keypair to secure the transport. The
binding record (§C) is **signed in the renderer** (where the SEA priv already is) and only the
*signed, public* `Libp2pBindingRecordV2` is handed to the node for publishing.

```
 renderer (owns SEA priv)                 preload bridge          main / native node (owns PeerID priv)
        │                                      │                         │
        │ 1. node.getLocalPeerInfo() ─────────►│ ipc:getPeerInfo ───────►│ returns {peerId, addresses,
        │◄──────────── {peerId, addresses, relayAddrs} ─────────────────│  relayAddrs}  (PUBLIC only)
        │                                                                 │
        │ 2. build + SEA-sign Libp2pBindingRecordV2  (SEA priv stays here)│
        │                                      │                         │
        │ 3. publishBinding(signedRecord) ────►│ ipc:publishBinding ────►│ writes to Gun
        │    (only PUBLIC signed record crosses the bridge)              │
```

### G.2 Bridge rules (enforced in `preload.ts` + `ipc-contract.ts`)

- **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`** on the `BrowserWindow`.
  The renderer never gets `require`/`process`/`fs`.
- The preload exposes a **narrow, typed** `window.iinpublicNative` surface — **no generic "invoke
  arbitrary channel"**. Each method is an explicit allow-listed channel:

```ts
// native-desktop/electron-shell/src/ipc-contract.ts
export interface IinpublicNativeBridge {
  /** PUBLIC peer info only — never returns private key material. */
  getPeerInfo(): Promise<{ peerId: string; addresses: string[]; relayAddrs: Libp2pRelayReservation[] }>;
  /** Accepts an already-SEA-signed binding; main never signs, never sees SEA priv. */
  publishBinding(signed: Libp2pBindingRecordV2): Promise<void>;
  /** Opens /iinpublic/mesh/1.0.0; returns an opaque session handle, not the raw stream. */
  dialPeer(args: { otherUserId: string; otherPub: string }): Promise<{ via: PeerDialVia }>;
  /** Frame I/O: renderer sends/receives already-SEA-signed-and-encrypted P2PMeshFrames. */
  sendFrame(handle: string, frame: P2PMeshFrame): Promise<void>;
  onFrame(cb: (originUserId: string, frame: P2PMeshFrame) => void): () => void;
  getNodeStatus(): Promise<{ running: boolean; peerId: string; relayProvider: boolean; reason: string }>;
}
```

- **Only SEA-signed/encrypted `P2PMeshFrame`s cross the bridge.** Signing and pair-encryption happen
  **renderer-side** (where the SEA priv is) *before* `sendFrame`; verification/decryption happen
  renderer-side *after* `onFrame`. The native node forwards opaque frames and never possesses the
  material to read or forge them — it is, by construction, the same "dumb relay" trust level as a
  Circuit Relay hop (§F). This means even a compromised main process cannot impersonate the user or
  read pair-private talk content.
- **PeerID private key** is generated and stored by the main process only, encrypted at rest via
  Electron `safeStorage` (OS keychain). It never crosses to the renderer; the renderer only ever
  receives the public `peerId` string.
- **Binding TTL + replay defence** (§C `expiresAt`, and the existing nonce/timestamp in
  `SignedP2PEnvelopeProof`) carry over unchanged — a stale or replayed binding is rejected by
  `BindingResolver.resolve` before any dial.
- **CSP / remote content:** the renderer loads only the bundled local SPA; no remote code execution.
  The relay accepts inbound circuit streams but every frame still passes SEA origin verification, so
  an attacker who reserves a relay slot cannot inject a forged talk.

### G.3 Threat summary

| Threat | Mitigation |
|---|---|
| Compromised main process exfiltrates SEA priv | SEA priv never leaves renderer; main holds only PeerID priv |
| Malicious relay reads/alters talk content | Frames SEA-signed + pair-encrypted end-to-end; relay sees ciphertext |
| Forged binding redirects dials to attacker | Binding SEA-signed (§C.2), TTL-checked, `seaPub` must match expected peer |
| Replayed stale binding | `expiresAt` + proof nonce/timestamp window |
| Renderer reaches OS via bridge | `sandbox:true`, no `nodeIntegration`, narrow typed allow-listed IPC |

---

## H. Build order (maps to files in §B; each step independently testable)

1. **`shared-node/createNativeLibp2pNode.ts`** — js-libp2p with `@libp2p/tcp`, `@libp2p/quic`,
   Noise, Kademlia DHT, mDNS, and `circuitRelayServer`. Unit test: node exposes
   `handle`/`dialProtocol`/`contentRouting` (satisfies existing `Libp2pLike`).
2. **`src/shared/p2p-runtime.ts`** — add `Libp2pBindingRecordV2`, `Libp2pRelayReservation`,
   `Libp2pNodeKind`, `bindingSigningPayloadV2`. Unit test: sign/verify round-trip incl. relay fields.
3. **`shared-node/bindingPublisher.ts` + `relayProvider.ts`** — publish V2 binding with real
   `addresses`/`relayAddrs`; issue relay reservations. Unit test: published record verifies + TTL set.
4. **`P2PRoomDiscoveryService.dialPeerWithUpgrade`** (§D) + `BindingResolver`. Unit test: priority
   ladder direct→relay→webrtc with mocked `dialProtocol`.
5. **Wire** `getOrCreateLibp2pMeshSession` to call `dialPeerWithUpgrade`; on `webrtc-signaling`,
   defer to existing `createFallbackMeshSession`. Unit test: fallback invoked only when ladder fails.
6. **`electron-shell/`** — main/preload/ipc-contract (§G); `BrowserWindow` loads existing SPA;
   renderer routes `ensureLibp2pNode()` to the bridge when `window.iinpublicNative` is present.
7. **E2E** — extend the hub-down discovery test (REQ-LIBP2P-03 acceptance) with one native relay
   node bridging two NAT-simulated browser peers (the §F scenario).

**Budget note (REQ-LIBP2P-07):** the Electron app bundles its own Node; the *web* bundle is
unchanged. Record the installed-size delta in the packaging PR.
