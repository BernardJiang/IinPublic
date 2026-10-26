# Device core: one Gun, one copy of the app logic, a thin GUI

Status: **adopted 2026-10-25** (owner decision). Supersedes the "UI layer reused 100% / peer layer
reused 100%" split of `docs/archive/consolidated-2026-07-29/S3-embedded-node-shell.md`, whose
process model it keeps. Privacy rules: `docs/design/data-sharing-privacy-rules.md`.
TODO: OPEN-91 (this architecture), OPEN-88 (the exchange log, its first slice).

## Goal

The app is a GUI over a graph database. On every device there is **one Gun instance**, and **one
copy of the app logic** built on top of it:

- **Native apps** (Android, Windows, Ubuntu, macOS, iOS): the Gun instance and the app logic live in
  the **Node.js process** that each app already embeds (nodejs-mobile on phones, Electron's main
  process on desktop). It talks to other peers, reads and writes the device's storage, and serves
  the GUI.
- **Web browser**: the same app logic and its Gun instance live in a **background worker** that
  serves the page.
- **The GUI** (the WebView, the Electron window, the browser page) only draws and sends the user's
  intents. It keeps an in-memory view of what is on screen, filled and updated by the core.

The app logic is written once, in TypeScript, and runs unchanged in both hosts.

## How it drifted (as of 2026-10-25)

The S3 design meant the WebView to be UI-only. In practice:

- All app logic runs in the page: `src/web/app/app.ts` (~10,000 lines), `src/web/ui/*` and
  `src/web/services/*`, next to the DOM.
- The page runs **two Gun instances**: one connected to a peer (the hub on the web, the local
  embedded node over loopback in the apps), and one peerless in a Web Worker
  (`public/worker.js`, IndexedDB `gun-idb`) that holds private data.
- Much of the app's state is not in Gun at all but in localStorage (`myTalks`, `myConversations`,
  `localTalkExchanges`, the talk ledger, answer history, chatbot memory, ~25 keys).
- The embedded node runs the hub's server code (`src/server`) — rooms, routes, relay — not the
  app.
- Direct P2P (WebRTC data channels, `src/web/services/p2p-webrtc-session.ts`) runs in the page.

## Target

```
 Native app (one device)                              Web browser (one origin)
┌────────────────────────────────────────────┐      ┌────────────────────────────────────────┐
│ GUI: WebView / Electron window              │      │ GUI: the page                           │
│  · draws; sends intents                     │      │  · draws; sends intents                 │
│  · view model (in memory) ◄── patches ──┐   │      │  · view model (in memory) ◄─ patches ─┐ │
│  · WebRTC adapter (until Node has it)   │   │      │  · WebRTC adapter                     │ │
└──────────────┬───────────────────────────│──┘      └──────────────┬────────────────────────│─┘
     loopback WebSocket: core protocol     │              postMessage: core protocol         │
┌──────────────▼───────────────────────────┴──┐      ┌──────────────▼────────────────────────┴─┐
│ DEVICE CORE in Node.js                       │      │ DEVICE CORE in a worker                  │
│  · app logic (src/core) ← same code →        │      │  · app logic (src/core)                  │
│  · ONE Gun + sharing policy                  │      │  · ONE Gun + sharing policy              │
│  · storage: radisk on the file system        │      │  · storage: IndexedDB                    │
│  · peers: hub (relay), other devices         │      │  · peers: hub (relay), other devices     │
└──────────────────────────────────────────────┘      └──────────────────────────────────────────┘
```

### The device core (`src/core/`, new)

Everything that is not drawing:

- **Domain logic**: Talks (create, deliver, answer, match), the chatbot and its memory, the talk
  ledger, Contacts and relationships, the person↔tag graph, places, Me answers, statistics,
  Nearby cards, conversations.
- **One Gun instance** and the **sharing policy** that decides what may leave the device.
- **View projections**: for each screen, the rows it shows, computed from the graph and pushed to
  the GUI as a snapshot followed by patches.

It depends on the environment only through small **adapters**, one implementation per host:

| Adapter | Node.js host | Worker host |
|---|---|---|
| Storage under Gun | radisk on the file system | IndexedDB store (as `public/worker.js` does today) |
| Network to peers | WebSocket / HTTP to the hub and other devices | WebSocket / HTTP from the worker |
| Direct P2P | see "WebRTC" below | see "WebRTC" below |
| Crypto (SEA) | `require('crypto').webcrypto` installed as `globalThis.crypto` (nodejs-mobile is Node 18, no global WebCrypto) | the worker's WebCrypto |
| GUI link | loopback WebSocket server | `postMessage` |
| Platform | battery, background, notifications via the shell | page visibility, notifications via the page |

