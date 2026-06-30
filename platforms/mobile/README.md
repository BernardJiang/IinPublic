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
- `platforms/mobile/nodejs-project/` (this dir), and
- the compiled `dist/server` + `dist/web`

into the app's bundle/assets. Build those first from the repo root:

```bash
npm run build:web
npm run build:server
```

## Android

Native sources live in `android/` (extended in this change):
- `MainActivity.kt` — WKWebView equivalent; waits for the node port, loads UI.
- `NodeForegroundService.kt` — foreground service hosting the embedded node.
- `NodeBridge.kt` — libnode JNI wrapper.

**Wire-up (corrected 2026-06 against the upstream docs — there is no Gradle
dependency coordinate for nodejs-mobile):**
1. Download the release ZIP from
   [nodejs-mobile/nodejs-mobile/releases](https://github.com/nodejs-mobile/nodejs-mobile/releases).
2. Copy `include/` → `android/app/libnode/include`, and
   `bin/{arm64-v8a,armeabi-v7a,x86_64}/libnode.so` → `android/app/libnode/bin/<abi>/`.
3. Add a `CMakeLists.txt` + minimal JNI shim (`android/app/src/main/cpp/`, none
   exists yet) exposing `startNodeWithArguments(String[])` → `node::Start()`,
   per [the official Android getting-started guide](https://nodejs-mobile.github.io/docs/guide/guide-android/getting-started/).
4. Wire `externalNativeBuild`/`ndk.abiFilters`/`sourceSets.jniLibs` in
   `android/app/build.gradle` (see the detailed comment there) and call the
   native method from `NodeBridge.startProject` instead of its current log stub.

```bash
npm run build:web && npm run build:server
npm run android:build   # gradle stages nodejs-project + dist into assets
```

## iOS

Xcode target sources live in `platforms/ios/IinPublic/`:
- `AppDelegate.swift`, `ViewController.swift` (WKWebView), `NodeRunner.swift`
  (nodejs-mobile bootstrap), `Info.plist` (ATS loopback exception).

**Wire-up (corrected 2026-06 — there is no `nodejs-mobile-cocoapods` npm
package; see the detailed comment in `platforms/ios/Podfile`):** either vendor
[NodeMobile.podspec](https://github.com/JaneaSystems/nodejs-mobile/blob/mobile-master/NodeMobile.podspec)
from the nodejs-mobile repo and reference it via `:podspec =>`, or skip
CocoaPods and manually embed `NodeMobile.framework` (from the release ZIP's
`Release-universal/` path) as an Xcode "Embedded Binaries" entry, per
[the official iOS getting-started guide](https://nodejs-mobile.github.io/docs/guide/guide-ios/getting-started/).
Then add a "Copy nodejs-project + dist into bundle" build phase and build in
Xcode (the `.xcodeproj`/`.xcworkspace` itself doesn't exist yet either — only
the Swift sources under `platforms/ios/IinPublic/` are checked in).

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
