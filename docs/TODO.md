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
  reader). None of these need new architecture beyond the Session-1 dispatcher itself.
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
  - K4's stage2-5 progressive-snapshot conversion (~210 call sites) — already flagged in K4 itself
    as needing a scope/priority decision before starting; don't schedule until that decision is
    made, since "how many sessions" depends entirely on the scope chosen.
  - L2's real-deployment instrumentation run + retention-policy numbers, and G/I/J's nightly
    cross-platform specs (X3-X8) — these are blocked on you (a production deployment to measure,
    or native-build/CI runner infra) rather than schedulable engineering sessions.

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

### Current state (K1–K3 and K6 complete; K4/K5/L1/L2 mostly complete)

K1, K2, and K3 (below) landed 2026-07-25/26 — see `docs/completed.md` and the three design notes
(`docs/design/techsupport-k1-design-note.md`, `-k2-`, `-k3-`) for the implementation record. K4's
fixture, K5's Items 1–5, K6 (fully, including its two stage1 tests), and L1/L2's CRDT counter +
retention instrumentation have since landed too — see their `docs/completed.md` entries. What's
left for the K/L series:

- K4: the `clearGunForStage3/4/5Spec` helpers exist and `talks-matching`/`isolated-01` are wired to
  them; ~174 call sites remain (stage2/3/4/5/mass/isolated-02) — deferred by scope decision, not a
  correctness gap (every site already gets a valid built-in TechSupport today).
- K5: complete except the `answeredBy` open design question (record the answering operator
  internally, display as TechSupport — proposed, not yet decided).
- L1: removing the legacy visit-count scalars once one full staged run confirms nothing else reads
  them.
- L2: the retention-policy decisions (real-deployment numbers, tombstone semantics, where trimming
  runs) — explicitly blocked on a product decision, not on code.
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
- [x] Non-staged dirs decided: `talks-matching/` and `isolated/`'s three-real-user specs should
      target **stage3** (audited actual `bootstrapUser()` patterns — corrects the earlier "stage2"
      hunch, which undercounted); `mass/`'s (and `isolated-02`'s) ephemeral N-browser-loop specs get
      no benefit from any fixed-population stage and stay on the bare stage0 fixture. Recorded in
      `tests/e2e/staged/README.md`. 2026-07-27.

### K5. TechSupport DM Q&A: ignore talks, answer questions `[Opus]`

Decision 2026-07-25. Depends on **K2** (signed authorship) and **K3** (TechSupport client).
Verifiable entirely at **stage1** (one ordinary user + TechSupport).

> **All 6 work items + the full test list complete 2026-07-27/28.** Only the `answeredBy` open
> design question below remains.

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

**Open question**

- Does the developer answer as "TechSupport" anonymously, or is the answering operator recorded in
  `answeredBy`? (Proposed: record internally, display as TechSupport.)

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

- [ ] Remove the legacy `visitCount` / `uniqueVisitorCount` scalars and the `visits/<eventId>`
      nodes once no client reads them. Blocked on the `max(new, legacy)` fallback in `getChatroom`
      being retired, which needs one full staged run to confirm nothing else reads the scalars.

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

- [ ] **Run it against a real deployment and paste the numbers here**, then decide a retention
      policy per path. A reaper without an agreed policy is how real data gets lost, so the
      numbers come first.
- [ ] Decide whether the room-visit paths in the table above (`visits/<visitEventId>`,
      `uniqueVisitors/<userId>`, `visitCounter/<userId>`) fit into SRS §28.8's existing tier model
      as-is (they look closest to Tier 3 — other users' bounded-TTL public data) or need a
      dedicated tier of their own, then adopt the §28.9 merkle-checkpoint pattern for whichever
      of these paths ends up needing prune-with-provability rather than a hard delete.
- [ ] Tombstone semantics: Gun is append-oriented and P2P, so a "delete" that a peer never sees can
      be resurrected on the next sync. SRS §28.9's checkpoint-commits-to-pruned-range design is the
      candidate answer (adopted for the ledger/messages it was designed for); confirm it (or an
      equivalent) before building a bespoke tombstone mechanism for room-visit data specifically.
- [ ] Decide whether trimming is relay-side, device-side, or both. Under the P2P model the relay
      cannot be the sole authority — each device holds its own Gun graph. SRS §28.8's tiers are
      already framed per-device (each tier's TTL/retention is something each device decides for
      its own graph), which is a starting answer to this question too.
> **Still blocked on you for two things the §28 design doesn't settle:** whether the lifetime
> visit/unique-visitor badges are worth their storage cost at all (see the open question below —
> §28's design doesn't argue for keeping them, only for how to prune them cheaply if kept), and the
> exact numeric retention windows for room-visit data specifically (§28.9 picks N=100/K=50 for
> ledger/messages; room visits need their own numbers). Everything else — the pruning mechanism
> itself — is now a design-exists-go-adopt-it task, not an open design question.

> **Open question:** are the lifetime badges worth their cost at all? If "visits ever" is not a
> number users act on, replacing both with "active now" deletes this entire problem class. Worth
> answering before building the reaper.

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

## Future / low priority (explicitly deferred)

- Multiple identities on one device (profile switching). Decided low priority 2026-07-13; v1 stays one identity per device install.
- Merging message history across linked devices; aggregating reputation across a cluster (`flagged` in I).

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
