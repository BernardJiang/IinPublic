# TechSupport Bootstrap Contract

TechSupport is a bootstrap/system presence, not an interchangeable ordinary user.

## Invariants

- The canonical root id is `iinpublic-root-techsupport`; the canonical stage name is `TechSupport`.
- **TechSupport is built into the client, not resident in the server (K1, 2026-07-25 revision).**
  Identity is compiled into every client bundle (`TECHSUPPORT_ROOT_USER_ID` + trust-anchor keys in
  `src/shared/techsupport.ts`); presence is peer-provided. The relay seeds the signed
  `public/techsupport-identity` record and one Global member row on boot and after every E2E
  reset (`ChatroomManager.seedTechSupportGlobalMembership`, called from
  `IinPublicServer.publishPublicBootstrap`) — bytes, not a database. The client also synthesizes
  TechSupport as a built-in Global roster/count entry directly from the compiled constants
  (`techSupportRosterMember()`), so headcount 1 on an empty network never depends on any Gun row
  existing yet, nor on a browser having bootstrapped anything.
- In dev, `npm run dev` / `dev:stage-zero` starts a clean database and boots an **ordinary** user;
  the built-in TechSupport member is provided by the relay boot seed and the client's
  compiled-constant floor (K1), so headcount is **2** (dev user + TechSupport). A developer acts
  **as** TechSupport by running **`npm run dev:techsupport`** (K3, 2026-07-26), which boots the
  normal web client in TechSupport mode: it loads the canonical DM SEA pair from the device key
  file (`TECHSUPPORT_SEA_PAIR_JSON` or `TECHSUPPORT_KEY_FILE`), refuses to start unless the pair's
  pub is a trusted DM anchor, `gun.user().auth(pair)`s, adopts `TECHSUPPORT_ROOT_USER_ID`, and
  shows a permanent "TechSupport (root)" badge. `dev:multi` still seeds TechSupport server-side
  and keeps its ordinary browsers as ordinary users; its `?devRole=techsupport` driver window
  still logs in as root without a real keypair (unaffected by K3, tracked as a follow-up).
- **The TechSupport DM/greeting private key lives only on the TechSupport device** — a key file
  loaded at runtime into the distinct localStorage key `iinpublic_techsupport_keypair_v1` via the
  `dev:techsupport` launcher (`scripts/dev-techsupport-login.js`). It is never inlined into the
  web bundle and never held by the relay (guarded by
  `src/test/unit/techsupport-key-not-bundled.test.ts`). The relay holds at most the
  **announcement** key (for on-demand system announcements) and republishes a **pre-signed**
  identity record; server boot and E2E reset require **no** private SEA pair (K3).
- A first-time ordinary user must not claim the TechSupport id or stage-name reservation.
- Every ordinary user gets one support channel with TechSupport. The welcome greeting is rendered
  client-side from a **compiled, pre-signed, per-locale template**
  (`src/shared/techsupport-greeting.signed.json`, signed by the TechSupport **DM key**), verified
  against `TECHSUPPORT_DM_TRUST_ANCHORS` before rendering, then persisted as a real message in the
  **receiver's own local Gun** at the deterministic soul `support_welcome_<userId>` (K2, 2026-07-25).
  Nothing per-user is authored or stored by the relay. A client that cannot verify the signature
  renders **no** greeting (never a fabricated one). Substitution of the user's stage name into the
  `{name}` placeholder happens only **after** signature verification. This satisfies invariant 4
  (every message attributed to TechSupport is signed by the TechSupport key and verified by the
  receiving client) — the browser no longer fabricates an unsigned message in TechSupport's name.
- Support-channel messages are durable through the support transport. Ordinary user-to-user messages remain separate from support channels.
- **Headcounts count TechSupport as exactly 1 in all cases** — status bar, chatroom list badges, and any user-facing room total. It is never excluded and never double-counted. **Liveness is a separate signal** (online/away, sourced from real peer presence via `P2PPresenceClient`) and is never reflected in the count — TechSupport renders as present whether or not its device is currently reachable (K1-2).
- User-facing lists that show TechSupport must label it as built-in/bootstrap support, not as a normal peer.
- TechSupport is **never evicted** from Global by presence-staleness pruning, in either the
  Gun-persisted path (`ChatroomManager.pruneStaleRoomMemberships`) or the in-memory fast path
  (`ChatroomManager.getFastActiveMembers`) — both check `isTechSupportId` before applying the TTL (K1-3).
