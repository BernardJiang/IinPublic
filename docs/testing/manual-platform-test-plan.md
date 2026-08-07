# Manual cross-platform test plan (macOS / Windows / Android)

Local-intranet acceptance test for the three packaged builds — no production hub exists
yet, so a Mac mini on the home network stands in as the shared relay for the duration
of the test.

Artifacts under test (built 2026-08-07):

| Platform | Artifact | Location |
|---|---|---|
| macOS (arm64) | `IinPublic-1.0.0-arm64.dmg` | `platforms/desktop/dist/` |
| Windows (x64) | `IinPublic Setup 1.0.0.exe` | `platforms/desktop/dist/` |
| Android (debug) | `app-debug.apk` | `android/app/build/outputs/apk/debug/` |

## Why a shared hub is required

Each app — desktop or Android — runs its own **embedded local Gun node**, bound to
`127.0.0.1` only (`IINPUBLIC_LOOPBACK_ONLY=1`, set unconditionally by both the Electron
main process and the Android foreground service). That local node dials **out** to one
hub URL for discovery/mesh sync; it never accepts inbound connections itself. So three
copies of the app on three separate machines, each defaulting to the (nonexistent)
production hub, cannot see each other. One reachable hub is required — the Mac mini,
on the LAN, filling that role.

Default hub URL baked into each build: `https://www.iinpublic.com/gun`.

## 0. One-time setup

### 0.1 Stand up the relay on the Mac mini

```bash
cd /path/to/IinPublic
npm run build:server
PORT=8080 node dist/server/server/index.js
```

Leave this running for the whole test session (a plain terminal tab is fine; `nohup ... &`
if you want to close the terminal). Prefer this over `npm run dev:server` (tsx watch) for
a multi-hour session — a watch-triggered restart mid-test would drop every connected peer.

### 0.2 Find the Mac mini's LAN IP and open the port

```bash
ipconfig getifaddr en0        # or en1/en0 depending on interface — Wi-Fi vs Ethernet
```

macOS will prompt "Do you want the application 'node' to accept incoming network
connections?" the first time something connects — **Allow**. If it doesn't prompt,
check System Settings → Network → Firewall and allow incoming connections for `node`,
or temporarily disable the firewall for the test window.

Verify from a **different** device on the same network:

```bash
curl -i http://<macmini-ip>:8080/gun
```

Any HTTP response (even a 404/upgrade-required page) confirms reachability. No response
= firewall or wrong IP — fix before continuing.

### 0.3 Point each app at the Mac mini relay

**macOS** — packaged `.app`s launched by double-click do not inherit a shell's
environment variables. Launch the actual binary inside the bundle from Terminal instead:

```bash
IINPUBLIC_HUB_GUN_URL="http://<macmini-ip>:8080/gun" \
  "/Applications/IinPublic.app/Contents/MacOS/IinPublic"
```

(First launch will be Gatekeeper-blocked since the DMG is unsigned — see §2.1.)

**Windows** — same idea, from PowerShell, after installing via the NSIS installer:

```powershell
$env:IINPUBLIC_HUB_GUN_URL = "http://<macmini-ip>:8080/gun"
& "C:\Users\<you>\AppData\Local\Programs\IinPublic\IinPublic.exe"
```

**Android — hard blocker:** the hub URL is a hardcoded Kotlin constant
(`NodeForegroundService.kt:32`), not read from an env var or app setting, so the debug
APK as built **cannot** be pointed at the Mac mini without a source change + rebuild.
Ask Claude to parameterize it (e.g. a `BuildConfig` field or an in-app debug setting)
before starting Phase 3 (multi-device) tests — Phases 1–2 on Android alone can still run
against the unreachable production URL (the app should degrade gracefully to
solo/offline-ish behavior; that degradation is itself worth checking, see §2.3).

### 0.4 Confirm each app actually attached

Settings → Storage Inspector (§ drill-down: Settings tab → tap "Storage Inspector") shows
the active hub peer list and connection state — confirm `<macmini-ip>:8080` appears
there on each device before starting Phase 2.

---

## 1. Phase 1 — Install & first-launch smoke test

Run once per platform, independently (hub connectivity not required yet).

### 1.1 macOS

