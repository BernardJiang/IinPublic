# IinPublic Mobile (Android + iOS via nodejs-mobile)

Both mobile apps embed a real Node runtime (via
[nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile)) that runs the
**same** embedded local node as desktop (`dist/server/node-app/embedded-node.js`).

```
┌─────────────────────────── device ───────────────────────────┐
│  WebView (system)            nodejs-mobile (embedded Node)     │
│  ┌─────────────────┐         ┌──────────────────────────────┐ │
│  │ reused web SPA  │  HTTP/  │ embedded-node → src/server    │ │
│  │ (dist/web)      │ ◄─────► │  · Gun peer + radisk on-device│ │
│  │ UI only         │  ws://  │  · dials hub: discovery only  │ │
│  └─────────────────┘ 127.0.0.1│  · serves dist/web           │ │
│                              └──────────────┬───────────────┘ │
└──────────────────────────────────────────────│───────────────┘
                                                │ discovery/signaling
                                        ┌───────▼────────┐
                                        │  public hub    │
                                        └───────┬────────┘
                                                │ direct P2P (Gun mesh)
                                        ┌───────▼────────┐
                                        │   other peers  │
                                        └────────────────┘
```

Key property: the **Node process is the peer**, the WebView is UI-only. So
WKWebView's limited WebRTC does not block P2P — the mesh/transport lives in Node.

## Shared Node project — `nodejs-project/`

`main.js` is the nodejs-mobile entry. At build time both platforms stage:
- `platforms/mobile/nodejs-project/` (this dir — `main.js` + `package.json`, whose one real
  dependency is `gun`; see below for why), and
- `dist/embedded-mobile/server` (ONE bundled file, not the whole `dist/server` tree) + `dist/web`

into the app's bundle/assets. Build those first from the repo root:

```bash
npm run mobile:stage   # = build:web + build:server + build:embedded-mobile
```

**Why the server half is a single bundled file, not the raw `dist/server` tree:**
`NodeBridge.kt`'s `unpackIfNeeded` copies staged assets out of the read-only APK into the app's
writable sandbox ONE FILE AT A TIME via the Android `AssetManager` — `MainActivity.kt`'s own
comment already documents this costing 30–45 seconds on first launch. The unbundled
`dist/server` tree plus a separate `npm install` of express/gun/socket.io/helmet/cors/
bonjour-service/uuid and their transitive dependencies is 1000+ small files; collapsing the
server's own `require()` graph into one file (`scripts/build-embedded-mobile.js`, esbuild)
removes nearly all of that count, and also removes the per-*launch* (not just first-launch) cost
of Node's CommonJS resolver walking many small files on the mobile filesystem. Verify a change
to that script with `npm run smoke:embedded-node-mobile` — it boots the actual bundled artifact
in the same layout (`node_modules/gun` staged as a sibling, data dir == install dir) a real
device would and asserts `/health`, `/`, `/worker.js`, and both `gun.js`/`sea.js` (the two files
the browser Worker `importScripts()`) all serve correctly. `gun` stays a real dependency here —
not bundled away — because those last two are static HTTP file responses to the browser's own
Worker, not a server-side `require()`; bundling the *server's* code can never eliminate them (see
that script's header comment for the full detail, including why `Gun.serve`'s own `__dirname`
-based fallback for this stops working once bundled, and why the explicit
`express.static('/node_modules/gun', …)` route in `http-bootstrap.ts` is what actually serves it
here).

## Android

Native sources live in `android/` (extended in this change):
- `MainActivity.kt` — WKWebView equivalent; waits for the node port, loads UI.
- `NodeForegroundService.kt` — foreground service hosting the embedded node.
- `NodeBridge.kt` — libnode JNI wrapper.
- `android/app/src/main/CMakeLists.txt` + `cpp/native-lib.cpp` — CMake/JNI
  shim that calls `node::Start()`.

**Wire-up (corrected 2026-06 against the upstream docs — there is no Gradle
dependency coordinate for nodejs-mobile):**
1. Download the release ZIP from
   [nodejs-mobile/nodejs-mobile/releases](https://github.com/nodejs-mobile/nodejs-mobile/releases).
2. Copy `include/` → `android/app/libnode/include`, and
   `lib/{arm64-v8a,armeabi-v7a,x86_64}/libnode.so` →
   `android/app/libnode/lib/<abi>/`.
3. Keep `android/app/libnode/` local: it is ignored by git because it is a
   large third-party binary payload.

```bash
npm run mobile:stage
npm run android:build   # gradle stages nodejs-project + dist/embedded-mobile into assets
```

## iOS

Xcode target sources live in `platforms/ios/IinPublic/`:
- `AppDelegate.swift`, `ViewController.swift` (WKWebView), `NodeRunner.swift`
  (nodejs-mobile bootstrap).
- `platforms/ios/Info.plist` contains the ATS loopback exception.
- `platforms/ios/IinPublic.xcodeproj`, `project.yml`, and
  `NodeMobile-Bridging-Header.h` define the app target.

**Wire-up (corrected 2026-06 — there is no `nodejs-mobile-cocoapods` npm
package; see the detailed comment in `platforms/ios/Podfile`):** either vendor
[NodeMobile.podspec](https://github.com/JaneaSystems/nodejs-mobile/blob/mobile-master/NodeMobile.podspec)
from the nodejs-mobile repo and reference it via `:podspec =>`, or skip
CocoaPods and manually embed `NodeMobile.framework` (from the release ZIP's
`Release-universal/` path) as an Xcode "Embedded Binaries" entry, per
[the official iOS getting-started guide](https://nodejs-mobile.github.io/docs/guide/guide-ios/getting-started/).
The checked-in Xcode project expects
`platforms/ios/Frameworks/NodeMobile.xcframework`; that directory is ignored by
git because it is a large third-party binary. If you keep the nodejs-mobile
release under `third_party/nodejs-mobile-v18.20.4/`, run:

```bash
cd platforms/ios
./scripts/copy-xcframework.sh
```

Build the shared bundles first, then build in Xcode or with `xcodebuild`:

```bash
npm run mobile:stage
xcodebuild -project platforms/ios/IinPublic.xcodeproj -scheme IinPublic \
  -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

## Why this can't be compiled in CI here

Android/iOS native builds need the Android SDK + NDK/CMake, or Xcode, plus the
nodejs-mobile release binaries — none of which are present in this
environment, and the JNI/CMake (Android) and Xcode project (iOS) glue code
needs a real toolchain to write and verify correctly rather than being
authored blind. The TypeScript that the embedded node compiles to **is**
type-checked and unit-tested in CI (`npm run smoke:embedded-node`); the native
shells are verified on-device. `.github/workflows/build-apps.yml`'s `android`
and `ios` jobs already encode the steps above and degrade gracefully
(`::warning::`) where a step needs an artifact that isn't checked in yet.
