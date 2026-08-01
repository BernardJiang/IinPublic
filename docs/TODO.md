# IinPublic TODO

Last updated: 2026-07-29

This file tracks only open work. Completed items are archived in `docs/completed.md`.
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specifications.md` (§19.13, §19.14, REQ-P2P-09–29; mesh talk delivery design §23; libp2p/IPFS §25 — supersedes Phase D §24; find-similar §22)

## Model routing legend

Each item is tagged with the cheapest model that can do it reliably, to optimize token spend:

- **`[Opus]`** — distributed-correctness / ordering / architecture is the hard part; design mistakes cascade.
- **`[Sonnet]`** — standard implementation against an existing spec or pattern.
- **`[Haiku]`** — mechanical, fully specified work; running test suites; scaffolding from a written design.

Token-saving rules: for `[Opus]` items, have Opus write a short design note first, then hand implementation + tests to Sonnet. `- [ ] Test:` items belong to whichever model implemented the step.

---

## Session batches (sized for one ~5-hour work session each)

**Honesty note on what this sizing actually is.** There's no way to calibrate these to an exact
token/time budget from inside the work itself — sizing below is by *relative engineering effort*
(files touched, how much new UI/data-model surface is introduced, how much test depth is needed),
using this session's own pace as the reference point (e.g., "write 3 new E2E specs end-to-end" ≈
one comfortable chunk; "survey + merge 1,600 lines of docs into the SRS + archive + cross-check"
≈ a full session on its own). Treat session boundaries as *suggested stopping points at a shipped,
tested increment*, not a hard clock — stop early if a natural boundary arrives sooner, and don't
force a session's last item to completion if it's running long; carry it to the next session
instead of leaving something half-wired.

Ordering within and across sessions follows Q's existing easy-to-hard build order plus each
item's actual dependencies (e.g., N1's destination decision must land before N3/O reuse it).

- **Session 1 — foundation + quick wins (mixed trivial/easy, ~9 small items).** Land the
  `navigateToGraphNode(target)` dispatcher skeleton (Q, kept deliberately minimal — 2-3 existing
  functions wired through, no new click handlers yet); M1 (disable Replies-to-my-talks panel,
  already a single contiguous edit); verify Chatroom→Person works (Q); P's `created`-vs-`answered`
  destination decision (decide + doc, or a one-line routing tweak); N1 (clickable DM toast +
  destination decision); N3 single-partner case; M5 (compact TechSupport contact row); K6's two
  remaining tests + the talk-intake carve-out note; L1's legacy-scalar removal (after confirming no
  reader); W's Gap 1 fix (new 2026-08-01 — swap the main Broadcast button to the already-existing
  per-receiver unsent-talk filter, one call-site change); X (new 2026-08-01 — `Talk.authorLocation`
  raw-coordinate fix, a confirmed violation of the SRS's own day-one blurred-location requirement,
  mechanical since `LocationPrivacy.blurLocation()` already exists). None of these need new
  architecture beyond the Session-1 dispatcher itself.
- **Session 2 — DM/talk traceback depth (~5 medium items).** N3 multi-partner picker (reuses
  `#peer-send-picker-modal`); P's actual dead-end fix (real retry on `demandFullTalk` failure); O
  (peer-detail history list clickable + on-demand thread creation); Q's Talk→Me-tab-Q&A reverse
  edge; P's `contextHash`/`contextPath` per-question deep link.
- **Session 3 — Contacts/Talks/Me list performance.** R's shared `renderListProgressively` helper
  + R1 (Contacts two-phase render split — the highest-value target, has the genuine blocking
  chain); M6 (contact headshots + prefetch cache, revisit in light of R1); R2 + R3 (apply the same
  helper to the Talks list and Me Answers list — smaller once the helper exists).
- **Session 4 — cross-tab DM affordance (N2).** One item, but large: new global UI element (app-bar
  icon + list/popover), a design decision (dropdown vs. reviving `#conversations-list`), badge
  wiring off the existing unread count, and cross-tab E2E coverage. Budget the whole session for it
  rather than pairing it with something else.
- **Session 5 — talk/answer row compression (M2 + M3).** Also large on its own: collapsing four
  talk-type row templates (flow/tag/survey/route) plus the answer-entry template to 2 lines with
  inline icon actions, building the shared details-popup modal, and full-matrix testing across
  talk types and both OUT/IN directions.
- **Session 6 — Settings tab cleanup (M4).** Shared section-wrapper extraction across 9-10
  sections, splitting content-filters into its sub-concerns, and the grouping/accordion design
  decision — a mechanical refactor plus one real design call.
- **Session 7 — ledger + conversation-message merkle-checkpoint pruning (S).** Large and
  self-contained: new `CHECKPOINT_CREATED` ledger event kind, the delta-sync proof-instead-of-raw-
  event change, the analogous message-checkpoint structure, plus real crypto/data-integrity test
  coverage. Don't split this across sessions if avoidable — the checkpoint/proof logic is easiest
  to get right end-to-end in one continuous pass.
