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

## How to run this without clicking through every screen on every device

You don't need to. Two things do most of the work:

1. **Let the diagnostic script (§0.4) answer "is the mesh actually connected?"** instead
   of eyeballing Settings → Storage Inspector on all three devices every time something
   seems off. One command per machine, plain pass/fail output.
2. **Phase 2 (single-user walkthrough) is the automated Playwright suite's job, not
   yours.** Every button, tab, and form in this app is already covered in isolation by
   `npm run test:all` — clicking through Chatrooms/Talks/Settings/Contacts identically on
   three separate devices by hand mostly re-proves the automated suite already proved.
   **Skim Phase 2 once, on whichever device is fastest to reach** (confirms the build
   itself isn't broken), then spend your actual time budget on **Phase 3** — that's the
   one thing no amount of single-machine automation can substitute for: real network
   latency, real cross-device Gun sync, real per-OS WebRTC behavior. Phase 3's own list is
   already short (5 subsections); that's the real test.
3. **For repeat runs, drive one side by script instead of by hand where you can.** The
   embedded node's local REST API (same one the UI calls) is scriptable — e.g. `curl
   -X POST http://127.0.0.1:8088/api/talks -d '{...}'` from the Mac mini to fire a talk
   without opening the talk editor UI at all — then use the GUI only on the *receiving*
   device to confirm it arrived. Ask Claude to build out a small script against this API
   for whichever specific flow you're repeating most, once you know which one that is.

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

**This auto-switches to HTTPS** the moment it finds `certs/dev-key.pem` +
`certs/dev-cert.pem` in the repo (self-signed, generated once via `scripts/gen-dev-cert.sh`
— this repo already has one with `192.168.10.50` baked into its SAN list). Watch for
`🔒 HTTPS enabled for LAN (self-signed dev cert found)` in the startup log — if you see it,
every hub URL below must be `https://`, not `http://`; a protocol mismatch here fails
**silently** (see the postmortem in §8) and is the single most likely thing to go wrong.
`TLS_DISABLE=1 PORT=8080 node dist/server/server/index.js` forces plain HTTP instead if
you'd rather sidestep the cert-trust dance in §0.3 — see the tradeoff there.

### 0.2 Find the Mac mini's LAN IP and open the port

```bash
ipconfig getifaddr en0        # or en1 — check networksetup -listallhardwareports for
                               # which is actually Wi-Fi vs Ethernet on this machine;
                               # don't assume from the interface name alone
```

macOS will prompt "Do you want the application 'node' to accept incoming network
connections?" the first time something connects — **Allow**. If it doesn't prompt,
check System Settings → Network → Firewall and allow incoming connections for `node`,
or temporarily disable the firewall for the test window.

Verify from a **different** device on the same network (browser is fine, or):

```bash
curl -ik https://<macmini-ip>:8080/gun    # -k: skip cert-trust check, just testing reachability
```

Any HTTPS response (even a 404/upgrade-required page) confirms reachability. No response
= firewall, wrong IP, or the two devices are on different subnets (check `ipconfig`/`ifconfig`
on BOTH machines — the IP ranges must match) — fix before continuing.

### 0.3 Point each app at the Mac mini relay

Every client needs **three** things set, not just the hub URL — this was the single
biggest source of "why can't they see each other" during setup (full story in §8):

| Env var | Value | Why |
|---|---|---|
| `IINPUBLIC_HUB_GUN_URL` | `https://<macmini-ip>:8080/gun` | Which hub to dial. Must match the relay's actual protocol (§0.1). |
| `IINPUBLIC_EMBEDDED_HUB_MODE` | `gun-peer` | **Required for talks/matches/DMs to sync at all.** The default (`explicit-http`) only relays presence/chatroom-membership over discrete REST calls — it deliberately never opens a live Gun connection to the hub, so talk data (which only propagates via genuine Gun graph sync) has no path to travel. `gun-peer` mode opens a real, persistent Gun connection instead. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `0` | Only needed if using `https://` (§0.1). The self-signed cert is valid and even has the LAN IP in its SAN list, but Gun's own connection layer doesn't honor `NODE_EXTRA_CA_CERTS` (tried it — connects and immediately disconnects, silently) — it needs the blunter flag. **This disables TLS certificate verification for the whole process.** Fine for this trusted LAN test; never carry this env var into a build pointed at a real public hub. |

**macOS** — packaged `.app`s launched by double-click do not inherit a shell's
environment variables. Launch the actual binary inside the bundle from Terminal instead:

```bash
IINPUBLIC_HUB_GUN_URL="https://<macmini-ip>:8080/gun" \
IINPUBLIC_EMBEDDED_HUB_MODE=gun-peer \
NODE_TLS_REJECT_UNAUTHORIZED=0 \
  "/Applications/IinPublic.app/Contents/MacOS/IinPublic"
```

(First launch will be Gatekeeper-blocked since the DMG is unsigned — see §1.1.)

**Windows** — from PowerShell, after installing via the NSIS installer. Set every env var
and launch the exe as **one single line** — `$env:` only persists for the session it's set
in, so setting it and launching separately across two commands can silently launch without
it if anything resets the session in between (this bit us during setup):

```powershell
$env:IINPUBLIC_HUB_GUN_URL="https://<macmini-ip>:8080/gun"; $env:IINPUBLIC_EMBEDDED_HUB_MODE="gun-peer"; $env:NODE_TLS_REJECT_UNAUTHORIZED="0"; & "C:\Users\<you>\AppData\Local\Programs\iinpublic-desktop\IinPublic.exe"
```

Note the install folder is `iinpublic-desktop`, not `IinPublic` — the NSIS installer uses
the package name, not the display name. If that path is wrong, right-click your
Desktop/Start Menu shortcut → **Open file location** to get the real one.

**Prefer plain HTTP instead?** Skip `NODE_TLS_REJECT_UNAUTHORIZED` and start the relay
with `TLS_DISABLE=1` (§0.1); use `http://` in all three commands above.
`IINPUBLIC_EMBEDDED_HUB_MODE=gun-peer` is still required either way — that part has
nothing to do with HTTP vs HTTPS. HTTP is simpler (no cert-trust flag to remember) and,
since the HTTPS path already requires disabling certificate verification to work at all,
it provides no real additional security in this LAN-test setup — pick whichever you find
less confusing and use it consistently everywhere.

**Android — fixed (was a hard blocker).** The hub URL used to be a hardcoded Kotlin
constant (`NodeForegroundService.kt`) with no way to override it short of a source change +
rebuild. It's now overridable per-launch via an adb Intent extra, without touching the
constant (still the default for a normal Play Store / sideloaded launch):

```bash
adb shell am force-stop com.iinpublic.app
adb shell am start -n com.iinpublic.app/.MainActivity --es hub_gun_url "http://<macmini-ip>:8080/gun"
```

The `am force-stop` matters — `NodeForegroundService`/`NodeBridge` both latch "already
started" for the life of the app process, so relaunching an already-running process with a
*different* hub_gun_url extra is silently ignored; force-stop guarantees a clean process
picks up the override. There is no HTTPS-vs-HTTP or `IINPUBLIC_EMBEDDED_HUB_MODE` distinction
to set here — Android's embedded node always dials in `gun-peer` mode and simply takes
whatever URL it's given.

Also required for the debug APK to be automatable at all: `MainActivity.kt` now calls
`WebView.setWebContentsDebuggingEnabled(true)` (debug builds only) — this is what lets
either `chrome://inspect` or Playwright's `_android` module attach to the WebView over adb.
Neither change affects a production build (no `hub_gun_url` extra → same hardcoded default
as before; release builds never enable WebView debugging).

**e2e over adb:** `tests/e2e/native-app/05-android-device-boots.spec.ts` drives this
automatically via Playwright's `_android` module (`device.webView({pkg}).page()` → a normal
`Page`) — same idea as the existing Electron desktop specs in that directory, just with a
real phone as the "window." It skips itself when no adb device is attached. One thing a
human running this by hand needs to know that the spec's own code comments cover in
detail: adb-over-USB is only the *automation* control channel — the app's own network
traffic still goes over Wi-Fi/LAN, so the hub URL must be the Mac's real LAN IP, never
`127.0.0.1` (that's the Mac's own loopback, unreachable from the phone). Phone and Mac must
be on the same network.

