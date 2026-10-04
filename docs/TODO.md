# IinPublic TODO

Last reconciled: 2026-10-04.

This file contains the current execution focus plus explicitly deferred open work. Completed
implementation history is in
`docs/completed.md`; product requirements and design decisions are authoritative in
`docs/specs/iinpublic-technical-specifications.md`. The separate
`docs/IinPublic Identity & Key Architecture TODO.md` is a design specification and keeps its own
implementation plan.

The current product priority is the **website and Android app**. Work on their shared web runtime,
browser behavior, Android shell, and website↔Android interoperability before any other platform.
The order below, not the numeric issue ID, defines execution priority. Do not start a deferred issue
unless it directly blocks the website/Android focus or the product owner explicitly promotes it.
Run the Android availability preflight before physical-device work. When an issue is completed,
move its outcome and verification evidence to `docs/completed.md`, remove it here, and do not reuse
its ID.

## Active execution queue — website and Android first

- [ ] **OPEN-37 — Make the active chatroom the hard P2P traffic partition (design frozen
  2026-10-04).** One million online users must never create global discovery, a global roster, or
  pairwise connection attempts. Each device has exactly one active exchange room; capacity `C`
  bounds its candidate population and sparse fanout `K` bounds its live room-neighbor links.
  Users manually switch rooms to reach another population. Inactive memberships create no live
  traffic, while existing contacts/conversations reconnect only on demand. Authoritative design:
  `docs/design/chatroom-scoped-p2p-traffic.md`; requirements: Technical Specification §3.3 and
  §23. This is a prerequisite for enabling OPEN-36 nearby mode by default.
  - [x] Record the million-user scaling model, one-active-room rule, manual-switch semantics,
    transport layering, background lifecycle, privacy invariants, and validation plan.
  - [x] Add the active-room partition requirements to the canonical Technical Specification.
  - [x] Confirm capacity is one global parameter for every room, not a per-room policy or
    creator-configurable attribute; record the current production value `C = 498`.
  - [ ] Introduce a persisted `ActiveExchangeRoom` state machine and signed, expiring self-presence
    tied to the global protocol epoch; distinguish known rooms and remembered rooms from the one
    active exchange room. Do not introduce a room authority that issues admission proofs.
  - [ ] Remove/migrate the custom-room `capacity` API/metadata field (currently defaults to 50),
    and prevent creators or room metadata from overriding the global capacity.
  - [ ] Retire the owner/moderator/member/guest room-role model, owner-only rename/delete controls,
    owner-keyed room identity, and owner-gated challenge plugins. A creator is only the first
    ordinary participant and may be FIFO-evicted; leaving/eviction does not delete the room.
  - [ ] Remove capacity from the Create Room UI and treat trademark/name claims as outside the P2P
    protocol. Permit duplicate display names and distinguish rooms by stable cryptographic ID plus
    locally evaluated identity/trust evidence.
  - [ ] Implement a content-addressed, signed protocol-manifest chain. Each release pins the next
    release's public verification key; the next release carries an offline-signed manifest that
    commits the following key. Peers relay missing manifests during handshake and verify the chain
    locally without a central lookup. Bundle the public manifest history needed by the oldest
    supported release, never historical private keys, and never omit an incompatible intermediate
    manifest as a downgrade. Never ship a release private key in an application.
  - [ ] Persist the highest accepted manifest sequence/hash; reject rollback and fail closed on a
    same-sequence fork. Add a separately stored threshold recovery-key policy so loss or compromise
    of the ordinary one-time next-release key cannot permanently strand deployed clients.
  - [ ] Implement a global protocol-epoch transition for rare capacity changes. For `498 → 1000`,
    gossip the signed manifest during a grace period, preserve the active set at activation, open
    502 positions, do not resurrect evicted users, and synchronize manifests before room traffic.
    A compatible old release updates the parameter without reinstalling; an incompatible manifest
    engine or out-of-bounds parameter fails closed and requests an app update.
  - [ ] Treat a release manifest as authorization for protocol parameters, not remote-binary
    attestation. Validate every peer message locally and test forged manifests, replay, downgrade,
    same-sequence forks, lost/compromised next keys, recovery rotation, offline catch-up, activation
    clock skew, incompatible engines, and mixed-epoch refusal.
  - [ ] Implement release-1 compatibility semantics before production: parameter-only updates;
    optional capability intersection; mandatory capability/minimum-room-protocol failure; critical
    versus non-critical unknown fields; explicit epoch retirement; and local-only/update-required
    mode that preserves Settings, export, identity recovery, and update access.
  - [ ] Decide before release 1 between perpetual legacy availability (recommended) and an expiring,
    P2P-renewable protocol lease. Record that an isolated non-expiring old client cannot learn a
    future retirement until another peer supplies the authenticated manifest chain.
  - [ ] Define deterministic eventual FIFO/admission from signed expiring presence. Keep `C` and
    `K` as hard per-client safety bounds, and test partition/merge convergence; do not claim an
    instantaneous exact global roster without adding consensus or a coordinator.
  - [ ] Make Global/over-capacity parent rooms navigation directories rather than live mesh rooms;
    enforce the global capacity before accepting candidates into the local active set, and return
    bounded child choices without exposing the parent roster.
  - [ ] Populate and authenticate room scope on every discovery candidate. Fail closed on empty,
    expired, mismatched, or unauthorized room scope before signaling or link establishment.
  - [ ] Restrict hub presence, DHT rendezvous, LAN NSD, BLE, Wi-Fi Aware, and Wi-Fi Direct discovery
    to the active room. Advertise rotating opaque room tokens, never raw room IDs, coordinates,
    stage names, user IDs, or SEA public keys.
  - [ ] Enforce `K = 8–16` configurable automatic neighbors per device with bounded candidate
    samples/pages, jittered negotiation, backoff, diversity-aware selection, gossip TTL, seen-set,
    rate limits, and backpressure. Never construct a full room mesh.
  - [ ] Implement ordered room switching: stop old discovery/subscriptions and close old room-only
    links before starting the new room; retain durable queues, receipts, dedupe state, contacts,
    and on-demand direct conversations.
  - [ ] Stamp announcements with active room, global protocol epoch, and accepted manifest
    sequence/hash; synchronize and verify a missing checkpoint before processing. Keep pending
    broadcasts in their origin room and require a deliberate broadcast after switching instead of
    automatically rebroadcasting.
  - [ ] Move Android nearby ownership from `MainActivity`/WebView into a user-started
    `connectedDevice` foreground service with active-room status plus Pause/Stop actions. Persist
    checkpoints so radio loss, process recreation, or revoked permission resumes idempotently.
  - [ ] Wire all LAN/Direct/Aware/Internet adapters into the common route manager using actual
    path health and `NET_CAPABILITY_NOT_METERED`; remove the binary hub-reachable route decision
    and do not prompt in the middle of an exchange.
  - [ ] Replace fixed `OFFLINE_GROUP_CREDENTIALS` with rotating per-room/session Wi-Fi Direct
    credentials distributed only through an authenticated room capability/channel.
  - [ ] Add Settings for Nearby exchange (Off / While open / Always), room selection, metered byte
    policy, Wi-Fi-only peer forwarding, battery awareness, identity reveal, and diagnostics.
  - [ ] Add unit/integration/abuse coverage plus a synthetic one-million-user topology test that
    proves candidate enumeration and link attempts stay `O(NK)` with no global roster/fanout.
  - [ ] Verify on Android hardware with two isolated rooms across foreground/background/lock,
    room switching, radio loss, process recreation, and LAN↔Wi-Fi Direct↔Internet changes.

- [ ] **OPEN-35 — Enable Android R8 minification safely (found 2026-09-27, Play Console warning:
  "no deobfuscation file associated with this App Bundle").** `android/app/build.gradle`'s release
  buildType has `minifyEnabled false`, and references a `proguard-rules.pro` that has never
  actually existed (`proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'),
  'proguard-rules.pro'` — silently unused while minify is off; AGP only reads the file list when
  minification is actually on). Deliberately NOT flipped on blind for the first closed-testing
  release: two classes expose `@JavascriptInterface` methods the WebView calls **by exact name**
  from JavaScript (`NativeCustodyBridge` — the Android-Keystore-backed identity custody read/
  write path — and `NearbyJavascriptBridge`), and R8's default behavior without explicit keep
  rules is to rename/strip anything it can't see a Kotlin-side call site for. A regression there
  wouldn't crash loudly; it would silently break identity load/save for real users. To do this
  properly: write real keep rules for both `@JavascriptInterface` classes and any JNI native
  method declarations, enable `minifyEnabled`, build a release AAB, and verify on a real Android
  test phone (identity read/write survives, nearby discovery still works) before trusting it —
  not just a clean Gradle build. Low priority: this is a non-blocking Play Console warning, not an
  error; the app publishes and functions fine without it, just slightly larger and without
  crash-report symbolication.

The balanced production-security decision is documented in
`docs/security/techsupport-and-user-production-security.md`. Implement it in this order; keep the
ordinary-user browser-v3 and Android Keystore defaults automatic and do not introduce HSM/seed
phrase complexity into normal use.

