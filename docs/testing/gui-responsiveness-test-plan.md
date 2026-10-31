# GUI responsiveness test plan — every user operation, every network condition

**Goal:** no button, icon, row or gesture ever appears dead. Every user operation reacts
visibly at once and reaches a final state (done, or a clear failure) within a bounded time,
whatever the network does.
**Findings this plan grew from:** `gui-responsiveness-audit.md` (F1–F16).
**Automation:** `tests/e2e/responsiveness/`, helper `tests/e2e/helpers/ui-responsiveness.ts`,
`npm run test:e2e:responsiveness`.

## 1. Pass criteria (apply to every row in §4)

| # | Criterion | Budget | How it is measured |
|---|-----------|--------|--------------------|
| R1 | **Visible reaction** to the tap | ≤ 1 000 ms (target ≤ 300) | `clickAndMeasure`: first DOM change outside background regions, a checkbox/radio tick, a select/text field taking focus, a browser dialog, popup, download or file chooser. Taking focus alone does **not** count for a button. |
| R2 | **No freeze** | no main-thread gap ≥ 1 000 ms (warn ≥ 250) | `installMainThreadProbe`: 50 ms heartbeat + long-task observer |
| R3 | **Bounded outcome**: success or a failure message; no endless spinner or "Sending…" | ≤ 10 s on a stalled hub (≤ 15 s for media upload) | per-operation assertion in targeted specs |
| R4 | **Recoverable**: a control disabled during work is re-enabled after failure; the draft or input is kept | — | targeted specs |
| R5 | **Idempotent taps**: a second tap while pending neither duplicates the action nor opens a second dialog | — | targeted specs (double-click) |
| R6 | **Local-first**: actions about this device's own data (rename, profile, block, settings, create Talk) take effect locally even when the hub is unreachable, and publish later | — | targeted specs: reload after a fault and check the state stuck |
| R7 | **Reachable**: nothing (toast, banner, invisible overlay) covers the control | — | `clickAndMeasure` reports `not-clickable` and names what covers the control |

## 2. Network conditions

| ID | Condition | How (Playwright) | Models |
|----|-----------|------------------|--------|
| N0 | Healthy | — | baseline |
| N1 | Slow hub (each request +3 s) | `context.route` with a delay, or `E2E_HUB_API_DELAY_MS` (phone-path config) | congested cell |
| N2 | **Stalled hub**: HTTP held forever, WebSocket open but silent | `stallHub(page)` | Wi-Fi without internet, captive portal, dead cell. **Primary**: exposes `await fetch()` without a timeout. |
| N3 | Failing hub: everything rejects at once | `failHub(page)` | airplane mode |
| N4 | One endpoint stalled | `stallHubPath(page, /regex/)` | pins one audit finding |
| N5 | Flapping: N2 during the action, healthy afterwards | `stallHub` → act → `clear()` | elevator / tunnel; checks the action completes later and is not duplicated |
| N6 | Boot under N2/N3/N4 | fault applied before `goto` | cold start without network |
| N7 | Peer unreachable: WebRTC blocked, hub fine | Chromium `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` + no TURN | P2P DMs/delivery fall back to mailbox |
| N8 | Android resume with a stale network | real device: airplane on → background → resume → airplane off | `bd7427e8` foreground recovery |

Every operation in §4 runs under **N0, N2 and N3**. Operations marked ⚡ also run under N1, N5 and
N6 (they publish to the hub or a peer). Operations marked 📱 also run on the phone path
(`tests/e2e/phone-path`, RemoteGun over loopback) and on a real Android device (N8).

## 3. Two layers of automation

**Layer A: sweep** (`02-click-sweep-stalled-hub.spec.ts`). It needs no knowledge of the
controls: on each surface it discovers every visible control (`CLICKABLE_SELECTOR`), resets to the
same starting screen before each click, clicks, and checks R1, R2 and R7. Destructive controls
are excluded (`SWEEP_DENYLIST`, §6). Open findings are listed in `KNOWN_FINDINGS`; a new dead
control fails the run, and so does a known one that now works (so the list stays honest).
`SWEEP_HUB=stall|fail|healthy`, `SWEEP_ONLY=`, `SWEEP_VERBOSE=1`.

Today it covers the five tabs, the app bar of each tab, and every Settings section (103 controls,
single user). Each surface added to the sweep (§5) covers its controls with no per-button test.