- **TechSupport never receives or answers talks (K5).** It is not a valid talk recipient and never
  produces a response, match, or ignore. This is enforced as a hard rule on the canonical root id
  in the delivery/fanout path — deliberately *not* a `TalkIntakeFilters` entry, since that is
  user-editable and would let TechSupport be filtered back in by mistake. TechSupport still counts
  as 1 in every headcount regardless (invariant above, unchanged).

## Current Enforcement

- `src/shared/techsupport.ts` reserves the TechSupport name and root id, and exports
  `techSupportRosterMember()` / `TECHSUPPORT_GLOBAL_ROOM_ID` for the client-side floor.
- `src/shared/techsupport-graph.ts` is the single authored source for the baseline graph shape,
  consumed by both `tests/e2e/helpers/clear-database.ts` (TS) and `scripts/dev-techsupport-bootstrap.js`
  (via the compiled `dist/server/shared` output) — no more drifting duplicate graph builders.
- `IinPublicServer.publishPublicBootstrap()` (`src/server/index.ts`) republishes the signed identity
  record and calls `ChatroomManager.seedTechSupportGlobalMembership()` on boot and after every E2E
  reset. `bootstrapTechSupportRootIfMissing()` (the old browser-side root-minting path) is deleted —
  browsers no longer write the root; they only render it locally.
- `WebChatroomService.rosterWithTechSupportFloor()` / the count floors in `getMemberCount()` and
  `subscribeToMemberCount()`'s `emitCount()` inject the synthetic entry only when no real
  `TECHSUPPORT_ROOT_USER_ID` row is already present, so the two sources (relay seed, client floor)
  dedup by canonical id and never double-count.
- `IinPublicApp.countRoomMembers()` counts every unique member — TechSupport included — as 1 for the status bar.
- `UIManager.setTechSupportOnlineStatus()` / `isTechSupportOnline()` carry the liveness indicator,
  sourced from `P2PPresenceClient.fetchNearby()` results (`app.ts`'s `initP2PPresenceAndBridge()` and
  `refreshConversationPresence()`), decoupled from headcount.
- `scripts/dev-techsupport-login.js` (`npm run dev:techsupport`, K3) launches the web client in
  TechSupport mode, injecting the root id + canonical DM pair into localStorage before
  navigation; `WebGunService.ensureKeypairAndAuth()` loads the pair from
  `TECHSUPPORT_KEYPAIR_STORAGE`, asserts it via `assertTechSupportDmPair()`
  (`src/shared/techsupport.ts`), and authenticates with it instead of generating a device pair —
  never persisting it into the ordinary encrypted key-custody record. `isDevStageTechSupportLoginResolved()`
  (the old `stage-zero`/`empty` auto-login-as-root special case) is deleted; `dev:multi`'s
  `?devRole=techsupport` driver window (`isDevTechSupportDriver()`) is untouched.
- `TechSupportAnnouncementService.publishIdentity()` (K3) republishes the committed, pre-signed
  `src/shared/techsupport-identity.signed.json` (signed once by
  `scripts/sign-techsupport-identity.js` / `npm run sign:techsupport-identity` with the
  **announcement** key) — no boot-time private key. `IinPublicServer.publishPublicBootstrap()` no
  longer gates on `techSupportAnnouncements.isConfigured()`, so the identity record and the Global
  member-row seed are produced unconditionally, even on a relay with no
  `TECHSUPPORT_SEA_PAIR_JSON` configured at all (that env var now only gates the on-demand admin
  announcement feature).
- Contacts render TechSupport with `data-support-contact="true"` and built-in support copy, plus a
  `.techsupport-presence-indicator` online/away dot.
- Chatroom member rows render TechSupport with built-in support status copy, plus the same presence indicator.
- E2E helper bootstraps assert root-vs-ordinary identity through `tests/e2e/helpers/techsupport-contract.ts`.
- `src/shared/techsupport-greeting.ts` (K2, 2026-07-25) — `signGreeting`/`verifyTechSupportGreeting`/
  `renderGreeting`, mirroring `system-announcements.ts`'s sign/verify convention. Verification
  checks the trust anchor, that the template text matches the client's own compiled
  `TECHSUPPORT_GREETING_TEMPLATES` (a swapped template is rejected even if validly signed), and the
  SEA signature. `scripts/sign-techsupport-greeting.js` is the one-off build/dev signing step
  (`npm run sign:techsupport-greeting`; reads `TECHSUPPORT_SEA_PAIR_JSON`, asserts the pair matches
  `currentTechSupportDmPub()`, writes the committed `techsupport-greeting.signed.json`). Re-run and
  commit a new signed bundle whenever the greeting copy or the DM key changes.
