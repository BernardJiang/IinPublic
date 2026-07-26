# IinPublic Current Status Review

**Assessment date:** 2026-07-25 (America/Los_Angeles)  
**Repository:** `/Users/hongyujiang/IinPublic`  
**Branch/snapshot:** `dev`, seven commits ahead of `origin/dev`; HEAD `5be7839d` plus existing uncommitted TechSupport-related changes  
**Method:** read-only source/configuration inspection and diagnostics. No project code or configuration was changed.

## Executive summary

- ✅ **The current TypeScript tree compiles cleanly and the latest test evidence is green:** `npx tsc --noEmit` exited 0; a fresh 36-test Jest sample passed; the 2026-07-25 Playwright report records **171 passed, 2 skipped, 0 failed**.
- ⚠️ **The web/server/shared architecture is substantial and well-tested, but the active branch is not a stable release snapshot:** it contains uncommitted K1 TechSupport work and the roadmap itself was last labeled 2026-07-19 despite major K/L edits on July 25.
- ⚠️ **Desktop, Android, and iOS shells are materially implemented and have successful build artifacts**, but CI runner integration, native/cross-platform end-to-end coverage, release signing/notarization, and some target-specific validation remain incomplete.
- ❌ **Security hardening is not production-ready:** REST routes generally have no request authentication/authorization boundary, the server exposes the repository working directory via `express.static('.')`, CSP allows `unsafe-eval`, and the TechSupport signed-greeting/key-custody transition is unfinished.
- ⚠️ **The roadmap has moved past the original A–J sequence:** A–F and H are complete; G/I/J are partial; current architectural blockers are TechSupport K1–K5, cross-device handoff/linking, and retention policy L2.

## Readiness dashboard

| Area | Readiness | Assessment |
|---|---:|---|
| Architecture / type health | ✅ | Clear server/web/shared boundaries; strict TypeScript check passes |
| Unit and integration tests | ✅ | 79 Jest files; fresh representative sample 36/36 |
| Browser E2E | ✅ | 173 specs organized into staged and specialist suites; latest merged run 171 pass / 2 skip / 0 fail |
| Roadmap execution | ⚠️ | Large completed scope, but G/I/J partial and K/L now dominate |
| Desktop Electron | ⚠️ | Real macOS/Windows artifacts and embedded-node shell; release operations/CI not complete |
| Android | ⚠️ | JNI/CMake/Gradle wiring and debug APK exist; device/runtime and release validation not evidenced |
| iOS | ⚠️ | Xcode project and 215 MiB NodeMobile XCFramework present; iOS build succeeds with warnings, Catalyst fails |
| Server/P2P backend | ⚠️ | Broad functional surface and P2P-first design; mixed legacy/relay paths and volatile mailbox state remain |
| Code quality / maintainability | ⚠️ | Strong tests and strict typing, but very large UI manager, generated artifacts in `src`, stale comments, and repository bloat |
| Security | ❌ | Good SEA primitives, encryption, Helmet, and signed Socket.IO login; major HTTP/static-serving and TechSupport trust gaps remain |

## 1. Architecture overview

### Source layout

The application is organized around four production TypeScript areas:

- `src/server/` — Express + Socket.IO + Gun hub/server. It contains HTTP bootstrap/middleware, seven route modules, nine service files, socket handlers, logging, and server-side filtering/identity support.
- `src/web/` — browser SPA. `app/app.ts` is the main composition root; `services/` contains Gun, P2P mesh/WebRTC, mailbox, content-node, identity-linking, conversations, talks, and user adapters; `ui/` contains extracted views/dialogs plus the still-large `ui-manager.ts`.
- `src/shared/` — protocol types and pure/shared logic: talk engine/ledger, P2P runtime/trust/schema, content filtering, TechSupport, identity linking, location, metrics, and migrations.
- `src/node-app/` — embedded-node entry and explicit hub relay client used by native shells.

There are also:

- `src/test/` — 70 unit and 9 integration test files plus setup.
- `src/examples/` — legacy JavaScript React/Gun examples excluded from the strict TypeScript build.

### Counts

| Metric | Result |
|---|---:|
| TypeScript/TSX files under `src/` | **216** |
| Production TS by area | server 23; web 58; shared 53; node-app 2 |
| Test TS under `src/test/` | 80 including setup |
| Jest test files | **79** (70 unit, 9 integration) |
| Playwright E2E spec files | **173** |
| All discovered test/spec files in working tree (excluding dependencies/build output) | **318** |
| Working-tree size excluding `node_modules` and `.git` | **3,722.6 MiB** |
| Git packed object size | **219.07 MiB** |