**Layer B: targeted specs** (`01-stalled-hub-regressions.spec.ts` and the specs in §5). They
cover R3–R6, which a sweep cannot judge, and flows that need data (a peer, a Talk, a
conversation). Each audit finding has one test. While the finding is open the test is marked
`test.fail()`; delete the marker when it is fixed.

## 4. Inventory of user operations

Key: **A** = covered by the sweep today · **B** = targeted spec exists · **P** = planned (§5 phase) ·
F# = audit finding. "Expected reaction" is what R1 should see.

### 4.1 Shell (every screen)

| Operation | Expected reaction | Cov. | Notes |
|-----------|-------------------|------|-------|
| Bottom nav: Chatrooms / Contacts / Talks / Me / Settings | Tab active ≤ 1 s, panel shown | A B | regression of 1.0.201–1.0.203 |
| Tap a tab while boot is still running | Tab switches; actions work or say "starting…" | P1 | F1 |
| App-bar back (`back-to-chatrooms`, `-contacts-list`, `-settings-menu`, `graph-back-btn`) | Previous screen | P2 | |
| App-bar overflow (⋯) open / each item / close | Menu opens; item acts | P2 | narrow widths only (`52-appbar-overflow-responsive`) |
| Tap a toast; tap a Match! toast; tap a retry toast | Dismiss / open conversation / retry | P2 | |
| Tap an app-bar action while toasts are shown | The action runs | B | **F9** |
| Download banner: link / dismiss; update reminder: get / dismiss | Opens / hides | P2 | ⚡ `/api/downloads` without timeout (F16) |
| System announcement banner / TechSupport recovery banner actions | Act or dismiss | P3 | |
| Onboarding walkthrough: next / back / skip / finish | Step changes / closes | P2 | |
| First-run controller: location sheet answers | Proceeds | P4 📱 | |

### 4.2 Chatrooms tab

| Operation | Expected reaction | Cov. | Notes |
|-----------|-------------------|------|-------|
| Map ⇄ List toggle | View switches | A | `ee4b41e9` regression |
| Map: pan/zoom, Center on me, tap a person, tap a Place, tap a cluster, long-press a point → Travel here | Pans / opens / travel starts | P2 | ⚡ travel; `54-chatroom-tree-and-map` |
| Nearby self row ("Open Me") | Graph focus | A | |
| Nearby: Meet new people / Back to group 1 | Group changes or "searching…" | P2 | ⚡ hub introductions |
| Open a room / Place row | "Loading online users…" at once, roster later | P2 | ⚡ bounded 4 s |
| Return Home | Returns or explains | P2 | ⚡ awaits `resolveAutomaticNearbyRoom` + switch |
| Broadcast (with Talks / with none / all already sent) | Sending marker / editor / "already sent" | A B | F10 ⚡ |
| New Room → form → Create / Cancel | Form ≤ 1 s; Create shows progress | A B | **F4** ⚡ `app.ts:9387` POST without timeout |
| Member row → peer layout | Peer layout opens | P2 | |
| Match-collection start / end / review | Toast + list | P2 | |
| Place chat composer: send | "Sending…", then shown | P2 | ⚡ `2846414a` |

### 4.3 Contacts tab

| Operation | Expected reaction | Cov. | Notes |
|-----------|-------------------|------|-------|
| Filters toggle, relation/sort/search fields | Opens / filters | A | |
| Tags (topic directory) | Topic filter focused, or explanation | A | **F12** |
| Broadcast to a group → pick group → send | Dialog; sending state | A (open) P2 | ⚡ |
| Row tap → contact detail; row long-press / select; Pin; Remove | Detail / selection / pin / confirm | P2 | |
| Relationship & Credit: labels, nickname, rating, notes → Save | Saved at once | P2 | ⚡ F2 (`saveKnownPerson` awaits `getUser`) R6 |
| Vouch age / peer review | Toast | P2 | ⚡ silent on failure |
| Block / Unblock (+ notify-circle modal) | Applied at once, layout closes | P2 | **F5** ⚡ R6 |
| Mute / unmute TechSupport | Applied at once | P2 | |
| Starter contacts: add / remove | List changes | P2 | |

### 4.4 Peer layout (from any person)

