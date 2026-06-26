# S3 — Cross-platform native clients via embedded Node (design)

Status: in progress (desktop runnable; mobile scaffolded). Supersedes
`S3-native-libp2p-shell.md`.

## Goal

Ship IinPublic as native apps on **Windows, Linux, macOS, Android, iOS** while
reusing the existing web + server code as close to 100% as possible. Each app
runs a real **Node.js process** that connects to the original hub **only for
peer discovery**, then talks **directly P2P** with peers.

## Architecture

```
┌──────────────────────────── one device ────────────────────────────┐
│                                                                     │
│   UI layer (reused 100%)            Peer layer (reused 100%)        │
│   ┌───────────────────────┐         ┌──────────────────────────┐   │
│   │ web SPA  (dist/web)    │  http://│ embedded node            │   │
│   │ = src/web, unchanged   │ ◄──────►│ = src/server, unchanged  │   │
│   │ Gun client →127.0.0.1  │  ws://  │ · Gun peer + radisk      │   │
│   │ WebRTC datachannels    │127.0.0.1│ · serves dist/web        │   │
│   └───────────────────────┘         │ · dials hub: DISCOVERY    │   │
│      Electron renderer /            │   only                    │   │
│      Android WebView /              └────────────┬─────────────┘   │
│      iOS WKWebView                               │                 │
└───────────────────────────────────────────────────│───────────────┘
                                                      │ discovery / signaling
                                              ┌───────▼────────┐
                                              │  public hub    │  relay-only
                                              └───────┬────────┘
                                                      │ direct P2P
                              ┌───────────────────────┼───────────────────────┐
                        ┌─────▼─────┐           ┌──────▼──────┐         ┌──────▼──────┐
                        │ peer A    │           │ peer B      │   ...   │ peer N      │
                        └───────────┘           └─────────────┘         └─────────────┘
```

The key insight: the **UI and the peer are separate processes on the same
device**, bridged over loopback exactly like the browser bridges to the hub
today. The web client's `deriveGunHubUrl()` already returns `127.0.0.1:<port>`
when served from there, so no web code changes for the happy path.

## Why "node server inside" instead of a libp2p native module

| Concern | Embedded full Node (chosen) | libp2p native module |
|---|---|---|
| Code reuse | `src/server` runs verbatim | new node logic per platform |
| Gun persistence | radisk on-device, unchanged | must re-implement store bridge |
| UI changes | none (loads from local node) | new local-WS bridge protocol |
| WebRTC on mobile | irrelevant — Node is the peer | still needed in WebView |
| Risk | low; one entry, one config | high; parallel transport stack |

## Shell choice: Electron for desktop

- **Electron (chosen):** main process is real Node → Gun code runs unmodified
  with full radisk; Chromium renderer guarantees the WebRTC the direct-P2P
  conversation transport depends on. ~150 MB binary.
- **Tauri + Node sidecar:** smaller, but the system WebView (WebKitGTK on Linux
  especially) has inconsistent WebRTC — directly threatens the DM transport.
- **Plain Node + system browser:** Gun + WebRTC fine, but no app window, no
  mobile-parity foreground story, and `pkg` fights Gun's dynamic requires.

## Mobile: nodejs-mobile

Both Android and iOS embed a Node runtime via
[nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile) running
`platforms/mobile/nodejs-project/main.js`, which boots the same
`embedded-node.ts`. The WebView is UI-only and loads from the local node, so
WKWebView's limited WebRTC does not block P2P.

- Android: `NodeForegroundService` keeps the peer reachable while the app is in
  the foreground/recents (battery-friendly; no always-on background claim).
- iOS: foreground-scoped peer; no always-on node (App Store / OS limits). Future:
  notification-assisted wakeup (already modeled in `P2P_PLATFORM_DESCRIPTORS`).

## Configuration

`src/shared/embedded-node-config.ts` resolves a single `EmbeddedNodeConfig` from
env + shell-injected defaults:

| field | source | default |
|---|---|---|
| `enabled` | `IINPUBLIC_EMBEDDED_NODE` | false |
| `platform` | `IINPUBLIC_PLATFORM` | unknown |
| `localPort` | `IINPUBLIC_LOCAL_PORT` / `PORT` | 8080 |
| `hubGunPeers` | `IINPUBLIC_HUB_GUN_URL` (csv) | public hub when enabled |
| `webRoot` | `IINPUBLIC_WEB_ROOT` / shell | `dist/web` |
| `dataDir` | `IINPUBLIC_DATA_DIR` / shell | `radata` |
| `loopbackOnly` | `IINPUBLIC_LOOPBACK_ONLY` | true |

`attachGun` reads it to add the upstream hub peer and force on-device radisk;
`configureHttpMiddleware` reads it to serve `dist/web`. Both changes are additive
and env-gated — default (hub) server behavior is unchanged.

## Data flow & "discovery only"

Gun has no native per-subgraph peer scoping, so "discovery only" is enforced at
the application/relay layer, consistent with the existing design:
- the production hub runs `relayOnlyHub` (no application radata);
- the protocol classifies `relayOnlyDataClasses` (discovery, signaling, presence,
  room-membership) vs `localFirstDataClasses` (profiles, contacts, blocks,
  messages, talks, chatbot memory) — see
  `createP2PNodeProtocolSpec().syncPolicy`;
- conversations use the direct-P2P WebRTC transport, never the hub.

**Verification owed:** the embedded-node E2E must assert no `localFirst` app data
appears on the hub graph after a local node syncs.

## Build & run

```bash
# shared bundles (reused by every platform)
npm run build:embedded            # build:web + build:server

# desktop
npm run desktop:dev               # build + electron
npm run desktop:dist              # installers (win/linux/mac)

# headless embedded node (debugging)
npm run dev:embedded-node         # tsx src/node-app/embedded-node.ts

# android (needs Android SDK + nodejs-mobile AAR)
npm run mobile:stage && npm run android:build

# ios (needs Xcode + NodeMobile pod)
npm run mobile:stage && (cd platforms/ios && pod install)  # then build in Xcode
```

## Files

| Path | Role |
|---|---|
| `src/shared/embedded-node-config.ts` | config resolver (+ unit test) |
| `src/node-app/embedded-node.ts` | embedded entry every shell boots |
| `src/server/bootstrap/http-bootstrap.ts` | embedded-aware Gun + static SPA |
| `platforms/desktop/` | Electron shell |
| `platforms/mobile/nodejs-project/` | nodejs-mobile Node project |
| `android/app/src/main/.../*.kt` | Android WebView + foreground service |
| `platforms/ios/IinPublic/` | iOS WKWebView + nodejs-mobile bootstrap |

## Open items

Tracked in `docs/TODO.md` under "S3 — Remaining".