**Verified against real hardware (2026-08-08, Honor FRD-L04 / Android 7.0 / SDK 24).** The
app itself is confirmed stable — three real crash-on-launch bugs were found and fixed (see
`tests/e2e/native-app/05-android-device-boots.md` for the full root-cause writeup: a missing
`-DANDROID_STL=c++_shared` CMake arg, a missing `node_modules` in the staged embedded-Node
assets, and a `\p{L}\p{N}` Unicode-property regex literal that nodejs-mobile's non-full-ICU
V8 can't parse). All three were invisible in `adb logcat` alone — Node's stdout/stderr had
nowhere to go, so `native-lib.cpp` now redirects them to a pullable `node-stdio.log` in the
app's data dir; that's the tool that actually cracked each of these open. With the fixes in,
the app was confirmed running and interactive via screenshot and direct CDP inspection.

The Playwright spec itself still cannot pass on this specific device, though — Playwright
1.57's `_android` driver has a reproducible incompatibility with this WebView build
(`device.webViews()` finds it but reports an empty `pkg`, and `.page()` hangs indefinitely
even bypassing the pkg filter). This is a Playwright/old-WebView compatibility gap, not an
app bug; see the spec's `.md` for what was tried. A newer/different physical device is the
next thing to try if automating this matters more than the manual-verification evidence
already gathered.

### 0.4 Confirm each app actually attached

Run the diagnostic script **on each machine**, against its own local embedded node —
far faster than digging through raw JSON logs by hand:

```bash
# macOS/Linux
bash scripts/diagnose-local-node.sh 8088 <macmini-ip>:8080
```

```powershell
# Windows
powershell -File scripts\diagnose-local-node.ps1 -LocalPort 8088 -HubHost <macmini-ip> -HubPort 8080
```

It reports: whether the local embedded node is up, this device's own view of Global
chatroom membership (should show every device, not just itself + TechSupport), and
whether a live TCP connection to the hub actually exists. All three should be green
before moving on to Phase 2 — if membership only shows yourself, re-check the three env
vars in §0.3 (gun-peer mode and protocol match are the two most common misses).

The GUI's Settings → Storage Inspector → hub peer list shows the same information if you'd
rather check visually.

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
- If running over HTTPS (§0.1), `NODE_TLS_REJECT_UNAUTHORIZED=0` is required on every
  client and disables TLS certificate verification for that whole process. Fine for this
  trusted LAN test; never let this env var reach a build pointed at a real public hub.

## 7. Filing a bug

For anything that fails, capture: platform + build artifact name, which phase/step,
stage name(s) of the device(s) involved, Settings → Storage Inspector screenshot from
each involved device (transport mode + hub peer list), and — if reproducible — the exact
step sequence that triggers it. `scripts/diagnose-local-node.sh` / `.ps1` (§0.4) is a
faster first move than screenshots for anything connectivity-shaped.

## 8. Postmortem: the four-bug chain behind "they can't see each other"

First real attempt at this test hit four independent, stacked bugs — each one hiding the
next until the previous was fixed. Kept here so the next environment reset doesn't have
to rediscover all four from scratch.

1. **Neither app pointed at the relay at all.** Both defaulted to the (nonexistent)
   production URL. → §0.3's env vars.
2. **The relay was silently serving HTTPS** while every hub URL configured used
   `http://`. It auto-switches the moment it finds `certs/dev-key.pem`/`dev-cert.pem` in
   the repo — there's no console warning that a client is about to fail against it, the
   connection just never establishes. → match protocol everywhere (§0.1/§0.3), or force
   `TLS_DISABLE=1`.
3. **A PowerShell env var didn't actually apply** — set in one line, app launched in a
   separate command; `$env:` assignments don't reliably survive across separate
   invocations the way you'd expect from a persistent shell session. The giveaway was in
   the app's own startup log (`hub=https://www.iinpublic.com/gun` instead of the LAN
   address) — always check that line after launching, don't assume the env var took.
   → combine assignment + launch into one line (§0.3).