- [ ] Mount the DMG, drag `IinPublic.app` to `/Applications`
- [ ] Double-click → Gatekeeper blocks ("cannot be opened because the developer cannot
      be verified") — expected, unsigned build
- [ ] Right-click → Open → Open anyway (or `xattr -cr /Applications/IinPublic.app` once
      from Terminal) → launches on retry
- [ ] Window opens at a reasonable default size, app icon in Dock is correct
- [ ] No crash/white-screen; "Connecting to IinPublic network..." resolves within a few
      seconds (against production URL, expect it to hang if no route to
      `www.iinpublic.com` — that's expected pre-hub-override, not a bug)
- [ ] Quit and relaunch — second launch is faster (no re-extraction), same identity
      persists (check stage name in Settings → Profile)

### 1.2 Windows

- [ ] Run `IinPublic Setup 1.0.0.exe` — SmartScreen blocks ("Windows protected your PC")
      — expected, unsigned installer
- [ ] More info → Run anyway → installer proceeds (oneClick NSIS, installs to
      `%LOCALAPPDATA%\Programs\IinPublic`)
- [ ] Desktop/Start Menu shortcut created and correctly icon'd
- [ ] Launch — same connecting/hang-then-resolve behavior as macOS
- [ ] Quit and relaunch — identity persists
- [ ] Uninstall via Settings → Apps removes cleanly (no orphaned Start Menu entry)

### 1.3 Android

- [ ] Enable "Install unknown apps" for the file manager/browser used to sideload
      `app-debug.apk`
- [ ] Install completes, app icon correct, no install-time permission prompts beyond
      what the manifest declares
- [ ] First launch: foreground-service notification appears (the embedded Node process
      runs as a foreground service — confirm the persistent notification is present and
      not alarming/unlabeled)
- [ ] App survives being backgrounded (Home button) for 60s+ without the OS killing the
      foreground service (check the notification is still there)
- [ ] Force-stop from Android Settings → re-launch → identity persists

---

## 2. Phase 2 — Single-user functional walkthrough (per platform)

Repeat this whole phase independently on **each** of the 3 apps once hub connectivity is
confirmed (§0.4). Every item should behave identically across platforms — flag anything
that doesn't as a cross-platform bug, not just a bug.

### 2.1 Chatrooms tab
- [ ] Global chatroom shows correct headcount (should include this device + TechSupport)
- [ ] Chatroom hierarchy (Global → Region → City) expands/collapses correctly
- [ ] Tapping a chatroom row opens its detail view (member list, visit stats) with a
      working back button
- [ ] TechSupport appears pinned, marked "Built-in", shows online/away correctly

### 2.2 Talks tab — create one of each type
- [ ] **Tag** — single-keyword tag talk creates and broadcasts
- [ ] **Flow** — multi-question directed graph, at least one branch, ends in
      match/ignore
- [ ] **Survey** — no match/ignore outcome, answers collected
- [ ] **Route** — DAG with `next` pointers, terminal node reached
- [ ] Each shows correctly in "My Talks" / OUT list afterward

### 2.3 Settings tab (drill-down — new as of this build)
- [ ] Menu list is the default view; tapping any of the 9 rows (Profile, Credit,
      Languages, Talk Behavior, Distance and Home, Content Filters, Linked devices,
      Erase this device, Storage Inspector) shows only that section
- [ ] Back button (top-left) returns to the menu list every time
- [ ] Edit stage name in Profile → persists across app restart
- [ ] Change UI language (Languages section) → nav labels + section titles relocalize
      immediately
- [ ] Toggle a Content Filters checkbox, leave the tab, come back — setting persisted;
      but re-entering Settings resets to the menu (expected — matches Chatrooms/Contacts)

### 2.4 Contacts tab
- [ ] Empty state renders sensibly before any matches exist
- [ ] TechSupport contact row present, pinned

### 2.5 Me tab
- [ ] Answered question history is empty pre-match, fills in as talks get answered
      later (revisit after Phase 3)

---

## 3. Phase 3 — Cross-platform multi-user scenarios (main event)

Three physical devices, three different platforms, one shared Mac mini hub. This is the
scenario the automated Playwright suite (isolated browser contexts on one machine) can't
cover — real network latency, real WebRTC NAT/mDNS behavior between different OSes, real
per-platform rendering.

**Setup:** rename each device's stage name to something identifiable —
`MacTestUser` / `WinTestUser` / `AndroidTestUser` — before starting (Settings → Profile).

### 3.1 Presence & headcount
- [ ] All three appear in the Global chatroom member list on all three devices
- [ ] Member count badge matches (3 + TechSupport) everywhere, updates live as devices
      join/leave
- [ ] Closing one app drops that device from the other two's member list within a
      reasonable window

### 3.2 Talk exchange + matching
- [ ] Create a Tag talk on macOS, confirm it's received on Windows and Android
- [ ] Answer it (match) on Windows → macOS sees the match; a Contacts entry appears on
      both
- [ ] Answer it (ignore) from Android → no match, no Contacts entry, no false-positive
      notification on the other two
- [ ] Repeat with a Flow talk created on Android, answered on macOS and Windows — same
      match/ignore correctness

### 3.3 Direct P2P conversation
- [ ] After a match, open the conversation from Contacts on both matched devices
- [ ] Send a message from each side, confirm delivery in both directions
- [ ] Check Settings → Storage Inspector → Conversation Transport shows `direct-p2p`
      (not a relay fallback) on both ends once the WebRTC channel establishes
- [ ] Kill and relaunch the app on one side mid-conversation — message history persists,
      conversation resumes

### 3.4 Broadcast
- [ ] Broadcast a talk from one device to the Global chatroom, confirm the other two
      receive it (respecting each device's own intake filters — test with one device's
      language filter narrowed to confirm it correctly excludes)

### 3.5 TechSupport
- [ ] Ask TechSupport a question from one device (support conversation), confirm the
      canned/FAQ response behaves the same as it would in the single-device e2e suite

---

## 4. Phase 4 — Platform-specific checks

### 4.1 macOS
- [ ] Window resizing/maximizing behaves correctly, no clipped UI at small sizes
- [ ] Cmd+Q / Cmd+W behave as expected (quit vs close window, per whatever the app
      defines)
- [ ] Retina rendering is crisp (icons, text) on a Retina display

### 4.2 Windows
- [ ] Window resizing/maximizing/snap (Win+arrow) behaves correctly
- [ ] Alt+F4 closes as expected
- [ ] DPI scaling (125%/150% display scaling) doesn't blur or clip the UI

### 4.3 Android
- [ ] Rotation (if supported) doesn't break layout — or is correctly locked if not
- [ ] Notification (foreground service) survives a phone lock/unlock cycle
- [ ] Battery-optimization prompt (if the OS shows one for a persistent foreground
      service) — note whether the app requests exemption or just accepts throttling
- [ ] App resumes correctly after several hours backgrounded (not just a quick
      Home-and-back)

---

## 5. Phase 5 — Resilience / edge cases

- [ ] Kill the Mac mini relay process mid-session on all 3 devices — apps should show
      some form of "disconnected"/"reconnecting" state, not silently hang forever
- [ ] Restart the relay — all 3 devices reconnect without needing to be relaunched
- [ ] Toggle Wi-Fi off/on on the Android device mid-conversation — message queues and
      delivers once reconnected, no duplicate/lost messages
- [ ] Two devices simultaneously answer the same incoming talk within ~1s of each other
      — no crash, consistent outcome on both

---

## 6. Known limitations / not this pass

- Neither desktop build is code-signed — every install will hit Gatekeeper/SmartScreen.
  Not a bug to file; expected until a signing cert is set up.
- Android is a **debug** build (no release signing config exists yet in
  `android/app/build.gradle`) — fine for this test, not distributable as-is.
- Android's hub URL is hardcoded — Phase 3 is blocked on Android until that's
  parameterized (see §0.3).
- No HTTPS on the local relay (`http://<macmini-ip>:8080/gun`) — acceptable for a LAN
  test; note if any WebRTC/secure-context-gated behavior misbehaves under plain HTTP so
  it can be looked at before trying this over a real TLS hub later.

## 7. Filing a bug

For anything that fails, capture: platform + build artifact name, which phase/step,
stage name(s) of the device(s) involved, Settings → Storage Inspector screenshot from
each involved device (transport mode + hub peer list), and — if reproducible — the exact
step sequence that triggers it.
