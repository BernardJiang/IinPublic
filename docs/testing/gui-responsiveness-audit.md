# GUI responsiveness audit — network work in the GUI's click paths

**Date:** 2026-10-30 · **Branch:** `dev` at `1e1e6473` (after Codex's responsiveness fixes in
`0dfdb28a`, `2846414a`, `bd7427e8`, `ee4b41e9`) · **Test plan:** `gui-responsiveness-test-plan.md`
· **Specs:** `tests/e2e/responsiveness/`

## What "the GUI thread is blocked" means here

The web client is single-threaded JavaScript, and nearly all network calls are already `async`. A
`fetch` does not freeze the page. Taps go dead in four other ways, all found below:

1. **A click handler `await`s the network before it shows anything.** The button looks dead
   until the request returns. With a request that has no timeout, on a hung network (Wi-Fi with
   no internet, a captive portal, a dead cell), it never returns. A fast failure (airplane mode)
   hides this, because `fetch` rejects at once and the `catch` path runs.
2. **The handler isn't registered yet.** `UIManager` is an `EventEmitter`. An `emit()` with no
   listener is silently dropped, and `app.ts` registers its listeners only at the end of boot.
3. **A synchronous native bridge call does I/O.** Android `@JavascriptInterface` methods run
   synchronously and block the WebView's JS thread until they return.
4. **Something covers the control** (toasts), or the control has no reaction in some state.

Each finding below says how it was established: **verified** means a spec reproduces it today
(it is marked `test.fail()`, or listed in `KNOWN_FINDINGS` in the sweep). **Code** means it was
found by reading the code and still needs a reproducing test (the test plan names it).

## Fix status (2026-10-30, second pass)

| ID | Status | What changed |
|----|--------|--------------|
| F1 | **fixed** | Flags fetch not awaited + 3 s timeout. With the **whole** hub stalled, boot also waited on presence register/nearby/acks: those are now bounded (4 s), the lookup and acks run in the background, and the presence heartbeat starts even when the first register fails (it used to never retry). Boot under a full stall: never → ~7.5 s. |
| F2 | **fixed** | `getPublicUserFromApi` 3 s timeout; `ingestConversationRecords` bounds its name lookup at 2.5 s (placeholder kept); peer **Message** says "Opening the conversation…" after 400 ms and ignores repeat taps. |
| F3 | **fixed** | Rename is local-first: confirmed at once, hub publish + greeting re-render + member PATCH in the background. Profile/photo changes are applied to `currentUser` and the screen at once (reverted if the save fails), and `updateProfileFoundation` starts from the in-memory user instead of re-reading Gun. |
| F4 | **fixed** | New Room opens its form at once; the credit check runs alongside (4 s) and closes the form with the reason if the hub says no. When the device's own counts say no, it says "Checking…" while it asks the hub. Place create POST bounded at 10 s. |
| F5 | **fixed** | Block/Unblock apply locally at once (no hub call in the UI); `blockUser` writes the private block list first, then tells the hub in the background with retries that a later unblock cancels. The duplicate hub POST is gone. |
| F6 | **fixed** | `getTalkWithRetry` enforces its deadline with a race; server fallback bounded at 3 s; opening an incoming Talk says "Opening the Talk…" after 400 ms and ignores repeat taps. |
| F7 | open | Global answer queue left as is: commit `bc7db734` serializes Talk response commits on purpose; per-author queues need a design check. |
| F8 | **fixed (needs a phone)** | `IinPublicAttestation.generateAttestedKeyAsync(requestId, challenge)` runs on an executor and answers with `iinpublic-attestation-result`; the JS uses it when present and falls back to the sync call on older APKs. Kotlin compiles; not yet run on a device. `IinPublicBackground.status()` kept — only the native-app e2e spec 40 calls it. |
| F9 | **fixed** | Toasts start below the measured app bar (`--toast-top`), so they never cover its actions. Tap-to-dismiss kept (redesign rule G1, `54-notification-autodismiss`). |
| F10 | **fixed** | Broadcast shows a busy (disabled) button during its wait, and no longer pops the editor over another screen if the user moved on (**F18**, found by the parallel sweep). |
| F11 | **fixed** | "Finding your location…" on tap, "Location updated." when done (room unchanged). |
| F12 | **withdrawn** | Harness false alarm: Tags focuses the filter field (a caret / keyboard is the reaction). The harness now counts focus moving into a text field. |
| F13 | open (bounded) | Device-Gun RPC is capped at 8 s by the worker; no per-click case over budget was found by the sweep. Re-measure in P2. |
| F14 | **fixed** | Empty code: "Enter the invite code first."; with a code the button is disabled with "…" until the answer. |
| F15 | **fixed** | "Loading..." at once, 4 s timeout. |
| F16 | **fixed** | `fetchWithTimeout` (`src/web/services/fetch-with-timeout.ts`) on every hub call in `src/web` except the native-node Gun RPC/stream and `node-core-link` (long-lived by design); the knocks long poll is bounded at 30 s. Correction: `:263` (profile foundation) already had a 4 s timeout. |
| F17 | **fixed** (new) | `getUser()` → `readPublicProfileFoundation` fetched the hub with **no timeout**, inside `withPrivateDataLock`: one hung request stalled every later private write (filters, contacts, blocks). Now 3 s. |
| F18 | **fixed** (new) | See F10. |