The 3.7 GiB footprint is dominated by `platforms/` (~2.21 GiB), `android/` (~785 MiB), `third_party/` (~220 MiB), `logs/` (~206 MiB), and `.cache/` (~171 MiB), not source (`src/` is ~3.7 MiB). `git count-objects` also reports several temporary/garbage object files.

### Type diagnostics

`npx tsc --noEmit` completed successfully with exit code 0 and no diagnostics. The root config is strict (`strict`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`, and related checks). Tests and examples are intentionally excluded from this root type command and are instead compiled by Jest/other configs.

**Assessment: ✅ Ready.** The architecture is understandable and the current production TS graph is type-clean. The main qualification is that the inspected working tree includes uncommitted development work.

## 2. Test coverage and quality

### Jest

Jest is configured for `src/test/**/*.test.ts` with `ts-jest`. A fresh representative sample was run:

- `src/test/unit/app-bar.test.ts`
- `src/test/unit/message-content-filter.test.ts`
- `src/test/integration/system-routes.test.ts`

Result: **3 suites passed, 36 tests passed, 0 failed, 0 snapshots**, in 2.377 seconds.

Warnings observed:

- Jest haste-map package-name collision between `platforms/mobile/nodejs-project/package.json` and `platforms/ios/assets/package.json`.
- Node experimental warning that `localStorage` is unavailable without `--localstorage-file`.
- Gun prints its standard startup greeting during the integration suite.

These do not fail the run, but the package collision should be removed because it can become nondeterministic as the native projects grow.

No current coverage percentage was available because this assessment intentionally ran a quick sample rather than the full `jest --coverage` suite. The configuration collects coverage broadly across `src/**/*.{ts,js}` with limited exclusions, so legacy JS examples may distort a future coverage run unless the collect set is tightened.

### E2E organization

Staged specs:

| Stage | Specs |
|---|---:|
| stage0-bootstrap | 4 |
| stage1-single-user | 38 |
| stage2-two-user | 49 |
| stage3-three-user | 44 |
| stage4-four-user | 2 |
| stage5-multi-user | 5 |
| **Staged total** | **142** |

Specialist suites:

| Suite | Specs |
|---|---:|
| cross-platform | 8 |
| embedded-node | 1 |
| isolated | 2 |
| mass | 3 |
| native-app | 3 |
| platform-smoke | 1 |
| talks-matching | 12 |
| topology | 1 |
| **Specialist total** | **31** |

Total: **173 Playwright specs**.

The organization is strong: user-count stages are explicit, heavy multi-browser cases are separately shardable, and the config has worker isolation, target-specific browser projects, timeout scaling, and heavy-suite controls.

### Latest Playwright evidence

The newest report is `playwright-report/index.html`, modified **2026-07-25 16:50:25**, after current HEAD. Its merged JSONL source records:

- **171 passed**
- **2 skipped**
- **0 failed**
- Overall status: **passed**

This is a **98.84% executed-pass / 1.16% skipped** result, or 100% pass among executed tests.

Older July 23 logs are not current health evidence: they show failures in light (2), heavy staged (3), find-similar (1), mesh batch/isolated, mass (3), stage5 (2), and isolated (1). The later July 25 report supersedes those failures. The report should retain that distinction because the active TODO still says “re-run light shard,” which is stale relative to the latest merged artifact unless the TODO means a very specific host command not represented by this report.

The two skipped tests should be named and tracked in CI output; roadmap text indicates cross-platform X3–X6/X7/X8 scaffolds are intentionally skipped in some configurations, but the merged artifact alone does not provide a simple human summary tying the two skips to roadmap items.

**Assessment: ✅ Browser and Jest health are currently strong.** Remaining weakness is proof breadth on real native devices/runners and lack of a fresh coverage percentage.

## 3. TODO / roadmap status

`docs/TODO.md` declares the original land order:

> A → B → C → D → H → E → F → G → I → J

Current state:

- **A–D: complete** (AppBar/overflow, notifications, conversation-first entry/matched-talk threads, unified peer/contact detail).
- **H: complete** (dirty-word and grammar message filters, send and receive directions).
- **E/F: complete** (responsive popup sizing and option-matrix coverage).
- **G: partial**. Browser/device-profile smoke and WebKit/Firefox work are shipped. Actual macOS/Windows/Linux native CI runners are not wired. Cross-platform X3–X6 remain scaffolded/blocked.
- **I: partial**. Multi-device linking protocol and UI exist, but live graph wiring, clustered contact rendering, cluster-wide block behavior, fragment/loopback shortcuts, and X3/X8 remain.
- **J: partial**. Local wipe and handoff archive/merge exist, but encrypted P2P transfer/receiver import and X7 remain.

The roadmap has since expanded:

- **K — TechSupport built-in peer:** K1–K3 are architecture-sensitive and mostly open; K6 is partly implemented; K4 baseline normalization and K5 live FAQ/inbox behavior remain incomplete.
- **L — room metrics/retention:** L1 CRDT counters are largely implemented but legacy scalars/events still need removal after migration confidence. L2 has instrumentation but requires real deployment measurements and an explicit tombstone/retention ownership decision.

### Completed scope

`docs/completed.md` is a substantial archive: **2,992 lines, ~191 KB, 143 dated completion sections**. It documents the original product baseline; P2P roadmap P1–P7; test stabilization; localization; talk lifecycle and intake behavior; mesh delivery and mailbox; deterministic E2E work; GUI polish A–H; canonical conversations; embedded-node/hub topology; coverage-gap closure; G/I/J shipped subsets; cross-browser coverage; and test-run performance work.

### Blocked by architecture or external infrastructure

- TechSupport K1–K3: built-in rendering versus relay-seeded presence, signed local greeting behavior, and private-key custody/operator mode.
- G/X3–X6: needs actual website/native builds and CI runner infrastructure.
- I/X3/X8: needs real `WebIdentityLinkService` app/graph integration and same-device handshake.
- J/X7: needs encrypted P2P handoff transfer and receiving-side import.
- L2: needs production graph-size measurements plus decisions on tombstones and whether trimming is relay-side, device-side, or both.
- K4: requires a firm stage-baseline policy and fixture regeneration ownership.

The active TechSupport implementation appears ahead of the checklist: uncommitted files and tests already contain K1/K5/K6 pieces. TODO status should therefore be reconciled only after that work is committed and verified.

**Assessment: ⚠️ Direction is documented, but priorities have outgrown the old A–J land-order line and several items require explicit architecture decisions.**

## 4. Platform build infrastructure

### `src/web/ui/app-bar.ts`

The module is a complete, tested AppBar implementation (back action, centered status, action buttons, responsive overflow, keyboard/click handling, and style registration), and its unit test passed.

However, repository-wide import/call search found **only the unit test importing `app-bar.ts`**. No production file imports `renderAppBar`, `updateOverflow`, or `registerAppBarStyles`. The current application likely implements the shipped AppBar behavior through HTML/CSS/UI-manager paths rather than this extracted module.

**Conclusion: standalone/dead in production, despite tests and E2E coverage around equivalent UI behavior.** This is a code-integration discrepancy worth resolving before treating the module as the canonical implementation.

### Desktop / Electron

The Electron shell:

- Starts the compiled embedded Node server in-process.
- Uses local radisk storage under Electron `userData`.
- Loads the SPA over `127.0.0.1:8088`.
- Uses `contextIsolation: true` and `nodeIntegration: false`.
- Restricts external windows to the system browser.
- Packages server, web, public, and `node_modules` together.
- Includes build-ID drift detection and `electron-updater`.

Existing artifacts prove packaging has worked:

- macOS arm64 DMG, July 12 (~239 MB)
- Windows x64 NSIS installer, July 3 (~141 MB)
- Windows x64 and arm64 ZIPs and unpacked apps

Gaps:

- No evidence here of signing/notarization, production updater publication, Linux artifacts, or CI runner integration.
- Packaging the complete root `node_modules` makes installers very large and widens dependency/release surface.
- Native-app E2E has only three specs and actual platform runners are a roadmap item.

**Assessment: ⚠️ Buildable beta infrastructure, not yet a fully operated release pipeline.**

### Android

Android is no longer a stub:

- Gradle targets SDK 34, min SDK 24, with three ABIs.
- CMake imports `libnode.so` and builds JNI glue.
- `native-lib.cpp` calls `node::Start()` on a detached thread and injects IinPublic environment configuration.
- Kotlin `NodeBridge`, activity, foreground service, WebView assets, native headers/libraries, and staged web/server bundles are present.
- A **166 MB debug APK** was built successfully on 2026-07-14.

Concerns:

- `build.gradle` still contains an obsolete comment saying no JNI shim exists, while the shim now exists; this is misleading debt.
- No release minification, signing, Play Store bundle, instrumentation result, or on-device network/runtime proof was found.
- The large pre-staged assets/native binaries contribute heavily to repository size.

**Assessment: ⚠️ Wiring complete enough to build; production/device validation incomplete.**

### iOS

iOS contains:

- Generated Xcode project and `project.yml`.
- Swift app delegate, `NodeRunner`, and WKWebView controller.
- `NodeMobile.xcframework` integrated into the project and physically present (~215 MB).
- Build phase that stages `main.js`, compiled server/web, and public assets.
- Node starts on a background queue and serves the app on loopback.

Build history:

- iOS device build log, 2026-07-04: **BUILD SUCCEEDED**.
- Warnings include unused/no-op `try?`, interface-orientation settings, and an always-running build script without declared outputs.
- Mac Catalyst build: **BUILD FAILED** because the XCFramework has no Catalyst slice. This is not necessarily an iOS blocker, but Catalyst should be explicitly unsupported/disabled or supplied with a compatible binary.

No `.ipa`, signed archive, TestFlight evidence, simulator/device E2E, or recent post-July-4 build was found.

**Assessment: ⚠️ Real iOS shell and successful compile, but release and runtime readiness are not demonstrated.**

## 5. Server / P2P backend health

### Services and responsibilities

There are nine files under `src/server/services/`:

1. `gun-service.ts` — graph CRUD/set access, SEA pair creation, network statistics.
2. `user-service.ts` — users, public profile foundations, known people, blocks, location/online state.
3. `chatroom-manager.ts` — hierarchy, membership, capacity/eviction, roles, visit counters, built-in TechSupport presence.
4. `talk-service.ts` — talk retrieval/processing, answers/matches, stats/surveys.
5. `reputation-service.ts` — reputation and trust-related operations.
6. `mailbox-store.ts` — bounded, encrypted-envelope, in-memory offline mailbox with TTL and caps.
7. `broadcast-tag-popularity-store.ts` — process-local popularity/trend aggregation.
8. `techsupport-announcement-service.ts` — SEA-signed identity and announcement authorization.
9. `techsupport-message-store.ts` — support-message storage abstraction; current K design intends to avoid server authority for support content.

The server registers seven route modules with roughly **65 Express endpoints**, plus Socket.IO events.

### Gun and topology

`attachGun()` chooses topology by environment:

- Embedded native node: radisk forced **on**, local node is source of truth.
- Relay-only / ephemeral star / E2E memory-only / fresh-dev: radisk **off**, peers empty, AXE/multicast disabled.
- Legacy generic Gun-peer embedded mode can dial configured hub peers.
- Preferred embedded mode uses an **explicit HTTP relay** client rather than treating the hub as application data authority.

The public hub is being intentionally reduced to bootstrap/signaling/room membership and bounded ciphertext relay. Local/browser peers own conversations, ledgers, mailbox processing, and content.

### Routes and health

Major route groups:

- `/health`
- users, profiles, known people, blocks, age verification
- chatrooms, members, roles, join/move/capacity
- talk lookup
- stats, surveys, broadcast-tag trends
- encrypted offline mailbox
- presence and signed acknowledgments
- P2P signaling/conversation relays and diagnostics
- local-node, neighbors, data ownership/migration
- signed admin announcements
- test-only graph reset/snapshot/size/shutdown endpoints (conditionally registered)

### Persistence

- Embedded/native node: Gun radisk on device.
- Relay-only/ephemeral hub: application Gun graph is memory-only/stateless by design.
- Browser: Gun/local browser custody and encrypted private namespaces.
- Mailbox: ciphertext only, in memory, TTL 48h default/72h max, bounded per recipient/globally. A hub restart loses pending envelopes.
- Popularity trends and several relay/presence structures are process-local.

This topology is coherent with the P2P-first specification, but “questions are never lost” and “offline mailbox” claims are stronger than an in-memory single-hub mailbox can guarantee across restarts. Durable-but-encrypted or replicated relay semantics need an explicit decision if loss across hub reboot is unacceptable.

**Assessment: ⚠️ Functionally broad and well-tested, but migration/legacy boundaries and volatile relay state need operational decisions.**

## 6. Technical debt and code quality

### TODO/FIXME/HACK search

Most matches are documentation references to roadmap items, not ad hoc debt. Actionable code comments found:

- `src/web/services/peer-mesh-service.ts`: neighbor selection still has “TODO step ≥2” to use trust-based ranking.
- `src/web/ui/ui-manager.ts`: match-count tracking is commented out as TODO.

Other “todo” matches in examples are variable names/logging, not debt markers.

### Warnings and issues

- TypeScript compilation: no warnings/errors.
- Jest: duplicate package name and experimental localStorage warning.
- iOS: unused/no-op `try?`, orientation warning, and build script output-dependency warning.
- Git object store: garbage temporary objects reported by `git count-objects`.
- Dependency audit could not run because registry access was unavailable; current vulnerability posture is therefore unknown.

### Maintainability concerns

- `src/web/ui/ui-manager.ts` exceeds 8,500 lines and combines rendering, event binding, filters, storage, dialogs, conversation behavior, localization updates, and state. Extraction has started, but this remains the largest change-risk concentration.
- `app-bar.ts` is tested but apparently unused by production.
- Compiled `.js`, `.map`, `.d.ts`, and `.d.ts.map` artifacts exist inside `src/shared/`, creating source-resolution/staleness risk; Jest explicitly has to prefer TS.
- Legacy examples remain under `src/`; they are excluded from TS but can affect search and coverage interpretation.
- Many compatibility and legacy read paths remain during P2P migration. New writes are guarded against deprecated public paths, which is good, but the cleanup/retention exit criteria should be explicit.
- Root middleware serves both `public` and the entire working directory; besides security, this blurs source/runtime boundaries.
- Roadmap and inline Android comments have become stale relative to implementation.
- Repository/artifact bloat makes clones, indexing, CI caching, and audits unnecessarily expensive.

**Assessment: ⚠️ Good correctness discipline, but modularity and artifact hygiene need an intentional sprint.**

## 7. Security posture

### Positive controls

- SEA keypairs and signatures are used across socket authentication, identity linking, ledgers, announcements, presence proofs, and release verification.
- Pair-private messages and mailbox/content envelopes use SEA ECDH (`SEA.secret`) and encryption.
- Socket authentication verifies `SEA.verify(signature, pub) === userId` and rejects public-key mismatch.
- User private Gun records are encrypted before write.
- Helmet is enabled; production CORS is narrowed to `https://iinpublic.com`.
- Embedded native servers are intended to bind loopback only.
- Mailbox TTL, item count, and ciphertext-size caps reduce abuse/memory exposure.
- TechSupport has separate announcement/DM trust-anchor concepts and explicitly rejects relay-served keys that are not compiled trust anchors.
- `.env.local` and `radata/` are ignored, and the example says to generate a production TechSupport pair.

### Critical and high-risk gaps

1. **REST authorization is broadly absent.** User, block, chatroom/member/role, presence, relay, and other routes accept identifiers from URL/body without a common signed request or authenticated session middleware. Socket.IO has authentication, but the REST surface does not inherit it. An attacker able to reach the API may impersonate IDs, mutate membership/profile/block state, scrape relay data, or submit actions for another user, subject only to per-route validation/rate limits.

2. **The server exposes `express.static('.')`.** In a production launch from repository/application root this can serve source, configuration, logs, docs, test artifacts, and other non-dot files over HTTP. Dotfiles are normally ignored by Express static defaults, but that does not make whole-repository serving safe. Only an explicit immutable public/build directory should be exposed.

3. **TechSupport authorship is not yet sound end to end.** The roadmap records that the browser currently composes an unsigned welcome message while posing as TechSupport. K2/K3 intend to replace this with compiled trust anchors, signed templates, and a real TechSupport peer holding the DM key, but that path remains incomplete. Until completed, support identity must not be presented as cryptographically authoritative.

4. **CSP permits `script-src 'unsafe-eval'`.** This materially weakens XSS mitigation. It may be required by current Gun/Webpack code, but should have a tracked removal or a narrowly justified production exception.

5. **Production origin policy may be too narrow and dev policy is intentionally broad.** Production permits only `https://iinpublic.com`, not `https://www.iinpublic.com`, even though native defaults reference `www.iinpublic.com`. Confirm actual deployment origins. Development accepts any HTTP(S) host and credentials; that is tolerable only when development servers are not exposed to untrusted networks.

6. **SEA custody migration needs completion.** Device keypairs are encrypted in local storage and migrated from a legacy plaintext record, but the legacy record should be deleted/verified after migration. The TechSupport private pair must not remain on the relay under the revised K3 model.

7. **Invitation challenge is not cryptographically complete.** `src/shared/challenge-plugins.ts` states that the signed invite token is currently validated only as a non-empty string. Any security-sensitive private/community admission must not rely on this placeholder.

8. **Volatile mailbox availability conflicts with “never lost.”** Ciphertext secrecy is good, but process-memory storage provides no durability across restarts or failover.

9. **Dependency vulnerability status is unknown.** `npm audit --omit=dev` could not contact the npm advisory endpoint in this environment.

### Content filtering

Dirty-word and grammar filtering are implemented, not merely planned:

- Shared `assessMessageContent`, outgoing, and incoming paths.
- Built-in plus editable dirty-word lists.
- NFKC/case-normalized whole-word handling.
- Grammar scoring against configured threshold.
- Tests passed in the fresh sample.
- E2E specs 70/71 cover dirty-word and grammar message blocking.

Important limitation: this is user-controlled content preference/moderation, not a server security boundary. Incoming rejected content remains encrypted/in the graph and is hidden at render time; disabling filters reveals it. TechSupport is deliberately exempt under K6.

### Auth flow

- Device identity is SEA keypair-based rather than username/password server login.
- Browser generates/loads an encrypted custody record, authenticates `gun.user()` with the pair, and migrates a legacy stored pair when present.
- Socket.IO requires a signature over the user ID and pins the pub to the stored user.
- HTTP REST requests largely lack equivalent authentication.
- Multi-device linking uses different keys per device with signed attestations, but app-level graph wiring is incomplete.

**Assessment: ❌ Not production-ready until the HTTP authorization/static exposure and TechSupport impersonation issues are fixed.**

## Top five recommendations for the next sprint

1. **Establish one signed HTTP authorization boundary.** Define canonical request signing (method, path, body hash, timestamp, nonce), enforce user/pub ownership in middleware, add replay protection, and apply it to every mutating or private REST/relay route. Add negative integration tests for cross-user impersonation.

2. **Harden the production HTTP surface immediately.** Remove `express.static('.')`; serve only `dist/web`/`public` from explicit paths, confirm `iinpublic.com` versus `www.iinpublic.com`, gate all debug/test endpoints by a fail-closed production check, and plan removal of CSP `unsafe-eval`.

3. **Finish TechSupport K1–K3 as a single trust-boundary slice before adding more behavior.** Stop browser impersonation, ship/verify signed localized greeting blobs, keep the DM private key off the relay, add real TechSupport-mode authentication, and land tamper/mismatched-key E2E tests. Then wire K5 FAQ/inbox behavior.

4. **Turn native builds into repeatable release gates.** Add real macOS/Windows/Linux/Android/iOS runners, smoke the embedded node on-device, capture signed artifact provenance, declare Catalyst supported or explicitly disabled, and keep skipped X3–X8 specs visible as release blockers rather than silent scaffolds.

5. **Run a debt/retention cleanup after the trust work.** Integrate or remove standalone `app-bar.ts`, continue splitting `ui-manager.ts`, remove generated outputs from `src`, resolve the Jest package collision, measure real deployment graph size for L2, decide tombstone/retention ownership, and purge obsolete artifacts/logs from the working tree/release context.

## Critical issues needing attention

- **Critical:** unauthenticated/under-authenticated REST mutations and relay reads/writes.
- **Critical:** whole-working-directory static serving through `express.static('.')`.
- **High:** client-fabricated unsigned TechSupport welcome/authorship until K2/K3 completes.
- **High:** invitation “signed token” currently checks only non-empty input.
- **High availability/data-loss risk:** in-memory mailbox cannot guarantee queued-message survival across hub restarts.
- **Release blocker:** native CI/signing/on-device proof is incomplete despite successful local artifacts.

## Diagnostic record

Commands/checks used during this assessment:

- `npx tsc --noEmit` — **exit 0**
- Targeted `npx jest ... --runInBand --no-cache` — **36/36 passed**
- Latest Playwright report/merged JSONL inspection — **171 passed, 2 skipped, 0 failed**
- Source/test counts via `find`
- Size accounting via `du`, excluding `.git` and `node_modules`
- Read-only searches for architecture imports, routes, persistence, SEA/auth, CORS, TODO/FIXME/HACK, generated artifacts, build products, and build logs
- `npm audit --omit=dev --json` — **not completed: registry DNS/network unavailable**

No full Jest suite, full E2E rerun, Android Gradle build, Electron packaging run, or Xcode build was launched during this review; existing artifacts/logs plus focused diagnostics were used to keep the assessment timely and read-only with respect to the project.
