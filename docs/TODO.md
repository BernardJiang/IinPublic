# IinPublic TODO

Last updated: 2026-06-24

This file tracks only open work. Completed items are archived in `docs/completed.md`.
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specifications.md` (§19.13, §19.14, REQ-P2P-09–29; mesh talk delivery design §23; libp2p/IPFS §25 — supersedes Phase D §24; find-similar §22)

## Model routing legend

Each item is tagged with the cheapest model that can do it reliably, to optimize token spend:

- **`[Opus]`** — distributed-correctness / ordering / architecture is the hard part; design mistakes cascade.
- **`[Sonnet]`** — standard implementation against an existing spec or pattern.
- **`[Haiku]`** — mechanical, fully specified work; running test suites; scaffolding from a written design.

Token-saving rules: for `[Opus]` items, have Opus write a short design note first, then hand implementation + tests to Sonnet. `- [ ] Test:` items belong to whichever model implemented the step.

---

## Open items

### S3 — Cross-platform native clients `[Opus]`

Add native builds that run a real libp2p node (TCP/QUIC), eliminating WebRTC signaling overhead for native↔native and exposing a Circuit Relay so browser peers can connect.

**Target platforms:** Windows, Linux, macOS desktop (Electron or Tauri); Android (WebView + Kotlin native module); iOS (WKWebView + Swift native module).

**Browser ↔ native-node connection design (chosen: hybrid):**
- Native↔native: libp2p direct TCP/QUIC via published multiaddrs in `Libp2pBindingRecord` (Gun path `p2p-peer-bindings/<userId>`, already spec'd).
- Browser↔native: native node runs `circuitRelayServer()` and includes the relay multiaddr in its `Libp2pBindingRecord`. Browser reads the record from Gun and dials via `@libp2p/webrtc` through that relay — no HTTP signaling needed.
- Browser↔browser: unchanged — Gun WebSocket + WebRTC with HTTP or Gun-pubsub signaling (see S2).

**Pieces to build:**
- [ ] Electron/Tauri shell (Windows/Linux/macOS): bundled libp2p node with `@libp2p/tcp`, `@libp2p/quic`, Circuit Relay v2 server, Kademlia DHT. Shares the same Gun hub WebSocket as the browser build.
- [ ] `Libp2pBindingRecord` extended with Circuit Relay multiaddr; published to Gun on startup; refreshed on address change.
- [ ] Browser-side dial upgrade: in `P2PRoomDiscoveryService.findRoomProviderPeerIds()`, if a peer has a `Libp2pBindingRecord` with a Circuit Relay addr, attempt `node.dialProtocol(peerId, '/iinpublic/mesh/1.0.0')` via the relay before falling back to Gun-WebRTC signaling.
- [ ] Native-node shortcut: for peers with a `Libp2pBindingRecord` in Gun at `p2p-peer-bindings/<userId>`, skip Gun-WebRTC signaling entirely and dial their multiaddrs via `node.dialProtocol(peerId, '/iinpublic/mesh/1.0.0')`.
- [ ] Android: WebView shell + Kotlin `Libp2pBridgeService` exposing a local WebSocket; same libp2p node logic as desktop.
- [ ] iOS: WKWebView shell + Swift `Libp2pBridgeService` over WKScriptMessageHandler; same circuit-relay logic.
- [ ] E2E spec: one browser peer + one native node in the same chatroom; exchange a talk and open a conversation; assert DataChannel opens through the Circuit Relay multiaddr from `Libp2pBindingRecord`.

**Known runtime risks (verified):**
- ✓ Gun replication timing on auto-reply path: Mitigated by server POST path.
- ✓ `talkCompleted` handler fallback: Verified, preserves data safely.

---

## Nightly cron jobs

| # | Time (PDT) | Command | Purpose |
|---|-----------|---------|---------|
| 1 | 2:00 AM | `npm run health` | Health check |
| 2 | 2:10 AM | `npm run test:e2e:parallel` | Full E2E suite, parallel workers |
| 3 | 2:20 AM | `npm run test:e2e:heavy` | Mass specs + stage4/5 + find-similar |
| 4 | 2:30 AM | `npm run test:e2e:mesh` | Talks-matching mesh tests sequentially |

---

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep SRS audit snapshots tied to code evidence and verification commands.