Verified by: `tests/e2e/responsiveness/` (all `test.fail` markers removed; sweep has no known findings; 28/28 twice
with 4 workers, and under `SWEEP_HUB=stall|fail|healthy`), unit tests (`fetch-with-timeout`,
`web-user-service` F5/F17, `contacts-view` setBlocked, `web-talk-service-retry-deadline`,
`native-attestation-bridge` async), and the existing specs for Places, blocking, toasts, app bar,
navigation, linked devices, erase, broadcast and profile. Specs that fail identically on unmodified
HEAD (not caused by this work): `78-techsupport-unblockable-every-route`,
`15b-blocking-stops-delivery…`, `03-support-greeting-signed`, `06-support-new-question-ack`,
`00e-chatroom-peer-detail` (4 tests), `04-profile-edit-stage-name` (first test),
`69-matched-talk-threads`; unit size budgets `ui-manager-size-budget` (3168 > 3160) and
`ui-module-boundaries` (`chatroom-map-view.ts` 1236).

## On real phones (2026-10-30, Android 1.0.205 debug, installed in place, identities kept)

P30 (`DUM0219418001663`, Android 10), PH-1 (`PM1LHMA7A2707315`, Android 10), Honor FRD-L04
(`RNV0217207000190`, Android 7). Measured over raw CDP in the app's WebView.

| Check | P30 | PH-1 | FRD |
|-------|-----|------|-----|
| F8 attestation key: page frozen, old sync call | 138–166 ms | 174–229 ms | 430–439 ms |
| F8 attestation key: page frozen, new async call | 21 ms | 23 ms | 23–25 ms |
| Boot with the hub black-holed (`hub_gun_url=http://10.255.255.1:8080/gun`) | ready ~6.7 s | ~6.2 s | ~10.2 s |
| Taps (5 tabs, New Room, Create talk, Refresh Location): slowest reaction / longest freeze, hub black-holed | 53 / 166 ms | 85 / 131 ms | 167 / 301 ms |
| Same, production hub | 65 / 153 ms | 97 / 106 ms | 184 / 234 ms |
| New Room, hub black-holed | "Checking…" at once → refusal reason within 7 s (was: nothing) | same | same |
| Open the TechSupport DM from the person page, hub black-holed | 13 ms | 24 ms | 30 ms |

Found while doing it: the two new "one open at a time" guards (peer Message, incoming Talk) would
have left a person/Talk permanently dead if an open never settled; both now release after 15 s.
Follow-up, not changed: the person page's "relationship stats" placeholder waits the full 8.5 s
for a profile that TechSupport never has (`readPublicProfileFoundation` retry loop) — taps are
unaffected. Not a bug: a Contacts name tap opens the person page only (by design since
`1a77307e`), which is why specs 78/00e — expecting it to open the DM — fail on HEAD.