| Operation | Expected reaction | Cov. | Notes |
|-----------|-------------------|------|-------|
| Message (open DM) | Conversation opens ≤ 1 s, or "opening…" | P2 | **F2** ⚡📱 |
| Inline DM Send | "⏳ Sending", then ✓ or re-enabled | P2 | **F2** R3 R4 ⚡📱 |
| Send a Talk to this person (picker → send) | Picker; "Sending"; ✓ count | P2 | ⚡ |
| Open their Talk responses, tags, places | Opens | P2 | |
| Overflow: Block / Mute | Applied, layout closes | P2 | **F5** |
| Back | Closes | P2 | |

### 4.5 Conversation overlay

| Operation | Expected reaction | Cov. | Notes |
|-----------|-------------------|------|-------|
| Open from list / toast / graph | Messages shown (cached first) | P2 | ⚡📱 |
| Send text; send with Enter; captured-question flow | "Sending…", draft kept until stored | P2 | `2846414a` ⚡📱 R4 R5 |
| Share media (pick file → upload) | "Uploading…" at once; done or error | P2 | ⚡ IPFS + `app.ts:2723` block-status fetch without timeout |
| Confirm deal | Pending state; confirmed | P2 | ⚡ awaits `confirmDeal` |
| Per-Talk thread switch; media viewer back | Switches / closes | P2 | |
| Back (`back-from-conversation`) | Closes even while a send is pending | P2 | `bd7427e8` |

### 4.6 Talks tab (IN / OUT)

| Operation | Expected reaction | Cov. | Notes |
|-----------|-------------------|------|-------|
| IN/OUT filter, type checkboxes, filters toggle, sort | List updates | A | |
| Build from template / from scratch / Create talk | Editor or picker opens | A B | |
| Incoming row tap → response dialog | Dialog ≤ 1 s, or "opening…" | P2 | **F6** ⚡📱 R5 |
| Incoming row gestures: swipe like/pass, long-press, quick answer, quick ignore | Row reacts at once | P2 | `83-incoming-talk-gesture-actions` ⚡ |
| Tap mode: Pass / Like / Pin buttons (enabled after selection) | Applies to selection | P2 | |
| OUT row: Edit (`loadTalkForEdit`), broadcast toggle, delete, disable, pin | Editor / toggle / confirm | P2 | ⚡ `getTalk` miss ≤ 8 s (F13) |
| Creator replies panel | Opens | P3 | hidden today (§M1) |

### 4.7 Talk editor, template picker, response dialog

| Operation | Expected reaction | Cov. | Notes |
|-----------|-------------------|------|-------|
| Editor: type radios, title, add/remove question/answer, route editor, More options, preview, media attach | Each control reacts | P3 (modal sweep) | |
| Editor: Create / Save | Closes; "Talk created" | B (open/close) P2 | ⚡ local-first, delivery in background R6 |
| Template picker: pick, customize, expand, close | | P3 | |
| Response dialog: each answer, next/back, submit, ignore, close | Advances; toast on submit | P3 | ⚡ F7 |
| Survey statistics dialog | Opens | P3 | |

### 4.8 Me tab

| Operation | Expected reaction | Cov. | Notes |
|-----------|-------------------|------|-------|
| Filters toggle, type/state filters, search | List updates | A | |
| Preferences dialog | Opens | A | |
| Answer row tap / select; Pin / Pass / Like / Talk | Opens / applies | P2 | |
| My Talks dialog | Opens | P3 | |
| Conversation list rows | Overlay opens | P2 | ⚡ `needConversationSync` |

### 4.9 Settings

| Operation | Expected reaction | Cov. | Notes |
|-----------|-------------------|------|-------|
| Menu → every section; Back | Section opens | A | |
| Profile: stage name field (change), headshot select, choose/take/remove photo, edit profile dialog | Saved state ≤ 1 s | A B | **F3** ⚡ R6 |
| Appearance, credit, languages, talk behaviour, content filters, connectivity, distance & home | Control reacts | A | |
| UI language select | Labels change | P2 | excluded from sweep |
| Refresh Location (app bar), Use my location | "Locating…", then result | A | **F11** 📱 |
| Encounter location picker | Opens; pick saves | P2 | |
| Linked devices: open, link code (show/share/QR/scan/paste), approve, import hand-off, enable sync | Each shows progress | A (open) P3 | ⚡ |
| Identity password: set / change / remove / unlock / lock now | Progress; result | P3 | destructive → own spec |
| Erase this device | Confirm; progress | P3 | destructive → own spec (`72-erase-this-device`) |
| Storage inspector refresh | Refreshes or errors | A | F15 |
| Help: guide, walkthrough, FAQ items | Opens | A | |
| Support delegate: invite code submit, accept/decline | Validation / progress | A | **F14** ⚡ |
| TechSupport operator views (inbox answer, delegates issue/revoke, FAQ) | Progress; result | P3 | `npm run dev:techsupport` identity |
| Download app section | Links | A | |