- [x] **OPEN-27 — Remove the TechSupport root from the production browser/relay boundary.**
  Enforce keyless production-relay startup. Add a local root-control path that can issue and revoke
  short-lived delegate grants while sending only signed public records to the relay. Migrate every
  remaining rare root operation to a local signer/decrypter or offline command, then delete the
  `iinpublic_techsupport_keypair_v1` browser injection and retire the persistent root agent. Prove
  with tests that production relay startup rejects `TECHSUPPORT_KEY_FILE` and legacy plaintext-key
  configuration, invalid delegate grants are rejected, and normal website/Android support via a
  delegate does not expose the root pair.
  - [x] Fail production relay startup before reading a configured TechSupport vault or legacy key.
  - [x] Add `npm run techsupport:delegate -- issue|revoke`: signing stays in a short-lived local
    Node process and the relay receives/verifies only the signed public grant.
  - [x] Reconcile HTTP, embedded-node, live Gun, and cached grant reads monotonically: once an
    installation or relay request has observed a newer issue/revocation, an older signed record
    cannot restore authority.
  - [x] Publish signed revocations under a separate append-only discovery root and reconcile that
    history with mutable HTTP, embedded-node, live Gun, and cached state. This protects a fresh
    install from a stale mutable slot; no protocol can prove freshness if every transport withholds
    both the current record and its tombstone, so independent recovery/checkpoints remain OPEN-29.
  - [x] Reject and erase root injection in production web builds and restrict the legacy headless
    root harness to loopback development/E2E origins.
  - [x] Move production issue/revoke behind the local signer, use delegates for routine answering.
  - [x] **Regression found 2026-09-22, first real-hardware run since the local-signer rewrite
    (`4e2dd21b`, 2026-09-21): the opt-in `09-android-techsupport-delegate-answers` physical-device
    scenario did not pass — root-caused and fixed 2026-09-22 (`cde15762`).** The rewrite replaced
    the old desktop-TechSupport-browser approve flow (Honor's signed request seen live over Gun,
    master approves in the UI) with a direct `fetch(POST /api/support/delegate-grants)`, mirroring
    `techsupport:delegate issue`. Initial diagnosis on real hardware (Honor/RNV0217207000190) ruled
    out a hub-URL mismatch and this session's own OPEN-29 relay-poll addition, and pointed at
    `GET/POST /api/support/delegate-grants`'s server-side storage — but the true root cause wasn't
    device-specific at all: **`system-routes.ts` wrote delegate grants through the main relay's
    `gunService`, whose Gun instance is permanently `radisk:false`** (deliberate — see
    `p2p-runtime.ts`). That config silently drops multi-level chained Gun writes
    (`gun.get(a).get(b).put()`'s ack never fires, data never reaches `gun._.graph`) — the exact bug
    class `techsupport-durable-store.ts`'s class doc already documented from 2026-09-02 and fixed
    for TechSupport's message/mailbox channel via an isolated `radisk:true` Gun instance, but never
    extended to the newer delegate-grant/recovery-anchor routes. Confirmed live against production
    (`www.iinpublic.com`) with a real Safari-session grant, *before* the fix: `POST` returned
    `{stored: true}` but a moments-later `GET` (from the hub itself, no relay chain involved) came
    back empty — 100% reproducible, platform-agnostic (would hit any client: browser or Android).
    Fix: `TechSupportDurableStore` gained generic `putPath`/`getPath`/`getSet` (delegating to its
    existing, already-proven `put`/`get`/`collectMap`); `system-routes.ts`'s delegate-grant and
    recovery-anchor routes now prefer the injected durable store over `gunService`, matching the
    existing message-channel idiom. Verified live in production after redeploy: issued a real
    signed grant via `techsupport:delegate issue`, confirmed it was readable immediately, then
    **restarted the production service and confirmed the grant was still there** — proving real
    disk durability, not just warm-process memory. Test coverage: two new integration tests in
    `system-routes.test.ts` proving the durable store is preferred over `gunService` for both
    routes' reads and writes (a direct Jest unit test against a real `TechSupportDurableStore`
    was attempted first but hits a pre-existing Radisk/ts-jest incompatibility — same limitation
    `gun-message-store.test.ts`'s doc comment already describes for bare in-memory Gun).
    - Separately (and already fixed in the prior pass): the settings-tab menu-first drill-down
      (`3503cf13`) also broke this test's navigation to `#support-delegate-optin-toggle` — fixed
      with the same `openSettingsSection` call this scenario already needed.
    - Re-run against real Android hardware 2026-09-23 (a real Huawei phone, real app, real
      question typed through the actual Contacts → TechSupport UI, against the now-durable
      delegate-grants storage from the fix above) — confirmed the grants storage bug itself is
      genuinely gone (the phone correctly fetched the live grant roster with a fresh 200, and it
      verified correctly), but surfaced a **second, independent bug**: see below.
  - [x] **Regression found 2026-09-23, first real-hardware run of an actual asker (not the
    delegate) since the K7 follow-on synchronous-fetch fix — root-caused and fixed 2026-09-23
    (`a692d8be`).** `postSupportQuestionToMailbox` (app.ts) fetches and verifies the live
    delegate-grant roster fresh from the server before fanning out a mailbox envelope to each
    valid delegate (the exact fix the K7 follow-on comment describes) — but then discarded that
    freshly-verified return value and re-derived `validDelegates` by calling
    `readCachedDelegateGrants()`, a second, independent round trip through `localStorage`. Three
    real questions asked from a real Huawei phone (against a real Mac-mini Safari delegate,
    opted in and holding a valid, durably-stored grant) each produced a mailbox envelope for
    TechSupport's own master mailbox but never one for the delegate — confirmed via VPS server
    logs (`POST /api/mailbox/iinpublic-root-techsupport` ×3, zero `POST /api/mailbox/<delegate>`
    across the whole session) and a from-scratch Node simulation of the exact fetch → verify →
    filter → resolve-epub sequence against the live server, which succeeded cleanly at every
    step — proving the server side, the signature verification, and the delegate's epub
    resolution were never the problem. Fix: use the array `fetchDelegateGrantsFromServer` already
    fetched and verified directly, instead of re-reading it back through the cache. Verified type-
    check + full unit suite clean; rebuilt and redeployed to production (`a692d8be`) and republished
    fresh 1.0.49 installers (mac/windows/linux/android) to the downloads page. This fix was real and
    correct, but re-tested against the real Huawei phone (fresh 1.0.49 install) and still failed
    identically — see the entry directly below for the actual, conclusive root cause.
  - [x] **The real root cause, found 2026-09-23 (`62acd81f`): `SEA.verify` was completely broken
    inside the Android embedded-mobile bundle, unconditionally, for every build that has ever
    shipped.** `scripts/build-embedded-mobile.js` esbuild-bundles the whole embedded server
    (including `src/shared/techsupport-delegate.ts`) into one CJS file for on-device performance
    (fewer files for `NodeBridge.unpackIfNeeded` to copy one-at-a-time). esbuild's CJS bundling of
    `gun/sea` silently breaks its default-export interop: the bundled call site saw
    `import_sea.default.verify is not a function`, even though `gun/sea`'s own `module.exports` has
    a real `.verify` function — the plain (non-bundled) tsc server build, requiring the same module
    normally, verifies correctly. Every `verifyDelegateGrant`/recovery-anchor/FAQ-bundle signature
    check therefore failed unconditionally on Android, silently: the HTTP routes all still returned
    200 with empty results, indistinguishable from "nothing published yet" from any log, client
    symptom, or the two earlier (real, but insufficient) fixes above.
    - Found by booting the *actual built Android artifact* (`dist/embedded-mobile/server/node-
      app/embedded-node.js`) standalone against a real hub, outside any Playwright/adb harness —
      confirmed the relay fetch itself returned real, correctly-signed grants (4/4), but
      `verifyTechSupportDelegateGrant` rejected all 4; traced the rejection to the exact
      `SEA.verify` call throwing `TypeError: import_sea3.default.verify is not a function`. A
      parallel test of the plain tsc build (`dist/server/node-app/embedded-node.js`, what the
      Electron desktop app actually runs) verified all 4 grants correctly, confirming this was
      bundling-specific, not a code-logic bug — desktop was never affected by this particular
      regression, since it doesn't use this esbuild bundle at all.
    - Fix: `gun`/`gun/sea` are external to the bundle instead of inlined.
      `platforms/mobile/nodejs-project/node_modules/gun` was already staged on-device as a real
      dependency (previously only for the browser Worker's static assets, per this project's
      existing convention); it sits well within plain Node module resolution's normal upward walk
      from the bundle's own on-device location, so externalizing just leaves an ordinary
      `require('gun')`/`require('gun/sea')` at runtime instead of esbuild's broken interop
      wrapper — matching the already-working tsc build exactly. Bundle size dropped
      ~2.57MB -> ~2.23MB as a side effect.
    - New permanent regression coverage: `scripts/verify-embedded-mobile-bundle.js` boots the
      just-built bundle as a real child process and runs a real signed grant through its actual
      HTTP route end to end, wired into `build-embedded-mobile.js` so it runs automatically on
      every rebuild (skips gracefully without a local signing key). Confirmed it actually catches
      this exact regression: temporarily reverting the externalization made the smoke test fail
      immediately, with the identical original symptom, on the very next build.
    - Verified the actual shipped artifact, not just the dist output: decompressed the signed
      1.0.51 release APK and byte-compared its bundled server against the fixed dist build —
      identical. Rebuilt and republished 1.0.51 across all four platforms (mac/windows/linux/
      android) to the downloads page and redeployed production. Not yet re-confirmed against the
      real Huawei phone with this build (the user was asleep) — this is the first still-open,
      concrete next step for the morning: install 1.0.51, ask a question, confirm the delegate's
      inbox receives it.
    - Also added `tests/e2e/staged/stage2-two-user/00n-techsupport-delegate-answers-cold-asker.spec.ts`
      (proves the browser-only fan-out path works for a cold asker — passes, confirms the earlier
      localStorage-round-trip fix is real) and
      `tests/e2e/native-app/25-macmini-app-techsupport-delegate-cold-asker.spec.ts` (same scenario
      through the packaged Electron app — reproduced the bug's exact symptom without physical
      Android hardware, though Electron itself was never affected by the gun/sea regression since
      it runs the plain tsc build; this spec's own Electron-launch readiness flakiness on this dev
      machine is a separate, unresolved, lower-priority loose end — two follow-up runs timed out in
      `bootstrapNativeWindow` before ever reaching the app's own logic, unrelated to this fix).
  - [x] **Retired `dev:techsupport`'s root-key browser injection (2026-09-27).** Production paths
    were already hardened and tested (see the checked items above); this closed the last place a
    real TechSupport private key ever touched a browser process at all, even in dev.
    `scripts/dev-techsupport-login.js` no longer reads/injects the root pair into the browser —
    it boots a normal browser session (an ordinary, freshly-generated device identity, same as any
    other user), then issues that device's own pub a short-lived (1-day) delegate grant through
    the existing local-signer CLI (`techsupport-delegate-tool.js issue`, in-process, same code path
    a real production operator uses) and opts it in automatically
    (`iinpublic_techsupport_delegate_optin_v1`). The root pair is decrypted only in that
    short-lived Node process and never serialized to the browser. Also purges a stale
    `iinpublic_user_id`/`iinpublic_techsupport_keypair_v1` left in an existing
    `user_data/techsupport-operator` profile by a pre-rewrite run of this script, so an old dev
    profile can't silently resume the root identity. Verified live end to end against a real dev
    server: fresh ordinary device identity generated, delegate grant published and confirmed
    readable, `isTechSupportOperatorSession()` true on reload, all using a pub distinct from the
    real compiled TechSupport root pub. `scripts/techsupport-agent.js` (the separate headless
    inbox-watcher tool, explicitly documented as loopback/E2E-only and never run in production —
    `docs/IinPublic_VPS_Installation_Guide.md` §14) and the E2E suite's own root-mode test
    fixtures were deliberately left unconverted: both are already gated to non-production builds
    and loopback origins (tested), so converting them is a separate, much larger refactor with no
    corresponding production-risk reduction — worth doing eventually for hygiene, not blocking.

- [ ] **OPEN-29 — Add an independent emergency recovery authority.** Single offline recovery key
  (product owner decision 2026-09-22 — a solo-operator deployment doesn't yet justify an M-of-N
  threshold; the anchor-list-based design extends to one later without breaking clients). A real
  recovery keypair is generated and pinned (`techsupport-trust-anchors.json`'s `recovery`
  section) — its private half must still be moved to genuinely offline/cold storage before this
  is production-ready; it currently sits in this dev machine's `secrets/` (gitignored) for
  testing.
  - [x] `src/shared/techsupport-recovery.ts`: `RecoveryAnchorRecord` (revoked dm/announcement
    pubs + a next dm/announcement pub, one global record, no expiry — trust changes only by a
    newer signed record), sign/verify, and `isRecoveryAnchorRollback` (strictly-newer-only,
    mirroring `isDelegateGrantRollback`'s monotonic discipline).
  - [x] `isTrustedDmPubWithRecovery` / `isTrustedAnnouncementPubWithRecovery`: an explicit
    revocation wins even over the compiled trust-anchor list; a `next*Pub` extends trust to a pub
    the compiled list doesn't contain. Wired into `verifyFaqBundle` and `verifyDelegateGrant` /
    `isTrustedTechSupportAuthorPub` as an optional, additive parameter — every pre-existing call
    site keeps its exact prior behavior unless it opts in. A delegate grant issued by a
    since-revoked master stops authorizing its delegate immediately (found and fixed a real bug
    here during review: the delegate-grant fallback path was initially recovery-unaware and would
    have silently bypassed a revocation).
  - [x] Distribution: `GET`/`POST /api/support/recovery` (mutable current slot + append-only
    history root, same monotonic-reconciliation shape as OPEN-27's delegate-grant hardening),
    embedded-hub-relay-client passthrough for native devices, client-side cache/subscription
    (`techsupport-recovery-cache.ts`) wired into `app.ts`'s boot sequence and relay poll.
  - [x] `scripts/techsupport-recovery-tool.js` (`npm run techsupport:recovery -- generate|publish|
    status`) — genuinely separate encrypted vault and passphrase env vars from the DM tool;
    decrypts only in a short-lived local process; publishes only the signed public record.
    Verified: real generate → real encrypted vault → real signed dry-run record (recoveryPub
    matches the compiled anchor) against a live embedded-node server.
  - [x] Unit tests (19, `techsupport-recovery.test.ts`) covering sign/verify/rollback and the
    actual security property end to end; integration tests (`system-routes.test.ts`) for the
    routes; CLI arg/passphrase/publish tests (`techsupport-recovery-tool.test.js`); regression
    tests in `techsupport-faq-bundle.test.ts` proving the revocation-bypass bug above stays fixed.
  - [x] **Real live HTTP publish round trip, done against local dev (2026-09-27) — found and
    fixed a genuine, previously-undetected bug, not just a missing proof.** Deliberately run
    against a local dev server rather than production (a recovery-anchor publish is a real
    trust-rotation action; production needs the product owner present for that, per the note this
    replaces). Publishing a real signed record returned `{stored: true}`, but a moments-later read
    came back `{current: null, history: []}` — the server log showed
    `[TechSupportDurableStore] put ack error: "Invalid data: Array at techsupport-recovery.current...`.
    Root cause: `RecoveryAnchorRecord`'s `revokedDmPubs`/`revokedAnnouncementPubs` are real JS
    arrays (even when empty), and Gun cannot store a nested array under a compound path (the same
    documented quirk this file's own "Gun.js quirks to know" section already names) —
    `TechSupportDurableStore`'s generic `putPath` passes the record straight to Gun with no
    workaround. Every OTHER generic-accessor consumer (delegate grants, FAQ entries) has no array
    fields and was never affected, which is why this was never caught before despite those routes
    sharing the exact same code path. **This means every recovery-anchor publish ever attempted
    against a real deployment, including this exact route, would silently fail to persist** —
    the dry-run signing path (the only thing previously verified) never touches Gun at all, so it
    could not have caught this.
    - Fix: `recoveryAnchorToDurableWire`/`recoveryAnchorFromDurableWire`
      (`src/shared/techsupport-recovery.ts`) — JSON-serializes the two array fields only at the
      `system-routes.ts` durable-store read/write boundary, mirroring this codebase's existing
      `questionsJson`-style idiom for the same Gun limitation. Never changes the signed payload,
      the POST body shape, or the embedded-hub-relay HTTP shape — only what actually reaches Gun.
    - Verified live end to end: published a real record, confirmed it read back correctly (real
      arrays, signature verifies), then **restarted the dev server process and confirmed the
      record was still there** — the same disk-durability bar the delegate-grant fix was held to.
    - Test coverage: 4 new unit tests (`techsupport-recovery.test.ts`) covering the wire round
      trip for both non-empty and empty arrays (the exact shape that broke live) plus
      pass-through/null-safety; 2 existing integration tests updated
      (`system-routes.test.ts`) that had encoded the old (buggy) plain-array `putPath` call as
      the expected behavior.
  - [ ] Cross-client "stale cache / installed Android version catches up" scenario has no E2E
    coverage yet — only unit/integration. The mechanism (client-side monotonic cache +
    HTTP-relay poll, identical in shape to the already-E2E-tested OPEN-27 delegate-grant
    hardening) gives reasonable confidence, but this is asserted, not demonstrated end to end.
  - [x] **Master-operator recovery banner (2026-09-27).** `techsupport-recovery-banner-view.ts`
    renders a warning banner (reason, issued date, revoked-key count) at the top of the master's
    own Settings, above the Delegates section — only for a session logged in as
    `TECHSUPPORT_ROOT_USER_ID`; renders nothing in the normal no-incident state. The `console.warn`
    stays as-is for anyone with devtools open. Wired through the existing
    `support-settings-controller.ts` factory (`updateRecoveryAnchor`/`renderRecoveryBanner`,
    matching the delegates/inbox pattern exactly) and pushed from `refreshDelegateAdminPanel` — NOT
    from a one-shot check inside the live Gun subscription itself, which fires early in boot
    (often before `currentUser` resolves) and found a real timing bug during manual verification:
    the very first implementation silently never painted the banner because its only push
    happened at that early, pre-login moment. `refreshDelegateAdminPanel` already runs from every
    later point in the lifecycle where the master's identity is confirmed, so re-routing through it
    (reading the always-current `readCachedRecoveryAnchor()`) fixed it. Verified live against a
    real dev server + the real recovery vault: published a real anchor record, loaded a fresh
    browser as the TechSupport root, and confirmed the banner rendered with the real reason/
    timestamp/revocation-count.

- [x] **OPEN-30 — Harden website release integrity and the browser execution boundary.** Treat CSP
  as defense in depth rather than private-key custody.
  - [x] Remove CSP `scriptSrc: 'unsafe-eval'` (`src/server/bootstrap/http-bootstrap.ts`). Verified
    against the current dependency set (webpack `devtool` is `source-map`, never
    `eval-source-map`; the built bundle's only `new Function(...)` call is webpack's own benign
    `__webpack_require__.g` global-object shim, which falls back to `window`; MapLibre GL JS
    compiles style expressions to a safe interpreter, not `eval`) and confirmed live: the
    embedded-node server booted under the tightened policy, the app loaded, and the chatroom map
    view rendered (MapLibre worker + WebGL init included) with no CSP-violation console errors.
    No dev-only carve-out was needed — `npm run dev`'s split webpack-dev-server never goes through
    this Express/helmet CSP at all, only the embedded-node/production/desktop path does.
  - [x] "Untrusted content cannot become executable markup" already has real, if scattered, unit
    coverage (`conversation-message-cards.test.ts`, `chatroom-message-view.test.ts`, etc. assert
    `<script>`/`onerror=` payloads are neutralized) on top of the codebase's `escapeHtml` rendering
    convention (52 files). Not yet a single consolidated audit/test across every rendering surface
    (stage names, delegate labels, FAQ content, ...) — worth doing but not urgent given existing
    coverage.
  - [x] Release-integrity checks: published `SHA256SUMS` per release. `npm run build:embedded`
    writes `dist/web/SHA256SUMS`; `scripts/stage-app-download.mjs` writes
    `public/downloads/SHA256SUMS` for desktop installers + the Android APK. Both are
    `sha256sum -c`-compatible. `npm run release:verify-checksums -- --dir <path>` or
    `-- --base-url <origin>` re-hashes and reports any mismatch/missing file — verified live
    against a running embedded-node server, including that it actually catches a tampered file.
  - [x] **Always-on release-checksum monitor (2026-09-27).** `scripts/monitor-release-checksums.sh`
    wraps `release:verify-checksums --base-url` for a periodic systemd timer
    (`docs/IinPublic_VPS_Installation_Guide.md`'s new "Release-checksum monitor" section, right
    after the main service section) — every 6h + 10min after boot, `Persistent=true` so a missed
    run (VPS reboot) still fires once it's back up. A mismatch both fails the systemd unit outright
    (visible in `journalctl -u iinpublic-checksum-monitor`) and writes a `checksum-monitor-
    status.json` marker file with the failure detail, so the outcome is checkable without journal
    access. Deliberately no outbound email/webhook (product-owner decision 2026-09-27 — no
    alerting infra exists yet to wire into honestly; journal + marker file is the real, checkable
    thing available today). Verified live: ran the wrapper against the real production origin
    (passed, 44 files, wrote a real `ok` status file) and separately against a deliberately
    unreachable URL (failed with the right exit code and a real `failed` status file capturing the
    error) before installing.
  - [x] **Subresource Integrity on `index.html`'s entry scripts (2026-09-27).**
    `scripts/add-sri.js` computes a real sha384 digest of `startup-head.js` (served from
    `public/`) and webpack's `bundle.js` entry (`dist/web/`) and injects
    `integrity`/`crossorigin="anonymous"` into their `<script>` tags, wired into
    `build:embedded` right after `build:web` and before `generate-web-checksums.js` (so the
    checksum manifest hashes the SRI-patched file actually served, not a pre-patch copy) — idempotent
    on re-run. **Deliberately scoped to the two statically-referenced entry scripts only, NOT
    webpack's dynamically-imported async chunks** (maplibre-gl, helia/IPFS, libp2p — this app has
    many via code-splitting); covering those correctly needs a dedicated webpack plugin
    (`webpack-subresource-integrity`) and is real, separate build-pipeline work, since a wrong/
    stale hash on an async chunk fails differently (a feature silently breaks for legitimate users
    at runtime) than a bad entry-script hash (fails loudly at the very first load). Verified live:
    built, loaded the real page in a browser (booted cleanly, no integrity errors) — then
    deliberately appended a byte to the built `bundle.js` and reloaded: Chrome blocked it outright
    (`Failed to find a valid digest in the 'integrity' attribute ... resource has been blocked`),
    confirming this actually enforces, not just decorates. New test coverage:
    `scripts/test/add-sri.test.js` (6 tests, `npm run test:add-sri`, wired into `test:unit`).

- [x] **OPEN-33 — App update checks/reminders (found 2026-09-27, product owner asked "how can an
  app check there is new updates? or gets reminder of new updates?"). All three platforms done
  2026-09-27.** State per platform:
  - [x] **Web:** nothing needed — a page load always serves the current deployed build.
  - [x] **Desktop (Electron), fixed 2026-09-27.** `electron-updater` was already wired in
    `platforms/desktop/main.js` (`autoDownload: true`, checks on launch and periodically, "Restart
    now / Later" dialog on `update-downloaded`) but was NON-FUNCTIONAL: `build.publish` targeted
    `{ provider: "github", ... }`, and this project has never published a GitHub Release, so
    `checkForUpdates()` found nothing every time (the failure was swallowed to a log line, never
    surfaced as a visible bug). Fixed: `publish` now targets
    `{ provider: "generic", url: "https://www.iinpublic.com/downloads/" }`. Since
    `downloads:stage`'s existing renamed-filename copy (`IinPublic-<version>-<platform>.<ext>`,
    for the app's own `/downloads` page) is a DIFFERENT filename than the one
    `latest.yml`/`latest-mac.yml`/`latest-linux.yml` actually reference (electron-builder's own
    naming), a new `scripts/stage-autoupdate-manifest.mjs`
    (`npm run downloads:stage-autoupdate -- mac|windows|linux`) reads the real manifest electron-
    builder just wrote and stages it plus every file it references, unmodified — both filenames now
    coexist in `public/downloads/`. Documented in `DEPLOY_PRODUCTION.md`. Test coverage: 7 unit
    tests (`scripts/test/stage-autoupdate-manifest.test.js`, `npm run test:stage-autoupdate-
    manifest`, wired into `test:unit`) — including a regression test for a REAL inconsistency found
    while building this: this repo's own `platforms/desktop/dist/latest.yml` (a stale leftover from
    an earlier build) referenced a filename that didn't match what was actually on disk
    (`IinPublic-Setup-1.0.57.exe` in the yml vs `IinPublic Setup 1.0.57.exe`, dash vs literal space,
    on disk) — the script fails loudly on this rather than silently staging a broken auto-update
    path; confirmed by testing live against the real (if inconsistent) local dist output for all
    three platforms. No other code change needed; the dialog/quit-and-install flow already existed.
    **Not yet re-verified against a genuinely fresh, current desktop build** (only tested against
    pre-existing `platforms/desktop/dist/` output of mixed vintage) — worth a real end-to-end check
    (build → stage → install an older version → confirm the in-app updater actually finds and
    installs the new one) the next time a desktop release is cut.
  - [x] **Android, implemented 2026-09-27.** On launch, fetches `GET /api/downloads` and compares
    `version` against this device's own running version (the `?app_version=` query param
    `MainActivity.kt` already appends — same value `settings-view.ts`'s "IinPublic version" line
    reads) via a new shared, dependency-free `src/shared/semver-compare.ts`
    (`isNewerVersion`/`compareVersions` — web/Electron could reuse it too, not wired in either
    since desktop now has its own real in-app updater and web is always current). When the server's
    published version is newer, shows a dismissible banner (`app-update-reminder-view.ts`, reusing
    the app-download-banner's exact CSS class) linking straight to the APK, plus a small `!` badge
    on the Settings gear icon (`notification-badges.ts`'s `renderUpdateAvailableBadge`, same
    `.notification-badge` element the unread-message badges already use). This can only ever be a
    reminder — a sideloaded app cannot silently self-update — the user still taps through the
    browser download + install flow (the v1+v2 signing fix from OPEN-32's sibling work means that
    flow itself now works broadly). Dismissal is per-version (`localStorage`): dismissing hides the
    reminder for that exact version, but a still-newer version published afterward reminds again.
    Deliberately Android-only (`native_platform=android`) — desktop has its own updater, web is
    always current on load. Refactored the pre-existing native-host/version detection (previously
    duplicated slightly differently in `settings-view.ts` and `app-download-banner.ts`) into one
    shared `native-host-info.ts` all three now read from. 22 new unit tests (`semver-compare.test.ts`,
    `app-update-reminder-view.test.ts`) plus live verification against a real dev server: loaded
    the app as `native_platform=android&app_version=1.0.50` against a real published `1.0.57`,
    confirmed the banner + badge both appeared with the real version/link, dismissing removed both
    immediately and persisted (`localStorage`), and the banner correctly stayed hidden after a
    reload for the same already-dismissed version. **Not implemented:** a periodic re-check while
    the app stays open (only checks on launch) — the TODO's own "(or a daily timer)" phrasing
    treated these as alternatives, and Android processes get restarted by the OS often enough that
    launch-time alone covers the common case; add a timer later if that assumption turns out wrong
    in practice.

- [ ] **OPEN-34 — Android Keystore custody migration intermittently leaves the legacy v1 record non-null
  (found 2026-09-27, investigated in depth, MITIGATED but not conclusively fixed).**
  `18-android-keystore-custody.spec.ts`'s "migrates atomically..." test on RNV0217207000190 (Honor): after a
  v1->v3 migration (write the v1 legacy localStorage record with the real active pair, remove native custody,
  reload — production's actual startup migration boundary), the migrated pair is always correct, but
  `localStorage.getItem('iinpublic_key_custody_v1')` intermittently comes back non-null afterward — the SAME
  identity's original encrypted blob, not a different/stale record from an earlier run (confirmed by comparing
  `publicIdentity.pub` against the active pair — they match).
  - **Ruled out with direct evidence, not just reasoning:**
    - `IdentityPasswordCustodyManager` (a separate subsystem that also names `iinpublic_key_custody_v1` as ITS
      OWN legacy key) — its `getStatus()` is read-only when no password is set; never called on this path.
    - A second write from `persistCustodyRecord` via the `pairStoredInV3`-guarded fallback path — instrumented
      every call site with a stack trace; it fired exactly once, from the test's own setup, before the delete.
    - A source-level trace on `removeIfMatches` — confirmed the delete runs and reads back `null` immediately.
    - A **global `Storage.prototype.setItem`/`removeItem` trap**, installed via Playwright `addInitScript` (runs
      before ANY bundled module's own top-level code, closing the gap where a module could cache the original
      method reference before a same-bundle trap installs) — across a full test run, exactly ONE `removeItem`
      fired (the real migration code) and ZERO further writes of any kind occurred anywhere in the page's JS
      realm, yet the record still reappeared moments later.
  - That is conclusive that no JS-level code in this page writes the key a second time — the reappearance is a
    storage-engine effect (WebView's `localStorage` is synchronous at the JS API level but backed by an
    async-flushing store), not an application logic bug in `migrateFrom`/`removeIfMatches`.
  - **Attempted fixes, both evidence-based, neither conclusively resolved it:**
    1. A 1.5s wait between writing the v1 fixture and reloading (`18-android-keystore-custody.spec.ts`) — kept,
       doesn't hurt, but alone did not fix it (still failed 4/4 with it added).
    2. `NativePasswordFreeCustodyManager.migrateFrom` (`native-password-free-custody-manager.ts`) now re-checks
       `source.readPair()` after the delete and retries `removeIfMatches` up to 4 times with backoff (250ms x
       1..4) — real, safe, evidence-grounded hardening against exactly the flush-race class of bug, kept
       committed. **Measured pass rate with this fix: 1/9 (11%) across repeated trials on the same device — not
       statistically distinguishable from the failure rate without it.** The retry does not appear to be hitting
       the actual window where the stale write lands; whatever the precise mechanism is (possibly a
       multi-process WebView storage-partition sync effect, possibly something below the JS engine entirely),
       it was not pinned down further before ending this investigation.
  - **Still open:** the real mechanism. Does not affect the active identity (always correct in every trial) —
    remains a leftover-plaintext-adjacent hygiene concern, not a correctness bug, but worth resolving before
    trusting it for any OPEN-06 custody guarantee. Only reproduced/investigated on RNV0217207000190 (Honor); not
    checked on the other two phones. Next step if resumed: check whether a genuine cold `am force-stop` + full
    process relaunch (not same-process `location.reload()`) exhibits the same behavior — `reload()` keeps the
    renderer/storage-partition connection alive in a way a real process death does not, and this device is
    independently documented elsewhere in this codebase as one that can restart its foreground-service process
    mid-cold-boot, which is a class of behavior no diagnostic pass in this session actually checked for despite
    being a documented, real behavior of this exact harness.

- [x] **OPEN-32 — Production `GET /api/support/delegate-grants` silently returned an EMPTY roster after ~1 day of uptime
  (found 2026-09-25). User-facing impact mitigated 2026-09-27; the underlying root cause is still NOT known.**
  Evidence: the durable store file (`techsupport-radata-8080/!`) still held all 5 grant records (one valid: "Safari (Mac)",
  expires 2026-10-24), and a COPY of that directory read back all 5 with the same `dist` code under both the VPS's Node 24 and a
  Mac's Node 26 — including under overlapping concurrent `getSet` calls (`.map().on()` + `.off()` from several pollers). Only the
  long-running production process returned `{"grants":[],"revocations":[]}` (3 consecutive polls); `sudo systemctl restart
  iinpublic` immediately restored all 5. `faq-entries` (same store, same `collectMap`) kept working, so the degradation is
  specific to nodes that were only ever on disk, not written since boot. Impact: while empty, no delegate could verify its own
  grant ("Cannot answer — grant missing") and askers could not verify a delegate-signed answer. Suspects (still unconfirmed):
  repeated `.off()` on the shared `techsupport-delegates` chain of a radisk-backed Gun (`TechSupportDurableStore.collectMap`,
  600 ms window) unloading in-memory state; radisk read-cache eviction.
  - **2026-09-27 follow-up: the watcher script mentioned in the original write-up (started 2026-09-25 23:51 UTC to log
    grants/faq counts + RSS every 2 min) never actually captured anything** — checked the VPS (no running process, no tmux/
    screen session, no log file) and it had evidently died silently at some point (most likely when the SSH session that
    launched it, without `nohup`/`systemd`/`tmux`, disconnected) without that being noticed. So the live-recurrence
    investigation this note describes was never actually completed; treat the root cause as still fully open.
  - **Implemented instead: the first candidate fix ("cache the last verified non-empty roster in the route").** This fixes the
    actual user-facing impact without needing the root cause — `GET /api/support/delegate-grants`
    (`src/server/routes/system-routes.ts`) now keeps an in-memory `lastNonEmptyDelegateRoster` (single long-running process,
    matching the actual deployment this was observed on), and only falls back to it in the EXACT observed shape: both `grants`
    and `revocations` come back completely empty from a fresh read while the cache isn't. A read that legitimately finds
    anything at all (including a real revocation) is trusted as-is and updates the cache normally — a genuine revocation can
    never be masked by this fallback, since revoking a delegate always produces a non-empty read at the moment it happens.
    4 new integration tests (`system-routes.test.ts`): the exact empty-then-recovers sequence, a genuine revocation correctly
    overriding the cache, and a genuinely-empty (never-populated) deployment still returning empty rather than erroring.
  - **Not done:** the POST route's own internal pre-write existing-grant lookup could hit the same transient-empty-read glitch
    (would incorrectly treat an existing grant as absent, defeating rollback protection for that one write) — narrower/rarer
    impact than the GET route (operator-initiated, not continuously polled), left unprotected for now; extend the same pattern
    there if it's ever observed to matter in practice. The actual root cause is still open — re-establish a DURABLE watcher
    (systemd timer, not a bare shell loop over an SSH session) if/when actually investigating it further; the impact-mitigating
    fix above means this is no longer urgent.
  - **Not yet deployed to production** — committed and pushed to `origin/dev`, pulled onto the VPS's working tree, but
    `npm run build:production` + `systemctl restart iinpublic` (the actual deploy) was deliberately left as a separate step
    (same reasoning as every other fix from this session — see the top of this file's recent history).
- [x] **OPEN-31 — TechSupport FAQ bundle does not scale (found 2026-09-24; IMPLEMENTED 2026-09-24, option 1: per-entry keyed storage).**
  - **Implemented (option 1).** Each answered question is now its own flat, individually signed record
    (`src/shared/techsupport-faq-entry.ts`: `signFaqEntry`/`verifyFaqEntry`/`isFaqEntryRollback`),
    stored at `techsupport-faq-entries/<questionKey>` in the hub's DURABLE support store (the legacy
    bundle route wrote to the radisk:false main graph — a latent durability bug, fixed as part of this).
    Publishing answer N+1 is one sign + one write (O(1)). Routes (`system-routes.ts`):
    `GET /api/support/faq-entries/:questionKey`, `GET /api/support/faq-entries?limit=` (newest-first,
    hard-capped at 500, master audit view only), `POST /api/support/faq-entries` (the relay VERIFIES
    author trust — master/recovery anchor/valid delegate grant, looked up in the durable store, the
    main Gun graph for grants approved via the in-app panel, or the hub relay — and refuses a stale
    answer overwriting a newer one with 409). Embedded nodes relay via `getFaqEntry`/`postFaqEntry`/
    `listFaqEntries` on `EmbeddedHubRelayClient`.
  - **Client.** `handleSupportQuestion` does ONE synchronous per-key fetch right before its lookup
    (no background whole-FAQ sync, no poll-interval race) and falls back to a per-entry localStorage
    cache — capped at 100 records, least-recently-cached evicted — so a known question still
    auto-answers offline and a device's cache is proportional to what IT asked, never to the global FAQ.
    The auto/human answer message carries its own signed record (`faqEntryJson`), so
    `filterVerifiedSupportMessages` verifies it with no cache at all. The whole-bundle subscription and
    5s bundle poll are gone; operator sessions instead do a per-pending-key check (to hide rows another
    delegate already answered) and the master's "Delegate activity" list uses the capped listing.
  - **Side fix.** A seed-FAQ-sourced auto-answer used to fail `filterVerifiedSupportMessages` on
    re-render (only the live cache was consulted); it now also verifies against the compiled seed bundle.
  - **Migration / compatibility.** The legacy `GET/POST /api/support/faq-bundle` routes remain (read
    falls back to the old main-graph location) so already-installed APKs keep working. Answers that
    exist ONLY in the legacy bundle (e.g. production's "question 2") need a one-time
    `npm run techsupport:delegate -- migrate-faq --api-base https://www.iinpublic.com` (verifies the
    bundle first, then re-signs each answer as its own record with the master key; `--dry-run` first).
    Until that is run they are not auto-answered by new clients.
  - **Not done / still open:** option 2 (delegate-only FAQ) was not pursued. FNV-1a 32-bit key
    collisions are guarded only by `canonicalQuestion` equality inside `lookupSupportAnswer`.
    Original analysis below kept as the design record.
  **Original analysis (written before implementation, kept as the design record):** the whole Q&A history was ONE array, re-signed and
  re-published as a single unit on every new answer (`signFaqBundle`), and every asker's client
  downloads and caches the ENTIRE bundle (`fetchFaqBundleFromServer`) just to look up one
  question. Two real, compounding problems as the FAQ grows: (1) writes get slower over time —
  answering question N+1 re-signs and re-publishes all N previous answers; (2) every device
  caches the full history in `localStorage` — the exact storage that hit its quota and broke a
  real delegate session live tonight (`QuotaExceededError`, forced a full site-data reset
  mid-session). It's explicitly marked "v1" in the code (`techsupport-faq-bundle.ts`'s own
  comment: the distribution layer is meant to be swapped out later) but no detailed replacement
  design exists yet.
  - **The lookup itself is already O(1) and needs no change.** `supportQuestionKey(question)`
    (`techsupport-faq.ts`) normalizes (trim/lowercase/strip trailing punctuation) and hashes
    (FNV-1a) the question text entirely client-side, with no network call — exact key match only,
    deliberately no fuzzy/semantic matching ("a wrong fuzzy hit answers a user's real question
    with something unrelated, which is worse than honestly saying 'this is new'"). The bottleneck
    is purely that this key currently has to be checked against an array that was fully
    downloaded first, not that the lookup itself is inefficient.
  - **Two real options were discussed, not yet decided between:**
    1. *Per-entry keyed Gun storage* (the more mechanical fix): store each `SupportFaqEntry` at
       its own Gun node addressed by its existing `questionKey`
       (e.g. `techsupport-faq-entries/<questionKey>`) instead of one growing `entriesJson` blob,
       and sign each entry individually at publish time instead of re-signing the aggregate. An
       asker's client does one targeted `gun.get(...)`/HTTP-relay read per question instead of a
       full-bundle download; writes become O(1) instead of O(n). This is the same pattern already
       used for message history (`merkle-checkpoint.ts`'s checkpoint/pruning system), not a new
       concept for this codebase. As a side effect, this alone already keeps an ordinary asker's
       local cache proportional to *their own* question history, never the global FAQ size — they
       never "keep a large copy" regardless of how big the FAQ gets globally, and the instant,
       offline-capable auto-answer stays intact (the asker still resolves a known question locally
       and immediately, without needing anyone else online).
    2. *Route every question through a delegate, ordinary users never sync any FAQ data at all*
       (product owner's proposal): only delegates/master hold a local FAQ cache; an asker's
       question always goes out via the existing mailbox fan-out, and a delegate's own client
       recognizes and auto-answers a known question on the delegate's behalf, invisibly. Guarantees
       zero FAQ data on ordinary devices, at real costs: the instant/offline auto-answer is lost
       for everyone (a well-known answer now waits on *some* delegate device being online and
       processing it); multiple simultaneously-online delegates could race to auto-answer the same
       question (today's mailbox fan-out already handles this class of race for *human* answers —
       "first to answer wins, others see it's already answered" — the same pattern would need to
       extend to auto-answers); and it does not fix the underlying per-write re-sign inefficiency
       for delegates themselves, who would still hold the full growing history and eventually hit
       the same storage wall a real delegate session hit tonight — just for a smaller population
       (delegates only, not every asker).
  - **Recommendation for whoever decides:** option 1 (per-entry keyed storage) appears to resolve
    the product owner's actual concern (ordinary users never accumulate a large local copy) as a
    natural side effect, without sacrificing the instant/offline auto-answer UX or leaving
    delegates exposed to the same unbounded growth — but this needs the product owner's own
    review before implementation, not a unilateral pick. Scope if approved: `techsupport-faq-
    bundle.ts` (per-entry signing), `techsupport-faq-cache.ts` (per-key fetch instead of whole-
    bundle fetch), `system-routes.ts`'s faq-bundle route (per-key GET/POST, matching the pattern
    already used for delegate-grants/recovery), `embedded-hub-relay-client.ts` (per-key relay
    methods), and `app.ts`'s `handleSupportQuestion`/`handleAnswerSupportQuestion` (call the new
    per-key fetch instead of `readCachedFaqEntries()`/`signFaqBundle` over the whole array). A
    real, moderately-sized refactor — not a quick patch.
  - **Related question resolved 2026-09-24, not a gap: how does a new question route to multiple
    online delegates?** Confirmed against the code: it's broadcast to every currently-valid
    delegate (plus the master), each getting their own encrypted mailbox envelope
    (`postSupportQuestionToMailbox`'s K7 fan-out loop) — never routed to just one based on
    distance, load, or any other condition; no such routing exists anywhere in the codebase.
    Whoever answers first wins; every other delegate's device sees the FAQ bundle publish and
    quietly hides its own copy of the pending row (no cross-device claim lock). Deliberately kept
    this way, not a gap to close: this is a P2P system with no guaranteed-online infrastructure —
    routing to a single pre-selected delegate would introduce a new single point of failure (that
    delegate being offline stalls the question with no fallback, unless a whole timeout/reassign
    mechanism is built), for a domain (async, text-based support) where "distance" carries no
    real latency or quality benefit anyway. The only cost of broadcasting is a few delegates each
    reading the same pending question — no wasted work, since only the first to actually answer
    does anything. If specialization-based routing (e.g. a billing-only delegate) is ever wanted,
    the right shape is "notify the specialist first, broadcast to everyone else after a short
    delay if they don't respond" — additive, not a replacement for the broadcast — to keep the
    same reliability. Not currently needed or planned.

OPEN-13 and the website/Android portion of OPEN-06 were completed on physical Android hardware on
2026-09-20; evidence is in `docs/completed.md`.

All other standalone Android and Mac↔Android matrix work is complete: logical device selection,
directional browser/app pairs, multi-phone convergence, background/foreground, force-stop/restart,
Wi-Fi interruption, offline resynchronization, and Android Keystore custody are archived in
`docs/completed.md`.

## Deferred open issues — not in the current execution queue

The following IDs remain open for traceability, but website/Android work takes precedence. Do not
start them unless they become a direct blocker or are explicitly promoted.

### TechSupport identity protocol

- [ ] **OPEN-28 — Split TechSupport authority by role (deferred).** Introduce a versioned identity
  protocol with separate offline root/delegation authority, support DM/decryption operator keys,
  and a limited announcement signer. Give each role a distinct trust anchor, rotation window, and
  compromise procedure; do not make the online announcement role capable of reading questions,
  issuing delegates, or signing identity continuity. Deliberately deferred by the product owner
  2026-09-22: OPEN-27/29/30 must not depend on this, and it adds real protocol complexity (a new
  versioned identity format, more trust-anchor categories) that isn't worth taking on yet.

### macOS-native host testing

- [ ] **OPEN-03 — Test Mac sleep/wake recovery (deferred).** The opt-in native-app scenario and
  bounded `pmset` helper are implemented (`npm run test:e2e:macos-sleep-wake`), but this Mac's
  current user lacks the required noninteractive `pmset` sudo permission. No physical sleep was
  requested.

- [ ] **OPEN-04 — Exercise temporary Mac firewall isolation (deferred).** The opt-in scenario and
  loopback/port-scoped PF helper are implemented (`npm run test:e2e:macos-firewall`) with
  trap-based cleanup, but this Mac's current user lacks noninteractive `pfctl` sudo permission. No
  firewall rules were changed.

### Other desktop platforms

- [ ] **OPEN-07 — Sign the Windows release artifacts (deferred).** Select a trusted code-signing
  identity, sign the NSIS installer and installed executable, and verify the signature in the
  Windows installed-release gate.

- [ ] **OPEN-10 — Unblock Ubuntu Playwright WebKit (deferred).** The `ubuntu-test` owner must install
  Playwright's missing system dependencies (`libavif16`/`playwright install-deps`, as appropriate)
  with sudo; then run `npm run test:e2e:ubuntu:webkit` and retain the returned report. The SSH test
  user intentionally has no passwordless sudo.

### CI infrastructure

- [ ] **OPEN-12 — Connect native jobs to real CI runners (deferred).** Register and harden the Mac
  mini, Windows, and Ubuntu hosts as CI runners for their native-app jobs. Jobs must perform
  availability checks before installation or tests and retain platform artifacts on failure.
  Android-targeted X3 acceptance should run locally first; CI scheduling is not a prerequisite for
  OPEN-13.

### iOS, nearby transports, certification, and external review

Do not start these until the required iPhone/nearby-transport hardware, owner access, or external
review capacity is available and the issue is promoted after the website/Android queue.

- [ ] **OPEN-26 — Complete other-platform custody adapters and review (deferred).** Accept the
  Xcode license, compile and run the existing iOS Keychain adapter (`AppleCustodyBridge.swift`),
  select reviewed credential-store providers for Windows/Linux, and obtain the external custody
  security review. The website and Android custody boundary is complete under OPEN-06.

- [ ] **OPEN-21 — Add iPhone native-shell coverage (deferred).** Build an iOS shell, add
  clean-profile and automation support, and include it in the central matrix when suitable
  hardware is available.

- [ ] **OPEN-22 — Prototype and verify Apple Wi-Fi Aware (deferred).** On supported physical
  devices, test discovery and data paths in both iPhone→Android and Android→iPhone directions,
  plus same-LAN iOS↔Android Gun convergence.

- [ ] **OPEN-23 — Prototype BLE discovery and route upgrade (deferred).** Measure throughput,
  battery use, background behavior, and upgrade to a high-bandwidth route. Do not select BLE as a
  Gun data transport until measurements demonstrate a product need.

- [ ] **OPEN-24 — Maintain the physical-device certification matrix (deferred).** Keep at least two
  iPhones, two Android devices, and one desktop node across supported OS ranges. Cover foreground,
  background, locked-screen, normal Wi-Fi, isolated LAN, no-Internet, cellular-NAT, and mixed
  routes; record latency, throughput, battery drain, reconnect time, and forwarding bytes.
  `npm run verify:devices` validates the inventory schema; the physical run inventory is currently
  empty.

- [ ] **OPEN-36 — Hub-matchmade local link: same Wi-Fi, then Android Wi-Fi Direct (in progress
  2026-10-03; behind a flag; automatic upgrade, 3-phone group and recovery verified on hardware,
  v1.0.78).** Intended flow: two
  phones in the same active exchange room find each other through the website over cellular; if
  they share a Wi-Fi network they
  exchange talks over it; if not, they form a Wi-Fi Direct group and exchange talks over it.
  Implementation: `src/shared/wifi-direct-link.ts` (election, path classification, `wd-*` frame
  schema), `src/web/services/wifi-direct-link-service.ts` (per-peer state machine),
  `src/web/services/android-wifi-direct-native.ts` (bridge + flag), `WifiDirectGroupController.kt`
  (broadcast-driven group lifecycle), `src/server/services/local-link-turn-relay.ts` +
  `routes/local-link-routes.ts` (loopback TURN relay, embedded node only), signed `link-upgrade`
  DataChannel frames + `setIceConfigOverride()`/`reconnect()` in `p2p-webrtc-session.ts`; unit tests
  in `src/test/unit/wifi-direct-link.test.ts` and `local-link-turn-relay.test.ts`. Design:
  negotiation runs over the already SEA-authenticated DTLS DataChannel; Wi-Fi Direct only supplies
  an IP link. Android WebView never gathers ICE candidates on the group interface (it only uses
  networks ConnectivityManager knows; verified 2026-10-02), so each phone's embedded node runs a
  tiny loopback TURN relay whose relay socket is bound to its group address, and both sides replace
  the session's connection with a relay-only one (`wd-ready` → `wd-switch`). DTLS stays end to end;
  the group owner forwards ciphertext only. An ICE restart on the live connection does not work —
  Chrome keeps the old pair and never checks the new relay pairs (verified on PH-1). Enable on a
  device with
  `adb shell am start -n com.iinpublic.app/.MainActivity --ez wifi_direct_link true` (persists;
  `false` turns it off); progress logs as `[wifi-direct-link]` in the WebView console.
  Room eligibility, discovery scope, background ownership, dynamic offline credentials, and the
  default-on gate are governed by OPEN-37; transport availability must never broaden a room's
  audience.
  - **Same-Wi-Fi first**
    - [x] Keep WebRTC host-candidate (LAN) connection as the first choice — a host↔host selected
      pair is classified `lan` and left alone (`classifySelectedPath`).
    - [x] Timed decision (3 s after connect, `WIFI_DIRECT_PATH_DECISION_DELAY_MS`): a non-LAN
      selected pair (srflx/relay — including same SSID with client isolation) starts the upgrade.
  - **Fix the existing Wi-Fi Direct code** (`NearbyConnectivityManager.kt`)
    - [x] Discovery: peers reported from `WIFI_P2P_PEERS_CHANGED_ACTION`.
    - [x] Connect: group state read only after `WIFI_P2P_CONNECTION_CHANGED_ACTION`.
    - [x] Group owner no longer emits its own address as a peer endpoint.
    - [ ] Wi-Fi Aware: both sides need the same passphrase (each currently generates its own in
      `android-nearby-adapter.ts`), and the returned network handle must become a usable address.
    - [x] Wire into `app.ts` behind a feature flag (`initWifiDirectLink`; the generic
      `AndroidNearbyAdapter`/`PlatformAdapterCoordinator` discovery path is still not wired).
  - **Host (group owner) selection**
    - [x] Host calls `createGroup()` (Android 10+ with app-chosen name + passphrase); Android 10+
      clients join by name + passphrase; Android 7–9 fall back to `connect(ownerDeviceAddress)`
      (prompts on the owner). Verified 2026-10-02: PH-1 (Android 10) joined the Honor's (Android 7)
      group in ~1.4 s with no prompt on either phone. Two hardware findings baked in: the joiner
      must get the owner's frequency (`setGroupOperatingFrequency`; PH-1's own Wi-Fi was on
      2.4 GHz, the Honor's group on its 5765 MHz station channel), and must NOT get
      `setDeviceAddress` (the owner's group BSSID `…:d3:53` differs from its device address
      `…:53:53`, so the supplicant never found the group).
    - [x] ~~Website assigns roles with a token~~ — replaced: both peers run the same deterministic
      election over the authenticated DataChannel, so the hub never sees roles or credentials.
    - [x] Selection rules, in order: (1) join an existing group (owner, or a client that still has
      a live link over it, re-shares its credentials); (2) only a host-capable device hosts; (3) an
      Android 7–9 device hosts so the Android 10+ peer joins without a prompt, and never joins an
      existing group (classic join needs the owner's real device address — Android 10+ owners only
      see `02:00:00:00:00:00` — and prompts on the owner), so such a pair stays on its normal path;
      (4) higher `hostScore` (charging +2, battery ≥ 50 % +1) hosts; (5) tie-break: lowest SHA-256
      of SEA pub.
  - **Identity binding**
    - [x] Credentials are sent only inside SEA-signed frames of a session whose peer passed the SEA
      handshake; traffic after the upgrade stays in that same DTLS session, so the radio MAC is
      never treated as identity.
  - **Multiple people**
    - [x] Star topology: a third phone joins the existing group (rule 1) — verified with Honor
      (owner) + PH-1 + P30: all three pairs on `192.168.49.x`, talk from P30 reached both.
      - [ ] Measure the real per-device client limit (commonly ~4–8, chipset-dependent).
    - [x] Owner removes the group → both reconnect on normal ICE within ~7 s (the service does it;
      the mesh would only retry on its next send), re-elect and re-link: 8 s total on v1.0.78
      (P30 + PH-1). Force-stopping the owner's *app* does not end the group (Android keeps it).
    - [x] Different groups are not bridged (`both-in-different-groups` abort); those pairs stay on
      website/WebRTC.
    - [x] Phones keep normal Wi-Fi while in a P2P group (PH-1's wlan0 stayed connected; ping
      over the group 0 % loss, ~15 ms). - [ ] Same check with cellular.
  - **Privacy: host must not read client↔client talks**
    - [x] Host's Gun node is not used; talk bodies and answers stay on the client↔client WebRTC
      DataChannel (DTLS), now relayed by each phone's own loopback TURN relay across the group.
    - [ ] Additionally encrypt content to the receiver's key so a misrouted relay copy is
      ciphertext.
    - [x] Remaining metadata exposure documented in `docs/security/connectivity-threat-model.md`.
    - [x] Owner↔client and client↔client (through the Honor 8 owner) relay paths verified on
      hardware, RTT ~18–30 ms. If a chipset isolates clients, the relay-only connection fails, the
      service drops the override and reconnects on normal ICE (unit-tested).
    - [x] WebView host candidates are plain IPs (no mDNS obfuscation) — but WebView does not gather
      on the `p2p-*` interface at all, hence the relay design above.
  - **Offline mode (no hub) — implemented 2026-10-03 (v1.0.80–1.0.103), verified on P30 + PH-1 +
    C10 tablet.** `src/shared/nearby-offline.ts` (records, election, Wi-Fi-only fallback),
    `src/web/services/nearby-offline-service.ts`, native NSD/BLE/DNS-SD in
    `NearbyConnectivityManager.kt` + `WifiDirectGroupController.kt`. Key finding: once two phones'
    Gun graphs are linked (page Gun → other phone's node, `ws://<ip>:8088/gun`), rosters, Gun
    pub/sub signaling and the WebRTC mesh all work unchanged — so offline mode is discovery + an IP
    link, nothing else.
    - [x] Same LAN: Android NSD (unique service name, rotating id in TXT, serialized resolves) →
      page Gun peers with the other node. Always on, no permission. Verified: 3 devices, no hub,
      rosters merged, mesh 2/2 connected each, in ~1 min.
    - [x] Different networks: Wi-Fi Direct with app-wide group credentials
      (`OFFLINE_GROUP_CREDENTIALS`, option (a) taken further: anyone with the app nearby may join
      the link; protection stays SEA + DTLS). Group peers connect relay↔relay through each phone's
      loopback TURN relay, added as an extra default ICE server while in a group
      (`setLocalLinkIceServer`). Runs only while the hub is unreachable
      (`/api/local-link/hub-status`), so phones online never form groups with strangers.
    - [x] Presence, redundant: BLE (8-byte service data: version, rotating id, flags) — fast and
      deterministic; Wi-Fi DNS-SD (TXT record); and a Wi-Fi-only fallback from plain P2P peer
      scans: join any phone-type (WSC category 10) group owner with the fixed credentials, host after
      a random 15–45 s if phones but no owner are visible, and an empty owner seeing another owner
      merges into it. Non-phone P2P devices (e.g. a Push2TV display) are ignored.
    - [x] Verified Wi-Fi Direct with BLE (P30 owner, PH-1 + tablet clients; all sessions on
      192.168.49.x relay pairs; mesh ping + pongs across the group incl. client↔client) and
      Wi-Fi-only (BLE off: converged in ~50 s).
    - [x] Permissions in context: the first time the phone is offline it asks once for Nearby
      devices (Android 12+: Wi-Fi + Bluetooth in one prompt; 10–11: Location); Wi-Fi/Location/
      Bluetooth switched off → a toast that opens the right settings screen.
    - [ ] DNS-SD is unreliable when phones are associated to access points on different channels
      (queries un-ACKed / answered after the asker stopped waiting). Jittered rounds, no rounds while
      in a group, `startListening()` on Android 13+ applied; BLE + the Wi-Fi-only fallback cover it.
    - [x] Android 7–9 sit out offline Wi-Fi Direct (they can neither set nor join by the app-wide
      credentials) and are never waited on in the election; they still use the same-Wi-Fi path.
      Verified on the Honor FRD-L04: no group/prompt, linked to 3 phones over the LAN (v1.0.93).
      BLE scan on Android 7 runs unfiltered (the hardware 128-bit service-data filter dropped all
      results there).
    - [x] Settings → "Nearby without internet" (Android app only): Wi-Fi Direct and Bluetooth
      switches, both on by default, applied immediately (off = leave the offline group / stop the
      beacon); live status line; plain-language "what nearby people can and cannot see" notes.
    - [x] Hardware fixes (v1.0.89–93): a repeated native `failed` state no longer postpones the join
      retry forever; mDNS answers over the group (192.168.49.x) are not treated as same-Wi-Fi peers
      (that blocked re-forming a group for 20 min); 4-device run P30 owner + PH-1 + tablet clients.
    - [x] Wedged Wi-Fi stack (PH-1 failed every join with P2P-GROUP-FORMATION-FAILURE until a Wi-Fi
      restart): joins now fail fast on CONNECTING→DISCONNECTED instead of the 35 s timeout, and after
      3 consecutive failures the app rebuilds its P2P channel (the deepest reset an app may do;
      Wi-Fi restart is not allowed on Android 10+). Not reproduced since the reboot — unverified on
      a wedged stack.
    - [x] Slow / stuck linking after a restart (v1.0.94–96), three causes found on hardware:
      (1) Gun peer added the instant the group formed, before its route carried traffic → Gun's
      reconnect backoff delayed the link 51 s; peers are now probed with a WebSocket and handed to Gun
      once they answer (1 s). (2) Gun deletes a peer whose socket closes (mesh.bye) and never
      reconnects it — after the owner's app restarted, clients' rosters stayed empty; the nearby
      service now re-asserts its LAN/owner peers every tick. (3) PeerMeshService trusted a
      `connected` flag that nothing cleared when a session died later, so reconcile never retried
      (a general mesh bug, online too); it now checks the session's live state. Result on PH-1 +
      tablet: cold start linked ~45–60 s after launch (incl. ~25 s app boot); a restarted owner or
      client relinks on its own (previously never).
    - [x] 4-phone round (v1.0.97–103, P30 + PH-1 + C10 + Honor), found and fixed:
      (1) a joining phone saw only itself for ~60 s — Gun does not replay data to a peer that
      connects after a subscription, so it waited for the next membership heartbeat, whose public
      keys ride only every 10th beat: on a new nearby peer the app now pulls the room roster and
      re-announces its membership with keys; (2) boot crash "reading 'charAt'" — a partial local
      users/<id> record (no id/stageName) was accepted and cached; getUser now always sets id,
      refreshes merge onto the known record, and the cache refuses records without id/stageName;
      (3) intermittent native crashes on all four phones were V8 out-of-memory
      (node::OOMErrorHandler): WebRTC signaling frames written by connected Gun peers bypassed the
      server persistence filter, piled up in the embedded node's Radisk (~1 MB per pair) and
      re-hydrated on every re-subscribe. Signaling puts are now kept out of Radisk at the Gun store
      hook and idle ones evicted from RAM (transient-signal-store-filter.ts); boot also scrubs
      stale Radisk temp files and signaling keys inside mixed chunks (incl. the legacy
      `undefinedp2p-signal` souls). Result: 0/16 crashes in a relaunch soak (was ~1 in 12), stores
      0.65–0.83 MB (were up to 5.4 MB + growing quarantine), 3-phone offline mesh complete 26–31 s
      after launch, restarted owner relinks in 20 s and a client in 32 s.
    - [ ] Discovery: advertise over Wi-Fi Direct service discovery
      (`WifiP2pManager.addLocalService` + `discoverServices`, DNS-SD) — not `startNsd`, which only
      works on a shared infrastructure Wi-Fi. TXT record, roughly:
      `_iinpublic._tcp id=<15-min rotating digest> hosting=yes|no group=DIRECT-xx v=1`. Reuse
      `rotatingDiscoveryId` so passive scanners cannot track a person.
    - [ ] Host rule without the hub: (1) join any peer advertising `hosting=yes`; (2) otherwise
      the lowest rotating digest calls `createGroup()`. Every phone computes the same answer from
      the advertised records.
    - [ ] Passphrase delivery — decide between: (a) publish group name + passphrase in the TXT
      record (no prompts, but the Wi-Fi link is effectively open; acceptable only because all
      protection is app-layer SEA + end-to-end encryption); (b) classic `connect()` negotiation
      with the system pairing prompt (fine for two people, poor in a crowd); (c) QR code showing
      group name, passphrase and SEA pub (deliberate in-person meetings; also verifies identity).
    - [ ] Signaling inside the group (host's local node at `192.168.49.1` for SDP/ICE only), then
      the same WebRTC DataChannel as online.
    - [ ] Identity after link-up: exchange SEA-signed connectivity bindings + challenge
      (`docs/protocol/connectivity-v1.md`); recognize known contacts by stored SEA pubs; treat
      strangers as new SEA keys, as online. Talk exchange needs only local Gun + SEA.
    - [ ] Android constraints to measure on real phones: foreground app or foreground service
      required on both sides; service discovery is flaky/slow on some devices (re-issue every
      10–30 s, expect seconds to tens of seconds); `NEARBY_WIFI_DEVICES` (already in manifest) and
      Location on for older Android; battery cost — run only while the user is in an explicit
      "nearby" mode.
  - **Platform scope**
    - [ ] Android ↔ Android only. iOS has no Wi-Fi Direct; iPhone pairs stay on WebRTC/STUN until
      OPEN-22 (Apple Wi-Fi Aware, iOS 26+) is verified.
  - **Verification**
    - [x] Same Wi-Fi → `lan`, no upgrade (PH-1 + Honor, 2026-10-02).
    - [x] Different networks → Wi-Fi Direct, automatic end to end (v1.0.72+): group + relay
      switch in ~8 s after connect, ~1.5 s reconnect gap; a real talk crossed the group (bytes on
      the `192.168.49.x` pair 3 KB → 10 KB). Desk setup: dev hub with
      `TLS_DISABLE=1` (an `http://` hub URL against the HTTPS dev hub silently leaves phones on
      production), a TURN server for the pre-upgrade path, and the debug-only
      `--es p2p_drop_remote_candidates 192.168.10.` to hide each other's LAN host candidates.
    - [x] 3 phones in one group; owner removing the group mid-session (see Multiple people).
    - [ ] Fully offline discovery → group → talk exchange. Record results in
      `docs/device-verification/runs.json` and the OPEN-24 matrix.
    - Hardware fixes from these runs (v1.0.73–78): reconnect when the link drops (mesh would not);
      clear the relay override when the radio reports the group gone before the session notices;
      `leaveGroup` in a fresh process; transient failures (busy / cooldown / send-failed /
      session-lost) cool down 30 s, not 10 min; joiner retries once without the frequency hint;
      native join drops a stale group first; no `02:00:00:00:00:00` owner address.
    - [ ] Decide default-on once verified (today: off unless `wifi_direct_link=1`).

- [ ] **OPEN-25 — Complete the external transport security review (deferred).** Review cellular
  peer forwarding and BLE discovery/data transport before either is enabled by default. Track any
  remediation as new ordered issues.

## Deferred product decisions

These are deliberately outside the execution order above. Promote one to a new `OPEN-nn` issue
only when it receives an owner and product scope.

1. **DEFERRED-01 — Multiple identities/profile switching on one device.**
2. **DEFERRED-02 — Durable person identifier for linked-device clusters.**
3. **DEFERRED-03 — Cross-device aggregation policy** for contacts, blocks, conversations, Q&A,
   credit, and reputation; v1 remains mutual-link/display merge only.
4. **DEFERRED-04 — Precise-location sharing** as an explicit opt-in feature.
5. **DEFERRED-05 — Talk bridging through a middle person.** Discovery gossip and configurable
   mesh forwarding remain v1; content bridging remains v2.
6. **DEFERRED-06 — Geographic/topic DHT indexes** after privacy and enumeration review.
7. **DEFERRED-07 — Advanced v2 relay guarantees, incentives, and accounting.**
8. **DEFERRED-08 — BLE Gun data transport** only after OPEN-23 demonstrates measured need.
9. **DEFERRED-09 — Broader public-image graph** beyond Me-tab Q&A and contextual
   credit/reputation.
10. **DEFERRED-10 — React Native/Expo product effort.** The measured React DOM pilot was rejected;
    native presentation work requires a separate owner, budget, and migration plan.
11. **DEFERRED-11 — Enterprise TechSupport custody controls.** Consider HSM/KMS-backed signing,
    hardware tokens, threshold/two-person approval, centralized monitoring, and formal external
    audit only when product scale, staffing, regulation, or measured threat level justifies their
    operating cost. OPEN-27 through OPEN-30 must not depend on these controls.

## Verification rules

1. Put E2E specs in the lowest stage with enough users and add a companion `.md` explanation.
2. Assert durable state or stable UI signals, not transient toasts.
3. If a test exposes a product bug, fix the product rather than weakening the assertion.
4. Check platform availability before installation, build, or test work.
5. Move completed work to `docs/completed.md` immediately and retain its validation evidence.

## Nightly jobs

- `npm run health`
- `npm run test:e2e:parallel`
- `npm run test:e2e:heavy`
- `npm run test:e2e:mesh`