## Findings (as found)

| ID | Severity | Where | What the user sees | Status |
|----|----------|-------|--------------------|--------|
| F1 | **High** | Boot: `app.ts:1340` → `syncConversationTransportFromServer` (`app.ts:6556`) | App never finishes starting; every tap that `emit()`s is lost | verified |
| F2 | **High** | `getPublicUser` API-first fetch (`web-gun-service.ts:892`, `:932`) on DM paths | Tapping a person's "Message" does nothing; peer "Send" stuck on "⏳ Sending" | code |
| F3 | **High** | Stage name / profile / photo save (`app.ts:8289`, `:8338`) | Rename confirms only after ~13.5 s; Remove photo shows nothing (2.2 s with a healthy hub) | verified |
| F4 | Medium | New Room (`chatroom-shell-controller.ts:237`) | Form never opens on a hung network; 1.6 s with a healthy hub | verified |
| F5 | **High** | Block / Unblock (`contacts-view.ts:1170`, `user-detail-view.ts:345`) | Block button dead while hung; **offline it cannot block at all** | code |
| F6 | Medium | Opening an incoming Talk (`talk-detail-view.ts`, `quick-incoming-talk-actions.ts`) | 4–8 s+ with no indicator; a second tap starts a second lookup | code |
| F7 | Low | Answer submit queue (`app.ts:8962` `talkCompletionQueue`) | Later answers' delivery waits behind one slow key lookup (≤ ~26 s each) | code |
| F8 | Medium | Android sync JS bridges (`*JavascriptBridge.kt`, `NativeAttestationBridge.kt`) | WebView frozen while Kotlin does disk/keystore/HTTP work | code |
| F9 | **High** | Toasts (`main.css:3108`, `notification-toast.ts`) | App-bar buttons can't be tapped for 3–10 s after many actions; a tap only dismisses the toast | verified |
| F10 | Low | Broadcast with nothing to send (`broadcast-controller.ts:123`) | 1.6 s of nothing, then the editor opens | verified |
| F11 | Medium | Settings → Refresh Location (`app-shell-controls.ts:252` → `app.ts:9757`) | No "locating…" state; often no message at all on success | verified |
| F12 | Low | Contacts → Tags with no contacts (`graph-focus.ts:255`) | Button does nothing | verified |
| F13 | Medium | Device-Gun RPC (`remote-gun.ts`, `core/gun-rpc.ts:63-91`, `gun-bridge.ts:168`) | Any UI path awaiting a `put` ack or a `once` of a missing key pays up to 8 s | code |
| F14 | Low | Support delegate "Send request" (`support-delegate-optin-view.ts:60`) | Empty code: silent no-op; with a code: no pending state while the request runs | verified (empty) |
| F15 | Low | Storage Inspector → Refresh (`storage-inspector.ts:321`) | Debug tool hangs on a hung network | verified |
| F16 | — | 66 `fetch` calls without a timeout (inventory below) | Source of F1–F5, F15 | inventory |

### F1 — Boot hangs on one request; taps before boot ends are dropped

`initialize()` awaits `syncConversationTransportFromServer()` (a `fetch` of `/api/debug/storage`
with no timeout) **before** `setupEventHandlers()` (`app.ts:1570`). If that request hangs, boot
never completes. The bottom nav (bound in the `UIManager` constructor) still switches tabs, but
every action that goes through `emit()` (Create Talk save, send, block, join room…) has no
listener and is silently discarded. Boot also awaits `initializeUser()` and `initializeChatrooms()`
(bounded at 4 s / 700 ms in `web-chatroom-service.ts`) before the handlers, so even a healthy
slow boot drops early taps.

*Verified:* `01-stalled-hub-regressions.spec.ts` "F1": boot with only `/api/debug/storage` held
is not ready after 25 s; the control boot is ready in ~3 s.

