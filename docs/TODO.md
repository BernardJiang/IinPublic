# IinPublic TODO

Last updated: 2026-07-06

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

### P0 — Conversation inbox, TechSupport bootstrap, and dev presence correctness `[Opus]`

**Why now:** the native-app + `dev:multi` topology is exposing product seams that
must be stable before expanding E2E coverage to app instances and production-like
LAN users.

- [ ] **Pairwise conversation hardening `[Opus]`:** the canonical pair thread
      model is now implemented (`conv_pair_<sorted users>`) and direct/manual
      messages reuse it across direct peer-detail sends and matched-talk
      continuations. Remaining acceptance criteria: both users see the same
      ordered history after reload/reconnect; read receipts/order are
      deterministic when both sides send concurrently; conversation list sorting
      uses most-recent activity across multiple partners; direct/manual threads
      remain clearly distinguished from support channels.
- [ ] **Conversation E2E depth `[Sonnet]`:** backfill UI tests for direct-message
      history depth: large history pagination/scroll performance (>50 messages),
      conversation deletion/editing behavior or an explicit unsupported-state
      assertion, and reload/reconnect checks for the canonical manual pair
      conversation once that product model is finalized.

### P1 — E2E coverage gaps to backfill `[Sonnet]`

- [ ] **Native app as E2E participant `[Opus]`:** execute the plan in
      `docs/testing/native-app-e2e-strategy.md`: run one and then two desktop app
      users alongside browser users through the shared hub, then extend the same
      pattern to Windows and mobile once device toolchains are ready.
- [ ] **LAN browser participant smoke `[Sonnet]`:** add a development-topology
      smoke for an ordinary browser user on a different PC on the same intranet:
      it must load the web app from the host dev server, connect to the shared
      Gun hub, appear in Global with TechSupport and local browser users, and
      exchange at least one direct/manual conversation message.
- [ ] **Production compatibility smoke `[Opus]`:** prove the production topology
      (`www.iinpublic.com` + public hub) remains compatible with the development
      topology assumptions: no app path may hard-code localhost-only peers unless
      it is explicitly native-loopback mode, and browser/native clients must use
      configured hub URLs consistently across dev, LAN, and production stages.

### S3 — Cross-platform native clients (embedded-node model) `[Opus]`

**Design:** `docs/design/S3-embedded-node-shell.md`. Supersedes the earlier
libp2p-native-module plan (kept as `docs/design/S3-native-libp2p-shell.md` for
reference). The libp2p Circuit-Relay items are deferred behind this model.

**Core idea:** every native build bundles a real **Node.js process** that runs
the *existing* `src/server` code as a **local Gun peer**. That local node:
- persists application data **on-device** via radisk (satisfies the
  "Gun-on-device is the source of truth" invariant — strictly better than
  browser storage),
- dials the public hub as an **upstream Gun peer for discovery only**
  (`relayOnlyDataClasses`: discovery / signaling / presence / room-membership),
- **serves the prebuilt web SPA** (`dist/web`) on `127.0.0.1:<port>`, so the
  WebView/renderer reuses **100% of the browser UI** unchanged. Because the UI
  loads from the local node, `WebGunService.deriveGunHubUrl()` already resolves
  Gun to the local node — no web code fork.

**Why this over Tauri/libp2p-module:** Electron runs the Gun *Node* code
unmodified and its Chromium renderer guarantees the WebRTC the direct-P2P
conversation transport relies on. On mobile, the **Node process is the peer** so
WKWebView's limited WebRTC never blocks P2P — the mesh lives in Node.

**Reuse map:** `src/server` (P2P/Gun node) 100% · `src/web`→`dist/web` (UI) 100%
· `src/shared` (domain/match) 100% · only the native shells are new code.

**Target platforms / hosting:**
- Windows / Linux / macOS → **Electron** (`platforms/desktop`): main process boots
  the embedded node in-process; renderer loads the SPA from loopback.
- Android → WebView + **nodejs-mobile** foreground service (`android/`,
  `platforms/mobile/nodejs-project`).