- `IinPublicApp.ensureSupportBootstrapForCurrentUser()` (`app.ts`) verifies-then-renders the
  greeting and persists it via `WebConversationService.upsertMessageRecord` (a local-only Gun
  write, never `sendMessage`'s peer-notify path). No `supportState` localStorage gate remains —
  idempotency comes from the deterministic message id.
- `UIManager.filterVerifiedSupportMessages()` re-verifies a stored greeting at render time
  (independent of the write-time check), including confirming the stored `text` is exactly what
  the verified template renders to for the current user — closing the gap where a stored record's
  signature fields are left untouched but its displayed text was altered after signing.
- **Stage0 is the only place a database is built from scratch (K4, 2026-07-26).** A committed,
  validated fixture — `tests/e2e/staged/fixtures/stage0.fixture.json` — is the one definition of
  the built-in TechSupport baseline. It is produced by a real browser traversal
  (`npm run test:e2e:regen-stage0-fixture`, which drives `stage0-bootstrap/aaa` → `baa` → `caa` →
  `zzz-save-stage0` and copies the validated result into the committed path), never hand-authored.
  `tests/e2e/helpers/clear-database.ts`'s `seedTechSupportRootBaseline()` — the seed every
  `clearGunDatabases()`/`maybeClearGunDatabases()` call routes through — loads this fixture via
  `POST /api/test/import-snapshot` instead of calling the `techSupportBaselineGraph()` factory
  in-process. The factory itself is unchanged and still used by `scripts/dev-techsupport-bootstrap.js`
  (dev seeding, not E2E) and by the regeneration pipeline's own traversal setup.
  `src/test/unit/stage0-fixture.test.ts` fails fast (no server needed) if the committed fixture
  ever stops passing the same `assertStageSnapshotIntegrity` check the stage pipeline enforces;
  `src/test/unit/no-inline-baseline-graph.test.ts` fails if any `.spec.ts` outside
  `stage0-bootstrap/` references the raw factory or calls the seed function directly.

## Verification

- `tests/e2e/staged/stage0-bootstrap/000-relay-only-techsupport-presence.spec.ts` — bare relay, no
  browser: identity record + one member row present, no support DB (K1 item 6).
- `tests/e2e/staged/stage1-single-user/02-techsupport-away-headcount.spec.ts` — TechSupport device
  not running: headcount still 2, contact/roster row listed, away indicator shown (K1 item 7).
- `tests/e2e/staged/stage1-single-user/01-login-single-user-headcount.spec.ts` — contact count +
  headcount across re-login (no longer asserts a server-stored greeting; that moved to spec 03).
- `tests/e2e/staged/stage1-single-user/03-support-greeting-signed.spec.ts` (K2) — signed greeting
  renders once, personalizes correctly, verifies, and survives clear-storage + re-open.
- `tests/e2e/staged/stage1-single-user/04-support-greeting-tamper-suppressed.spec.ts` (K2) — a
  stored greeting whose text was altered after signing renders as nothing, silently, no toast.
- `tests/e2e/staged/stage2-two-user/00k-techsupport-contact-mute.spec.ts`
- `tests/e2e/staged/stage2-two-user/34-contacts-filter-name.spec.ts`
- `src/test/unit/techsupport.test.ts`
- `src/test/unit/chatroom-manager.test.ts` — `seedTechSupportGlobalMembership` presence + eviction
  immunity (both the Gun-persisted and in-memory fast paths).
- `src/test/unit/web-chatroom-techsupport-floor.test.ts` — client-side roster floor dedup.
- `src/test/unit/techsupport-greeting.test.ts` — sign/verify round-trip, tamper rejection, untrusted
  key rejection, malformed-input handling.
- `src/test/unit/techsupport-baseline.test.ts` — `signedGreetingProblem`: absence is not an error,
  presence must verify.
- `tests/e2e/staged/stage1-single-user/05-techsupport-mode-signed-dm.spec.ts` (K3) — a browser
  booted in TechSupport mode authenticates with the canonical DM pub (not a random device pair),
  publishes it to the TechSupport user record, and a DM it sends is visible to the receiver
  alongside an author identity that verifies as a trusted DM anchor.
- `src/test/unit/techsupport-login.test.ts` (K3) — `assertTechSupportDmPair`: a pair whose pub is
  not a trusted DM anchor is rejected; malformed input is rejected without leaking.
- `src/test/unit/techsupport-key-not-bundled.test.ts` (K3) — the built web bundle contains
  neither the TechSupport private key material nor the `TECHSUPPORT_SEA_PAIR_JSON` env-var name.
- `src/test/unit/system-announcements.test.ts` — `signTechSupportIdentity` round-trips through
  `readVerifiedTechSupportIdentity`; `publishIdentity()` succeeds with no pair configured at all.
- `src/test/unit/stage0-fixture.test.ts` (K4) — the committed stage0 fixture exists and passes
  `assertStageSnapshotIntegrity`.
- `src/test/unit/no-inline-baseline-graph.test.ts` (K4) — no spec outside `stage0-bootstrap/`
  constructs the baseline graph in code.
- `tests/e2e/staged/stage1-single-user/06-support-new-question-ack.spec.ts` (K5) — a miss-path
  question renders a signed ack, verifies, and posts to the TechSupport mailbox envelope.
- `tests/e2e/staged/stage1-single-user/07-support-inbox-answer-flow.spec.ts` (K5) — full operator
  loop: question asked → mailbox delivery → TechSupport drains inbox → operator answers → asker
  receives the answer → FAQ bundle independently readable and verifiable.
- `acceptsIncomingTalks()` (`src/shared/techsupport.ts`), checked at the top of
  `shouldAcceptIncomingTalkAsync` (`src/web/app/app.ts`) before any filter runs (K5 talk-exclusion
  invariant above).
- **Enforced a second time on the sender's own side, discovered while E2E-verifying the above:**
  `IinPublicApp.resolveBroadcastReceivers()` (`app.ts`) filters `TECHSUPPORT_ROOT_USER_ID` out of
  every candidate source (UI member list, server member fetch, Gun active-members fallback) before
  resolving who a broadcast goes to. A broadcast into a room containing only TechSupport therefore
  never even attempts delivery ("no receivers resolved") — TechSupport is excluded from receiver
  *resolution*, not merely from *acceptance* once an offer arrives. `acceptsIncomingTalks()` remains
  the receiver-side backstop if that sender-side filter is ever removed.
- `tests/e2e/staged/stage1-single-user/10-techsupport-ignores-broadcast-talks.spec.ts` (K5) is the
  E2E proof of both of the above: broadcasting tag and flow talks into a room containing an
  ordinary user and a real TechSupport session never populates TechSupport's local incoming-talk
  index, and Global headcount stays 2 throughout.

## Honest cost (K2/K3)

Rotating the DM or announcement key means shipping a new client build (the compiled trust-anchor
lists) and re-running the relevant signing script (`sign:techsupport-greeting`,
`sign:techsupport-identity`) to produce and commit a new signed artifact; for K3 specifically, the
operator must also redistribute the new key file to every machine that runs `dev:techsupport` /
the production TechSupport device.

## Honest cost (K4)

The committed fixture can drift from the live `techSupportBaselineGraph()` factory /
`aaa`/`baa`/`caa` traversal behavior over time — a code change to any of those without re-running
`npm run test:e2e:regen-stage0-fixture` leaves the fixture stale until someone notices (the
integrity unit test catches a fixture that fails validation, but not one that is merely
out-of-date relative to new traversal steps). Regenerating and reviewing the JSON diff is a manual
step, not yet enforced in CI. Only `stage1`/`stage2` (via `clearGunForStage1Spec`/
`clearGunForStage2Spec` in `E2E_STAGE_PIPELINE=1` mode) load a *progressive* multi-user snapshot
built on top of this fixture; `stage3`/`stage4`/`stage5` and the non-staged directories
(`talks-matching/`, `mass/`, `isolated/`) still reset via the bare fixture on every spec rather
than a stage-appropriate multi-user baseline — see the remaining `docs/TODO.md` K4 work items for
that follow-on scope.