*Fix:* give the flags fetch a 3 s `AbortSignal.timeout` and don't await it: apply the flags when
they arrive. Register `setupEventHandlers()` before any network await, with handlers that
themselves wait for `currentUser`. Or buffer `emit()`s made before the listeners exist and replay
them.

### F2 — DM paths wait on `getPublicUser`, whose first step has no timeout

`WebGunService.getPublicUser` always calls `getPublicUserFromApi` first: a `fetch` with no
timeout. Only then does it try Gun (8 s timeout). Callers on click paths:

- Peer layout → **Message** (`peer-controller.ts:126` `openDirectConversationWithPeer`) →
  `openDirectConversation` → `findOrCreateDirectConversation` → `ingestConversationRecords`.
  That awaits `getPublicUser` and then `userService.getUser` whenever the peer's name is not
  already known. The UI shows no pending state and the `catch` swallows the error, so the button
  just does nothing.
- Peer layout → **Send** (`user-detail-view.ts:374`) shows "⏳ Sending" and disables the button.
  With nothing bounding the chain, it can stay that way indefinitely.
- `resolvePeerEpub` wraps it in a 5 s race (fine), and Codex's roster-epub fast path covers
  in-room peers only.

*Fix:* add `AbortSignal.timeout(3_000)` to `getPublicUserFromApi`. In
`findOrCreateDirectConversation`, create the record with the name the UI already has, and resolve
a missing name in the background (`ingestConversationRecords` should never await the network for
a display name).

### F3 — Saving your name, profile or photo waits for the hub

`onStageNameChange` (`app.ts:8289`) awaits `userService.syncPublicUserForRelay`, which is three
attempts × 4 s plus back-off (`web-user-service.ts:284`). It then awaits
`renderSupportGreeting`, plus a PATCH `fetch` with no timeout when in a Place. Only after all of
that does it show "Stage name updated". The rename dialog (`edit-stage-name-dialog.ts:48`) stays
open the whole time. The Settings field has no saving state. `onProfileChange` (`app.ts:8338`:
headshot select, Remove photo, take or choose photo, Edit profile) awaits `updateProfileFoundation`.
That reads `getUser` (several Gun reads, 8 s each on a miss), then three puts, then
`putPublicProfileFoundation` (`fetch` with no timeout, `web-user-service.ts:263`).

*Verified:* "F3" in spec 01 (no confirmation within 3 s; it arrives after ~13.5 s). The sweep
shows Remove photo with no reaction under a stall and 2.2 s with a healthy local hub.

*Fix:* the local write is the save. Update `currentUser`, the cache and the UI, confirm at once,
and publish to the hub in the background (`syncPublicUserToApiBestEffort` already exists).

### F4 — New Room waits for the credit check before opening its form

`chatroom-shell-controller.ts:237` awaits `GET /room-creation-credit` (no timeout) before
`showCreateCustomChatroomDialog()`. Its `catch` handles a fast failure only.

*Verified:* "F4" in spec 01 (form not open after 2 s); the control with a fast failure opens at
once. The sweep shows 1.6 s with a healthy local hub.

*Fix:* open the form immediately, run the credit check in parallel with a 3 s timeout, and
disable Create with a reason if it comes back ineligible. The hub re-checks on submit anyway.

### F5 — Block/Unblock depend on the hub, before any local effect

`setBlocked` (`contacts-view.ts:1170`) awaits a hub `fetch` (no timeout) **before** it changes
`blockedUserIds` locally. If the fetch hangs, the peer layout's block button
(`user-detail-view.ts:345`) never closes the layout. If the fetch fails fast (offline), it throws:
the block is never applied locally and nothing tells the user. Separately, the `setUserBlocked`
handler (`app.ts:8254`) calls `userService.blockUser` again. Blocking is a safety action and must
work offline.

*Fix:* apply the block locally first, close the UI, then publish to the hub in the background with
retry. Remove the duplicate hub call.

### F6 — Opening an incoming Talk has no pending state and an unbounded worst case