### 4.10 Android-only (📱, real device or `native-app` config)

| Operation | Expected reaction | Notes |
|-----------|-------------------|-------|
| Any tap during `generateAttestedKey` at boot | Reacts ≤ 1 s | **F8** |
| Settings render with `nearbyReadiness()` / permission status | Renders ≤ 1 s | F8 |
| Use my location (`lastLocation()`, permission sheet) | Sheet or fix | F8 |
| Resume from background with network gone (N8) | Nav and Back respond ≤ 1 s | `bd7427e8` |
| Notification tap → conversation | Opens | |
| Nearby offline: Wi-Fi Direct/BLE permission prompts, open settings | Prompt/settings | |

## 5. Automation phases

| Phase | Scope | Where | Status |
|-------|-------|-------|--------|
| **P0** | Harness (`ui-responsiveness.ts`); sweep of tabs + app bars + Settings sections under N2/N3/N0; targeted F1, F3, F4, F9 + controls | `tests/e2e/responsiveness/01`, `02` | **done 2026-10-30**; F1–F6, F8–F11, F14–F18 fixed the same day (audit "Fix status") |
| P1 | Boot under N2/N3/N4 for every boot fetch; taps during boot (F1) | `03-boot-under-faults.spec.ts` | planned |
| P2 | Two-user data-bearing surfaces: peer layout, conversation, contacts detail, block (F5), DM open/send (F2), incoming Talk open (F6), answer + match, deal; Talks/Me row actions; sweep each opened surface | `04-two-user-*.spec.ts`, seeded from `stage2-two-user` (one user with a match) | planned |
| P3 | Modal sweep: open each dialog, then sweep inside it (`scope: '.modal-overlay:last-child'`); editor, picker, response, linked devices, identity password, erase (with the destructive submit only in its own spec) | `05-dialog-sweep.spec.ts` | planned |
| P4 | Phone path: P0 sweep + F2/F3/F6 through embedded nodes (RemoteGun loopback) with `E2E_HUB_API_DELAY_MS` | `tests/e2e/phone-path/` | planned |
| P5 | Real Android: F8 bridge timing (instrument `@JavascriptInterface` durations), N8 resume, the P0 sweep via WebView remote debugging | `tests/e2e/native-app/`, `docs/testing/android-core-test-plan.md` | planned |
| P6 | Gate: run `01`+`02` in `npm run health` (≈ 2.5 min single worker) | `package.json` | after P1 |

Each finding, when fixed, flips its `test.fail()` / `KNOWN_FINDINGS` entry. Per
`journey-coverage.md`, a bug found on a device also gets a unit test.

## 6. Excluded from sweeps (each needs its own spec)

`SWEEP_DENYLIST`: erase, lock identity, remove password, unlink, logout (destroy identity or data);
UI language (rewrites every label); file inputs, `target=_blank` links, download links (leave the
page); disabled controls; the already-selected radio (a correct no-op). Their reaction is covered
by the existing specs (`71-linked-devices-page`, `72-erase-this-device`,
`32-language-setting-persist`). A P3 spec adds R1/R3 timing to those.

## 7. Running

```bash
npm run test:e2e:responsiveness                                   # 01 + 02, hub stalled
SWEEP_HUB=fail  npx playwright test tests/e2e/responsiveness/02-click-sweep-stalled-hub.spec.ts --project=chromium
SWEEP_HUB=healthy SWEEP_VERBOSE=1 npx playwright test tests/e2e/responsiveness/02-click-sweep-stalled-hub.spec.ts --project=chromium
SWEEP_ONLY=create-custom-chatroom npx playwright test tests/e2e/responsiveness/02-click-sweep-stalled-hub.spec.ts --project=chromium
```

The sweep prints one line per control with `SWEEP_VERBOSE=1`, e.g.
`#create-talk-btn — dom 48 ms (childList on body)` or
`#create-custom-chatroom-btn — NONE (tap reached the control; it did nothing visible)`. A
`[noisy page]` tag means the page never went quiet before the click, so treat that result as
weak.