- **Session 8+ — the genuinely large or blocked-on-you items, size TBD, likely more than one
  session each:**
  - Q's Talk → "people I've separately exchanged this with" edge — hardest item in the whole
    backlog by design (no existing pattern to extend, privacy-sensitive), deliberately last.
  - G/I/J's nightly cross-platform specs (X3-X8) — blocked on you (native-build/CI runner infra)
    rather than a schedulable engineering session. (L2 is no longer in this list — Bernard's
    2026-08-01 decision unblocked and closed it; see §L2.)
  - K4's remaining ~174 call sites (stage2/3/4/5, `mass`, `isolated-02`) — scope confirmed
    2026-08-01 as a **full** conversion, not partial; schedule as its own dedicated session
    (stage3 alone is 128 of the 174, the bulk of the work) rather than starting mid-session. See §K4.
  - K7 (new 2026-08-01) — TechSupport answer-delegation/redirect needs an `[Opus]` design note
    before implementation (co-operator pool storage, how a delegate's answer gets relayed back
    under a TechSupport-signed reply, `answeredByDelegate` audit trail) — write the design note
    as its own session, then hand implementation to Sonnet per the model-routing legend.
  - U (new 2026-08-01) — broadcast to a contact group with deferred/offline delivery needs an
    `[Opus]` design note first (custom-label-as-group vs. multi-tag data model; whether the
    mailbox's fixed 48h/72h TTL is acceptable as-is), then the group-picker UI and
    `recipientUserIds` wiring go to Sonnet. See §U.
  - V (FR-TK-7, spec'd 2026-01-19, never built — corrected + mostly decided 2026-08-01) — Auto
    Linear Capture from DM shorthand. Grammar, same-session chaining, the compose-time confirmation
    step (mandatory, never silent), and the edit/append id policy (editing a talk mints a new id;
    old one deleted by default, Settings-tab override to keep — same shape as the ledger's existing
    response-versioning) are all decided. Also needs a new two-author credit model — permanent
    `originalAuthorId`/`originalCreatedAt`/`originalAuthorLocation` vs. current `authorId`/
    `createdAt`/`authorLocation`, the latter switched to blurred (`LocationPrivacy.blurLocation()`)
    instead of the raw coordinate it stores today — verified none of this exists yet, see §V. Title
    edits don't count as authorship, settled; one sub-question left: do metadata-only edits reassign
    the current-author fields at all. `[Opus]`-tagged for that plus the reference-integrity blast
    radius of
    generalizing "edit mints a new id" to the existing Talk Editor path. See §V.

---

## Execution rules (apply to all E2E specs)

1. Place spec in the **lowest stage whose user count can verify the choice** (1 user → `tests/e2e/staged/stage1-single-user/`, 2 users → `stage2-two-user/`, 3 users → `stage3-three-user/`).
2. Each spec gets a companion `.md` describing it in plain English.
3. Use existing helpers: `timing.ts` (`afterSync`/`afterAction`/`afterLoad`), `e2e-status-checks.ts`; assert via hard signals (`#status-bar-text`, local Gun IN index, `.conversation-list-item`), not toasts.
4. Run single spec: `npm run build:server && npx playwright test <spec>` (staged specs via `npm run test:e2e:staged` pipeline order).
5. **If a test exposes a real bug: fix the product code (never weaken the assertion), re-run until green.** If the feature doesn't exist at all, stop and log it under "Feature gaps" instead of inventing behavior.

---

## Land order: A → B → C → D → H → E → F → G → I → J

> **A–D complete 2026-07-15** — see `docs/completed.md`. AppBar + overflow, notification
> auto-dismiss, conversation-first entry + matched-talk threads, and the unified
> peer/contact detail are all landed with their specs (50–54, 60–61, 68–69, stage3/71).
> The planned `stage2/62-peer-messaging-merged` update was superseded: that spec never
> existed; the merged messaging area is covered by 60/61/69.

### Host E2E re-run (verification of 2026-07-15/16 fixes) `[Haiku]`

> **Complete 2026-07-31** — Rounds 1–4 (2026-07-15/16) archived in `docs/completed.md`; both
> remaining verification items confirmed via two full `npm run test:all` runs on this host done
> while fixing the cross-browser Firefox timeout (see `docs/completed.md`).

- [x] Re-run the light shard on the host to confirm 0 failed.
      **Done.** `light` phase: `rc=0` both runs (315s, then 312s warm).
- [x] Verify the 2026-07-19 `test:all` speed changes on the host: (a) type/lint/jest now
      overlap the e2e waves instead of gating them (`TEST_ALL_PREFIX_OVERLAP=0` rolls back;
      jest capped at `--maxWorkers=50%` while overlapped), (b) webpack filesystem cache
      (`node_modules/.cache/webpack` — delete it to roll back; cache key covers all
      bundle-baked env vars). Expected: phase 0 ≈ build-only on first run, seconds on
      warm re-runs; watch wave 1 for any jest-contention flakes. `[Haiku]`
      **Done.** `phase0 (builds gate e2e)`: 5s cold, 1s warm re-run — confirms overlap +
      webpack cache both working as designed; `type=0 lint=0 jest=0` both runs (no
      jest-contention flakes in wave 1).

> **H complete 2026-07-15** — message content filters (dirty words + grammar, both
> directions) landed with specs 70/71; the stage3 intake regression was confirmed green
> in the 2026-07-15 host run. Details archived in `docs/completed.md`.

> **E + F complete 2026-07-15** — popup responsive size classes + all 16 option-matrix
> specs landed. Two host-run fix rounds the same day (19 → 8 → 0 expected) resolved
> selector/UX-drift and two real product bugs; see `docs/completed.md`. Pending one
> green host re-run (tracked above).

### G. Platform × screen-size × cross-platform (catalog Part 6) `[Opus]`

Source: SRS §26.2 (Layout Catalog, Coverage & Test Plan) Part 6 — formerly `docs/gui-layout-catalog-and-e2e-plan.md`

> Shipped subset (smoke set, device profiles, size sweep, cross-platform harness,
> X1/X2) archived in `docs/completed.md` 2026-07-19.

- [~] CI runners: Mac mini (P2 Electron), Windows (P3), Linux (P4) — added `test:e2e:native-app:win` / `:linux` scripts; wiring these into the actual CI system is left to the CI config (needs the runner infra).
- [~] **X3** identity linking website ↔ webapp — scaffolded skipped spec (needs I's protocol + real website/webapp on CI). `(nightly)`
- [~] **X4** mobile-profile ↔ desktop-app matching + threads — scaffolded skipped spec. `(nightly)`
- [~] **X5** three-platform stage-3 network incl. thread isolation — scaffolded skipped spec. `(nightly)`
- [~] **X6** offline/mailbox across platforms, both directions — scaffolded skipped spec. `(nightly)`

> **G verification:** config parses; `platform-smoke` runs on `chromium` + (with `E2E_DEVICE_PROFILES=1`) `iphone-webkit`/`android-chromium`; `cross-platform` X1/X2 enumerate. X3–X6 are `test.skip` scaffolds awaiting the native/website build + item I on the CI runners.

### I. Multi-device identity linking (redesign §10, catalog T10) `[Opus]`

Source: SRS §26.1 (Redesign Plan) §10 — formerly `docs/gui-redesign-plan.md` — user decision 2026-07-13

One person, multiple devices ⇒ **different SEA identity per device** (keys never leave a device). Build the linking mechanism instead of identity sharing.

> Shipped subset (link protocol + 12 unit tests, linked-devices Settings page,
> stage1/71 spec) archived in `docs/completed.md` 2026-07-19.

- [~] Cluster rendering for peers: Contacts merged row + User-layout cluster line. — `WebIdentityLinkService.isLinked` provides the resolver; the Contacts/User-layout merge is scaffolded but not yet wired into the row renderers (needs the real service on the graph — X3). `[Sonnet]`
- [~] Block interplay: cluster-wide block offer. — deferred to the block flow; needs the cluster resolver wired (X3). `[Sonnet]`
- [~] **New** `cross-platform/x3-identity-linking.spec.ts` — scaffolded skipped spec (needs website↔webapp on the shared graph + `WebIdentityLinkService` wired in app.ts). `[Opus]`
- [~] Same-device linking shortcuts (§10.3): URL-fragment / loopback / clipboard. — `encodePairingCode`/`decodePairingCode` support the `#link=` fragment; the fragment auto-detect + loopback handshake are not yet wired.
- [~] **New** `cross-platform/x8-same-device-link.spec.ts` — pending the same-device shortcuts. `[Opus]`

> **I verification:** protocol has 12 passing unit tests; `stage1/71` compiles and drives the full page/dialog/validation/unlink flow single-device; `tsc`/`lint` clean. The service (`web-identity-link-service.ts`) is ready for app.ts to wire real signed attestations for X3.

### J. Public-device exit — sync-then-erase (redesign §11, catalog T11) `[Opus]`

Source: SRS §26.1 (Redesign Plan) §11 — formerly `docs/gui-redesign-plan.md` — user decision 2026-07-13

No server login/logout exists; a public-PC session leaves an identity behind. Build a verifiable local wipe with optional encrypted handoff to a linked personal device first.

> Shipped subset (wipe engine, erase dialog, handoff archive + merge, stage1/72,
> stage2/72) archived in `docs/completed.md` 2026-07-19.

- [~] **New** `cross-platform/x7-sync-then-erase.spec.ts` — scaffolded skipped spec (needs the P2P handoff transfer + receiver import wired). `[Opus]`

> **J verification:** handoff build/merge has 7 passing unit tests; `stage1/72` (wipe + fresh boot) and `stage2/72` (sync-progress + gating) compile and drive the full UI; `tsc`/`lint` clean. The wipe engine and dialogs are wired into Settings; the encrypt-to-pub P2P transfer + receiver import are the remaining app.ts wiring, tracked by X7.

---

## K. TechSupport as a true built-in presence `[Opus]`

Source: SRS §19.7.1 (formerly `docs/design/techsupport-bootstrap-contract.md`, contract amended by K1–K6 below; source now in `docs/archive/consolidated-2026-07-29/`).

**Decision 2026-07-25 (revised): "built-in" means built into the client, not resident in the
server.** TechSupport is an ordinary *peer* — it may run on a separate device — whose identity is
compiled into every client bundle. The hub stays a lightweight relay: signaling, room membership,
and a signed identity/pointer record. No support database on the server.

> Supersedes the first draft of K1/K2, which made the server author and store support data. That
> contradicted the P2P-first design (spec §19.4, §23, §25; `CLAUDE.md` — "the server is a
> bootstrap/signaling/room-membership connector, not the talk inbox authority").

### Resolved decisions 2026-07-25 (Bernard)

| # | Decision | Choice |
|---|---|---|
| K1-1 | Where the TechSupport record comes from | **Relay seeds on boot.** Public key served by the relay; every client receives it as given. TechSupport is a built-in Contact for every user from first launch |
| K1-2 | Headcount when the device is offline | **Always count 1 + separate online/away indicator** |
| K1-3 | Eviction immunity | **Never evicted from Global**; implement at the cheapest single point |
| K2-1 | Greeting artifact | **Hybrid** — signed template renders immediately, a real DM follows when the device is online |
| K2-2 | Greeting form | **Real message** persisted in the receiver's local Gun |
| K2-3 | Signature verification failure | **Suppress silently** |
| K3-1 | Key custody | **Two keys** — announcement key (server) + DM/greeting key (TechSupport device) |
| K3-2 | Rotation | **Trust-anchor list** — clients accept any pub in a compiled array |
| K3-3 | How a developer runs it | **Both** — headless agent for uptime, browser mode for answering |
| K3-4 | Production custody | **Redundant** — server, laptops, and a dedicated machine; reliability over minimal key surface |

**Additional requirements from the same decision:**

- A small **user guide ships with the relay**, so basic help is answerable with no TechSupport
  device online and no per-deployment setup.
- **New answers come from a TechSupport client**, only when it is online.
- **Questions are never lost.** If the device is away, the message waits in the offline mailbox and
  is delivered on reconnect.
- **Chatbot marker:** an answer served automatically from the existing FAQ is labelled with the
  chatbot icon, the same treatment as chatbot replies elsewhere — a user must be able to tell an
  automatic answer from a human one.

> **Two tensions worth holding onto while implementing.**
>
> 1. *K1-1 + K3-2:* "the relay serves the public key" must stay a **convenience, not the trust
>    root**. If a client would accept a key merely because the relay served it, a compromised relay
>    can substitute its own TechSupport. The compiled trust-anchor list stays authoritative; a
>    relay-served key is only usable if it already appears in that list.
> 2. *K3-4:* redundancy raises reliability and compromise surface at the same time. Because K3-1
>    splits the keys, keep the **DM/greeting key** off the relay even when replicating for
>    availability — otherwise a relay compromise can author messages as TechSupport, which is the
>    exact property K2 exists to prevent. Replicate it across operator machines instead.

### Target contract (amend the contract doc as part of K1)

1. **Identity is built-in; presence is peer-provided.** `TECHSUPPORT_ROOT_USER_ID` +
   `TECHSUPPORT_PUB` already ship in `src/shared/techsupport.ts`, so every client knows who
   TechSupport is without asking the server. The relay carries only the signed identity record
   (`public/techsupport-identity`, produced by the existing `publishIdentity()`) plus one Global
   member row and signaling data — bytes, not a database.
2. **Headcount is unconditional.** Empty network = **1**; one ordinary user = **2**. TechSupport
   renders as a built-in member whether or not its device is currently reachable; liveness is shown
   as a separate online/away indicator, never by removing it from the count.
3. **TechSupport can never be blocked, muted, or filtered out** by an ordinary user (see K6).
4. **Every message attributed to TechSupport is signed by the TechSupport key** and verified
   against `TECHSUPPORT_PUB` by the receiving client. No component may fabricate messages in
   TechSupport's name — the server included.
5. **Developers act as TechSupport by running the TechSupport client with the keypair**, never as a
   random ordinary id and never by having the server ghost-write on its behalf.

### Answering "can TechSupport live off-server?" — yes

- **Greeting** needs no stored per-user message: TechSupport pre-signs a welcome *template* once
  with its key; the client renders it locally and verifies the signature. Real authorship, zero
  server storage, works while TechSupport's device is offline.
- **Known-question answers** ride the same trick — a signed, content-addressed FAQ bundle
  distributed over the existing libp2p/IPFS path (spec §25); clients answer locally from a cached
  bundle. The relay stores at most a CID pointer.
- **New questions** are the only path that needs TechSupport actually online. When its device is
  away, the question waits in the existing offline mailbox
  (`talks-matching/05-mailbox-offline-response.spec.ts`) and is delivered on reconnect.
- **Cost of the model, recorded honestly:** new questions have unbounded latency (bounded by when
  a developer brings the TechSupport device up); the pre-signed template must be re-signed to
  change the greeting copy; and the deterministic `support_welcome_<userId>` message id that
  `e2e-stage-pipeline.ts:95-103` asserts on has to be reworked, since there is no longer a stored
  greeting message per user.

### Current state (K1–K3, K5, K6, L1, L2 complete; K4 scoped-but-deferred; K7 new)

K1, K2, and K3 (below) landed 2026-07-25/26 — see `docs/completed.md` and the three design notes
(`docs/design/techsupport-k1-design-note.md`, `-k2-`, `-k3-`) for the implementation record. K4's
fixture, K5 (fully, including its `answeredBy` question — resolved 2026-08-01), K6 (fully,
including its two stage1 tests), L1 (CRDT counter, including retiring the legacy-scalar fallback),
and L2 (device-side size-triggered prune + fold-aggregate retention, plus the extended
time/location/user size-report breakdown) have since landed too — see their `docs/completed.md`
entries and §L2's own 2026-08-01 decision note. What's left for the K/L series:

- K4: the `clearGunForStage3/4/5Spec` helpers exist and `talks-matching`/`isolated-01` are wired to
  them; ~174 call sites remain (stage2/3/4/5/mass/isolated-02). Scope reconfirmed 2026-08-01 as a
  **full** conversion (not a partial subset) — deferred to its own dedicated session, not a
  correctness gap (every site already gets a valid built-in TechSupport today).
- K7 (new 2026-08-01): TechSupport answer delegation — redirect a pending question to a trusted
  co-operator, relay their answer back through TechSupport. Needs an `[Opus]` design note before
  implementation; see §K7 for the scope already decided vs. what the design note still has to work
  out (chiefly: how a delegate's answer gets a real TechSupport signature on the way back).
- Key rotation tooling, the headless-agent run mode (K3-3's other half), and production key
  custody (K3-4) remain open — see K3's completed-entry "Open questions carried forward" in
  `docs/completed.md`.

### K1. Built-in identity + relay-light presence `[Opus]`

> **Complete 2026-07-25** — see `docs/completed.md`. Design note:
> `docs/design/techsupport-k1-design-note.md`. Contract doc amended.

### K2. Signed greeting without server storage `[Opus]`

> **Complete 2026-07-25** — see `docs/completed.md`. Design note:
> `docs/design/techsupport-k2-design-note.md`. Contract doc amended.

### K3. Developer login as TechSupport `[Opus]`

> **Complete 2026-07-26** — see `docs/completed.md`. Design note:
> `docs/design/techsupport-k3-design-note.md`. Contract doc amended.

### K6. TechSupport is unblockable / unfilterable `[Sonnet]`

> **Complete 2026-07-30** — see `docs/completed.md`. The talk-intake carve-out closed as not
> applicable (TechSupport neither sends nor receives talks per K5 — no reachable code path to
> guard); both stage1 tests (every block/filter route; maximally restrictive intake filters) done.

### K4. Every stage but stage0 loads a TechSupport-bearing snapshot `[Sonnet]`

**Requirement 2026-07-25: stage0 is the only place a database is built from scratch. Every other
E2E spec — staged or not — must start by loading a stage snapshot that already contains
TechSupport.** Scope decision: tighten the plan now, land it *after* K1–K3, because K1 changes
where the baseline comes from and doing the refactor first means doing it twice.

**Audit (2026-07-25).** Every spec technically sees a TechSupport today, but it comes from
`seedTechSupportRootBaseline()` (`tests/e2e/helpers/clear-database.ts:110`) — a hand-built graph
constructed in code, not a loaded stage. `maybeClearGunDatabases()`
(`clear-database.ts:60`) wipes and re-seeds it even under `E2E_STAGE_PIPELINE=1`, so the
`_setup/load-stage{2,3,4}.setup.ts` imports are thrown away by the first spec's `beforeAll`.

| Location | `maybeClearGunDatabases()` call sites | Loads a stage snapshot? |
|---|---|---|
| `staged/stage1-single-user/` | 0 (uses `clearGunForStage1Spec`) | ✅ stage0 |
| `staged/stage2-two-user/` | 15 | partly — 127 via `clearGunForStage2Spec` |
| `staged/stage3-three-user/` | 128 | ❌ |
| `staged/stage4-four-user/` | 3 | ❌ |
| `staged/stage5-multi-user/` | 13 | ❌ |
| `talks-matching/` | 36 | ❌ |
| `mass/` | 9 | ❌ |
| `isolated/` | 6 | ❌ |
| `topology/`, `cross-platform/`, `embedded-node/` | 0 | ✅ stage2 |
| `platform-smoke/` | 0 | ✅ stage1 |

**Baseline source — decision: commit a verified stage0 fixture.**

- Check a validated `tests/e2e/staged/snapshots/stage0.fixture.json` into the repo; every reset
  path restores that file instead of constructing a graph in code. One definition of the built-in
  TechSupport, no drift.
- This is what makes the default parallel run work: `npm run test:e2e` `testIgnore`s
  `stage0-bootstrap/`, `_setup/`, and `aaa-`/`zzz-` specs, and each worker owns an isolated Gun
  server, so there is no generated stage0 snapshot to load there. A committed fixture is available
  to every worker with no extra boot cost, in both the pipeline and parallel runs.
- Per-worker snapshots stay generated as today; the fixture is the seed they derive from.
- `stage0-bootstrap/zzz-save-stage0.spec.ts` becomes the fixture's regeneration path — add a
  documented command to refresh it, and a check that fails if the committed fixture no longer
  passes `assertStageSnapshotIntegrity`.

**Work (in this order, after K1–K3)**

> Fixture + regeneration command, the shared baseline guard, and the contract-doc amendment are
> complete — archived in `docs/completed.md` 2026-07-26.

- [x] Added `clearGunForStage3Spec` / `4` / `5` mirroring `clearGunForStage2Spec`
      (`e2e-stage-pipeline.ts`) — each loads the prior stage's snapshot under
      `E2E_STAGE_PIPELINE=1`, falling back to a bare `clearGunDatabases()` otherwise, identical
      branch structure to the already-proven stage1/stage2 helpers. **Done 2026-07-30.**
- [x] Converted `talks-matching/`'s 36 call sites (12 files) and `isolated/isolated-01`'s 6 to
      `clearGunForStage3Spec` — the specific pair the "Still to do" note below called out as
      blocked on this helper existing. **Done 2026-07-30.** Verified: full `talks-matching/` suite
      run (12/13 green — the one failure is a pre-existing, unrelated `stopHubProcess` 403 in
      `07-mesh-ping-after-hub-stop.spec.ts`, confirmed present before this change too) plus
      `isolated-01` standalone (`E2E_RUN_ISOLATED=1`), both exercising the non-pipeline
      `clearGunDatabases()` fallback branch — the one actually reached by `run-test-all.sh` today,
      since neither directory's phase sets `E2E_STAGE_PIPELINE=1`. The pipeline-snapshot branch
      itself is unexercised in this session (same code shape as the proven stage1/stage2 helpers,
      but no run script currently drives these two directories in pipeline mode) — flagged
      honestly, not silently assumed.
      **Scope decision (2026-07-30, user-confirmed):** the remaining ~174 call sites — stage2 (15),
      stage4 (3), stage5 (13), `mass` (9), `isolated-02` (part of `mass`'s 9), and stage3 itself
      (128, largest) — stay deferred. Every one of these already gets a validated built-in
      TechSupport today via `seedTechSupportRootBaseline()` (fixture-backed); the deferred remainder
      is purely the *progressive multi-user snapshot* speed/realism shortcut, not a correctness gap.
      Revisit as its own scoped session if/when it becomes a priority.
      **Reconfirmed 2026-08-01:** convert **all** ~174 remaining sites, not a partial subset — do
      not cherry-pick just stage3's 128. Schedule as its own dedicated session rather than starting
      mid-session on other work (see the top-of-file session list).
- [x] Non-staged dirs decided: `talks-matching/` and `isolated/`'s three-real-user specs should
      target **stage3** (audited actual `bootstrapUser()` patterns — corrects the earlier "stage2"
      hunch, which undercounted); `mass/`'s (and `isolated-02`'s) ephemeral N-browser-loop specs get
      no benefit from any fixed-population stage and stay on the bare stage0 fixture. Recorded in
      `tests/e2e/staged/README.md`. 2026-07-27.

### K5. TechSupport DM Q&A: ignore talks, answer questions `[Opus]`

Decision 2026-07-25. Depends on **K2** (signed authorship) and **K3** (TechSupport client).
Verifiable entirely at **stage1** (one ordinary user + TechSupport).

> **All 6 work items + the full test list complete 2026-07-27/28.** The `answeredBy` open design
> question below is resolved 2026-08-01 — see its note for why multi-operator answering became its
> own item, **K7**, instead.

**Behavior**

1. **TechSupport ignores all talks.** It is never a talk recipient and never produces a response,
   match, or ignore. Enforced in the delivery/fanout path as a hard rule on the canonical root id
   — *not* as a `TalkIntakeFilters` entry, which is user-editable and would let TechSupport be
   filtered back in. TechSupport still counts as 1 in every headcount (unchanged).
2. **TechSupport answers questions over DM**, in the support conversation `conv_support_<userId>`.
3. **Known question ⇒ automatic answer.** On an incoming support message, normalize the question
   and look it up; on a hit, reply immediately, signed by TechSupport.
4. **New question ⇒ queued for a human.** On a miss, acknowledge to the user that it's a new
   question, and file it in a pending inbox a developer logged in as TechSupport can see and answer.
   Answering both delivers the reply and promotes the pair into the answered store, so the next
   asker is auto-answered.

**Data model (proposed)**

- **FAQ bundle** — signed by TechSupport, content-addressed, published over the existing
  libp2p/IPFS path (spec §25); relay stores at most the CID pointer. Entries:
  `{ questionKey, canonicalQuestion, answer, answeredAt }`. Clients cache the bundle and
  auto-answer **locally**, so known questions work even while TechSupport's device is away.
- **Pending inbox** — lives on the **TechSupport device**, not the relay. A miss is delivered as an
  ordinary P2P DM; if TechSupport is offline it waits in the existing offline mailbox and lands on
  reconnect. Entry: `{ questionKey, question, askedBy, conversationId, askedAt, status }`.
- `questionKey` = content hash of the normalized question; reuse the
  `src/shared/talk-content-id.ts` hashing pattern rather than inventing a second one.
- Normalization v1: trim, lowercase, collapse whitespace, strip trailing punctuation.
  **Exact normalized match only** — fuzzy/semantic matching is explicitly out of scope for v1.
- Deterministic message ids (`support_auto_<userMessageId>`, `support_answer_<questionKey>`) so
  replays are idempotent. Every answer is signature-verified before render, per invariant 4.
- **Privacy note:** publishing the FAQ bundle makes answered questions public to every client.
  Answers must be written as generic FAQ entries; never promote a question containing the asker's
  personal detail verbatim. Add this as a rule in the answering UI.

**Work**

> Items 1–5 of 6 (hard-exclude from talk delivery, question normalization + FAQ lookup, the K5
> design note, the signed FAQ-bundle module, the live hit/miss DM wiring, and the support-inbox
> answer/publish action) are complete — archived in `docs/completed.md` 2026-07-25/26.

- [x] Item 6 tests: `stage1/09-support-faq-reask-no-duplicate.spec.ts` (a known question is still
      auto-answered after TechSupport's browser context closes for good, and re-asking it does not
      create a second FAQ bundle row or regress the inbox entry off `answered` — confirmed by
      `handleSupportQuestion`'s `known` branch never calling `postSupportQuestionToMailbox`);
      `stage2/00l-techsupport-faq-cross-user.spec.ts` (a second, unrelated ordinary user is
      auto-answered the same question with zero TechSupport involvement in their own turn, proving
      the FAQ bundle is genuinely global). Both pass. 2026-07-27.

**Tests**

- [x] Test: `stage1` — user broadcasts talks to Global; TechSupport's IN index stays empty, Global
      headcount stays 2 — `10-techsupport-ignores-broadcast-talks.spec.ts`. Covers tag + flow, not
      all four types (see the spec's honest scope note: `acceptsIncomingTalks(userId)` takes only a
      user id, no talk-type parameter, so two types already exercise every code path the invariant
      depends on). Running it surfaced a stronger guarantee than documented: the *sender's own*
      receiver-resolution excludes TechSupport ("no receivers resolved"), not just the
      receiver-side `acceptsIncomingTalks` check — contract doc updated to record this. 2026-07-28.
- [x] Test: `stage1` — user DMs a brand-new question: receives the "new question" acknowledgement
      (`06-support-new-question-ack.spec.ts`), and the TechSupport client shows exactly one pending
      entry, asserted against the TechSupport device's own rendered UI, not a server snapshot
      (`07-support-inbox-answer-flow.spec.ts`).
- [x] Test: `stage1` — ask a new question with the TechSupport client stopped; start it; the
      question arrives from the offline mailbox and appears in the inbox — this is exactly
      `07-support-inbox-answer-flow.spec.ts`'s flow (the asker's question is sent before TechSupport
      ever boots in that test).
- [x] Test: `stage1` — with TechSupport stopped, a *known* question is still auto-answered from the
      cached FAQ bundle — `09-support-faq-reask-no-duplicate.spec.ts`.
- [x] Test: `stage1` — dev logs in as TechSupport (K3), sees the pending question in the support
      inbox, answers it; the asking user's support conversation receives the answer, the inbox entry
      flips to answered, and `techsupport-faq/<key>` now holds the pair —
      `07-support-inbox-answer-flow.spec.ts`.
- [x] Test: `stage1` — the same user asks that question again: auto-answered with no new inbox
      entry and no duplicate FAQ row — `09-support-faq-reask-no-duplicate.spec.ts`.
- [x] Test: `stage2` — a *different* user asks the same question and is auto-answered without any
      developer involvement — `00l-techsupport-faq-cross-user.spec.ts`.
- [x] Test: each spec gets its companion `.md` (execution rule 2); assert via hard signals — all six
      K5 specs (06, 07, 09, 00l, plus 00k's mute-flow ack check) assert via DOM/Gun state, never
      toasts. (The `.conversation-list-item` signal named in the original rule doesn't apply here —
      K2's archived entry already found the Me tab has no conversation-list UI; a contact click
      lands on the DM conversation directly.)

**Open question — resolved 2026-08-01.** Today there's exactly one operator (Bernard), so a plain
`answeredBy` field on the direct login-as-TechSupport path has nothing to disambiguate — not
implementing it. Multi-operator answering instead becomes its own feature, **K7** below, because
"redirect to someone else, then relay their answer back through TechSupport" is a materially
different flow (and audit need) than "record which of several people is logged into the one
TechSupport account right now."

---

### K7. TechSupport answer delegation: redirect a question, relay the answer back `[Opus]`

Decision 2026-08-01, arising from K5's `answeredBy` open question. Not yet designed at the code
level — needs a design note (per the model-routing legend) before implementation.

**Motivation.** The primary operator (Bernard) won't always be the right person to answer a queued
question. Rather than making them the sole bottleneck, TechSupport needs a way to hand a pending
question to someone better positioned to answer it, then get that answer back to the original
asker — still delivered and signed as TechSupport, never exposing the delegate's own identity to
the asker.

**Decisions made (scope, not implementation):**

- **Redirect targets are a fixed, pre-designated pool of trusted co-operators** — not arbitrary
  app users chosen ad hoc. Needs a place to store that pool (a new Gun path, e.g. something like
  `techsupport/delegates/<userId>`, or a config list — the design note picks one).
- **Built-in redirect UI, not a manual copy-paste workaround.** The support-inbox view gets a
  "redirect to…" action: choosing a co-operator delivers the question into *that person's own*
  inbox (their normal DM inbox, or a dedicated delegate-inbox view — design note decides which);
  they answer there as themselves; their typed answer is then auto-relayed back to the original
  asker's support conversation *through TechSupport*, with no manual step in between.
- **The relayed answer must still be a real TechSupport-signed message** (invariant 4: every
  answer is signature-verified before render). Only the device holding TechSupport's private key
  can produce that signature, so the design note must work out the actual mechanic — e.g. the
  delegate's answer text is submitted back to whichever device is logged in as TechSupport (K3),
  which is what actually signs and sends it to the asker. This is the key open design question:
  the delegate cannot sign as TechSupport themselves, so "relay back" is not just a UI redirect,
  it's a real second hop through the TechSupport identity.
- **Internal audit trail, external anonymity preserved.** The system records which delegate
  actually answered (something like `redirectedTo` / `answeredByDelegate` fields on the FAQ/inbox
  entry) so quality issues or bad answers can be traced back internally — but the asker's own view
  never shows anything but "TechSupport" replied, matching K5's existing privacy posture.

**Not yet decided (belongs in the design note):**

- Exact data model for the delegate pool and the redirect/relay records.
- Where the redirect UI lives (support-inbox view extension vs. a new view).
- Whether a redirected question still counts toward the same FAQ-bundle auto-answer mechanism K5
  built (i.e. does a delegate's answer get published into the public FAQ bundle the same way a
  direct TechSupport answer does, so the next asker of the same question is auto-answered?).
- Whether a delegate needs any special account flag/role, or is just an ordinary user whose id
  happens to be in the pool.

---

## L. Room metrics: counter correctness + data retention `[Opus]`

Audit 2026-07-25. The three badges on every chatroom row are 👥 active members (live, correct),
🚪 **lifetime** visits, and ◎ **lifetime** unique visitors. The two lifetime counters are wrong in
three independent ways and grow without bound.

### L1. The counters are unreliable `[Opus]`

Audit found three compounding bugs: lost updates from concurrent shared-scalar read-modify-write,
double counting from both server and client incrementing the same scalars, and a 700 ms timeout
that clobbered a real count with `1`.

> **Fixed with a CRDT G-Counter** (each user owns a monotone slot; total = sum of slots, unique =
> count of non-zero slots) — pure module, server + client writers, legacy-room migration, and the
> `stage2/35-concurrent-visit-counter.spec.ts` E2E proof are complete and confirmed green —
> archived in `docs/completed.md` 2026-07-25.

- [x] Remove the legacy `visitCount` / `uniqueVisitorCount` scalars and the `visits/<eventId>`
      nodes once no client reads them. Blocked on the `max(new, legacy)` fallback in `getChatroom`
      being retired, which needs one full staged run to confirm nothing else reads the scalars.

> **Done 2026-08-01.** Retired the `max(new, legacy)` fallback in
> `ChatroomManager.getChatroom` (`src/server/services/chatroom-manager.ts`) — the response now
> comes straight from the G-Counter's `visitTotals()`. A research pass confirmed no client, E2E
> spec, or committed fixture (`stage0.fixture.json`) reads the legacy `visitCount`/
> `uniqueVisitorCount` scalars or writes `visits/<eventId>` any more (that write path was already
> removed per the L2 note above); `migrateLegacyVisitScalar` (the one-time slot-seeding migration
> from `recordVisit`) is unaffected and stays — it's the mechanism that makes the fallback safe to
> retire, not part of what's being retired. Confirmed via the full unit suite (91 suites, 1094
> passed, 0 regressions) plus a real staged E2E run: `stage2/35-concurrent-visit-counter.spec.ts`
> (2/2) and `stage1/00-ui-navigation-settings.spec.ts` + `stage2/01-login-two-users-headcount.spec.ts`
> (9/9). `techsupport-graph.ts`'s dev-only baseline graph still hardcodes the legacy fields but is
> unreachable from any E2E path (only `scripts/dev-techsupport-bootstrap.js` calls it) — left as is,
> outside this item's scope. Deleting already-written legacy Gun nodes from pre-migration rooms
> remains L2's reaper/retention-policy scope, not this cleanup's.

### L2. Nothing is ever trimmed `[Opus]`

Storage grows without bound, and the badge data is the worst offender:

| Path | Growth | Bounded? |
|---|---|---|
| `chatrooms/<id>/visits/<visitEventId>` | one node **per visit event**, forever | ❌ worst offender |
| `chatrooms/<id>/uniqueVisitors/<userId>` | one node per user per room, forever | ❌ (replaced by the G-Counter slot) |
| `chatrooms/<id>/visitCounter/<userId>` (new) | one node per user per room | ❌ but one node, not one per visit |
| `conversations/<id>/messages/*` | one node per message | ❌ |
| `talks/<id>` | one node per talk | expiry exists (`expiresAt`), no reclaim |

> Stopped writing the per-visit-event node, and read-only size instrumentation
> (`src/shared/graph-size-report.ts`, `GET /api/test/graph-size`) is complete — archived in
> `docs/completed.md` 2026-07-25.

> **Found during the 2026-07-29 docs consolidation: a worked-out answer to most of this already
> exists, unimplemented.** `docs/Gun-Database-Architecture.md` (merged into SRS §28) designs
> exactly the mechanism L2 is missing — a **tiered retention policy** (§28.8: cryptographic-root /
> mine-plus-pair-confidential / others'-public-bounded-TTL / session-ephemeral tiers, each with a
> stated TTL and re-fetch trigger) plus a **merkle-checkpoint pruning protocol** (§28.9: every N
> events/messages, write one signed checkpoint committing to the pruned range's content hashes;
> any peer can still get an O(log N) proof that a pruned item existed, without the storing device
> keeping it) that answers the tombstone question below directly — pruned data stays provable, not
> silently gone, so a peer that resurrects a stale copy on reconnect doesn't reintroduce a
> integrity gap. It was designed for ledger events and conversation messages specifically, not
> room-visit data, so applying it here is an adaptation, not a copy-paste.

- [x] ~~Run it against a real deployment and paste the numbers here~~ — no production deployment
      exists to measure, so Bernard's 2026-08-01 decision ships a sensible adjustable default
      (`DEFAULT_VISIT_COUNTER_MAX_SLOTS = 500`) instead of waiting on real numbers, the same
      "ship with example values, adjust later" precedent §28.9 itself used (N=100/K=50). The
      extended `graph-size-report.ts` (topLocations/topUsers/ageBuckets, this decision's item #1)
      is what future-you runs against a real deployment to tune that default, once one exists.
- [x] Decide whether the room-visit paths in the table above (`visits/<visitEventId>`,
      `uniqueVisitors/<userId>`, `visitCounter/<userId>`) fit into SRS §28.8's existing tier model
      as-is (they look closest to Tier 3 — other users' bounded-TTL public data) or need a
      dedicated tier of their own, then adopt the §28.9 merkle-checkpoint pattern for whichever
      of these paths ends up needing prune-with-provability rather than a hard delete.
- [x] Tombstone semantics: Gun is append-oriented and P2P, so a "delete" that a peer never sees can
      be resurrected on the next sync. SRS §28.9's checkpoint-commits-to-pruned-range design is the
      candidate answer (adopted for the ledger/messages it was designed for); confirm it (or an
      equivalent) before building a bespoke tombstone mechanism for room-visit data specifically.
- [x] Decide whether trimming is relay-side, device-side, or both. Under the P2P model the relay
      cannot be the sole authority — each device holds its own Gun graph. SRS §28.8's tiers are
      already framed per-device (each tier's TTL/retention is something each device decides for
      its own graph), which is a starting answer to this question too.

> **Decided by Bernard, 2026-08-01 — simpler than §28.9's merkle-checkpoint pattern, and
> deliberately so.** Room-visit data is Tier 3 (other users' activity, bounded-TTL cache), but
> unlike the ledger/messages it doesn't need provable pruning — nobody needs an O(log N) proof
> that a since-departed visitor once visited a room. So instead of adopting §28.9's
> checkpoint-then-prove machinery wholesale, L2 uses a lighter aggregate-fold: **prune by time by
> default** (oldest `lastVisitedAt` first once a room's live slot count crosses a threshold —
> `DEFAULT_VISIT_COUNTER_MAX_SLOTS = 500`, adjustable), and **tombstone by folding**, not by
> checkpoint: each pruned slot's `count` is summed into a small per-room aggregate
> (`chatrooms/<id>/visitCounterPruned` = `{count, uniqueCount, lastPrunedAt}`) *before* the slot is
> deleted, so `visitTotalsWithPruned()` keeps the lifetime `visitCount`/`uniqueVisitorCount` badges
> numerically identical across a prune — "a simple algorithm that saves how many users are deleted
> is enough," not per-user history forever. **Trimming is device-side and symmetric**: the P2P
> model has no relay-is-authoritative special case, so the server (`ChatroomManager.
> pruneVisitCounterIfNeeded`, fired from `recordVisit`) and every browser (`WebChatroomService.
> pruneVisitCounterIfNeeded`, fired from `recordRoomVisit`) each run the identical prune check
> against their own local Gun graph, sharing one pure module (`src/shared/visit-counter.ts`
> `planVisitCounterPrune`/`foldSlotsIntoPrunedAggregate`). Implemented, unit-tested (prune
> selection, fold correctness, badge-invariance across a prune, and an end-to-end
> `chatroom-manager.test.ts` trigger test), and confirmed against a real staged E2E run
> (`stage2/35-concurrent-visit-counter.spec.ts`, `stage1/00-ui-navigation-settings.spec.ts`,
> `stage5/13-chatroom-scroll-and-broadcast-bar.spec.ts`).
>
> `src/shared/graph-size-report.ts` was also extended per item #1 of the same decision ("build
> size report tool based on time, location, event, or user ... so we know which take space and
> what to trim"): every category with a genuine per-room/per-user concentration now reports
> `topLocations`/`topUsers` (capped at 10, biggest first) and, where the node schema has a known
> timestamp field, an `ageBuckets` histogram (`under1d`/`d1to7`/`d7to30`/`d30to90`/`over90d`/
> `unknown`) off `GET /api/test/graph-size`. Categories with exactly one node per id (`users`,
> `user-public-profile`) deliberately have no breakdown — grouping by an id that already equals the
> node's own key finds nothing.
>
> **The "are the lifetime badges worth their cost" open question is resolved by this decision,
> not answered separately**: Bernard chose to keep the badges and prune the storage behind them
> rather than delete the feature, so this is now closed.

---

## Q/M. GUI graph-traversal model + Talks/Me/Contacts/Settings compaction `[Opus]`/`[Sonnet]`

> **Complete 2026-07-30** — see `docs/completed.md`. Covers the `navigateToGraphNode(target)`
> dispatcher, its `GraphNodeTarget` discriminated union, all 17 build-order items, and every
> M1–M6 subsection (Talks/Me/Contacts tab layout simplification, Settings tab cleanup).

---

## N. DM notification, cross-tab "pick a conversation" affordance, talk-row traceback `[Opus]`

> **Complete 2026-07-30** — see `docs/completed.md`. N1 (clickable DM toast), N2 (`#dm-inbox-btn`
> cross-tab picker, including the multi-sender stage3 test), and N3 (talk-row person traceback)
> all done.

---

## O. Peer detail: exchanged talks as pickable DM context, not just one thread from scratch `[Opus]`

> **Complete 2026-07-30** — see `docs/completed.md`.

---

## P. Me tab: robust Q&A → source-talk traceback (no dead ends) `[Opus]`

> **Complete 2026-07-30** — see `docs/completed.md`.

---

## R. Fast-first-render as a general principle for every long list, not just Contacts `[Sonnet]`

> **R1/R2/R3 complete 2026-07-31** — see their sections below and `docs/completed.md`'s eventual
> archive entry. R4/R5 stay low-priority/no-immediate-work, as already noted in their own
> sections; not part of this pass.

Requirement 2026-07-29 (Bernard): loading 500 contacts is too slow; there should be a way to get
the first few contacts and display them ASAP, with the rest retrieved quietly in the background —
**and this should be a general principle across every long-list view, not a one-off fix for
Contacts.**

**Audit (2026-07-29): every unbounded list in the UI layer shares this shape to some degree.**
Contacts (R1) is the worst case (a genuine blocking pre-render chain *and* no pagination) and was
audited first; Talks (R2) and Me/Answers (R3) share the no-pagination half without the blocking
chain; chatroom members (R4) already do part of the right thing; conversations/support-inbox (R5)
are the same shape of risk for whenever they carry real volume. One shared pattern should cover
all of them rather than five independent one-off fixes — see "Recommended approach" below.

### R1. Contacts tab (original audit)

**Audit (2026-07-29).** Confirmed both halves of the complaint are real and separable: a genuine
pre-render blocking chain, and a single-pass full-list render with no pagination.

- **Nothing renders until an async chain up to ~3.2s resolves — this is the real "too slow."**
  `displayContactsList()`'s `try` block (`contacts-view.ts:604`) first `await`s
  `runBeforeRender(deps)` (`contacts-view.ts:73-79`, races `deps.beforeRender()` against a 1200ms
  timeout), whose `beforeRender` (`ui-manager.ts:1890-1893`) does, **sequentially**:
  `await this.contactPreRenderSync()` — `app.ts:769-771` → `syncDirectPairTalkExchangesForContacts()`
  (`app.ts:2999-3070`), which under mesh delivery does `Promise.all` over **every peer**, each
  involving a Gun `.map().once()` read per created talk with a **350ms** settle timeout
  (`app.ts:3028-3043`) — then `await this.prefetchPeerLocations(...)` (`ui-manager.ts:670-677`,
  races its own `Promise.all` against a 2000ms timeout). Only a static "loading" placeholder
  (`contacts-view.ts:601`) shows during all of this — no row, not even one, appears until both
  awaits resolve.
- **Once that chain resolves, all 500 rows render in one synchronous pass anyway.**
  `visiblePeers` is built via a single `.filter().sort()` over the *entire* peer array
  (`contacts-view.ts:672-711`, no early-exit or limit), then written in one shot:
  `listEl.innerHTML = supportRow + visiblePeers.map(...).join('')` (`contacts-view.ts:742-767`) —
  every row is stringified and handed to the DOM at once, regardless of list size.
- **The heavy-user stress spec already exercises exactly this scenario, but only checks
  correctness, not speed.** `tests/e2e/mass/04-heavy-user-gui-stress.spec.ts` seeds `NUM_CONTACTS =
  500` (line 11). Its timing instrumentation (`warnIfSlow('contacts render', contentMs, 10_000)`,
  line 311) only `console.warn`s — it never fails the test — and the one contacts-tab count
  assertion has a `catch` that logs a warning on timeout rather than failing
  (lines 239-249). **No test today enforces any time-to-first-render bound**, so this regression
  could get worse again without anything going red.
- **A "render page 1 now, load more on demand" precedent already exists in this codebase — just
  not applied to Contacts.** The Talks tab's Replies panel uses exactly this shape:
  `CREATOR_REPLY_PAGE_SIZE = 25` (`ui-manager.ts:191`), a `creatorReplyVisibleCount` counter
  (`ui-manager.ts:320`), `filtered.slice(0, this.creatorReplyVisibleCount)` for the render
  (`ui-manager.ts:2898`), and a `#reply-load-more` button that bumps the counter and re-renders
  (`ui-manager.ts:2935-2941`). **Note the irony:** this is the same panel M1 disables — but the
  *pattern* it uses (slice-first-N + load-more) is exactly the missing piece for Contacts,
  independent of that panel's own fate.
- **Interaction with M6, worth flagging now before that item is built:** M6 proposes a new
  `prefetchPeerHeadshots` batch-fetch modeled on `prefetchPeerLocations`, called at the same point
  in `beforeRender` — if implemented as another blocking `await` in that same chain, it would make
  *this* problem strictly worse, not better. M6's implementation should land after (or be
  redesigned alongside) this item's non-blocking-render split, not before it.

**Work**

> **Complete 2026-07-31.** All items below done — see `docs/completed.md` for the full
> implementation record. Shared helper: `src/web/ui/render-list-progressively.ts`
> (`renderListProgressively`), reusable as-is by R2/R3.

- [x] Split `displayContactsList()`'s render into two phases: render `visiblePeers.slice(0, N)`
      (first-chunk size to be decided, e.g. matching `CREATOR_REPLY_PAGE_SIZE`'s precedent of 25,
      or a smaller "above the fold" count) **without waiting on `runBeforeRender`'s awaits**, then
      run `contactPreRenderSync`/`prefetchPeerLocations` in the background and re-render/append the
      remaining peers once they resolve — mirroring the existing Replies-panel slice pattern
      (`ui-manager.ts:191,320,2898,2935-2941`), just applied here for the first time.
      **Done.** `renderContactsListCore` now runs synchronously (no `beforeRender` await inside
      it) and is called twice per `displayContactsList` invocation: immediately, then again after
      the background enrichment chain resolves. `CONTACTS_FIRST_CHUNK_SIZE = 25`, matching the
      Replies-panel precedent.
  - [x] Decided: automatic quiet background fill, no manual button — matches the requirement's
        own wording ("retrieved quietly in the background"), not the Replies panel's manual
        load-more (that panel's *pattern*, not its manual-button UX, was the reusable part).
- [x] Make sure the first-chunk render doesn't depend on `contactPreRenderSync`/
      `prefetchPeerLocations` data at all for its basic fields (name, sort key) — only badges/
      distance/etc. that genuinely need that data should update in place once it arrives, so the
      first chunk is a real fast-path, not just a smaller version of the same blocking wait.
      **Done** — the first `renderContactsListCore` call runs before `runBeforeRender` is even
      called; the second call (after enrichment) re-derives and re-renders from scratch rather
      than patching in place, so newly-discovered contacts (not just enriched badges) appear too.
- [x] Revisit M6's `prefetchPeerHeadshots` design in light of this: it should follow the same
      non-blocking, fill-in-place pattern as the location/mesh-sync data once this item lands, not
      add a third sequential blocking `await` to `beforeRender`.
      **Already correct** — M6's `resolvePeerHeadshot` (`ui-manager.ts`) was already implemented
      non-blocking, with its own comment citing this exact concern; no change needed here.
- [x] Add a real timing assertion to (or alongside) `04-heavy-user-gui-stress.spec.ts` — the
      existing `warnIfSlow`/`catch`-and-log checks should gain a hard time-to-first-row bound (e.g.
      "first contact row visible within Xs of navigating to Contacts, with 500 seeded contacts"),
      so this can't silently regress again the way it did before this requirement was raised.
      **Done.** `FIRST_ROW_BOUND_MS = 500` (`expect.poll`, hard-failing, not advisory); the
      previous single-snapshot contact count is now a hard `toBeGreaterThanOrEqual(NUM_CONTACTS)`
      poll too, not just a `console.warn`. Verified via the stash pattern: fails reliably at
      ~1950ms without the fix (dominated by `prefetchPeerLocations`'s own 2000ms race timeout),
      passes reliably at ~400ms with it.
- [x] Test: `stage5`/`mass` — with 500 seeded contacts, the first chunk of rows is visible well
      before `contactPreRenderSync`/`prefetchPeerLocations` would have resolved (assert on wall
      time, not just eventual correctness); the remaining ~475 rows appear shortly after, without
      the user having to do anything if "automatic quiet fill" is the chosen design.
      **Done** as the timing assertion above (`04-heavy-user-gui-stress.spec.ts`), plus new unit
      coverage: `render-list-progressively.test.ts` (6 tests, the helper in isolation) and three
      new tests in `contacts-view.test.ts` (first chunk renders before `beforeRender` resolves; no
      dropped/duplicated rows across the two `renderContactsListCore` passes; a deferred-remainder
      row is clickable via the delegated listener). A real bug surfaced and was fixed while
      writing these: the delegated click listener originally closed over `deps` at bind time,
      so a later render with a fresh `deps` object would silently keep calling the first
      render's stale callback — fixed by stashing the current `deps` on the element and reading
      it at click time.

### R2. Talks tab main list (`#talks-list`)

- **Audit (2026-07-29).** `displayTalksList()` (`ui-manager.ts:2190`) has **no blocking pre-render
  chain** — it's a fully synchronous function, called directly from the nav click handler with no
  `await` in between (`ui-manager.ts:1706-1707`). But it shares Contacts' other half of the
  problem: single-pass, no pagination. `filteredOutEntries`/`inEntries` are each `.map(...).join('')`'d
  in full (`ui-manager.ts:2445-2448,2634-2636`) and written in one `innerHTML` assignment
  (`ui-manager.ts:2666`) — no `slice`/`PAGE_SIZE`/`visibleCount` guard anywhere in this function,
  unlike the Replies panel one screen above it. Realistic scale: grows with how many talks a user
  has broadcast/received over time (not user-count-bounded) — dozens to low hundreds for an active
  user in practice, 500 only under the stress spec. `04-heavy-user-gui-stress.spec.ts`'s
  `warnIfSlow('talks render', contentMs, 5000)` (line 268) is advisory-only, same as Contacts.
> **Complete 2026-07-31.**

- [x] Apply the same slice-first-N + quiet-background-fill treatment as R1, using whatever shared
      helper R's "Recommended approach" below lands on.
      **Done.** `renderOutRow`/`renderInRow` extracted from the old inline `.map()` callbacks and
      passed to `renderListProgressively`, applied per view mode: `'out'`/`'in'` render straight
      into `#talks-list`; `'all'` splits into two sub-containers (`#talks-in-section`/
      `#talks-out-section`) so one section's deferred remainder can never clobber the other's
      already-rendered rows. `TALKS_FIRST_CHUNK_SIZE = 25`, same precedent as Contacts.
      Per-row click listeners (row click, matched/sender-people click) replaced with one
      delegated listener bound once on `#talks-list`, same reasoning as R1 — a row landing in
      the deferred remainder needs to be interactive with nothing to re-attach. Unlike R1's
      `deps`-closure bug, there was no stale-closure risk here (the handler reads off `this`,
      not a per-call plain object) — but `getMyTalks()` is still re-read at click time rather
      than closed over, for the same "always current" reason.
      **Honest scope note, unlike R1:** Talks never had a genuinely blocking pre-render chain
      (confirmed by the audit above), so — verified empirically via the stash pattern — a
      first-row timing bound here does *not* cleanly separate fixed-vs-broken the way it did for
      Contacts: both versions render all 500 rows in ~150-200ms in this test environment, since a
      single large synchronous `innerHTML` write was already fast enough here. The bound is kept
      as a forward-looking perf budget (would catch a *future* blocking chain), not as proof of
      *this* fix.
      **A real bug found and fixed by the new E2E test, not just theorized:** the `'out'`-only
      view-mode branch's `renderListProgressively` call was missing the `isStale` guard (present
      on the other three call sites) — caught by deliberately breaking the guard and confirming
      `80-talks-list-progressive-render.spec.ts` failed with 100 rows instead of 40 (5 rapid
      re-renders × their deferred remainders all applying instead of only the latest); fixed by
      adding the missing `isStale`, confirmed the test then passes cleanly and reliably (4/4).
- [x] Test: `stage5`/`mass` — with 500 seeded talks, the first chunk of OUT+IN rows is visible
      immediately on opening the Talks tab; the rest fills in without blocking the tab.
      **Done:** `04-heavy-user-gui-stress.spec.ts`'s Talks-tab block gained the same hard
      first-row/full-count polling upgrade as Contacts (see the scope note above on what it does
      and doesn't prove here). Correctness under rapid re-renders — the actual risk this kind of
      chunking introduces — covered instead by the new
      `stage1-single-user/80-talks-list-progressive-render.spec.ts` (3/3 stable), plus an 11-spec
      Talks-tab E2E regression sweep (row click, matched/sender-people click-to-DM, tag
      checkboxes, broadcast toggle, remove, details popup, survey stats, filter/sort) all green.

### R3. Me tab Answers list

- **Audit (2026-07-29).** Same shape as R2: `displayAnswersList` (`answers-view.ts:337`) has no
  `async`/`await` at all, called synchronously from the nav handler (`ui-manager.ts:1716`) — no
  blocking chain. But both its row builders iterate the *entire* history array and
  `appendChild` per entry with no limit (`answers-view.ts:389,455`). Same advisory-only timing
  check exists (`warnIfSlow('me render', contentMs, 5000)`, `04-heavy-user-gui-stress.spec.ts:295`).
> **Complete 2026-07-31.**

- [x] Same slice-first-N + quiet-background-fill treatment, same shared helper.
      **Done.** Unlike R1/R2, both row builders used `document.createElement` +
      `appendChild` (DOM construction), not `.map().join('')` — converted to string
      templates (`data-xxx="..."` attributes instead of `.dataset.xxx =` assignments) so
      `renderListProgressively` could take over the write. `flattenedHistory`/`deduped` (the
      two possible sources — always mutually exclusive: `deduped` is empty whenever
      `flattenedHistory` is non-empty) unified into one tagged array (`FlatRow | LegacyRow`)
      so a single `renderListProgressively` call handles both, rather than two.
      `ANSWERS_FIRST_CHUNK_SIZE = 25`, same precedent. Four per-render listener bindings (row
      click, copy button, details button, and the empty-state preferences button — previously
      handled by two *different* mechanisms) replaced by one delegated listener bound once on
      the stable `#answers-content` container (not `#answers-list`, which gets recreated every
      render) — same `deps`-stashed-on-element fix as R1, since `ui-manager.ts` rebuilds a
      fresh `deps` object every call. New `onRowsRendered` hook on `AnswersViewDeps` fires
      after both the first chunk and the deferred remainder, since `applyMeAnswerFilter`
      (ui-manager.ts) only re-scans whatever `.answer-talk-item` rows exist in the DOM *right
      now* — without the hook, a filter set before the remainder landed would never reach the
      rows that arrived after it.
      **A real bug found by the E2E regression sweep, not just theorized:**
      `29-me-answers-search.spec.ts` failed after the conversion — the new string-template
      row wrote `style="display:flex; ..."` (no space after the colon) verbatim into the
      attribute, whereas the old `item.style.cssText = ...` assignment went through the
      CSSOM and got re-serialized with `display: flex;` (with a space) on read-back, which
      the test's `[style*="display: flex"]` selector depended on. Fixed by writing the style
      string with normalized `key: value;` spacing throughout, matching what CSSOM would
      have produced.
- [x] Test: `stage5`/`mass` — with 500 seeded answers, the first chunk of entries is visible
      immediately on opening the Me tab; the rest fills in without blocking the tab.
      **Done:** `04-heavy-user-gui-stress.spec.ts`'s Me-tab block gained the same hard
      first-row/full-count polling as Contacts/Talks (same honest scope note: Me tab never had
      a blocking chain either, so this is a forward-looking perf budget, not proof of this
      specific fix). Correctness under rapid re-renders covered by 5 new unit tests
      (`answers-view.test.ts`, including one that deliberately exercises two rapid renders with
      *different* `deps` objects to prove the delegated listener reads the current one, not a
      stale closure) plus a new
      `stage1-single-user/81-answers-list-progressive-render.spec.ts` (4/4 stable), and a
      6-spec Me-tab E2E regression sweep (search filter, compact-row popup/copy, dead-end
      retry, per-question deep link, dialogs, copy-talk flow) all green.

### R4. Chatroom member list — lower priority, already partly right

- **Audit (2026-07-29).** `renderMemberList` (`chatrooms-view.ts:307`) is also single-pass
  (`container.innerHTML = sorted.map(...).join('')`, line 317, no pagination) — but it already
  does the *other* half of this principle correctly: per-member stats load asynchronously,
  non-blocking, **after** the row render (`void loadMemberStats(...)`, `chatrooms-view.ts:299`),
  not before it. Real scale ceiling is much lower than Contacts/Talks/Answers: room capacity is
  config-bounded (`CHATROOM_MAX_CAPACITY`, defaulting to 50 in e2e/local-loopback mode, 3 in bare
  production default — `src/shared/config.ts:36-39`, FIFO-enforced,
  `web-chatroom-service.ts:925-1004`). Worth bringing into line with the shared pattern for
  consistency once it exists, but not urgent — 50 rows doesn't need pagination the way 500 does.
- [ ] Low-priority follow-up: adopt the same shared helper if/when it exists, for consistency, not
      because 50 members is currently a real performance problem.

### R5. Conversations list / support-inbox list — same shape, flagged for later

- **Audit (2026-07-29).** Both `conversations-view.ts` (`conversationsList.innerHTML =
  conversationEntries.map(...).join('')`, lines 59-97) and `support-inbox-view.ts`
  (`container.innerHTML = ...entries.map(...).join('')`, lines 43-66) render full-list with no
  pagination — same shape of risk, currently low-volume in practice (`conversations-view.ts` is
  presently dead code per section N's audit; the support inbox is a TechSupport-operator-only
  surface, not a per-user list). Flagged here so whichever of N2 (reviving `#conversations-list`)
  or ordinary growth of the support inbox happens first picks up the same convention from the
  start, instead of needing its own retrofit later.
- [ ] No immediate work item — apply the shared helper if/when N2 revives `#conversations-list`,
      or if the support inbox's entry volume ever grows enough to matter.

### Recommended approach: one shared helper, not five one-off fixes

Two different ad hoc patterns already exist for pieces of this (Replies panel's
`PAGE_SIZE`/`visibleCount`/load-more slice, chatroom members' render-then-enrich-non-blocking) —
neither is shared, and R1-R3 each need both halves combined. Following the same reasoning Q used
for `navigateToGraphNode` (build one small shared piece of infrastructure once, rather than each
view reinventing it slightly differently):

- [x] Extract one small shared helper — e.g. `renderListProgressively(container, items, {
      firstChunkSize, renderRow, onFirstChunkRendered? })` — that does exactly the R1 two-phase
      split (slice first N, write it immediately, then process the rest off the main blocking path
      and append/patch in place) and use it for R1 (Contacts), R2 (Talks), and R3 (Answers) rather
      than three separate implementations. R4/R5 can adopt it later without urgency.
      **Done 2026-07-31:** `src/web/ui/render-list-progressively.ts`. Signature ended up slightly
      richer than the sketch — also takes `prefixHtml` (for Contacts' pinned TechSupport row) and
      an `isStale`/`scheduleRemainder` pair (staleness guard + test-injectable scheduler) — but
      the core shape (slice-first-N, defer remainder, append not replace) is exactly this.
- [x] Land this helper alongside (or as part of) R1's implementation, since R1 is first in Q's
      build order and needs the most complete version of it (first-chunk render decoupled from a
      genuinely blocking prefetch chain, not just decoupled from a big array).
      **Done** — landed as part of R1, see R1's Work section above.
- [x] Test: unit test for the shared helper itself (first-chunk-immediate, remainder
      deferred/appended, no item duplicated or dropped across the two phases) — one test giving
      confidence to all of R1-R3 rather than duplicating the same assertion three times.
      **Done:** `src/test/unit/render-list-progressively.test.ts`, 6 tests.

> **R1, R2, and R3 all complete** (see their sections above) — R2 needed the click-delegation
> conversion too, not just the `.map().join('')` swap, since per-row listeners wouldn't reach a
> row in a deferred remainder; R3 needed the same plus converting its DOM-construction
> (`appendChild`) row builders to string templates first. R4/R5 remain explicitly
> low-priority/no-immediate-work per their own sections above — not part of this pass.

---

## S. Adopt merkle-checkpoint pruning for the ledger and conversation messages `[Opus]`

Found during the 2026-07-29 docs consolidation, reviewing the newly-merged SRS §28 against this
file: the interaction ledger (`ledger/<userId>/events/*`, live per `docs/completed.md`'s Phase E
entries — `WebLedgerService.writeIndexes`/`broadcastState`/`subscribeToInbox`) and pair-conversation
messages (`pairConversations/<pairId>/<convId>/messages/*`) both grow **without any pruning
mechanism at all** today, and a complete design for one already exists in the spec, unimplemented.

- **The growth is real, not hypothetical — the spec's own sizing formulas say so.** SRS §28.7's
  storage-scenario table: a "power user" (200 talks, 50 conversations × 200 messages) already
  reaches **~10.2 MB**; the stated "degenerate case" (1,000+ concurrent conversations) reaches
  **~97 MB**, and extrapolating to 10,000 conversations reaches **~960 MB** — "approaching or
  exceeding typical browser IndexedDB limits (50–250 MB common practice, 2 GB maximum)." The
  dominant term (`S_messages = C × n_avg × 800B`) scales with conversation count × message count,
  unbounded, with nothing in the shipped code trimming it.
- **A full pruning design already exists (SRS §28.9), unimplemented:** every N=100 ledger events
  (or K=50 conversation messages), write one signed **merkle checkpoint** committing to the
  content-hashes of the range being pruned; any peer can still get an O(log N) proof that a pruned
  event/message existed (and, for messages, that its ciphertext had a specific hash at commit
  time) without the pruning device keeping the raw data. §28.9.5's own numbers: ~99% size
  reduction for pruned ledger ranges, ~99% for a longer-lived power user's message history
  (97 MB → ~9.9 MB in the worked example).
- **This is not the same scope as L1/L2** (which are specifically about room-visit/headcount
  badge data) — this is the core ledger + messaging data path, a larger and arguably
  higher-priority gap since it's what the §28.7 sizing formulas show actually dominates storage
  growth at scale.

> **Design note complete 2026-07-31:**
> `docs/design/section-s-merkle-checkpoint-pruning-design-note.md`. Per this file's own
> model-routing legend, an `[Opus]` item gets a design note before implementation — this is that
> note, grounding SRS §28.9's design in the actual current code (which the spec text doesn't
> reference). Two corrections to the spec found while writing it, worth reading before
> implementing: (1) the ledger is currently write-mostly with **no external readers** — pruning's
> live-UI blast radius is much smaller than the spec's abstract description implies; (2) the
> message retention window (K_retain=200) is already compatible with the existing Phase 5
> reconciliation bound (`DEFAULT_RECONCILE_WINDOW=500`), not a new constraint. Also surfaces a real
> gap in the spec itself, not just an implementation detail: a checkpoint's merkle root cannot
> regenerate a lost leaf id, so the full leaf-id (ledger) / leaf-hash (messages) array must be
> retained on the checkpoint node itself for proofs to remain buildable after pruning — this
> changes the ~256B ledger-checkpoint size SRS §9.5's savings table assumes (the message case
> already budgets for a comparable list). Implementation (Items 0–7 in the design note) not yet
> started.

**Work**

- [x] Implement `CHECKPOINT_CREATED` as a new ledger event kind (SRS §28.9.2) — merkle root over
      the sorted CIDv1 array of the pruned range, SEA-signed, chained via `prev` like any other
      ledger event — and the corresponding pruning-window logic (keep the last M=500 events in
      full detail per SRS §28.9.2).
- [x] Implement the delta-sync protocol change SRS §28.9.6 requires: when a peer requests an event
      that's been pruned, return the merkle proof instead of the raw event node.
- [x] Implement the analogous message-checkpoint structure for `pairConversations/*/messages/*`
      (SRS §28.9.4 — commits to both message ids and ciphertext hashes; keep the last
      K_retain=200 messages per conversation in full detail).
- [ ] Decide the real numeric retention windows for production (SRS §28.9 proposes N=100/M=500 for
      the ledger and K=50/K_retain=200 for messages as starting points, not settled production
      values) — this is the one piece of the design that's a policy choice, not an implementation
      detail. **Still open — a decision for Bernard, not a coding task.**
- [x] Test: unit — a pruned range's checkpoint correctly verifies an O(log N) proof for an
      arbitrary event/message in that range, and rejects a forged proof.
- [x] Test: `stage2`/`stage3` — after enough messages/events to trigger pruning, older
      full-detail nodes are gone from local storage, the checkpoint exists, delta-sync between two
      peers still succeeds (one offering a proof instead of raw history), and message history still
      renders correctly in the UI up to the retention window.

> **Implementation complete 2026-08-01** (Items 0–7 of the design note, all but Item 5's own
> policy decision). Real E2E testing (`tests/e2e/staged/stage2-two-user/
> 30-ledger-message-pruning-e2e.spec.ts`) found and fixed **four real, previously-invisible
> bugs** the unit-level fakes couldn't catch: the ledger was completely inert in every E2E run
> since Phase E (a `DISABLE_HMR` gate), ledger event deletion never actually deleted anything
> (two separate causes — a flat-key `.put(null)` Gun rejects, then a `serializeDates` field-
> stripping bug), `getEventBySeq` silently broke every CID/signature verification it ever did
> (a date-coercion quirk), and the ledger's delta-sync inbox was permanently undiscoverable by
> any receiving peer (a flat-key-vs-nested-chain graph mismatch). Ledger checkpoint/prune/
> delta-sync (Items 1–3) is now solidly proven end to end across many real-browser runs.
> **One open gap remains, documented, not silently passing:** message-side pruning
> (Item 4) was found to be *unreliable* in a real browser — `prunedThroughCount` sometimes
> advances without the corresponding deletes landing — root cause not yet found; see the
> design note's own Item 7 "Done" note and the spec's own inline comments for the full
> investigation. Follow-up work, not blocking.

---

## T. Chatroom-hierarchy broadcast isolation leak: room-scoped mesh session gets stomped back to a stale boot-time room `[Opus]`

> **Complete 2026-07-30** — see `docs/completed.md`. Both root causes resolved; root cause #2
> was a test-helper issue (a shared E2E click-helper's Global-default fallback), not product code.

---

## U. Broadcast to a contact group, online or not, with deferred delivery `[Opus]`

Requested 2026-08-01. Today a user broadcasts a talk to a **chatroom** — the recipient set is
"whoever's in this room" (see `runBroadcastFromCurrentRoom`, `ui-manager.ts:1618`). This adds a
second broadcast entry point from the **Contacts tab**: pick a group of known contacts — *All*,
*Friend*, *Tennis Buddy*, etc. — and send to the whole group regardless of whether each member is
online right now. Members who are online get it immediately; members who aren't get it deferred,
delivered whenever they next come online, dropped if that never happens within a timeout.

**What already exists to build this on (research finding, not yet wired together):**

- `PeerMeshService.broadcastTalk()` (`src/web/services/peer-mesh-service.ts:482`) already accepts
  an explicit `recipientUserIds` list, not just "everyone in this room" — the room-broadcast path is
  one caller of a more general primitive, so a contact-group broadcast is a **second caller**, not a
  new delivery mechanism.
- That same call already floods the P2P mesh to whoever's online (`activeExpectedRecipients()`,
  line 736 — checks `GET /api/presence/nearby` plus live WebRTC neighbors) and falls through to
  `onMailboxFallback(...)` (line 615) for anyone who doesn't ACK in time — this fallback **is** the
  offline mailbox (`src/server/services/mailbox-store.ts`): SEA-encrypted, recipient-keyed,
  `MAILBOX_DEFAULT_TTL_MS = 48h` / `MAILBOX_MAX_TTL_MS = 72h` (server never sees plaintext), drained
  by the recipient's own client on its next boot/reconnect. **"Defer until online, drop after
  timeout" is already exactly what this store does** — nothing new to build for that half of the
  ask, only to reuse it for a bigger, deliberately-offline-inclusive recipient set instead of just
  the ACK-timeout stragglers from a live room broadcast.
- Contact data (`KnownPerson`, `src/shared/types.ts:22`) is written only via
  `WebUserService.putPrivateUserData()` — SEA-encrypted, client-only, per CLAUDE.md's private-data
  invariant. **Group membership is therefore resolved to a userId list entirely on the sender's own
  device** before any network call; the server and other users never see group membership, same as
  today's contact labels.

**What does not exist yet and needs building:**

- **A real "named group" concept.** `KnownPerson.label` (`RelationshipLabel` —
  `'friend'|'relative'|'coworker'|'acquaintance'|'partner'|'custom'`) is one enum value per
  contact, plus one freeform `customLabel` string used only when `label === 'custom'`. There is no
  arbitrary named group like "Tennis Buddy" as a first-class, independently-filterable value today
  — `customLabel` is free text, but the existing contacts-tab filter dropdown
  (`ui-manager.ts:961-969`, `contacts-view.ts:699`) only distinguishes the `custom` *bucket* as a
  whole, not by the specific text inside it. **Proposed (not yet decided):** treat every distinct
  non-empty `customLabel` value in use as its own selectable group — "Tennis Buddy" falls out of the
  existing field for free, no schema change, no new group-membership editor. The five built-in
  `RelationshipLabel` values double as built-in groups the same way. *All* = every known contact not
  currently blocked (`blockedUserIds` already exists and should obviously still apply).
- **A group-picker UI on the Contacts tab.** Nothing today lets a user pick a *set* of contacts or a
  named bucket and hand it to a send action — the closest analogs (single-select relationship
  filter dropdown for *browsing* the list; one-at-a-time block/unblock) aren't a multi-select-or-
  bucket send-target picker. Needs: a "Broadcast to…" action that lists All + every group in use,
  a preview of who's in it and who's currently resolvable-online vs. going to the mailbox (mirroring
  the existing room-broadcast preview modal's eligible/excluded split, `ui-manager.ts:6201`), then
  calls `broadcastTalk(talk, { recipientUserIds })` with the resolved list.
- **Per-broadcast timeout control.** The mailbox's TTL is a fixed constant today
  (48h default, 72h hard ceiling, not caller-configurable per envelope beyond that clamp). "Defer to
  a certain time" implies the sender might want to say *how long* to keep waiting (e.g. "by this
  weekend") — decide whether that's exposed to the sender at all for v1, or whether the existing
  fixed 48h/72h window is good enough to start.

**Open questions (decide before/while writing the design note):**

- Custom-label-as-group vs. a real first-class multi-tag system: is "one label per contact,
  bucketed by exact text" enough, or does a person eventually need to be in *more than one* named
  group (e.g. both "Tennis Buddy" and "Friend")? The current `KnownPerson.label` is single-valued,
  so multi-group membership is a bigger data-model change than the free-bucket proposal above.
  Deferring to v1-simplest (bucket by existing single label) unless this is confirmed to need
  overlap.
- Is the mailbox's existing fixed 48h/72h window an acceptable "certain time" for this feature, or
  does the sender need to pick their own wait window per broadcast? Affects whether v1 can ship
  with zero mailbox changes or needs a new per-envelope custom-TTL parameter.

This is `[Opus]`-tagged because both questions above are real data-model/UX tradeoffs, not
mechanical work — write a short design note first (per the model-routing legend), then hand the
group-picker UI and the `recipientUserIds` wiring to Sonnet.

---

## V. Auto Linear Capture: create/append a Talk from DM shorthand (FR-TK-7 — spec'd day one, never built) `[Opus]`

**Correction 2026-08-01: this is not a new idea.** It's `FR-TK-7`/`FR-TK-8`/`UI-1d`/§13.6/`TC-LIN-01`
in the original SRS, written on the project's first day (`projectplan.md`, commit `b24cdda8`,
2026-01-19) and still present verbatim in the current
`docs/specs/iinpublic-technical-specifications.md` (lines 364-369, 534, 1825-1850, 2219-2233, and a
traceability-table row pointing at a never-realized `AutoCapturePattern`/`src-shared/talks/TalkEngine.ts`)
— but never implemented against the current `src/shared`/`src/server`/`src/web` architecture.
There's even an abandoned prototype attempt: `src/examples/gun-react/{EnhancedEntity,ChatAI,Entity}.js`
(added 2026-02-15, "merged from 3 folders" — an earlier React+Gun experiment, not part of the
current build, no tsconfig/webpack reference) has its own hand-rolled regex,
`PatternQuestionWithOptions = /((.*?)(\x3F)+)((.*)(\x3B)+)*((.*?)(\x2E)+$)/`, and
`EnhancedEntity.autoCaptureTalk(message)` — but it's a single-question stub with no isMatch/isIgnore
tagging and no multi-line chaining, so it doesn't actually implement FR-TK-7/UI-1d's fuller behavior
even in its own limited scope. Historical reference only, not reusable code — it predates and
doesn't match the current `Talk`/`Question` model (`src/shared/types.ts`).

**What the original spec already says (FR-TK-7, FR-TK-8, UI-1d, TC-LIN-01) — this part is decided,
not open:**

1. In a DM chat, a line matching `Question? Answer1; Answer2; …; AnswerN.` renders the answers as
   tappable chips to the other person, instead of going out as a plain chat bubble.
2. Tapping a chip records that answer and either advances to the *next* such line the sender sends,
   or ends the flow — see the ordinal-position rule below for which.
3. A final plain sentence — ends with `.`, no `?`, no `;`-list — closes the capture and saves
   everything accumulated in that one session as a single **`flow`-type** talk draft
   (`FR-TK-8`: *"Route and survey talks MAY only be created or edited in the Talk Editor UI.
   Auto-captured chats produce flow talks only."* — my prior draft of this entry wrongly reasoned
   `survey` was the right type; corrected here).
4. `FR-TG-6`/`NFR-U-3`: the resulting draft must have the sender's tag/location preamble attached
   before it's eligible for bulk-send — same mandatory preamble every talk gets, auto-captured or not.
5. `TC-LIN-01`'s worked example: `Do you like coffee? Yes; No.` → recipient taps "Yes" → sender sends
   `Hot or iced? Hot; Iced.` → recipient taps "Iced" → sender sends `Great, let's meet tomorrow.`
   (no `?`, no `;`-list) → the two Q&A pairs save as one linear talk draft under the sender's talks.

**Simplified 2026-08-01 (Bernard, "keep it simple enough"):** the original §13.6 syntax required
explicit markers on every option — `**` prefix for "the sender's own default answer," `*` prefix for
"alternative option" (`** yes; * no; * maybe`). **Dropped.** No markers at all — plain
`Question? Answer1; Answer2; …; AnswerN.` — and match/ignore is decided by **ordinal position**: the
**first** answer is the one that continues the flow (`isMatch: true`, advances to the sender's next
captured line); **every other answer ends it** (`isIgnore: true` — the same outcome as tapping
"Ignore" anywhere else in a flow talk, per `FR-TK-5`/`checkIfIgnore`, `src/shared/talk-engine.ts:104`
— not special-cased, this is exactly how an ordinary flow question's Ignore branch already works).
No punctuation burden on the sender beyond writing the correct answer first; word order alone
encodes intent. This is now the v1 grammar — no longer an open question.

**Two different scenarios — both now decided, neither has an open identity problem:**

*(The "appending" scenario below grew, across two 2026-08-01 decisions, from "just the chat-append
case" into a general edit-mints-a-new-id policy — see the bullet for exactly what generalized and
what's still chat-append-specific.)*

- **Same-session chaining into a brand-new draft (FR-TK-7/TC-LIN-01, above): no identity problem.**
  Nothing is saved or hashed until the terminating plain sentence fires — the whole accumulated
  sequence becomes exactly one `Talk` with exactly one content-hash `id`, computed once, at the end.
  This is the plain-DM-thread case.
- **Appending to an *already-saved* talk later** (Bernard's clarification: "if it starts with an
  existing talk, it can append new question after a talk"), when the conversation is already scoped
  to that talk's thread — new territory the original SRS never addressed, but decided across three
  2026-08-01 passes, most recently: **editing a talk mints a new talk id, and the edited talk is
  then treated as a fully independent new `Talk`** — this generalizes past just the chat-append case
  to talk editing broadly. The scope ambiguity flagged in the prior pass is now resolved, and it
  turns out to already match existing code rather than needing new scoping logic: **title is not
  part of what triggers a new id — it's freeform.** Checked against `buildIdentityPayloadFromTalk`
  (`src/shared/cid.ts:218-258`), the function that computes a talk's content-hash id today: for a
  `flow`-type talk (the type this whole feature produces, per `FR-TK-8`) the hashed payload is only
  `{type, language, questions}` — `title` is only ever hashed for `type === 'tag'` talks (line 236),
  never for `flow`. So "new id on edit" cashes out precisely as **"new id whenever the edit changes
  `questions` (or `type`/`language`) — the fields already inside the identity hash"**; a pure
  title/tag/metadata edit keeps the same id, exactly as the hash function already implies. Nothing
  new to invent here, just wiring `updateTalk`'s save path to branch on it. **When a re-hashing edit
  happens, the old talk's fate is an option that defaults to delete** — ordinary users get
  delete-old-by-default; **advanced users can change that default to "keep" from the Settings tab.**
  This resolves the identity tension cleanly
  — no in-place mutation of an id other things already reference — and it's not a novel pattern for
  this codebase: it's the same shape of solution the ledger's response-versioning already shipped
  (commit `6591fcb2`, "P0 step 9" — "monotonic version bump on answer change (new responseId CIDv1,
  version+1); changed answer = new `TALK_ANSWERED` superseding prior, history kept"), just applied
  to talks instead of responses. This is a **behavior change to an existing, already-shipped code
  path**, not just new work for this feature — `WebTalkService.updateTalk(talkId, talkData)`
  (`web-talk-service.ts:289-326`) currently mutates an existing talk's `questions` *in place,
  keeping the same id* (the id is only content-derived at creation today, never re-derived on
  edit); this decision reverses that. Widening the blast radius honestly: every existing reference
  to a talk by its pre-edit id — past broadcasts, chatbot auto-answer CID/context-hash matching,
  `Message.talkId`-scoped threads already pointing at it — now needs to keep working (or gracefully
  degrade) after an ordinary Talk Editor save, not just after a chat-append. Concrete pieces none of
  which are built yet:
  - A new field linking the new talk to what it replaces — `Talk.supersedesTalkId?: string` —
    doesn't exist on `Talk` today (`types.ts:191-234`). Bernard: *"new talk can hold a reference to
    old talk in case that further work is needed"* — a provenance pointer for whoever needs to trace
    history later, not a functional coupling; the new talk otherwise stands alone as an ordinary
    independent `Talk`, same as `TALK_ANSWERED`'s superseding-but-independent pattern in the ledger.
  - A `deleteTalk` operation — doesn't exist anywhere in `WebTalkService` — now load-bearing as the
    *default* outcome of every re-hashing edit, not just an eventual nice-to-have.
  - The "keep the old one" alternative (the Settings-tab override) probably still wants the old
    talk marked inactive rather than left fully live under two ids at once — `Talk.expiresAt`
    (`types.ts:220`, doc comment: *"Once expired, talk is not sent automatically but can be
    re-activated"*) is the natural existing lever for that, reused rather than inventing a second
    disabled flag, but this needs confirming, not assuming.
  - A new Settings-tab preference (default: delete old talk on edit; advanced override: keep it) —
    no settings surface for talk-editing behavior exists today; needs its own small UI addition.

**Verified 2026-08-01: the two-author credit model Bernard described does not exist yet, and
directly interacts with the edit-mints-a-new-id decision above.** Bernard: *"each talk should have
two authors for credit system — the original author goes to the creator of the talk and never
changes again; a user edits an existing talk then he becomes the current author, overwrites the
previous one."* Checked against the actual code: `Talk` has exactly **one** author field,
`authorId` (`types.ts:194`), and today's two write paths disagree with each other in a way that
matches *neither* half of what's being asked for:
  - `WebTalkService.createTalk()` (`web-talk-service.ts:163`) sets `authorId` to whoever is
    creating the talk — the caller in `app.ts:4768` passes `authorId: this.currentUser!.id`.
  - `WebTalkService.updateTalk()` (`web-talk-service.ts:299`) explicitly **preserves the existing
    author forever** — `authorId: existing.authorId` — an edit never transfers it, which is the
    opposite of "the editor becomes the current author."
  - Under the newly-decided edit-mints-a-new-id flow (above), a content edit produces a fresh `Talk`
    through something `createTalk`-shaped — meaning, unless specifically wired otherwise, the new
    talk's sole `authorId` would become the *editor*, and Adam's original-creator credit would be
    lost outright (recoverable only by manually walking the `supersedesTalkId` chain), not preserved
    anywhere structured. Today's system cannot express "credit the original creator forever AND
    show who most recently touched it" — it only has one field doing an inconsistent job of both.
  - **What this needs:** a new `Talk.originalAuthorId?: string` field, set once and never
    reassigned after that — seeded from `oldTalk.originalAuthorId ?? oldTalk.authorId` on a talk's
    *first* edit (so a talk that predates this field falls back cleanly to its existing `authorId`
    as the original), then copied forward unchanged on every subsequent edit down the
    `supersedesTalkId` chain. `authorId` itself becomes the "current author" field and gets
    reassigned to the editor specifically on the new content-edit-mints-new-talk path.

**Resolved 2026-08-01 (Bernard): title edits don't count as authorship at all** — *"keep the title
as is, changing the title doesn't count as creator or editor."* Closes the sub-question above
cleanly: a title-only change touches neither `authorId` nor `originalAuthorId`, and it's already
architecturally consistent with the edit-rehash-scope decision (title was never part of the
content-hash payload for `flow` talks to begin with, per `cid.ts:236` — this isn't a new special
case, it's the same boundary already drawn for a different reason).

**New 2026-08-01 (Bernard): record a timestamp and a blurred location alongside both the original
creator and the current editor**, not just their ids. Checked against what exists:
  - The creator side is nearly free — `Talk.createdAt: Date` and `Talk.authorLocation?: {latitude,
    longitude}` already exist (`types.ts:216,224`) and already get populated at creation
    (`app.ts:4772-4776` passes `this.currentLocation` in). Mirroring the `originalAuthorId` pattern:
    add `originalCreatedAt`/`originalAuthorLocation`, seeded once and copied forward unchanged —
    same shape as everything else in this item.
  - **The editor side needs the same two fields freshly captured at edit time** — nothing today
    tracks "when/where was the most recent edit made" as distinct from the original creation.
  - **Location must be blurred by default — confirmed 2026-08-01 (Bernard): "blurred location
    should be used by default; precise location can only be used when the user specifically
    requests it, and not saved by default."** This isn't a new policy Bernard is inventing here —
    it restates the SRS's own day-one requirement, `FR-CR-8`/`NFR-S-1`
    (`docs/specs/iinpublic-technical-specifications.md:254,588`: *"the system SHALL store true
    location from GPS and use a blurred region for all public operations"* / *"True GPS location
    must not be exposed directly"*). `Talk.authorLocation`'s current raw-coordinate storage is a
    **confirmed violation of that existing requirement**, not a judgment call — see **§X**, its own
    item now, since it's a pre-existing bug affecting every talk ever created, not specific to this
    feature. The two new fields this item adds (`originalAuthorLocation`, and `authorLocation`
    repurposed for the editor) should obviously follow the same corrected, blurred-by-default
    behavior §X establishes — no separate design decision needed here once §X lands.
  - **One real design fork this creates, not yet resolved:** under the new content-edit-mints-a-
    new-talk flow, a fresh `Talk`'s own `createdAt`/`authorLocation` would naturally capture *this
    edit's* moment/place (exactly what's wanted for the editor side) — but the existing in-place
    `updateTalk` path (metadata-only edits) currently preserves `createdAt`/`authorLocation` from
    the original untouched. That's a real divergence between the two edit paths' semantics for the
    same two fields, mirroring the `authorId` sub-question already flagged — the design note needs
    to settle both together, not independently.

**What already exists to reuse (still accurate from the prior research pass):**

- Thread scoping is already exactly what's needed to tell the two scenarios apart at runtime.
  `Message.talkId` (`types.ts:334-340`) distinguishes the plain DM thread (no `talkId`) from a
  specific talk's thread (a real `talkId`) on the same Gun path; `showConversationDetail(
  conversationId, threadTalkId)` (`ui-manager.ts:5277`) and `messageInCurrentThread()`
  (`ui-manager.ts:8388-8394`) already track and filter by which thread is active; the compose
  handler (`ui-manager.ts:5409-5419`) already knows the current `talkId` when emitting
  `sendConversationMessage`.
- Rendering something other than a plain text bubble mid-conversation already has a precedent:
  `displayConversationMessages()` (`ui-manager.ts:8838-8918`) detects a structured payload inside
  `Message.text` (`parseIpfsSharePayload`, line 8419) and renders it specially
  (`renderIpfsAttachmentMessage`, line 8486) instead of the default bubble (fallback: lines
  8900-8907).
- Submitting an answer doesn't require the `talk-response-dialog.ts` modal's DOM — every answer path
  already bottoms out at one callback, `completeTalk(talk, answers, outcome?)`
  (`ui-manager.ts:6435`), backed by the shared, reusable `checkIfMatch`/`checkIfIgnore`
  (`talk-engine.ts:91,104`). Inline chat chips can call these directly.

**What still needs building:**

- The parser itself (grammar is now decided, above — nothing existing implements it against the
  current data model; the legacy `PatternQuestionWithOptions` regex is reference-only, not reusable).
- Multi-line session state: tracking an in-progress capture across several *separately sent*
  messages (per line, waiting for the recipient's chip-tap between each) before finalizing on the
  terminator sentence — this is more than a single-message parse, it's a short-lived capture session.
- Compose-time interception: "instead of sending it as plain text" implies recognizing the shorthand
  *before* the ordinary send happens (inside the `sendMessage` closure, `ui-manager.ts:5409`, before
  `sendConversationMessage` is emitted), not a parse-after-the-fact like the IPFS-share precedent.
  **Decided 2026-08-01: the diversion is mandatory-confirm, never silent** — a successful parse
  always shows the sender a confirmation step before it becomes a talk instead of an ordinary
  message; no longer an open question.
- Inline chip rendering + the lightweight tap-to-`completeTalk`/`checkIfMatch` wiring.
- The append/edit-case pieces above: `Talk.supersedesTalkId`, the `deleteTalk` operation (now the
  *default* path on a re-hashing edit, not just a someday-nicety), reusing `expiresAt` to mark a
  kept-but-superseded old talk inactive, and the new Settings-tab default-delete/keep preference.
- The two-author credit model above: `Talk.originalAuthorId`/`originalCreatedAt`/
  `originalAuthorLocation` (new fields, immutable after first set, seeded from the predecessor or
  falling back to the talk's existing plain fields), plus the still-open `createdAt`/
  `authorLocation`/`authorId` edit-path-divergence question just above (title edits are now settled
  — they touch none of this). The blurred-vs-raw location fix itself is §X, tracked separately since
  it's a pre-existing bug, not new-to-this-feature work.
- Routing the finished draft into `talk-editor-dialog.ts` for later refinement — not yet confirmed
  whether the editor's current open/edit path already handles an already-broadcast/already-answered
  talk cleanly, or only ever new-in-progress drafts.

Almost every design question in this item is now decided — the one still genuinely open is whether
metadata-only edits (title, tags, etc. — the ones staying on the existing `updateTalk` in-place
path) reassign `authorId`/`createdAt`/`authorLocation` to the editor, or keep preserving them as
today; title itself is now explicitly excluded either way. What's otherwise left is implementation,
plus checking the reference-integrity blast radius honestly (above) — between that and the
remaining authorship-fields question, this stays `[Opus]`-tagged. Write a short design note covering
the multi-line session-state mechanics, the reference-integrity checklist, and the metadata-edit
authorship-fields call, then hand the parser, `supersedesTalkId`/`deleteTalk`/`originalAuthorId`/
`originalCreatedAt`/`originalAuthorLocation` wiring and the chip UI to Sonnet (the location-blurring
fix itself, §X, doesn't need to wait for any of this and can land independently).

---

## W. Incremental re-broadcast: don't resend talks a recipient already has `[Sonnet]`

Verification requested 2026-08-01: *"when Adam has exchanged 100 talks with Eve and broadcasts
total 120 talks again, Eve should only receive 20 new talks — verify this is done or add to TODO."*

**Verdict: the literal scenario as stated is already handled correctly — verified, not a gap.**
For the specific case where the 100 are *exchanged* (answered), Eve gets only the 20 new ones.
**But the research surfaced two real, adjacent gaps worth tracking**, both found while confirming
the literal case, not invented speculatively.

**Why the literal case works:** delivery goes through `deliverTalkToReceiversOverMesh`
(`src/web/app/app.ts:3338-3395`). For every talk × recipient pair it computes the talk's
content-hash identity (`buildTalkIdentityKey`, `src/shared/cid.ts:276`) and calls
`shouldSuppressForPeer(recipientId, identityKey)` (`talk-ledger.ts:237-252`) **before** invoking
`mesh.broadcastTalk()` — a suppressed recipient is dropped from that talk's delivery list
pre-send, so the network round trip is genuinely saved, not just deduped after arrival. `doc.exchanged`
gets populated by a `TALK_ANSWERED` ledger event (`talk-ledger.ts:361-419`), written on Adam's side
once Eve's answer comes back (`app.ts:2973`) — so "exchanged" in the ledger's sense means
*answered*, matching the user's own word choice exactly. This check is per-recipient and
content-hash-keyed, so it doesn't care whether the 20 new talks are mixed into the same 120-item
batch as the 100 old ones — each of the 100 gets independently suppressed for Eve specifically.

**Gap 1 — received-but-not-yet-answered talks aren't covered by this mechanism.** If some of the
"100" were delivered to Eve but she hasn't answered them, `doc.exchanged` has no entry yet, so
ledger suppression won't drop them. A second, coarser filter exists — `broadcastConversationHistory`
local send-history (`ui-manager.ts:807-838`) — but the actual "Broadcast" button
(`runBroadcastFromCurrentRoom` → `getPendingBroadcastTalkIds()`, `ui-manager.ts:1618,6948-6955`)
uses the **room-wide** variant, `getUnsentBroadcastTalkIds` (`ui-manager.ts:824-829`), which checks
`receiverIds.some(...)` — if **any** other room member still needs a talk, it stays in the batch for
**every** recipient, Eve included. The **per-receiver** variant that would avoid this,
`getUnsentBroadcastTalkIdsForReceiver` (`ui-manager.ts:831-836`), exists but is only wired to the
automatic single-peer on-room-entry path (`broadcastPendingTalksOnRoomEntry`, line 1611), not the
main Broadcast button. Net effect: in a room with a mix of long-time and brand-new members,
received-but-unanswered talks can legitimately get re-sent to someone who already has them.

**Gap 2 — three separate, uncoordinated implementations of "don't resend what's already out
there,"** none sharing logic or a common data source: (1) `broadcastConversationHistory`'s
localStorage revision-key history (room broadcast), (2) the talk-ledger's `exchanged`
content-hash suppression (mesh delivery, answered-only), (3) `local-peer-derivation.ts`'s
`readLocalTalkExchanges` (`user-detail-view.ts`'s separate peer-detail "Send My Talks" button —
untouched by either of the other two). They can drift out of sync with each other since they key
on different things (a per-room-per-receiver send record vs. a global per-peer content-hash
ledger vs. a third local derivation) — worth a design pass to decide whether these should share
one source of truth, or whether three is actually fine given they cover three genuinely different
UI entry points.

**Also found, likely dead code, unrelated to the fix but worth flagging while here:**
`WebTalkService.sendBulkTalk` (`web-talk-service.ts:328-351`) and its server twin
(`talk-service.ts:38-65`) write a single-`talkId` `BulkSendJob` stub to Gun with no per-recipient
targeting and no consumer/worker found anywhere in the codebase (`bulkJobs` has no processor) — it's
wired to a legacy `sendTalk` UI event (`app.ts:4725-4739`) unrelated to the actual room-broadcast
path described above. Candidate for removal, or at minimum: don't build on it, it isn't live.

- [ ] Fix Gap 1: make the main Broadcast button use per-receiver unsent-talk filtering (like
      `broadcastPendingTalksOnRoomEntry` already does) instead of the room-wide `.some()` variant,
      so a new room member needing an old talk doesn't drag it back into everyone else's batch.
- [ ] Decide on Gap 2: unify the three exchange-tracking mechanisms, or document why three separate
      ones is the right shape given their different entry points.
- [ ] Decide whether `sendBulkTalk`/`BulkSendJob` should be removed as dead code or finished as a
      real feature — currently neither, which is its own small hazard for whoever finds it next.

---

## X. Talk.authorLocation stores a raw coordinate — violates the SRS's own blurred-location requirement `[Sonnet]`

Found 2026-08-01 while working §V's two-author credit model, confirmed as a real bug (not a
judgment call) by Bernard: *"blurred location should be used by default; precise location can only
be used when the user specifically requests it, and not saved by default."* This restates the SRS's
own day-one requirement — `FR-CR-8` (`docs/specs/iinpublic-technical-specifications.md:254`):
*"The system SHALL store **true location** from GPS and use a **blurred region** for all public
operations"*; `NFR-S-1` (line 588): *"True GPS location must not be exposed directly — only
blurred regions or derived chatroom memberships."* — plus the plain-language version at line 198:
*"location must be blurred before any public sharing."*

**The violation:** `Talk.authorLocation?: { latitude: number; longitude: number }` (`types.ts:224`)
stores the **raw, precise** coordinate — confirmed via `app.ts:4772-4776`, which passes
`this.currentLocation` (the live, unblurred GPS position) straight into a new talk at creation, and
`WebTalkService.createTalk`/`updateTalk` (`web-talk-service.ts:173,319-320`) which carry it forward
unchanged. Since talks get synced/broadcast across the P2P graph, this is a real instance of exactly
what `NFR-S-1` prohibits — every talk ever created has been shipping its author's precise location
to every recipient, not the blurred region the spec requires.

**The fix is mechanical, not a new design** — this codebase already has the blurring mechanism the
SRS calls for and already uses it for an analogous purpose (distance-based sorting,
`docs/specs/iinpublic-technical-specifications.md:4027`: *"Distance uses blurred location (`LocationPrivacy.blurLocation`) —
approximate is acceptable"* — direct precedent that blurred-region-based distance approximation is
already the accepted standard elsewhere in this exact system, so switching `Talk.authorLocation`
won't regress `locationRadiusMiles` filtering, just make it approximate like everything else that
already does this). `LocationPrivacy.blurLocation()` (`src/shared/location.ts:13-26`) reduces a
coordinate to a coarse ~2km grid `region` string and its own `BlurredLocation` type explicitly keeps
the precise coordinate as `trueLocation`, doc-commented *"only stored locally, never transmitted"*.

- [ ] Switch `Talk.authorLocation` (and the two new author-location fields §V is adding —
      `originalAuthorLocation` and the repurposed current-editor `authorLocation`) to store
      `LocationPrivacy.blurLocation(coordinate).region` instead of the raw `{latitude, longitude}`
      pair, at every write site (`app.ts:4772-4776` and wherever §V's edit path writes it).
- [ ] Confirm `formatTalkDistanceFromAuthor` (`ui-manager.ts:416`) and any other reader of
      `authorLocation` still work against a region string rather than a lat/lng pair (distance
      becomes approximate — expected and already how this SRS asks the rest of the system to work).
- [x] "Share my precise location with this specific talk/person" is out of scope for this fix —
      **confirmed 2026-08-01 (Bernard): "share location with someone is another feature in the
      future."** Blurred-only is a complete fix on its own here; a real opt-in precise-sharing
      capability, if built later, is its own separate backlog item, not a sub-task of this one.
- [x] **Audited and closed 2026-08-01 (Bernard): `Chatroom.location`/`BusinessInfo.coordinates`
      are *not* the same violation.** *"Business chat room is the current case in which user can
      specify the precise location."* A business owner publishing their storefront's exact address
      when creating a business chatroom is exactly the "specifically requested" precise disclosure
      `FR-CR-8`/`NFR-S-1` carve out — a deliberate, already-legitimate, different use case from a
      person's incidental current position leaking through `Talk.authorLocation`. No fix needed
      there; this item stays scoped to `Talk.authorLocation` only.

---

## Future / low priority (explicitly deferred)

- Multiple identities on one device (profile switching). Decided low priority 2026-07-13; v1 stays one identity per device install.
- Merging message history across linked devices; aggregating reputation across a cluster (`flagged` in I).
- Explicit "share my precise location with someone" opt-in capability. Not scoped or designed —
  Bernard, 2026-08-01, while closing §X: *"share location with someone is another feature in the
  future."* Noted here only so it doesn't get silently reinvented as part of §X's blurred-by-default
  fix.

---

## Open questions

- Identity linking v2 scope: should reputation aggregate across a linked cluster, and should contacts/conversations sync between linked devices? (v1: display-merge only.)
- iPhone/Android native shells: browser-profile testing is the stand-in until they ship — confirm.

---

## Resolved decisions

- ~~Mirror identity across devices or reject second session?~~ → Neither: per-device identities + linking (section I). 2026-07-13.
- ~~X3 identity strategy~~ → Per-device SEA, linking protocol, never shared keys.

---

## Nightly cron jobs

| # | Time (PDT) | Command | Purpose |
|---|-----------|---------|---------|
| 1 | 2:00 AM | `npm run health` | Health check |
| 2 | 2:10 AM | `npm run test:e2e:parallel` | Full E2E suite, parallel workers |
| 3 | 2:20 AM | `npm run test:e2e:heavy` | Mass specs + stage4/5 + find-similar |
| 4 | 2:30 AM | `npm run test:e2e:mesh` | Talks-matching mesh tests sequentially |

---

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep SRS audit snapshots tied to code evidence and verification commands.