### The GUI

- Renders from its **view model**: in-memory, synchronous, filled at start-up from the core's
  snapshot and kept current by patches. It is a cache — never the source of truth, rebuilt at any
  time. Optionally a saved snapshot paints the first screen instantly after a cold start.
- Sends **intents** (like this tag, open this person, send this message) as commands; the core
  answers with results and view patches.
- Keeps only what is truly local to a screen: scroll positions, open dialogs, UI preferences.

### The core protocol (one schema, two transports)

```
GUI → core   command  { id, name, args }            e.g. answerTag, broadcast, sendMessage
GUI → core   query    { id, name, args }            e.g. peopleForTopic, placesOf
GUI → core   watch    { id, view, args }            e.g. contacts, talks, me, nearby
core → GUI   result   { id, ok, value | error }
core → GUI   view     { id, snapshot | patch }      rows added / changed / removed
core → GUI   event    { name, args }                toasts, incoming call to open a chat, …
```

Versioned; the same messages travel over `postMessage` (web) and the loopback WebSocket
(native). The GUI never touches Gun.

### WebRTC

Browsers do not offer `RTCPeerConnection` in workers, and the embedded Node has no WebRTC today.
Therefore:

- **Signalling, sessions, encryption and all P2P logic stay in the core.** The GUI hosts only a
  **WebRTC adapter**: it creates the `RTCPeerConnection`/data channels the core asks for and pipes
  bytes between them and the core. The core treats it as one more transport.
- On native, a later step may give the Node host its own WebRTC (a native data-channel module per
  platform) so P2P works without the GUI; until then the adapter lives in the WebView, as P2P does
  today.

### Web specifics

- **One core per origin**: a `SharedWorker` serves every open tab (supported by current Chrome,
  Firefox and Safari 16+); where unavailable, a dedicated worker per tab elects a leader with Web
  Locks and the others relay to it.
- **No localStorage in workers**: every piece of app state moves into the core's Gun (IndexedDB).

### iOS

The core runs in nodejs-mobile in the foreground only (the platform does not keep it alive in the
background); without JIT it is slower, which the view model hides from the screens.

## Is it doable?

Yes. Every part already runs somewhere in the codebase: Gun with radisk in Node (the embedded node),
Gun with IndexedDB in a worker (`public/worker.js`), the GUI talking to a local process over
loopback (the apps today), WebRTC in the page. What changes is where the app logic lives. The cost
is the move itself — app.ts and the services are entangled with the DOM and with localStorage — so
it is done in slices, each shippable and each keeping the app working.

Risks to settle along the way: WebRTC on native without the WebView (deferred, adapter first);
nodejs-mobile performance on iOS; one core across browser tabs; data migration from localStorage
without loss.

## Phases

Each phase ships on its own and keeps every test green.

1. **P1 — The core seam, first slice: the exchange log (OPEN-88).** Create `src/core/` with the
   protocol, the view-model mechanism and a typed graph store over Gun. Host it in the web worker
   (built from TypeScript, replacing `public/worker.js`'s ad-hoc commands). Move the exchange log
   from localStorage into the core's Gun (`local/exchanges/<peer>/<talk>/<direction>`), with a
   one-time migration, and give the GUI a `exchanges` view the existing readers use.
2. **P2 — The sharing policy.** One Gun's `out`/`in` filter (default deny) per
   `data-sharing-privacy-rules.md`; move the pair responses and the delivery journal into the core
   under it; extend the wire audit (spec 09) to every private namespace.
3. **P3 — The other local logs**: My Talks, My Conversations, the talk ledger, answer history,
   chatbot memory and templates move into the core's graph; the tag graph, places and statistics
   become core queries.
4. **P4 — The domain logic**: Talk delivery, answering, the chatbot, matching, Nearby and
   conversations move from `app.ts` into the core; the GUI sends commands.
5. **P5 — The native host**: the same core bundle runs in the embedded Node process; the WebView
   becomes GUI-only over loopback; its Gun instances go away.
6. **P6 — One Gun on the web**: the page's hub-connected Gun goes away; the worker core is the only
   one.

## Testing

- The core is plain TypeScript: unit tests run it in Node (Jest) — the same code both hosts run.
- e2e specs keep driving the GUI; seed helpers move from writing localStorage to core commands.
- The phone-path suite covers the native host; the wire audits cover the sharing policy.
