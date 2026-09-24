# IinPublic TODO

Last reconciled: 2026-09-21.

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

The balanced production-security decision is documented in
`docs/security/techsupport-and-user-production-security.md`. Implement it in this order; keep the
ordinary-user browser-v3 and Android Keystore defaults automatic and do not introduce HSM/seed
phrase complexity into normal use.

- [ ] **OPEN-27 — Remove the TechSupport root from the production browser/relay boundary.**
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
  - [ ] Remove `iinpublic_techsupport_keypair_v1`, `dev:techsupport`/root-agent injection, and every
    production code path that exposes `priv`/`epriv` to page JavaScript.

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
  - [ ] A real live HTTP publish round trip (beyond the dry-run) wasn't proven in this session —
    hit an unresolved local networking quirk (TCP connects, HTTP hangs up) specific to that test
    session, not a code issue given every other layer (unit, integration via supertest against
    the real route handlers, and the dry-run signing path) passed. Re-verify with a real publish
    against a real deployment before relying on this in an actual incident.
    - Update 2026-09-22: `/api/support/recovery` shared the exact `radisk:false` write-loss bug
      just found and fixed for delegate grants (same `system-routes.ts` pattern, same fix — see
      OPEN-27's regression entry above), so a publish attempted before that fix would have
      appeared to succeed and then silently vanished regardless of the networking quirk. The fix
      is deployed and the *delegate-grant* route's round trip is now proven live (published,
      read back, survived a production service restart) — the *recovery-anchor* route runs
      through the identical `putSupportPath`/`getSupportPath` code, so it shares that fix, but a
      real recovery-anchor publish specifically was deliberately not attempted live: it's a
      trust-rotation action (can revoke the current master's authority), not something to test
      against production without the product owner present. Still worth a real publish + restart
      check the next time a recovery rotation is actually exercised, or against a non-production
      deployment.
  - [ ] Cross-client "stale cache / installed Android version catches up" scenario has no E2E
    coverage yet — only unit/integration. The mechanism (client-side monotonic cache +
    HTTP-relay poll, identical in shape to the already-E2E-tested OPEN-27 delegate-grant
    hardening) gives reasonable confidence, but this is asserted, not demonstrated end to end.
  - [ ] No UI surfaces a recovery event to the master operator (e.g. an audit/warning banner) —
    today it's a `console.warn` on the client and whatever `npm run techsupport:recovery --
    status` reports. Low priority: this is an emergency operator tool, not routine UI.

- [ ] **OPEN-30 — Harden website release integrity and the browser execution boundary.** Treat CSP
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
  - [ ] Turn the point-in-time `release:verify-checksums` check into an always-on monitor (cron/CI
    scheduling it against the production origin, alerting on failure) — not built; a manual or
    externally-scheduled check for now.
  - [ ] Subresource Integrity on `index.html`'s script/style tags — a stronger, browser-enforced
    complement to the checksum manifest (a tampered `bundle.js` would fail to execute at all, not
    just fail a later human check), deferred as separate build-pipeline work.

- [ ] **OPEN-31 — TechSupport FAQ bundle does not scale (found 2026-09-24, product owner: think
  through the design, do not implement yet).** The whole Q&A history is ONE array, re-signed and
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