`showTalkDetail` / quick actions emit `demandFullTalk` → `resolveMeshTalkData` →
`getTalkWithRetry(…, { deadlineMs: 4_000 })`. The deadline is checked only between attempts. One
`getTalk` miss can take 8 s (`WebGunService.get`), and with `meshLocalFirst` off, `tryServer` is a
`fetch` with no timeout (`web-talk-service.ts:336`). The `loadFullTalkViaIncomingIdentity` fallback
adds more Gun reads. Nothing shows while this runs, and a second tap starts a second lookup that
opens a second dialog.

*Fix:* show the row as "opening…" at once and ignore further taps on it. Enforce the deadline
with `Promise.race`, and give `tryServer` an `AbortSignal`.

### F7 — Answers queue behind one slow key lookup

`talkCompleted` handlers are serialized through `talkCompletionQueue` (`app.ts:8962`). The toast
appears at once (good), but `submitTalkResponsePairDirect` → `resolvePeerEpub` can take up to
4 × (1.5 s + 5 s) ≈ 26 s when a peer's key is unknown. Every later answer, even to a different
person, waits behind it. This is not a frozen GUI, but responses and matches arrive late.

*Fix:* queue per author, not globally, or resolve the key outside the queue.

### F8 — Android: synchronous JavaScript bridges that do I/O

`@JavascriptInterface` methods block the WebView JS thread until they return:

- `IinPublicBackground.status()` → `statusBlocking()` performs **blocking loopback HTTP**
  (`BackgroundAgentCoordinator.kt:45`). It is not called from JS today, but it is exposed. Remove
  it or make it async.
- `IinPublicAttestation.generateAttestedKey()` generates a key in the keystore synchronously
  (StrongBox can take seconds), and is called during boot (`web-attestation-service.ts:144`,
  fire-and-forget on the JS side, but the JS thread still blocks for the call itself).
- `IinPublicCustody.write/remove` use `SharedPreferences.commit()` (sync disk) plus AES-GCM;
  `read()` decrypts with the keystore.
- `IinPublicNearby.lastLocation()` calls `NativeLocation.requestFresh` and `lastFix`;
  `nearbyReadiness()`, `capabilities()` and `wifiDirectState()` query system services. These
  run on the binder thread but are called synchronously from settings rendering
  (`settings-view.ts:876`) and the nearby services.

*Fix:* follow Codex's `requestEvents(requestId)` → `CustomEvent` pattern (`bd7427e8`) for
keystore, attestation and location. Keep synchronous only the cheap reads served from cached
state.

### F9 — Toasts cover the app bar and swallow taps

`.notification` is `position: fixed; top: 58px` (62 px on wide screens), full-width below 768 px,
with `z-index: 10000`, and two can stack (58 px apart). Wherever the app bar is not entirely above
58 px — the web build with its download banner, Android with a status-bar inset — toasts sit on
the app-bar actions for 3 s (8 s for Match!/retry, 10 s for "no talks to broadcast"). A tap on a
toast dismisses it and is consumed.

*Verified:* "F9" in spec 01: right after first launch, **Create talk** cannot be tapped (Playwright
reports it covered), while two start-up toasts are shown.

*Fix:* anchor toasts below the actual app bar (measure `#top-header`), or move them to the bottom
above the nav. Make the toast body `pointer-events: none` except for a dismiss control and
actionable (retry / open) toasts.

### F10–F15 — smaller dead or silent controls (found by the sweep)

- **F10** Broadcast, when there is nothing to broadcast, polls for 1.5 s (`20 × 75 ms`) with no
  feedback before opening the editor. *Fix:* show a "checking…" state, or open the editor at once
  and only then wait.
- **F11** Refresh Location (`app.ts:9757`) awaits the GPS fix, `updateUserLocation` and possibly a
  room switch, with no "locating…" state. On the success path with no room change it never says
  anything. Measured 2 s with a healthy hub, nothing on a hung or failed one. *Fix:* immediate
  "Locating…" status and a final "Location updated" or error message.
- **F12** Contacts → Tags calls `focusContactsTopicFilter()`, which returns silently when the topic
  input does not exist (no contacts). *Fix:* hide or disable the action when there is nothing to
  filter, or explain it.
