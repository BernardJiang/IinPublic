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
- `NodeBridge.kt` — nodejs-mobile AAR wrapper.

Wire-up: uncomment `com.janeasystems:nodejs-mobile` in `android/app/build.gradle`,
add the nodejs-mobile gradle plugin, then:

```bash
npm run build:web && npm run build:server
npm run android:build   # gradle stages nodejs-project + dist into assets
```

## iOS

Xcode target sources live in `platforms/ios/IinPublic/`:
- `AppDelegate.swift`, `ViewController.swift` (WKWebView), `NodeRunner.swift`
  (nodejs-mobile bootstrap), `Info.plist` (ATS loopback exception).

Wire-up: `cd platforms/ios && pod install` after enabling the `NodeMobile` pod,
add a "Copy nodejs-project + dist into bundle" build phase, then build in Xcode.

## Why this can't be compiled in CI here

Android/iOS native builds need the Android SDK / Xcode + the nodejs-mobile
binaries, which aren't present in this environment. The TypeScript that the
embedded node compiles to **is** type-checked and unit-tested in CI; the native
shells are verified on-device.