4. **Presence worked (chatroom headcount, member list) but talks and DMs didn't**, even
   with the hub reachable and both apps pointed at it correctly. Two layered causes:
   - A device's public profile (SEA pub/epub keys) only pushes to the hub **once**, at
     identity creation, fire-and-forget with no retry. If that identity was created
     during an earlier, broken attempt (bugs 1–3 above), the push failed silently and
     never retried — the hub returned 404 for that user's profile indefinitely
     afterward. Fix: re-save the stage name in Settings → Profile to re-trigger the push.
   - Even with the profile visible, talk/match data still didn't flow, because the
     default `IINPUBLIC_EMBEDDED_HUB_MODE=explicit-http` intentionally never opens a live
     Gun peer connection to the hub — it only relays presence/profile/signaling via
     discrete REST calls. Talk delivery depends on genuine Gun graph sync, which has no
     path over REST. `IINPUBLIC_EMBEDDED_HUB_MODE=gun-peer` (§0.3) opens a real,
     persistent Gun connection instead — confirmed in the log by `peerId` being the
     literal hub URL (not a short random string) and a `GET`/`lsof` showing an actual
     established TCP connection to the hub's port, not just periodic REST hits.

**Identity persistence, for the record:** none of the relaunches above (env var changes,
relay restarts, or the profile rename used to fix #4) create a new identity. Each
device's SEA keypair + user ID is generated once and lives in that device's own local
storage (`~/Library/Application Support/IinPublic/node-data` on macOS,
`%APPDATA%\IinPublic\node-data` on Windows) — completely independent of hub URL, hub
mode, TLS settings, or the relay's own process lifecycle (the standalone relay itself is
in-memory only and persists nothing). Renaming a stage name only edits that field on the
existing identity. Verified directly from server logs during setup: both test devices'
user IDs were identical across every relaunch, before and after a rename.

**Why only one server this time, when dev work normally needs two (3001 + 8080)?** Those
are unrelated setups. `npm run dev` runs a webpack **dev** server on 3001 (hot-reload,
serves the SPA to a browser tab while actively editing code) alongside the API/Gun server
on 8080 — that split only exists for live development. The packaged desktop/Android
builds have no dev server at all: `dist/web` (the final built SPA) is baked into the app
and served directly by that device's own embedded Node process on its own local port
(8088), with no separate static-file server needed. The Mac mini in this test plan is
running *only* the shared relay (`dist/server`, port 8080) — each device, including the
Mac itself if you also run the desktop app there, carries its own web server internally.
