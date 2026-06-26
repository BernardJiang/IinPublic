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

**Remaining (needs device toolchains — not buildable in CI here):**
- [ ] Pin & link `nodejs-mobile` AAR (Android) + `NodeMobile` pod (iOS); replace
      the `NodeBridge`/`NodeRunner` stubs with real engine start calls.
- [ ] Android: implement `unpackIfNeeded` asset→filesDir copy (or rely on the
      nodejs-mobile-gradle plugin); request POST_NOTIFICATIONS at runtime.
- [ ] iOS: add Xcode "copy nodejs-project + dist into bundle" build phase; create
      the `.xcodeproj` (sources are ready under `platforms/ios/IinPublic`).
- [ ] Hub hardening: confirm the public hub only relays `relayOnlyDataClasses`
      for embedded peers (it is already `relayOnlyHub` in prod — verify no app
      subgraphs sync upstream from a local node).
- [ ] Desktop autoupdate: ship UI + node together (electron-updater); never let
      `dist/web` and `dist/server` drift across an update.
- [ ] E2E spec: one browser peer + one embedded-node desktop peer in the same
      chatroom; exchange a talk, open a conversation, assert the direct-P2P
      DataChannel opens. (Reuse `tests/e2e/helpers/p2p-transport-e2e.ts`.)
- [ ] CI: add a headless smoke job that boots `embedded-node.js` and asserts
      `/health` + `/` serve (the manual check this change ran).

**Known runtime risks:**
- ✓ Gun replication timing on auto-reply path: mitigated by server POST path.
- ✓ `talkCompleted` handler fallback: verified, preserves data safely.
- ⚠ Gun has no native per-subgraph peer scoping — "discovery-only" is enforced at
  the app/relay layer (`relayOnlyHub` + local-first data classes), not by Gun.
  The embedded-node E2E must assert no private app data lands on the hub.

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