- **F13** Device-Gun RPC: `put` waits up to 8 s for an ack (`core/gun-rpc.ts:63`), and `once` of
  a missing key up to 8 s (`:78`). The page-side `RemoteGun` has no per-call timeout and
  `gun-bridge.ts` only a 45 s one, queued behind `this.recovery`. `WebGunService.put` caps at
  800 ms, but `get` is 8 s. Any click path awaiting `get()` of a key that may not exist (e.g.
  `getTalk` for a not-yet-delivered Talk, `getUser` sub-reads) inherits up to 8 s per read. The
  recent `1e1e6473` ("reads answer in ~30 ms") addresses part of this. Re-measure each click path
  in the plan's §5.
- **F14** Support delegate "Send request" silently ignores an empty code, and with a code awaits
  the network without disabling the button or showing progress.
- **F15** Storage Inspector → Refresh: `fetch('/api/debug/storage')` without a timeout. Debug-only.

### F16 — `fetch` without a timeout (inventory)

These have no `AbortSignal` of their own (a caller may still race them). **Bold** = reachable from a
tap with the user waiting on the result.

- `app.ts`: `:2202` chatrooms list, **`:2723` block-status (DM media share waits on it before
  uploading)**, `:2740` age-verify for intake, `:3118` hub-status, `:4241` FAQ,
  `:5500`/`:5539`/`:5573`/`:5633` support delegates, **`:6558` boot flags (F1)**, **`:8319` PATCH
  member name (F3)**, **`:9387` create Place**
- `web-user-service.ts`: **`:263` profile foundation (F3)**, `:451`, `:508`, `:891`, `:905`
- `web-gun-service.ts`: **`:897` `getPublicUserFromApi` (F2)**
- `contacts-view.ts`: **`:1179` block/unblock (F5)**; `chatroom-shell-controller.ts`: **`:239`
  New Room (F4)**
- `web-talk-service.ts`: **`:340` `tryServer` (F6)**, `:483`
- `nearby-v3-runtime.ts`: `:37`, `:84`, `:121`, `:131`, `:148`, `:168`;
  `p2p-presence-client.ts`: `:43`, `:69`, `:96`;
  `web-mailbox-client.ts`: `:102`, `:127`, `:145`
- `techsupport-*`: `conversation-transport.ts:38/:60`, `faq-cache.ts:155/:250/:274`,
  `delegate-cache.ts:89`, `recovery-cache.ts:96`
- `web-attestation-service.ts`: `:89`, `:135`, `:151`; `remote-gun.ts`: `:31`, `:44` (native node
  loopback); `node-core-link.ts:40`; `graph-relay-client.ts:47/:60`;
  `p2p-conversation-relay-client.ts:16/:37`; `p2p-local-node-bridge-client.ts:48`;
  `p2p-webrtc-session.ts:265`; `p2p-transport-diagnostics-client.ts:9`;
  `android-wifi-direct-native.ts:135/:150`
- UI: `storage-inspector.ts:321` (F15), `local-statistics.ts:64`, `app-download*.ts`,
  `app-update-reminder-view.ts:67`, `browser-file-save.ts:16`

A shared `fetchWithTimeout(url, init, ms)` helper, plus a lint rule banning bare `fetch` in
`src/web`, would close this class.

## Checked and fine

- Bottom navigation, with the hub stalled. Codex's `navigationToken` and Settings-panel fixes
  hold; no main-thread gap ≥ 1 s was observed (spec 01 and the sweep).
- Message composers (Codex `2846414a`): disabled with "Sending…", re-enabled on error, draft
  kept until persisted.
- Create Talk: the editor opens and saves locally, and room delivery is fire-and-forget
  (`app.ts` `createTalk` handler).
- Room switching: server sync bounded at 4 s, roster probes at 700 ms, and a "loading online
  users" placeholder shows at once.
- 96 of the 103 controls the sweep reached on the five tabs, the app bar and every Settings
  section reacted within ~60 ms with the hub stalled.