- iOS → WKWebView + **nodejs-mobile** (`platforms/ios`,
  `platforms/mobile/nodejs-project`).

**Done in this change:**
- [x] `src/shared/embedded-node-config.ts` — config resolver (enabled, platform,
      port, hub peers, webRoot, dataDir, loopbackOnly) + unit test (10 cases).
- [x] `attachGun` / `configureHttpMiddleware` embedded mode (env-gated, additive):
      dials hub peers upstream, forces on-device radisk, serves `dist/web`.
- [x] `src/node-app/embedded-node.ts` — single entry every shell boots; reuses
      `IinPublicServer`. Smoke-tested: boots, persists on-device, serves SPA,
      `/health` 200 on loopback.
- [x] Electron shell: `platforms/desktop/{main.js,preload.js,package.json}` +
      electron-builder targets (nsis / AppImage+deb / dmg).
- [x] Android shell: `MainActivity.kt` (WebView), `NodeForegroundService.kt`,
      `NodeBridge.kt`, manifest, gradle staging of `nodejs-project` + `dist`.
- [x] iOS shell: `AppDelegate/ViewController/NodeRunner.swift`, `Info.plist`
      (ATS loopback), `Podfile`.
- [x] Root scripts: `dev:embedded-node`, `build:embedded`, `desktop:dev`,
      `desktop:dist`, `mobile:stage`.

**Done 2026-06-30 (see `docs/completed.md`):** hub-dial verification (+ a real
bug found and fixed — embedded nodes were never actually dialing the hub);
Android `unpackIfNeeded` + POST_NOTIFICATIONS; desktop autoupdate
(electron-updater) + build-id drift safety net; E2E spec (browser peer +
embedded-node peer, direct-P2P DataChannel); CI embedded-node smoke job;
mobile-toolchain doc/comment corrections (the previous AAR/pod coordinates
referenced packages that don't exist).

**Remaining (needs device toolchains — not buildable in CI here):**
- [ ] Android: wire the real libnode JNI/CMake integration (no Gradle
      dependency coordinate exists for this — see the corrected, detailed
      steps in `android/app/build.gradle` and `platforms/mobile/README.md`);
      replace `NodeBridge.startProject`'s log-stub with the native call.
- [ ] iOS: vendor `NodeMobile.podspec` (or embed `NodeMobile.framework`
      manually) per the corrected `platforms/ios/Podfile` comment; add the
      Xcode "copy nodejs-project + dist into bundle" build phase; create the
      `.xcodeproj` (sources are ready under `platforms/ios/IinPublic`).
- [ ] **Hub hardening fix `[Opus]`:** Gun's wire protocol (`mesh.say`,
      `node_modules/gun/gun.js` ~line 1502) broadcasts every local `.put()` to
      **all** connected peers unconditionally — now that the hub-dial bug is
      fixed and embedded nodes actually peer to the hub, app-private graph
      writes (`talks/*`, `conversations/*`, `pairConversations/*`, etc.) ARE
      sent over that wire to the hub's in-memory graph, even though
      `radisk:false` keeps them off disk there. Needs either (a) a
      soul-classification-tracking outbound filter scoped to just the hub
      peer connection (nontrivial: nested `.get().get()` chains use
      auto-generated souls for child nodes, so a single-message filter can't
      classify them without tracking the relational graph as observed), or
      (b) replacing the generic Gun peer link to the hub with a narrower,
      explicit REST-only discovery channel (loses live `.on()` sync, a real
      product tradeoff). Write a design note first, then hand to Sonnet.
      `scripts/relay-only-verification/` has a real-process verification
      harness to validate the fix against (its runtime results were
      unreliable in a sandboxed CI-like environment — see the note at the top
      of `run.js` — so validate on a machine/CI where Gun's WS handshake
      completes reliably).

**Known runtime risks:**
- ✓ Gun replication timing on auto-reply path: mitigated by server POST path.
- ✓ `talkCompleted` handler fallback: verified, preserves data safely.
- ⚠ Gun has no native per-subgraph peer scoping — see "Hub hardening fix" above;
  this is now a concrete, code-cited finding rather than a hypothetical.

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
