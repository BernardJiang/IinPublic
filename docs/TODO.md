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

> Rounds 1–4 complete (2026-07-15/16) — archived in `docs/completed.md`.

- [ ] Re-run the light shard on the host to confirm 0 failed.
- [ ] Verify the 2026-07-19 `test:all` speed changes on the host: (a) type/lint/jest now
      overlap the e2e waves instead of gating them (`TEST_ALL_PREFIX_OVERLAP=0` rolls back;
      jest capped at `--maxWorkers=50%` while overlapped), (b) webpack filesystem cache
      (`node_modules/.cache/webpack` — delete it to roll back; cache key covers all
      bundle-baked env vars). Expected: phase 0 ≈ build-only on first run, seconds on
      warm re-runs; watch wave 1 for any jest-contention flakes. `[Haiku]`

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

### Current state (K1–K3 complete; K4/K5/K6/L1/L2 mostly complete)

K1, K2, and K3 (below) landed 2026-07-25/26 — see `docs/completed.md` and the three design notes
(`docs/design/techsupport-k1-design-note.md`, `-k2-`, `-k3-`) for the implementation record. K4's
fixture, K5's Items 1–5, K6's block/filter/mute enforcement, and L1/L2's CRDT counter + retention
instrumentation have since landed too — see their `docs/completed.md` entries. What's left for the
K/L series:

- K4: converting the remaining ~210 `maybeClearGunDatabases()` call sites to progressive
  multi-user snapshots, and deciding a stage for the non-staged test directories.
- K5: complete except the `answeredBy` open design question (record the answering operator
  internally, display as TechSupport — proposed, not yet decided).
- K6: the talk-intake carve-out (not reachable today) and its two stage1 tests.
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

Requirement 2026-07-25. TechSupport must never be blocked, muted, or filtered out by an ordinary
user — the support channel is the only recourse a stuck user has.

> Block path, content-filter exemption, mute reconciliation, and the shared
> `isTechSupportId`/`canBlockTarget` enforcement are complete — archived in `docs/completed.md`
> 2026-07-25.

- [ ] Age-gate/language/distance rejection on the *talk* intake path still needs an explicit
      support-channel carve-out if TechSupport ever sends anything through it. Not reachable today
      because TechSupport neither sends nor receives talks (K5) — revisit if that changes.
- [ ] Test: `stage1` — attempt to block/filter TechSupport by every available route; contact row and
      message delivery survive all of them.
- [ ] Test: `stage1` — set maximally restrictive intake filters (language, distance, age, grammar,
      dirty words); a TechSupport DM still arrives.

> **Honest scope note:** in a P2P network this is a guarantee about the *shipped client*, not a
> cryptographic one. A user running patched code can always drop TechSupport's traffic locally.
> Design for the shipped client and say so in the contract doc rather than implying enforcement.

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

- [ ] Add `clearGunForStage3Spec` / `4` / `5` mirroring `clearGunForStage2Spec`
      (`e2e-stage-pipeline.ts:151`), then convert the call sites in the table above,
      **one directory per commit, running that directory's suite before moving on**:
      stage2 (15) → stage4 (3) → stage5 (13) → `isolated` (6) → `mass` (9) →
      `talks-matching` (36) → stage3 (128, largest and last). **Scope note:** every one of these
      call sites already gets a validated built-in TechSupport today via
      `seedTechSupportRootBaseline()` (now fixture-backed, see above) — this remaining item is
      about giving stage3/4/5 the same *progressive multi-user* snapshot shortcut stage1/stage2
      get in pipeline mode (faster setup, more realistic multi-user starting state), not about
      TechSupport correctness, which is already guaranteed everywhere by
      `verifyTechSupportBaseline()`. Not started — genuinely large (~210 call sites), deferred
      pending a scope/priority decision.
- [x] Non-staged dirs decided: `talks-matching/` and `isolated/`'s three-real-user specs should
      target **stage3** (audited actual `bootstrapUser()` patterns — corrects the earlier "stage2"
      hunch, which undercounted); `mass/`'s (and `isolated-02`'s) ephemeral N-browser-loop specs get
      no benefit from any fixed-population stage and stay on the bare stage0 fixture. Recorded in
      `tests/e2e/staged/README.md`. 2026-07-27.
      - [ ] Still to do: actually wire `clearGunForStage3Spec` and convert the `talks-matching`/
            `isolated-01` call sites once stage3's own pipeline helper exists (tracked above,
            "Add `clearGunForStage3Spec`...").

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

## Q. GUI as a graph-traversal model — read this first, before M–P `[Opus]`

**Placed first, out of alphabetical position — same convention as the top-of-file "Land order"
line** (which already lists `H` before `E`/`F`: letter labels in this file track *initiative*, not
required reading/build order). Bernard confirmed `navigateToGraphNode(target)` as the right idea
2026-07-29 and asked for the rest of this cluster (M–P) rearranged around it, easiest first — that
build order is the new subsection right after "Recommended approach" below.

Requirement 2026-07-29 (Bernard). The underlying idea across the last several TODO items: the GUI
is a **graph**, not a set of disconnected tabs. Node types are **Chatroom**, **Person**, **Talk**,
and **Me-tab Q&A** — and from any one of them you should be able to reach any directly-related
other one:

- Chatroom → switch to another chatroom, or pick a person present in it to talk to.
- Person → a talk the two of you exchanged (O).
- Talk → the person(s) it was exchanged with (N3) — **and** other people who separately exchanged
  the *same* talk content (new, see audit below).
- Talk ↔ Me-tab Q&A, in both directions (P covers Q&A → Talk; Talk → "which of my answers came
  from this" is the missing reverse edge).
- **Settings is the one deliberate exception** — a per-device configuration surface, not a graph
  node. You should never need to "arrive at" a person/talk/chatroom by navigating through Settings,
  and Settings shouldn't itself be a stop on the way between two graph nodes.

### Audit: what's already planned, what's genuinely new, what's already broken

- **Already planned as part of M/N/O/P** (this section adds no new work item for these, just names
  the pattern they're all instances of): Person→Talk (O), Talk→Person (N3), Q&A→Talk (P),
  cross-tab DM reachability (N1/N2).
- **Missing edge, not yet in any TODO item: Talk → Me-tab Q&A (forward direction).** P only wires
  Q&A → Talk; there's no reverse "from this talk, show me my answer to it" link yet, even though
  the same `talkId` join already used by P would answer it.
  **Built 2026-07-30 — see build-order item 12** for the full implementation.
- **Missing edge, not yet in any TODO item, and genuinely new — not a refactor of something
  existing: Talk → other people who separately exchanged the *same* talk content.** Audited
  thoroughly (2026-07-29): **no code path supports this today, in either direction.**
  - The creator-side "matched names" (N3, `ui-manager.ts:2451-2453`) only surfaces people with
    whom *I* (the creator) have a conversation record for that talk — direct sender→responder
    pairs I personally created, not co-recipients who got the identical content via a chatroom
    broadcast/relay from someone else.
  - Every identityKey-keyed structure found (`client-incoming-talk-mirror.ts:58,91,118`;
    `web-talk-ledger-store.ts:175,186` `getResponderSendersForIdentity`/
    `getResponderTargetsForIdentity`) is scoped to **my own** local history only — there is no
    identityKey→`[all users who have this]` index anywhere, client or server.
  - The server's old `incomingTalksMap`/`GET /api/incoming-talks` (CLAUDE.md's description of it)
    is stale documentation — that endpoint now 404s (`src/test/integration/star-endpoints-removed.test.ts:68-69`);
    star/server-authoritative talk state was already removed in favor of P2P mesh delivery, so
    this can't be built as a simple server query even if we wanted to — it has to be a
    P2P/mesh-native answer.
  - **Privacy implication, not just an engineering gap:** a network-wide "who else has this talk"
    query would leak other people's private exchange history to a stranger — almost certainly not
    what's wanted. The only privacy-safe framing is "people **I** have separately exchanged this
    same content with" (a join over my own local records I already have a relationship-based right
    to see), not "everyone in the mesh with this identityKey."
- **Chatroom → Person verified working 2026-07-30** (build-order item 3): `.chatroom-member-item`
  click → `openUserConversationFirst`, confirmed passing via `00e-chatroom-peer-detail.spec.ts` and
  `68-conversation-first-entry.spec.ts`.
- **Settings is not fully isolated today, but the coupling found is a read, not a graph edge.**
  The Talks tab's IN-list render reads `talkFilters`/`allowedTalkTypes` etc.
  (Settings-owned, `ui-manager.ts:2322-2326`) to decide what's visible — Settings values
  *influencing* what Talks shows is normal preference application, not a navigable edge (you can't
  click from a Settings control and land on a specific talk/person). The isolation principle this
  requirement actually needs is: **no click path starts in Settings and ends on a graph node**, not
  "Settings must have zero data dependencies from other views." Worth stating explicitly so this
  distinction isn't lost when M4 (Settings cleanup) is implemented.

### Recommended approach

**No centralized navigation concept exists in this codebase today — this is genuinely new
structure, not an extension of an existing pattern.** Audited: no `router`/`navigate()`/dispatch
table anywhere (`grep` for these across `src/web/` only matches UI copy strings and browser
`navigator.*`). Instead there are **~20 bespoke `show*`/`open*` functions** across `ui-manager.ts`/
`user-detail-view.ts`/`app.ts` (`showTalkDetail`, `showConversationDetail`, `showChatroomDetail`,
`showContactDetail`, `openPeerDetailForUser`, `openDirectConversationWithPeer`, etc. — full list
gathered during this audit), each with its own ad hoc signature (some take `id` only, some
`(id, name)`, some `(id, fallbackId)`), called directly from wherever needed. `app.ts`'s
`setupEventHandlers()` (`app.ts:4438`) is one large method with 37 sequential `uiManager.on(...)`
calls and inline closures — no registry, no command pattern, so a nav layer wouldn't be fighting
an existing convention; there simply isn't one yet.

- **Recommendation: introduce one thin `navigateToGraphNode(target)` dispatcher that every new
  click-to-traverse handler (M2/M3/N3/O/P, plus the new Talk↔Q&A and Talk→co-exchangers edges)
  calls through, rather than each surface inventing its own bespoke jump logic.** Keep it minimal
  and in the codebase's existing style (a plain function + a small discriminated-union `target`
  type — e.g. `{type:'chatroom',id}|{type:'person',id}|{type:'talk',id,questionContext?}|
  {type:'answer',...}`), not a framework. Concretely:
  - Reuse the existing `show*` functions as the actual per-type implementations — most already
    take a single target-id-ish param and slot in as-is (`showConversationDetail`,
    `showChatroomDetail`, `showContactDetail`); a few need small generalization work already
    tracked in P (`showTalkDetail`'s dead-end + missing question-anchor).
  - This buys one place to reason about "is X→Y actually reachable," one place to add a
    back-button/breadcrumb later if wanted, and stops each of M/N/O/P/this-item's new edges from
    growing its own one-off wiring — worth doing *once*, before landing several of M–P's items
    that each add a new click-to-navigate surface.
  - Do **not** attempt to retrofit the ~20 existing entry points into this dispatcher in one pass —
    fold them in gradually, starting with whichever M/N/O/P item lands first, so this stays a
    lightweight shared layer rather than a big-bang refactor.
- **For "talk → other people who exchanged this," design it as "people I've separately exchanged
  this with" (a join over data the current user already has a right to see), not a mesh-wide
  identityKey query** — the latter doesn't fit the P2P/no-server-authority architecture (per the
  removed `incomingTalksMap` endpoint) and would be a privacy regression even if it did.

**Build order (easiest → hardest) — the concrete answer to "rearrange around this idea"**

Every item below already has its full detail in M/N/O/P (or in this section's own "Work" list) —
this is a sequencing index, not new content. Land top-to-bottom.

1. [x] **Foundational, kept deliberately small.** Land the `navigateToGraphNode(target)` skeleton — the
   dispatcher + discriminated-union type, with just 2-3 existing functions wired through as its
   first targets (`showConversationDetail`, `showChatroomDetail`, `showContactDetail` — already
   take a single target-id-ish param, no generalization needed). No new click handlers yet; this
   step only creates the shape everything below plugs into.
   **Done 2026-07-30:** `GraphNodeTarget` union (`chatroom` / `conversation` / `person`) in new
   `src/web/ui/graph-navigation.ts`; `UIManager.navigateToGraphNode(target)` switches on it and
   delegates to the existing `showChatroomDetail`/`showConversationDetail`/`showContactDetail`.
   No new call sites yet, per scope — `tsc`/`lint`/Jest (1048 tests) all clean.
2. [x] **Trivial.** M1 — disable the "Replies To My Talks" panel. Already confirmed a single
   contiguous, self-contained edit.
   **Done 2026-07-30:** `#creator-replies-panel` set to `display:none`; the 3 external
   `renderCreatorReplies()` call sites (two filter-control listeners + `refreshCreatorReplies()`)
   removed so it's never invoked (the data derivation `deriveLocalCreatorReplies` stays, since
   `creatorReplyRows` still feeds the OUT-row matched-names line). Turned out to be wider than
   "self-contained": 5 E2E specs dedicated to this panel now `test.describe.skip` with a dated
   comment (`35-reply-filter-query`, `65-reply-triage-option-matrix`,
   `00ad-reply-triage-group-date`, `00v-creator-reply-triage-matrix`,
   `70-reply-triage-grouping-multi`), and 4 more specs that asserted panel visibility/interaction
   alongside otherwise-unrelated checks were surgically trimmed (`00-ui-navigation-settings`,
   `00x-tab-sweep-smoke`, `00y-chinese-ui-traversal` needed no fix — text-content assertions don't
   require visibility, `baa-techsupport-single-user-tabs`). Full light E2E shard (177 passed, 5
   skipped, 0 failed), `tsc`/`lint`/Jest (1048 tests) all clean.
3. [x] **Trivial.** Verify Chatroom → Person (clicking a chatroom roster row reaches that person's
   contact/DM) actually works today — a check, not new work, unless it turns out broken.
   **Verified 2026-07-30, no fix needed.** `.chatroom-member-item` click →
   `chatroomsDeps().openPeerDetail` → `openUserConversationFirst(userId, stageName)`
   (`ui-manager.ts:1949`, N2a rule) — same function `showContactDetail` uses. Confirmed passing
   today: `00e-chatroom-peer-detail.spec.ts` ("Clicking a member opens the peer detail overlay")
   and `68-conversation-first-entry.spec.ts` ("member click lands on ⟨Conv⟩") — 7/7 passed.
4. [x] **Trivial.** P's `'created'`-vs-`'answered'` destination asymmetry for self-answered own talks —
   decide and document (or a one-line routing tweak if the decision is "fix it now").
   **Done 2026-07-30 — fixed it now.** Decision: Me-tab Q&A traceback always means "show my
   answer," regardless of `myTalks[tid].role`. Added `showTalkDetail`'s `preferAnswerView` option
   (routes to the response dialog when `fullTalk` is present, even for `role:'created'`) and a
   `showTalkDetailAsAnswer` wrapper bound only to `displayAnswersList`'s deps — the Talks-tab OUT
   row and "My Talks" dialog call sites are untouched and still open the editor for `'created'`
   talks, since editing intent is correct there. New regression test in `05-talks-edit.spec.ts`
   ("Self-answered own talk: Me-tab entry opens the response view, not the editor") — confirmed it
   fails without the fix, passes with it. `tsc`/`lint`/Jest (1048 tests) all clean.
5. [x] **Easy.** N1 — make the DM-arrival toast clickable, routed through the new dispatcher. Settle
   the shared "which overlay does a DM click open" destination decision here, since N3 and O both
   reuse it.
   **Done 2026-07-30.** Destination decision: route through `navigateToGraphNode({type:'person',
   id, name})` — the same N2a "land on ⟨Conv⟩ with ⟨User⟩ underneath" convention every other
   click-to-a-person surface already uses (Contacts, Chatroom roster) — rather than the bare
   `showConversationDetail` the existing Match!-toast click uses. `showNotification` gained
   `peerId`/`peerName` options; the DM-arrival call site in `syncConversationMessageSummary` passes
   them. Existing Match!-toast behavior (rule N6, `showConversationDetail`) is untouched. New test
   `73-dm-arrival-toast-navigation.spec.ts`, confirmed it fails without the fix (toast dismisses,
   doesn't navigate) and passes 3/3 with it. `tsc`/`lint`/Jest (1048 tests) all clean.
6. [x] **Easy.** N3, single-exchange-partner case — thread the already-available `otherUserId`/
   `senderId` onto the matched-name/sender-name elements, wire via the dispatcher using N1's
   destination decision.
   **Done 2026-07-30.** OUT row's matched-names line now carries `data-matched-people` (JSON
   `{id,name}[]`); IN row's sender-avatar/name line and "from …" line both carry
   `data-sender-people`. One delegated click handler (`.talk-matched-people, .talk-sender-people`)
   parses it, `stopPropagation()`s (added to the row-click exclusion list alongside the existing
   actions), and for exactly one person calls `navigateToGraphNode({type:'person', id, name})` —
   the multi-partner picker is build-order item 8, not wired here yet, so multi-person clicks are
   currently a no-op. New test `74-talk-row-person-traceback.spec.ts`, confirmed it fails without
   the fix and passes 3/3 with it; regression pass on `05-talks-edit`, `00i-p0-direct-talk-delivery`,
   `69-matched-talk-threads`, `00f-ux-contacts-talks-answers` (5/5). `tsc`/`lint`/Jest all clean.
7. [x] **Easy–medium.** M5 — compact the TechSupport contact row (well-scoped, one file, no new modal).
   **Done 2026-07-30.** Row is now a single content line (down from 3): dropped the dedicated
   "Built-in support contact" line entirely (redundant — the "Built-in" pinned badge already says
   this), and replaced the full-sentence mute-status line with a small inline 🔕/🔔 icon
   (`aria-label` keeps the full text for screen readers; `openSupportControlsDialog`, already
   reachable, still shows the full explanation). `contactsViewDeps()` untouched, per scope.
   4 pre-existing E2E specs asserted the removed full-sentence lines directly on the row
   (`00k-techsupport-contact-mute`, `00-ui-navigation-settings`) — updated to check the badge text
   + `data-support-muted` attribute instead; added a `.contact-item-meta` count(0) assertion for
   the line-count requirement. Regression: 12/12 passed across all 5 affected specs. Confirmed the
   new assertions fail without the fix. `tsc`/`lint`/Jest all clean.
8. [x] **Medium.** N3, multi-partner case — the "choose who to DM" picker, modeled on the existing
   `#peer-send-picker-modal` pattern.
   **Done 2026-07-30.** New `showChooseWhoToDmPicker(people)` in `ui-manager.ts` (modal-overlay +
   one row per person, no checkboxes/confirm needed since a row click IS the pick), wired into the
   existing `.talk-matched-people`/`.talk-sender-people` delegate from item 6: exactly one person
   navigates directly (unchanged), more than one opens this picker; picking a row navigates via
   the same `navigateToGraphNode` destination. New test in `74-talk-row-person-traceback.spec.ts`
   ("OUT row: two matched responders opens…") using a real 3-user broadcast+match setup (Tom
   creates/broadcasts, Jerry and Bob both match). Confirmed it fails without the fix and passes
   3/3 with it. `tsc`/`lint`/Jest all clean.
9. [x] **Medium.** P — the actual dead-end fix: a real retry when `demandFullTalk` fails, instead of
   the current one-shot error toast whose copy already claims a retry it doesn't perform.
   **Done 2026-07-30.** `showNotification` gained a `retry?: () => void` option (extending the
   existing click-to-navigate pattern) — a retryable toast is marked `data-retryable="true"`,
   lingers 8s (was 3s, giving a fair window to act), and clicking it re-runs the callback instead
   of just dismissing. `showTalkDetail`'s dead-end branch now passes
   `retry: () => this.showTalkDetail(talkId, identityKeyFallback, options)` — clicking re-attempts
   the exact same lookup, which can succeed later if the mesh cache catches up. New test
   `35-me-answer-dead-end-retry.spec.ts`: a purged talk fails once, then a successful retry
   (after seeding the mesh cache) opens the response dialog normally. Confirmed it fails without
   the fix and passes 3/3 with it; regression on `54-notification-autodismiss` +
   `00-ui-navigation-settings` (13/13). `tsc`/`lint`/Jest all clean.
10. [x] **Medium.** M6 — contact headshots: new `Map`-based prefetch cache modeled on the existing
    `peerLocationCache` pattern, then render via the already-existing `avatarInnerHtml` helper.
    **Done 2026-07-30.** `peerHeadshotCache` + `resolvePeerHeadshot` in `ui-manager.ts` mirror
    `peerLocationCache`/`getPeerLocation` exactly, but deliberately *not* awaited in `beforeRender`
    (per R's caution against compounding Contacts' existing blocking pre-render chain) — instead
    fired per-peer, non-blocking, from a new self-heal loop in `contacts-view.ts` (mirroring the
    existing peer-name self-heal loop right above it), patching just the `.contact-item-avatar`
    element in place rather than re-rendering the whole list. New test
    `75-contact-headshots.spec.ts`: no-headshot → "?" fallback, a set headshot renders correctly
    on the next session, and re-sort triggers zero additional Gun reads for a peer whose headshot
    already resolved. Confirmed it fails without the fix and passes 3/3 with it; regression on
    `64-contacts-filter-sort-options`, `00k-techsupport-contact-mute`, `00f-ux-contacts-talks-
    answers`, `06-contacts-tab` (4/4). `tsc`/`lint`/Jest all clean.
11. [x] **Medium.** O — make the peer-detail exchanged-talks history list clickable, with on-demand
    `threadSummaries[talkId]` creation for talks that don't have one yet.
    **Done 2026-07-30.** `.peer-history-item` rows are now clickable: if a conversation already
    exists with the peer, calls `showConversationDetail(convId, talkId)` directly (works for any
    talkId, `threadSummaries[talkId]` doesn't need to pre-exist — it's created naturally once a
    message is sent under that scope); if no conversation exists yet, calls the (now
    talkId-aware) `openDirectConversation(peerId, peerName, talkId)`, which creates one and opens
    it already scoped to that talk. `openDirectConversationWithPeer` gained the same optional
    `talkId` param, threading through to `showConversationDetail`. New test
    `76-peer-history-clickable.spec.ts` (2 tests: brand-new conversation from a mismatch talk;
    existing conversation re-scoping across two distinct exchanged talks, including a regression
    check on the already-matched talk). Confirmed both fail without the fix and pass 3/3 with it;
    regression on `67-peer-history-controls`, `68-conversation-first-entry`,
    `69-matched-talk-threads`, `00e-chatroom-peer-detail` (9/9). `tsc`/`lint`/Jest all clean.
12. [x] **Medium.** This section's own Talk → Me-tab Q&A reverse edge — reuses P's `talkId` join,
    just the other direction.
    **Done 2026-07-30.** New `hasMeTabAnswerForTalk`/`navigateToMyAnswerForTalk` in `ui-manager.ts`;
    `showTalkResponseDialog` passes a `viewInMyAnswers` callback only when this talk actually has
    a Me-tab entry (i.e. I've answered it) — a "View in My Answers" link/button injected into the
    response-dialog modal (all 3 render branches: tag, TALK_SUPERSEDED review, per-question flow),
    switching to the Me tab and scrolling/highlighting the matching `.answer-talk-item` row(s) on
    click. New test `77-talk-to-me-tab-reverse-edge.spec.ts`: no link before answering, link
    appears and correctly navigates after. Confirmed it fails without the fix and passes 3/3 with
    it; regression on `05-talks-edit`, `35-me-answer-dead-end-retry`, `00i-p0-direct-talk-delivery`,
    `00w-talk-lifecycle-flow-multi-responder` (5/5). `tsc`/`lint`/Jest all clean.
13. [x] **Medium.** P — wire the already-computed `contextHash`/`contextPath` into a per-question deep
    link, so a multi-question entry can scroll/highlight the specific question, not just open the
    talk.
    **Done 2026-07-30 — used `questionId` rather than `contextHash` as the wire format** (already
    unique per question, no serialization/parsing needed, and `.review-question-block` — the
    screen this deep-links into — is naturally keyed by `q.id` already). Each `.answer-outcome-item`
    now carries `data-question-id`; the Me-tab row click handler reads whichever sub-item was
    actually clicked and threads it through `showTalkDetailAsAnswer` → `showTalkDetail` →
    `showTalkResponseDialog({targetQuestionId})` → new `scrollToTargetQuestion` helper in
    `talk-response-dialog.ts`, which scrolls/highlights the matching `.review-question-block`
    (reusing the `.answer-item-highlighted` CSS class from item 12). New test
    `36-per-question-deep-link.spec.ts` — verifies both halves of the fix in isolation (the
    row's `data-question-id`, and `targetQuestionId`'s scroll/highlight) rather than depending on
    the real exact-chatbot-memory auto-resolution subsystem's timing to reach the review screen
    naturally, which proved too flaky to drive reliably in a test. Confirmed it fails without the
    fix and passes 3/3 with it; regression on 4 Me-tab/answers specs (11/11). `tsc`/`lint`/Jest
    all clean.
14. [x] **Medium–hard.** N2 — the cross-tab "pick a conversation" affordance: a new global UI element
    plus a design decision (small dropdown vs. finally reviving `#conversations-list`).
    **Done 2026-07-30.** Decided small modal-overlay dropdown (modeled on item 8's
    `showChooseWhoToDmPicker`), not reviving `#conversations-list` — smaller diff, and this
    codebase already leans on the `.modal-overlay` pattern for exactly this kind of ephemeral
    picker. New `#dm-inbox-btn` in `#header-actions`, deliberately placed *without* a
    `data-appbar-view` attribute so `syncAppBarActionsForView`'s per-view hide/show never touches
    it — visible on every tab by construction, not by special-casing. `updateMatchBadge()` now
    badges it too (same aggregate unread count as the existing Me-tab badge). Clicking opens
    `showDmInboxPicker()`: unread senders sorted most-recent-first, picking one navigates via the
    same `navigateToGraphNode` destination N1/item 6/8 already settled on. New test
    `78-dm-inbox-affordance.spec.ts`: badge visible while on Settings (not Me, not Contacts),
    picker lists the sender, picking navigates to the right conversation. Confirmed it fails
    without the fix and passes 3/3 with it; regression on 4 other app-bar/notification specs
    (9/9). `tsc`/`lint`/Jest all clean.
15. [x] **Medium–hard.** M2/M3 — compress talk/answer rows to title+status (2 lines) with inline icon
    actions and a shared details-popup modal; touches four talk-type variants plus the answer-entry
    template. **Done 2026-07-30.** See M2/M3 sections above for full detail.
16. [x] **Medium–hard.** M4 — Settings tab cleanup: shared section-wrapper extraction, splitting
    content-filters into its sub-concerns, and the grouping/accordion design decision.
    **Done 2026-07-30.** See M4 section above for full detail.
17. [x] **Hardest — do last.** This section's own Talk → "people I've separately exchanged this
    content with" edge. Genuinely new data-layer design (no existing pattern to extend), and
    privacy-sensitive (see the audit above) — deliberately sequenced after everything else so the
    dispatcher, the easier edges, and the destination conventions they settle are all already in
    place before tackling the one item with no precedent to lean on.
    **Done 2026-07-30.**

**Work**

- [x] Design + land the thin `navigateToGraphNode(target)` dispatcher described above, with
      `show*`/`open*` functions as its per-type implementations. Land this *before or alongside*
      the first of M2/M3/N3/O/P's new click-to-navigate handlers, so those items build on it
      rather than duplicating one-off logic that gets retrofitted later.
      **Done 2026-07-30 — build-order item 1.**
- [x] Build the missing Talk → Me-tab Q&A reverse edge (from a talk, show my answer to it, if any)
      — same `talkId` join P already established, just the other direction.
      **Done 2026-07-30 — build-order item 12.**
- [x] Design (privacy-first, per the framing above) and build Talk → "people I've separately
  exchanged this same content with" — scoped to the current user's own local records, never a
  cross-user/mesh-wide query.
      **Done 2026-07-30 — build-order item 17.** See item 17's own writeup below for full detail.
- [x] Verify Chatroom → Person (clicking a chatroom roster row reaches that person's contact/DM)
      actually works today; if it doesn't, it's the same shape of gap as the others in this
      section and should get its own click-to-navigate treatment through the new dispatcher.
      **Done 2026-07-30 — build-order item 3, verified already working, no fix needed.**
- [x] Document the Settings-isolation principle precisely (read-dependency from other views is
      fine; a click path starting in Settings and landing on a graph node is not) so M4's Settings
      cleanup doesn't accidentally wire Settings into the navigable graph.
      **Already done** — see "Settings is not fully isolated today..." in the Audit section above
      (this doc, pre-dating M4). M4's implementation (build-order item 16) confirmed compliant on
      review: `renderSettingsSection()`'s refactor only changes wrapping markup/collapse behavior,
      adds no new click handler that navigates to a chatroom/person/talk/Q&A node.
- [x] Test: `stage2` — from a chatroom, pick a person present in it, then pick a talk the two
      exchanged, then from that talk reach the Me-tab Q&A it produced (if any) — one continuous
      traversal through all four node types without a dead end.
      **Done 2026-07-30.** New `81-graph-traversal-no-dead-end.spec.ts` — walks Chatroom
      (member-row click) → Person (conversation + peer-detail) → Talk (peer-history row reopens
      the conversation scoped to that talk) → Q&A (the talk's own response view's "View in My
      Answers" link jumps to the Me-tab entry), all in one continuous session, reusing build-order
      items 3/11/12's already-shipped edges. No new product code needed — this test exists purely
      to prove the chain has no dead end end-to-end, per this bullet's own framing.
- [x] Test: `stage3` — a talk I exchanged separately with two different people: from that talk,
      both people are reachable; a third person who has the same talk content only via a
      chatroom broadcast I wasn't part of is correctly *not* surfaced (privacy boundary holds).
      **Done 2026-07-30.** New `80-talk-co-exchangers.spec.ts` (3 real browsers — written in
      `stage2-two-user/` rather than the `stage3-three-user/` pipeline directory, since 3 ordinary
      `bootstrapUser` sessions already exercise this without needing the sequential stage-pipeline
      machinery). See item 17's writeup below for why this needed *explicit-id* talks to actually
      exercise the new code path, and how the "third person" exclusion is proven.

**Item 17 implementation notes — a key finding revised the original test plan:**

- **Investigation finding, discovered while building this item's own test:** for talks created
  through the real editor, `talk.id` is *itself* a content hash (`WebTalkService.createTalk`:
  `talk.id = talkData.id || await computeTalkCIDv1(talk)`) built from the **exact same payload**
  (`buildIdentityPayloadFromTalk` — type + language + question/answer text, sorted) as the ledger's
  `identityKey` (`buildTalkIdentityKey`, same payload, different hash encoding). Two organically-
  created talks with identical Q&A content therefore don't just share an identityKey — they
  collapse to the literal same `talk.id`, and the *existing* matched-names computation (filtered
  by `conversation.talkId`) already aggregates every exchange partner across that content
  automatically. Confirmed empirically: two same-content, different-title talks from two different
  authors produced byte-identical CIDv1 ids. This means identityKey and talk.id only genuinely
  diverge when a talk carries an **explicit** id rather than a computed one — which is exactly how
  this repo's own test fixtures (`talks-matching/lib/four-types-talks.ts`,
  `techSupportFourTalks`) and (by the same code path) any real explicit-id talk already work. The
  ledger-join design below targets precisely that divergence case, which is real but narrower than
  the original "any two separately-broadcast copies" framing assumed.
- `getCoExchangedPeople(identityKey, excludePeerIds)` (`ui-manager.ts`, near
  `showTalkItemDetailsPopup`) reads `web-talk-ledger-store.ts`'s local `talkLedger.exchanged` map —
  **this device's own record only**, combining both ledger roles for the given identityKey:
  `role:'author'` entries (responders who answered a talk *I created* with this content, across
  any talkId) and `role:'responder'` entries (authors whose talk *I answered* with this same
  content, excluding `outcome:'no-reply'` seed rows — only real exchanges). `excludePeerIds` drops
  whoever the row's own N3 matched-names/sender-name line already shows, so this surfaces only
  *additional* co-exchangers.
- Wired into both OUT-row and IN-row `.talk-item-details` popups (M2's shared popup mechanism) as
  `.talk-item-co-exchanged` (reuses the `.talk-matched-people` class for click delegation — single
  person navigates directly, multiple opens item 8's picker — no new click wiring needed). New
  translation key `talksAlsoExchangedWith` (EN+ZH).
- Privacy scoping is structural, not a runtime check: `getCoExchangedPeople` only ever reads local
  `localStorage`, so it is architecturally incapable of a mesh-wide "who else has this identityKey"
  leak — there is no code path by which a peer Tom never personally exchanged with could appear.
- Test `80-talk-co-exchangers.spec.ts` had to move to `createTalkFromCompanyPage` with explicit
  distinct ids (`coex-x-*` / `coex-y-*`) after the investigation above — an organic two-talk
  same-content setup collapsed to one row (the pre-existing behavior working correctly, not a
  test bug) and would have tested nothing new. Confirmed it fails without the fix (popup's
  `.talk-item-co-exchanged` absent) and passes with it. Full stage2 regression swept.
  `tsc`/`lint`/Jest (1048/1048, one confirmed-flaky unrelated retry) all clean.

---

## M. Talks/Me/Contacts tab layout simplification, Settings tab cleanup `[Sonnet]`

Requirement 2026-07-29 (Bernard). Talks/Me tabs currently render far more per-item detail inline
than needed; compress each item to **title + status** (2 visible lines), with actions folded in as
compact inline icons (not a dedicated row — see M2/M3's actions requirement below) and everything
else moved into a details popup. Settings tab needs a general cleanup pass (M4). Contacts tab's
special TechSupport row needs its footprint shrunk to roughly ordinary-row size (M5), and ordinary
contact rows need a headshot added (M6, currently text-only).

### M1. Disable "Replies To My Talks" section on the Talks tab

- **What it is:** `#creator-replies-panel` (`src/web/ui/ui-manager.ts:1000-1060`) — a self-contained
  block sitting above `#talks-list`, with its own header (`repliesTitle` — "Replies To My Talks",
  `ui-translations.ts:94`), a live summary span, 10 filter/sort/group controls, an active-filter-chip
  row, and `#creator-replies-list`. Populated by `renderCreatorReplies()`
  (`ui-manager.ts:2803-2943`) from `deriveLocalCreatorReplies(this.currentUserId)`
  (`ui-manager.ts:2798-2799`), called on every Talks-tab activation/filter change
  (`ui-manager.ts:1529`, `1543`) with no existing visibility flag gating it.
- [x] Hide the section (wrap `#creator-replies-panel` in `style="display:none"` or remove the
      block outright) and short-circuit `renderCreatorReplies()`'s call sites to a no-op. The
      section is self-contained (own DOM ids, own filter state, doesn't feed `#talks-list`), so
      this is one contiguous edit, not a scattered one — confirmed safe to disable without
      touching the OUT/IN list below it.
      **Done 2026-07-30.** `deriveLocalCreatorReplies`'s output (`creatorReplyRows`) still feeds
      the OUT-row matched-names line (`ui-manager.ts` ~2313), so `refreshCreatorReplies()` keeps
      that derivation and only drops its own `renderCreatorReplies()` call.
- [x] Test: `stage1` — Talks tab renders with `#creator-replies-panel` absent/hidden; `#talks-list`
      and its existing OUT/IN rows are unaffected.
      **Done 2026-07-30:** covered by the existing `00x-tab-sweep-smoke` (stage1) and
      `baa-techsupport-single-user-tabs` (stage0) specs, both updated with a `toBeHidden()`
      assertion right alongside their existing `#talks-list`/OUT-sort checks. Also had to
      `test.describe.skip` 5 specs dedicated to this panel's now-dead functionality
      (`35-reply-filter-query`, `65-reply-triage-option-matrix`, `00ad-reply-triage-group-date`,
      `00v-creator-reply-triage-matrix`, `70-reply-triage-grouping-multi`) and trim panel-specific
      assertions out of `00-ui-navigation-settings` — wider blast radius than the "self-contained"
      framing above assumed, since several specs asserted on this panel's own behavior directly.

### M2. Compress flow/tag/survey/route talk rows to title + status, inline icon actions, details in a popup

- **Current state:** talk rows are NOT `.creator-reply-row` (that class belongs to M1's section) —
  they are `.talk-list-item` inside `#talks-list`, built in `displayTalksList()`
  (`ui-manager.ts:2190` onward).
  - **OUT row** (talks I created), `ui-manager.ts:2500-2529` (~30 lines/row): title, role/type/
    language badges, relative-time meta, expiration+location meta, a stats line (matches/
    mismatches/rate), an optional weighted-score/latest-reply line, an optional matched-names line,
    and an actions row (survey-stats button, broadcast toggle, remove button). Tag talks already
    have a simpler chip-only branch (`2490-2498`).
  - **IN row** (talks sent to me), `ui-manager.ts:2601-2633` (~33 lines/row): title+status+type
    badges, sender avatar/name row, a chip row (progress/language/expiry/location/distance/
    response), relative-time meta, a "from" senders line, and a single "View" action button. Tag
    talks have a simpler branch (`2591-2599`).
- **Actions requirement 2026-07-29 (Bernard): actions must not get their own dedicated row, and
  acting on an item must never need a prior "select the item" click.** Audited the existing click
  wiring to check this isn't already broken: it isn't — action buttons (`.remove-talk-btn`,
  `.survey-stats-btn`, `.view-talk-btn`, `.talk-broadcast-toggle-btn`) already fire immediately on
  their own single click via a document-level delegate (`ui-manager.ts:2200-2272`), and the
  separate row-click listener (`ui-manager.ts:2680-2702`) explicitly excludes clicks inside
  `.talk-item-actions`/`.view-talk-btn` (guard at `2688`) so the two never conflict — there is no
  existing two-step "select row, then act" flow to remove. What needs to change is purely visual:
  stop reserving a whole row for actions.
- [x] Collapse both OUT and IN rows to 2 visible lines — **title** and **status** — with actions
      folded in as compact inline icon buttons rather than a dedicated row:
  - The row itself stays clickable for the primary action (open detail/editor — already the
    existing behavior, `ui-manager.ts:2680-2702`), so no new click is introduced for that case.
  - Secondary, same-shaped actions (remove, broadcast toggle, survey-stats, View) become small
    icon-only buttons inline on the title line (or status line), each independently clickable with
    `stopPropagation()` exactly as today — only their layout (icon-in-line vs. full button row)
    changes, not their click semantics.
  - Move everything else (badges beyond type, expiration, location, chips, matched-names, weighted
    score, sender detail) into a details popup opened from the row.
  - [x] Applies identically to all four talk types (flow/tag/survey/route) — tag's existing
        simpler branch is the template to generalize from, not a special case to preserve.
- [x] New details-popup modal, modeled on the existing `.modal-overlay`/`.modal-content`/
      `.modal-header`/`.modal-title`/`.modal-actions` skeleton already used by
      `showTalkResponseDialog` (`talk-response-dialog.ts:200-245`) and the peer-send-picker modal
      (`user-detail-view.ts:963-1000`) — same duplicate-guard-then-`appendChild`/remove pattern,
      not a new modal convention.
- [x] Test: `stage1` — an OUT row of each talk type renders exactly 2 lines with inline icon
      actions (no dedicated actions row); a single click on an icon fires its action with no prior
      row-selection step; clicking the row body opens the details popup showing the previously
      inline fields.
- [x] Test: `stage2` — an IN row renders 2 lines with an inline View icon; details popup shows
      sender/chip/meta info; the View action still opens the response flow in one click.

**Done 2026-07-30.** Implemented as designed, with one deliberate deviation from the "move
everything else" line above: matched-names (OUT) / sender-name (IN) stay **visible on the row**,
not moved into the popup — they're the interactive item 6/8 click-to-DM traceback affordance, not
decorative detail, and hiding them behind an extra popup-open click would violate Bernard's own
2026-07-29 "acting on an item must never need a prior select step" principle applied to this
affordance. Everything else (language badge, expiration/location meta, stats breakdown,
rank/weighted-score line, IN row's chip row) moved into the hidden `.talk-item-details` /
`.talk-item-status-line` structure as planned. Tag rows were intentionally left untouched — already
a simpler single-line chip branch, no dedicated actions row, single-click quick-decision UX; folding
them into the same template would have been a much larger, riskier change for no compaction benefit
since they're already more compact than the 2-line target.
- `showDetailsPopupFor(detailsEl, originalParent)` / `showTalkItemDetailsPopup(talkId)`
  (`ui-manager.ts`, near `showDmInboxPicker`) reparent (not clone) the row's hidden
  `.talk-item-details` node into a shared `#item-details-popup` modal and back on close, so
  already-wired interactive content inside it keeps working without re-wiring.
- New tests: `37-compact-talk-rows-out.spec.ts` (stage1 — flow/survey/route OUT rows: 2 visible
  lines, no `.talk-item-actions`, popup shows moved fields, broadcast-toggle/survey-stats/remove
  icons all fire on a single click) and `79-compact-talk-row-in.spec.ts` (stage2 — IN row: 2 visible
  lines, sender stays visible, popup shows the chip row, View icon fires on a single click). Both
  confirmed to fail without the fix and pass with it.
- Pre-existing regression risk, surveyed across the whole `tests/e2e/` tree before implementing:
  fixed `00-ui-navigation-settings.spec.ts`'s localization check (the broadcast-toggle's Chinese
  label moved from visible text to the button's `title` attribute — `toContainText` →
  `toHaveAttribute('title', …)`). Verified no regressions on the full at-risk list: 4/4
  `74-talk-row-person-traceback.spec.ts`, `00d-super-user-20-broadcast.spec.ts`,
  `08-super-user-copy-talk.spec.ts`, `38-mobile-talk-answer-flow.spec.ts`,
  `77-talk-to-me-tab-reverse-edge.spec.ts`, `28-stage-zero-n2n.spec.ts`,
  `36-per-question-deep-link.spec.ts`, `caa-techsupport-four-talk-types.spec.ts` (updated for M3,
  see below) — plus a full `stage1-single-user/` + `stage2-two-user/` sweep (149 passed, 2 failed:
  the localization fix above, and `00h-chatroom-hierarchy-broadcast.spec.ts` confirmed pre-existing
  on the base commit, unrelated to this change — a Gun-mesh-timing flake in regional broadcast
  scoping). `tsc`/`lint`/Jest (1048/1048) all clean.

### M3. Compress Me tab question/answer entries to title + status, inline icon action, details in a popup

- **Current state:** `src/web/ui/answers-view.ts` has two structurally-identical row builders — one
  for flattened per-question history (`389-454`) and one for legacy deduped talk records
  (`455-514`) — each producing an `.answer-question-item.answer-talk-item` div.
  - **Row shell** (`437-451`, `498-512`, ~15 lines): title, a metadata line (senders · item count ·
    date · location · answered-count), an outcome+type+language badge line, a copy-to-talks button,
    plus a nested `.answer-question-list` container.
  - **Nested per-question detail** (`renderAnswerItemsHtml`, `230-303`+): one `.answer-outcome-item`
    per Q/A, each with its own header line (question/tag label + counts), the prompt text, the
    answer/choice, a badge row (manual/auto/permanent mode, auto-use-count, latest-auto-use
    timestamp), and an optional context block (hash + path) — up to 4 more lines per nested
    question, on top of the 3 shell lines above.
  - **Existing click wiring already single-click, no prior selection needed:** `.answer-copy-talk-btn`
    has its own click listener (`answers-view.ts:527-533`, `stopPropagation()`), independent of the
    row's own click listener (`535-541`, guarded to skip the button via `.closest('.answer-copy-talk-btn')`
    at line 537) which opens talk detail. Same "no dedicated actions row" requirement as M2 applies
    here — this is a layout change, not a new interaction to wire up.
- [x] Collapse each answer entry to 2 visible lines — **title** and a single **status** line (e.g.
      outcome + answered-count) — with the copy-to-talks action folded in as a compact inline icon
      on the title or status line rather than its own row. The row body stays clickable to open
      talk detail (existing behavior, unchanged). Move the metadata line, badge line, and all
      nested per-question detail (prompt/answer/mode badges/context) into a details popup opened
      from the entry.
- [x] Reuse the same modal skeleton as M2 rather than inventing a second popup convention.
- [x] Test: `stage1` — an answer entry renders exactly 2 lines with an inline copy-to-talks icon
      (no dedicated actions row), regardless of how many nested questions it has; the icon fires
      copy-to-talks in one click with no prior selection step; the details popup shows the full
      per-question breakdown (prompt, answer, mode badges, context) that used to render inline.

**Done 2026-07-30.** Unlike M2, no exception was made here — per-question detail (prompt/answer/
mode badges/context) moves entirely into the popup, since (unlike matched-names/sender-name) it
has no click-to-navigate affordance of its own; the row body's existing click still opens talk
detail. New `showItemDetailsPopup` dep in `AnswersViewDeps` (`answers-view.ts`), wired in
`ui-manager.ts`'s `displayAnswersList()` as `this.showDetailsPopupFor.bind(this)` — reuses M2's
popup mechanism rather than inventing a second one. Both row builders (flattened-history and
legacy-deduped) collapsed to `.answer-item-title` + `.answer-item-status-line` (outcome +
answered-count + inline copy/details icons), with metadata/badges/`.answer-question-list` moved
into a hidden `.answer-item-details`. New test `76-compact-answer-rows.spec.ts` (stage1, using a
self-answered route talk since its 2-question self-answer produces the richest nested detail of
all four types): 2 visible lines, no dedicated actions row, popup shows the full per-question
breakdown including context path, copy-to-talks icon fires on a single click and the copied talk
appears as a fresh OUT row. Confirmed it fails without the fix and passes with it.
Updated `caa-techsupport-four-talk-types.spec.ts`'s visibility assertions on `.answer-outcome-item`
to open the details popup first (text-content checks like `toContainText` still work while hidden,
but `toBeVisible()` needs the popup open) — a deliberate, expected consequence of this item's own
design change, not an accidental break. Also updated the Jest unit test
`src/test/unit/answers-view.test.ts`'s 5 `displayAnswersList(...)` call sites to include the new
required `showItemDetailsPopup` dep. Verified no other regressions: `08-super-user-copy-talk.spec.ts`,
`77-talk-to-me-tab-reverse-edge.spec.ts`, `00d-super-user-20-broadcast.spec.ts`,
`29-me-answers-search.spec.ts`, `56-me-dialogs.spec.ts`, `36-per-question-deep-link.spec.ts`,
`05-talks-edit.spec.ts`, `35-me-answer-dead-end-retry.spec.ts` all still pass (these only assert on
the outer `.answer-talk-item` container or use visibility-independent selectors, unaffected by the
inner-content move). `tsc`/`lint`/Jest (1048/1048) all clean.

### M4. Settings tab cleanup

Requirement 2026-07-29 (Bernard): "Settings tab looks too messy."

- **Current state:** `renderSettingsView()` (`ui-manager.ts:3018-3348`, ~330 lines) stacks **9–10
  sections** flat in one long scroll inside `#settings-content` (`ui-manager.ts:3019`, hosted in
  `#settings-view`, `ui-manager.ts:1230`), via a plain CSS grid wrapper (`ui-manager.ts:3117`) —
  profile, credit/reputation stats, languages, talk behavior, distance/home room, content filters,
  linked devices, erase device, storage inspector, and (TechSupport-only) the support inbox.
  - Content filters (`ui-manager.ts:3266`) is really 4–5 sub-concerns bundled into one `<section>`:
    grammar/dirty-word toggles, the dirty-word chip editor, allowed-talk-types chips, a blocked-
    phrases textarea, and a filtered-incoming summary.
  - Every section repeats the same literal inline-style wrapper string
    (`<section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">`,
    e.g. `ui-manager.ts:3118, 3164, 3185, 3227, 3238, 3266, 3317, 3326, 3335`) copy-pasted rather
    than a shared helper — erase-device is the one exception, swapping in a danger border color
    (`ui-manager.ts:3326`).
  - Section headings are inconsistent: some are a plain styled `<div>` (e.g. `3186, 3228, 3239,
    3267`), others are a flex row with title+subtitle+action-button (e.g. `3150-3156, 3165-3169,
    3318-3323, 3327-3331, 3336-3338`) — two interchangeable conventions with no rule for which to
    use where.
  - No accordion/collapsible/tabs-within-tabs pattern exists anywhere in Settings (confirmed: zero
    `<details>`/`<summary>`/"accordion"/"collapsible" hits in `ui-manager.ts`; the only
    `<details>` usage in the whole UI layer is unrelated, in `answers-view.ts:312-313`).
- [x] Extract one shared section-wrapper helper (consistent border/background/padding, one heading
      convention — pick the flex title+subtitle+action pattern since it already covers the cases
      that need an inline action button) and convert all 9–10 sections to use it, instead of the
      copy-pasted inline-style string.
- [x] Split the content-filters section into its actual sub-concerns (or at minimum give each
      sub-concern its own heading within the section) rather than bundling grammar/dirty-word/
      allowed-types/blocked-phrases/summary into one undifferentiated block.
- [x] Decide whether the now-consistent sections should also be grouped/collapsed (e.g. an
      accordion, or a lightweight in-page section nav) given there are 9–10 of them stacked in one
      scroll — no existing pattern to reuse, so this needs a small design decision before
      implementation, not just a mechanical refactor.
- [x] Test: `stage1` — every Settings section renders via the shared wrapper (no leftover ad hoc
      inline-style section markup); all existing controls in every section (profile, languages,
      distance, content filters, linked devices, erase device, storage inspector) still read/write
      the same state and fire the same handlers as before the refactor.

**Done 2026-07-30.** New `renderSettingsSection(opts, bodyHtml)` helper (`ui-manager.ts`, right
before `renderSettingsView`) renders `<details class="settings-section" open><summary>title +
optional subtitle</summary><div class="settings-section-body">optional action + bodyHtml</div>
</details>` — all 9 sections (profile, credit, languages, talk behavior, distance/home, content
filters, linked devices, erase device, storage inspector) now use it, replacing the copy-pasted
`<section style="padding:16px;background:#fff;...">` string. Design decision for the "grouped/
collapsed" question: extended the one existing precedent (`answers-view.ts`'s context-group
`<details>`) rather than inventing an accordion widget or in-page nav — every section is
independently collapsible via the native disclosure triangle, defaulting to **open** so nothing
about current visibility changes unless the user collapses a section themselves. Action controls
(Manage/Erase/Refresh buttons, the credit-visibility checkbox) render in the body just below the
summary rather than inside it, specifically so their own click handlers never fight the browser's
native summary-click-toggles-open/closed behavior — no new click semantics needed for any existing
button. Content-filters split into 4 visually-separated sub-concerns with their own headings:
message filters (new `settingsMessageFiltersHeading`), the dirty-word list (existing
`settingsDirtyWordsListLabel`), allowed talk types (existing `settingsAllowedTypes`), blocked
phrases (existing label promoted to a heading), and filtered-incoming summary (new
`settingsFilteredIncomingHeading`) — two new translation keys added (EN+ZH). New test
`77-settings-section-wrapper.spec.ts` (stage1): asserts zero leftover `<section>` elements, exactly
9 `.settings-section` wrappers all starting `open`, collapsing one section hides only its own body
(others unaffected), then exercises a representative control from profile/credit/content-filters/
distance/linked-devices/erase-device/storage-inspector to confirm each still reads/writes the same
underlying state as before the refactor. Confirmed it fails without the fix (`9` leftover `<section>`
elements found) and passes with it. Verified visually via a throwaway screenshot script (not
committed) — clean bordered cards, consistent title+subtitle+action heading, correct
collapse/expand behavior, and the four labeled content-filters sub-concerns render as intended.
Regression: full `stage1-single-user/` sweep (84/84 passed, including `00-ui-navigation-settings.spec.ts`,
`31-intake-filters-persist.spec.ts`, `32-language-setting-persist.spec.ts`, `00y-chinese-ui-traversal.spec.ts`,
`71-linked-devices-page.spec.ts`, `72-erase-this-device.spec.ts`) plus stage2's
`04-profile-edit-stage-name.spec.ts`. `tsc`/`lint`/Jest (1048/1048) all clean.

### M5. Compact the TechSupport row on the Contacts tab

Requirement 2026-07-29 (Bernard): TechSupport is a special contact and should stay in the list (or
somewhere visible), but take up less space than it does today.

- **Current state:** the TechSupport row (`src/web/ui/contacts-view.ts:730-741`) is unconditionally
  **3 always-on content lines** — name + a "Pinned" badge + a presence-indicator dot (line 734), a
  dedicated "Built-in support contact" label line (line 735), and a notifications-muted/on status
  line (line 736) — versus an ordinary contact row (`contacts-view.ts:754-765`), which is 2 base
  meta lines plus at most 1 conditional line (sort-mode-dependent, lines 758-761). TechSupport's
  extra footprint is specifically the badge/presence-dot pair plus the two dedicated label lines
  that ordinary rows have no equivalent of.
  - It is **not** part of the sortable peer list at all — unconditionally string-prepended above
    `visiblePeers` (`contacts-view.ts:742`), so it's always pinned to the top regardless of sort
    order, and excluded from the self-heal peer-iteration loop (`contacts-view.ts:787`). Visibility
    (not position) is gated by `showSupportContact` (`contacts-view.ts:669`).
- [x] Compress the row to match (or be smaller than) an ordinary row's footprint — collapse the
      "Built-in support contact" label and the notifications-muted/on status into the same line as
      the name (e.g. as a compact badge/icon next to the presence dot, not a separate line each).
      Keep the "Pinned"-to-top positioning and the presence indicator itself — the requirement is
      shrinking the footprint, not removing the special treatment or hiding the contact.
      **Done 2026-07-30.** Went one step further than merging into one meta line: the "Built-in
      support contact" label was dropped entirely (the "Built-in" pinned badge on the name line
      already says this — a genuinely redundant line, not just mergeable), and mute-state became a
      🔕/🔔 icon next to the presence dot. Result: the row's content is a single line, no
      `.contact-item-meta` divs at all (an ordinary row has 2).
  - [x] Move any detail that doesn't fit inline (e.g. full mute-state explanation) into the
        existing peer-detail/relationship modal (`openSupportControlsDialog`) rather than a new
        row-level popup — TechSupport already has a dedicated controls dialog reachable from the
        row, unlike the Talks/Me items in M2/M3.
        **Done 2026-07-30.** Already true without changes needed — `openSupportControlsDialog`
        (`contacts-view.ts:157`) already renders both the full "Built-in support contact"
        description and the full mute-status sentence; only the row template needed to stop
        duplicating that text.
- [x] Do not touch `contactsViewDeps()` (`ui-manager.ts:1858-1897`, three call sites at `1900`,
      `1904`, `7618`) — the fields it provides (`hasSupportContact`, `isTechSupportOnline`,
      `isSupportNotificationsMuted`) stay the same; only the row template's use of them changes
      from separate lines to inline elements.
      **Confirmed 2026-07-30:** `contactsViewDeps()` diff is empty; only the `supportRow` template
      in `contacts-view.ts` changed.
- [x] Test: `stage1` — TechSupport's contact row renders at (or below) the line-count of an
      ordinary row, still appears pinned at the top of Contacts regardless of sort order, and its
      presence indicator + mute state are still readable (inline instead of on their own lines).
      **Done 2026-07-30:** extended `00k-techsupport-contact-mute.spec.ts` with a
      `.contact-item-meta` count(0) assertion (line-count) plus `.techsupport-mute-indicator`
      `data-support-muted` checks (mute state still readable, machine-checkable); pinned-to-top
      positioning was already covered by existing assertions in that spec and untouched by this
      change. Confirmed these assertions fail without the fix.

### M6. Show headshots on ordinary contact rows

Requirement 2026-07-29 (Bernard): "for all other contacts, their headshots should be included."
(TechSupport's row is out of scope here — it's the special case handled separately in M5.)

- **Current state: no visual avatar at all.** The ordinary-peer row (`contacts-view.ts:754-765`,
  inside `visiblePeers.map(...)` at `contacts-view.ts:743`) renders only the name, an optional
  "Blocked" badge, two meta lines, and an optional match-rate/rank chip — no `<img>`, no avatar
  element of any kind. A person is represented purely by text today.
- **Reuse what already exists — don't build a new renderer.** `avatarInnerHtml(headshot, fallback,
  escapeHtml)` (`src/web/ui/profile-avatar.ts:5-15`) already does exactly this: renders an
  `<img class="profile-avatar-image">` when the value is a `data:image/...;base64,...` string
  (validated by `isProfilePhoto()`, `profile-avatar.ts:1-3`), or falls back to rendering an emoji
  glyph/fallback character as plain text otherwise (a user's "headshot" is one of a fixed emoji
  set or an actual photo, `ui-manager.ts:3115,5171`/`3806,3868`). It's already used the same way in
  the Relationship modal (`contacts-view.ts:251`) and the peer detail view (`user-detail-view.ts:501`).
- **Data source:** `headshot` field from `user-public-profile/<userId>` in Gun, read via
  `getPublicProfileFoundation` (`app.ts:756-768`, `setPublicProfileFoundationReader`), already
  wired into `ContactsViewDeps.getPublicProfileFoundation` (`contacts-view.ts:41-46`, wired at
  `ui-manager.ts:1895`/`7588`) — no new plumbing needed to *fetch* it, only to *cache and render*
  it in the list.
- **The real gap: no per-peer batch cache for the list.** `contactDetailUserProfileCache`
  (`contacts-view.ts:202`) is a single-slot cache for one contact's detail modal, wiped every time
  a different contact is opened — useless for rendering the whole visible list at once. A headshot
  is a full base64 payload (not a lightweight URL), so a per-row live fetch on every re-render/
  sort/filter would be wasteful. Model the fix on the existing `peerLocationCache` pattern
  (`ui-manager.ts:654-677`: a `Map<userId, ...>` populated once via `prefetchPeerLocations`,
  called before `displayContactsList` runs at `ui-manager.ts:1892`, then read synchronously
  during row rendering).
- **Caution (added after R's audit, 2026-07-29):** adding this prefetch as another blocking
  `await` alongside `prefetchPeerLocations` in `beforeRender` would compound the slow-load problem
  R exists to fix (500 contacts already wait on a ~3.2s blocking chain before anything renders).
  Land R's non-blocking first-chunk-then-fill split before or alongside this item, and make the
  headshot prefetch follow that same fill-in-place pattern rather than gating first paint further.
- [x] Add a `Map<userId, headshot>` cache + a `prefetchPeerHeadshots(userIds)` batch-fetch
      (`Promise.all` over `getPublicProfileFoundation`), called alongside the existing
      `prefetchPeerLocations` before `visiblePeers.map(...)` runs (`contacts-view.ts:742-743`).
      **Done differently 2026-07-30, per the caution above:** no batch `prefetchPeerHeadshots`
      call in `beforeRender` — `peerHeadshotCache`/`resolvePeerHeadshot` exist, but are populated
      per-peer from `contacts-view.ts`'s non-blocking self-heal loop instead, so first paint isn't
      gated on a headshot batch-fetch.
- [x] Render `avatarInnerHtml(cachedHeadshot, '?', escapeHtml)` into each ordinary row
      (`contacts-view.ts:754-765`), reading synchronously from the new cache — same pattern the
      Relationship modal and peer detail view already use, just sourced from the prefetch cache
      instead of a live per-open fetch.
- [x] Test: `stage1`/`stage2` — a contact with a real photo headshot shows the image in their
      Contacts row; a contact with an emoji headshot shows the emoji; a contact with no headshot
      set shows the same `?` fallback the Relationship modal already uses. Re-sorting/filtering the
      list does not re-fetch headshots (reads from cache).
      **Done 2026-07-30 (emoji + no-headshot + no-refetch):** `75-contact-headshots.spec.ts`.
      Real-photo case not separately tested — `avatarInnerHtml`'s photo-vs-emoji branch is
      unchanged, already exercised by the Relationship modal/peer detail view's existing tests;
      re-testing it here would only re-prove the shared helper, not this row's new wiring.
      Confirmed the new spec fails without the fix and passes 3/3 with it.

---

## N. DM notification, cross-tab "pick a conversation" affordance, talk-row traceback `[Opus]`

Requirement 2026-07-29 (Bernard): being sent a DM should notify me and let me easily get to that
chat window; if more than one person has DMed me, I should see a sorted list of senders and be
able to pick one — reachable no matter which tab I'm currently on. Also: from a Talks-tab item, I
should be able to trace back to who I exchanged it with and go straight to DM with them (N3).

**Audit (2026-07-29).** Two of the three pieces already exist and work; the third (cross-tab
"pick one from a list") does not exist at all today:

- **A toast already fires on a new DM from elsewhere in the app**, but it doesn't navigate.
  `syncConversationMessageSummary` (`ui-manager.ts:8758-8777`) calls
  `showNotification(tf('conversationNewMessage', {name}), 'info')` (line 8776) whenever a new
  incoming message arrives for a conversation that isn't currently open. But `showNotification`
  (`ui-manager.ts:6719-6770`) only wires click-to-navigate when `isMatchNotification &&
  options?.conversationId` (lines 6748-6756) — the DM-arrival call passes no `options`, so
  clicking this toast today only dismisses it.
- **Per-conversation and aggregate unread state already exist and are exercised by a passing
  spec** (`stage2/10-message-unread-badge.spec.ts:265-325`): `conversation.unreadCount`/`unread`
  (`ui-manager.ts:8728-8751`), and an aggregate count via `updateMatchBadge()`
  (`ui-manager.ts:7870-7892`) stamped onto `.nav-btn[data-view="me"] .nav-icon` as a
  `.notification-badge`.
- **There is no cross-tab "pick a conversation" list anywhere in the shipped app.**
  `conversations-view.ts`'s `displayConversationsList()` targets `#conversations-list`
  (`conversations-view.ts:37-39`), which **no static HTML template defines** — confirmed dead code
  (also documented in `29-conversation-list-sorting.md:22-24` and `docs/completed.md:3109`). The
  Me-tab nav badge above therefore points at nothing: it shows a count with no list behind it. The
  actual way to reach any conversation today is Contacts tab → a contact row → the merged
  `#peer-detail-overlay` (`openPeerDetailView`, `user-detail-view.ts:152`) → its messaging section
  (`refreshPeerThreadList`, `user-detail-view.ts:668,683`) → `showConversationDetail`
  (`user-detail-view.ts:777` → `ui-manager.ts:4852`, opens `#conversation-detail-overlay`,
  `ui-manager.ts:1068`) — a multi-step path that only starts from the Contacts tab, not "any tab."
- **Existing sort convention to reuse:** both the dead `conversations-view.ts:42-46` and the live
  Contacts "recent" sort mode (`contacts-view.ts:667-711`, `709`) already sort by most-recent-
  message/interaction time descending — no new sort logic needed, just apply the same rule to
  whichever senders currently have `unread === true`.

**Work**

- [x] **N1 — make the DM toast clickable.** Pass `{ conversationId }` when calling
      `showNotification` for the DM-arrival case (`ui-manager.ts:8776`), and extend the
      click-navigate condition at `ui-manager.ts:6753` to also fire for plain DM-arrival toasts,
      not only `isMatchNotification`. **Design decision needed first:** should the click route
      through `showConversationDetail` (opens the legacy `#conversation-detail-overlay` directly,
      today's only working destination) or through `openPeerDetailView` (the "real"
      Contacts-tab-linked flow, redesign §5 rule N2a's contact-click-lands-on-DM convention)? Pick
      one destination and use it consistently with N2 below.
      **Done 2026-07-30.** Decided `openPeerDetailView`'s destination (via
      `navigateToGraphNode({type:'person',...})`, N2a convention), not `showConversationDetail` —
      keeps one consistent "go to this person" behavior across Contacts/Chatroom-roster/DM-toast/
      future N3/O, rather than the toast being a one-off. Existing Match!-toast click (rule N6)
      left as `showConversationDetail`, unchanged — a separate, already-shipped behavior, not part
      of this decision. `showNotification` gained `peerId`/`peerName` options for this.
- [x] **N2 — build the actual "no matter which tab" affordance**, since none exists: a small
      global element (app-bar icon is the natural fit, consistent with the existing icon-button
      row in `#top-header`) visible from every tab, badge-driven off the same aggregate unread
      count `updateMatchBadge()` already computes (`ui-manager.ts:7870-7892`), that opens a sorted
      list of senders with unread messages — reusing the existing recency sort
      (`contacts-view.ts:709`) and the existing per-conversation `unreadCount`/`unread` fields
      (`ui-manager.ts:8728-8751`). Clicking a person in that list opens their conversation via the
      same destination N1 settles on.
      **Done 2026-07-30.** `#dm-inbox-btn` in `#header-actions`, no `data-appbar-view` attribute
      (so it's visible on every tab by construction, not a per-view special case);
      `showDmInboxPicker()` sorts unread conversations by `lastMessageTime` descending directly
      (didn't need `contacts-view.ts`'s fuller sort-strategy machinery for this simpler list).
  - [x] Decide whether this list is a small dropdown/popover off the app-bar icon (lightweight,
        modeled on the existing `.modal-overlay` pattern used elsewhere — see M2's note on
        `talk-response-dialog.ts:200-245`) or whether it finally revives `#conversations-list` as
        a real, reachable surface. Either is acceptable; **do not leave the Me-tab badge pointing
        at a dead element** as it does today.
        **Decided 2026-07-30:** modal-overlay dropdown (modeled on item 8's
        `showChooseWhoToDmPicker`) — smaller diff than reviving `#conversations-list`/
        `displayConversationsList()`, which remain dead code, unaddressed by this item (a
        separate, still-open cleanup opportunity, not required for this requirement since the
        new picker independently satisfies "pick a conversation from any tab").
- [x] Test: `stage2` — Tom messages Jerry while Jerry is on Chatrooms/Talks/Settings (not
      Contacts); Jerry sees the toast and/or the app-bar affordance's badge update regardless of
      active tab; clicking either navigates to the Tom↔Jerry conversation.
      **Done 2026-07-30, both halves:** toast half via `73-dm-arrival-toast-navigation.spec.ts`;
      badge half via `78-dm-inbox-affordance.spec.ts` (badge visible on Settings, picker opens,
      picking navigates to the right conversation). Both confirmed to fail without their
      respective fixes and pass with them.
- [ ] Test: `stage3` — Tom and Jerry both DM Bob while Bob is on a non-Contacts tab; Bob opens the
      cross-tab affordance and sees both senders sorted most-recent-first; picking one opens that
      conversation, and the other sender's unread state is unaffected.
      **Not built 2026-07-30** — `78-dm-inbox-affordance.spec.ts` covers the single-sender case
      (list rendering, sort call, click-to-navigate); the multi-sender sort-order + independent-
      unread-state assertions this stage3 test specifically wants remain an open follow-up.

### N3. From a Talks-tab item, trace back to who I exchanged it with, then DM them

Requirement 2026-07-29 (Bernard): "from talks tab, on each item, there should be a way to trace
back to whom I exchanged this talk with, then go to DM with him."

**Audit (2026-07-29).** The names are already displayed on talk rows, but they're inert text —
clicking one does nothing beyond what clicking anywhere else on the row does.

- **Not clickable today:** the OUT row's matched-names line (`ui-manager.ts:2469-2472`) and the IN
  row's sender avatar/name + "from …" line (`ui-manager.ts:2610-2614`, `2626-2628`) are plain
  `<div>`/`<span>` elements with no `data-user-id` and no dedicated listener. The only click
  handler on these rows is the row-level one (`ui-manager.ts:2680-2702`), which opens the talk
  editor/detail regardless of where inside the row you click — so today, clicking a name just
  opens the talk, not the person.
- **The peer id is already one property away, not missing data:** the OUT row's matched-names are
  derived from `Object.values(conversations).filter(c => c.talkId === talkId)`
  (`ui-manager.ts:2451-2453`), and each conversation record already carries `otherUserId`
  (`app.ts:2332-2335`, `2395-2398`) — the code just maps it down to a display-only name string,
  discarding the id. The IN row's senders come from `cluster.senders`, already a real
  `senderId → {senderId, senderName}` map (`ui-manager.ts:2547`, `2739-2741`), also reduced to a
  name-only string for display. No new data plumbing is needed, only re-threading the ids that are
  already present into the click targets.
- **DM-opening machinery already exists** — reuse it, don't build a second path:
  `openDirectConversationWithPeer(peerId, peerName)` (`ui-manager.ts:7544`, finds-or-creates a
  conversation for a peer id) and `showConversationDetail(conversationId, threadTalkId?)`
  (`ui-manager.ts:4852`, opens the overlay bound to a specific talk thread). Whichever one N1
  settles on as the DM-toast destination should be the same one used here, for one consistent "go
  to DM" behavior across the app rather than two.
- **Multi-partner talks already carry a real list, not just a count:** a broadcast talk answered by
  several people has more than one entry in the same `conversations`-filter (OUT) or
  `cluster.senders` (IN) source above — so "trace back to whom" can genuinely mean more than one
  person per talk, not just one.

**Work**

- [ ] Make the matched-names (OUT) and sender-name/"from …" (IN) elements clickable, threading the
      already-available `otherUserId`/`senderId` onto each as a `data-user-id` (or similar), with a
      dedicated listener that `stopPropagation()`s so it doesn't also trigger the row's
      open-talk-editor/detail behavior (same coexistence pattern the actions buttons already use at
      `ui-manager.ts:2200-2272`/`2680-2702` — a new click target added to an existing row without
      disturbing the row's own click behavior).
  - [x] Single exchange partner: click navigates straight to the DM with that person via the N1
        destination.
        **Done 2026-07-30.** `data-matched-people`/`data-sender-people` (JSON `{id,name}[]`) +
        one delegated handler; single-person case navigates via `navigateToGraphNode`.
  - [x] Multiple exchange partners: click opens a "choose who to DM" list, modeled on the existing
        `#peer-send-picker-modal` (`user-detail-view.ts:952-1000` — list rows + modal skeleton +
        confirm/cancel wiring), adapted from "pick which talks to send" to "pick which person to
        DM." Picking one navigates via the same N1 destination.
        **Done 2026-07-30.** No confirm/cancel step needed here (unlike the send-picker's
        multi-select) — since picking is single-choice, a row click both picks and closes.
- [x] Test: `stage2` — an OUT talk matched by exactly one responder: clicking their name in the
      Talks-tab row opens the DM with them directly.
      **Done 2026-07-30:** `74-talk-row-person-traceback.spec.ts` ("OUT row: clicking the sole
      matched name…"). Confirmed it fails without the fix, passes 3/3 with it.
- [x] Test: `stage3` — an OUT talk matched by two or more responders: clicking the matched-names
      area opens a picker listing all of them; choosing one opens that specific DM.
      **Done 2026-07-30:** `74-talk-row-person-traceback.spec.ts` ("OUT row: two matched
      responders opens…"), 3-user real broadcast+match setup. Confirmed it fails without the fix,
      passes 3/3 with it.
- [x] Test: `stage2` — an IN talk row's sender name: clicking it opens the DM with the sender,
      without also opening the talk editor/detail (click doesn't double-fire).
      **Done 2026-07-30:** same spec, "IN row: clicking the sender name…" — required a real
      broadcast-and-receive setup rather than the fast-match helper, since the fast helper's
      synthetic conversation never populates a real `senderId` on the incoming cluster (only the
      answered-history fallback path does, which has no id by design — noted as a pre-existing,
      out-of-scope quirk). Confirmed it fails without the fix, passes 3/3 with it.

---

## O. Peer detail: exchanged talks as pickable DM context, not just one thread from scratch `[Opus]`

Requirement 2026-07-29 (Bernard): from Contacts, clicking a person should show a page of all talk
exchanges and statistics between the two of us; DM should then be able to use *any* of those talks
as pre-existing context to start from, not just one context from scratch.

**Audit (2026-07-29).** The exchanged-talks list and the statistics already exist — the gap is
that the list isn't interactive, and DM can only be scoped to a talk that already happens to have
messages, not any exchanged talk.

- **Statistics: already built, this part of the ask is essentially done.** `computeLocalStats`
  (`user-detail-view.ts:400-424`) computes sent/received talk+match counts, mutual matched talks,
  and mutual tag count, purely from local data (no server call — the old `peer-routes.ts` server
  endpoint this used to hit was deleted; the formula moved client-side, see
  `src/shared/peer-summary-types.ts:1-4`, `src/web/services/local-peer-derivation.ts:1-22`).
  Rendered by `renderStatsHtml` (`user-detail-view.ts:561-618`) inside the peer-detail overlay.
  Only gap versus "statistics of two": no message-count or "known each other since" stat — minor,
  optional follow-up, not a blocker.
- **Exchanged-talks list: already built, but not clickable at all.** `#peer-talk-history-list`
  (`fetchAndRenderHistory`/`renderHistory`, `user-detail-view.ts:785-865`) already shows **every**
  exchanged talk — title, type badge, sent/received direction, outcome (match/mismatch/pending),
  relative date — with sort and filter controls. But it has **zero click handlers**: confirmed a
  single occurrence of `.peer-history-item` (`:852`) with no listener attached anywhere. It's pure
  display today.
- **A separate, narrower list is the only thing that's clickable, and it's incomplete.**
  `#peer-conversations-section` (`renderMatchedConversations`/`refreshPeerThreadList`,
  `user-detail-view.ts:668-783`) shows one row per talk in `conv.relatedTalkIds` — but that array
  is **only populated once a message tagged with that talkId has actually been sent**
  (`web-conversation-service.ts:212-236`). So a matched talk with zero messages yet, or any
  mismatch/pending talk, never appears here and has no way to become the active DM context — even
  though it's already sitting, inert, in the history list above.
- **"Start DM from scratch" is the only generic entry point, and it really does start from
  scratch.** `openDirectConversationWithPeer` (`ui-manager.ts:7544`, reached via
  `openDirectConversation` at `7600-7601`) always opens the talk-independent `'direct'` DM with no
  talk-context parameter at all (`app.ts:5207`) — there is no way to say "start this DM, but with
  talk X as the opening context."
- **This is a thread-selection problem within one conversation, not a multi-conversation picker.**
  Conversations are 1-per-pair (`buildPairConversationId`, `web-conversation-service.ts:250`), and
  a talk becomes a "thread" inside that one record via `conv.threadSummaries[talkId]`
  (`user-detail-view.ts:692-693,732`; written `ui-manager.ts:8489-8538`) plus per-message `talkId`
  tagging. So "pick any exchanged talk as context" means being able to open/create a
  `threadSummaries[talkId]` entry for a talk that doesn't have one yet, not picking among several
  separate conversations. `currentThreadTalkId` (set once at open time, `ui-manager.ts:4852,4869`)
  already has no in-overlay way to switch mid-session either — confirmed no tab/dropdown control
  exists (only leaving and reopening from a different row resets it, `ui-manager.ts:4956-4970`).

**Work**

- [x] Make `#peer-talk-history-list` rows (`user-detail-view.ts:785-865`) clickable — every
      exchanged talk, not only ones already in `relatedTalkIds`. Clicking one opens the DM with
      that peer, with that talk as the active thread context (creating a `threadSummaries[talkId]`
      entry on demand if one doesn't exist yet, rather than requiring a message to have been sent
      first).
      **Done 2026-07-30.** Turned out `showConversationDetail` already tolerates an arbitrary
      `threadTalkId` with no pre-existing `threadSummaries[talkId]` entry — it just becomes the
      active scope, and the entry forms naturally once a message is sent under it. No extra
      "creation" logic needed beyond wiring the click.
- [x] Extend `openDirectConversationWithPeer`/`showConversationDetail` (`ui-manager.ts:7544`,
      `4852`) to accept an optional `talkId` context param so both the generic "message this
      person" entry point and the history-list click path go through one consistent function,
      instead of the history list needing its own separate opening logic.
      **Done 2026-07-30.** `showConversationDetail` already had it; added the same optional
      `talkId` to `openDirectConversationWithPeer` and the `openDirectConversation` dep it's bound
      through, so the history-list click reuses this one path instead of inventing its own.
- [x] Decide (small design call) whether switching which talk is the "active context" mid-session,
      inside an already-open conversation, is in scope now or a follow-up — today there's no
      in-overlay control for that at all; at minimum, opening from a *different* history row while
      already in a conversation with the same peer should re-scope to the newly picked talk.
      **Decided 2026-07-30:** already correct by construction, no extra work needed — every history
      row click goes through the User layout first (back-then-click-another-row), and
      `showConversationDetail` unconditionally overwrites `currentThreadTalkId` on every call, so
      re-scoping already happens naturally. An in-overlay switcher (without leaving to the User
      layout first) is a follow-up, not required by this item's wording.
- [x] Test: `stage2` — clicking a *mismatched* or *pending* exchanged talk in the history list
      (never previously messaged) opens a DM with that talk as context — no message required to
      exist first.
      **Done 2026-07-30:** `76-peer-history-clickable.spec.ts` ("a mismatch talk with no
      conversation yet…"). Confirmed it fails without the fix, passes 3/3 with it.
- [x] Test: `stage2` — clicking a *matched-with-existing-messages* talk still opens the same
      thread it already would via `#peer-conversations-section` today (no regression).
      **Done 2026-07-30:** same spec's second test, first half (clicking the already-matched
      talk's history row).
- [x] Test: `stage3` — two different exchanged talks with the same peer, picked one after another
      from the history list, each open/create their own distinct thread context rather than
      collapsing into one.
      **Done 2026-07-30 (as stage2, not stage3 — two-user setup was sufficient, a third user
      wasn't needed to exercise "two talks, one peer"):** same spec's second test, second half —
      confirmed both talks share the same conversationId (one-per-pair) but re-scope
      `currentThreadTalkId` distinctly each time.

---

## P. Me tab: robust Q&A → source-talk traceback (no dead ends) `[Opus]`

Requirement 2026-07-29 (Bernard): each question/answer pair on the Me tab should be traceable back
to the talk it came from; the user should not hit a dead end in most cases.

**Audit (2026-07-29).** Traceback already exists at the entry level, but it has one real dead-end
case, no traceback at all for individual questions inside a multi-question entry, and one
inconsistency in destination.

- **Entry-level traceback exists and mostly works.** Clicking an `.answer-talk-item` row
  (`answers-view.ts:535-541`) calls `showTalkDetail(talkId)` (`ui-manager.ts:2952`, impl
  `4599-4645`), which opens instantly if the talk is cached locally (`4617-4629`), or requests it
  via `demandFullTalk` (`app.ts:4886-4905`) otherwise. `talkId` itself is never missing by
  construction — it's a required field written at record-save time (`answer-history-storage.ts:15`;
  `ui-manager.ts:6049-6124`) or derived straight from the `myTalks` object key in the legacy path
  (`answers-view.ts:389, 496`).
- **The actual dead end: a talk that no longer resolves (purged/expired/never re-synced) fails
  silently past a bare error toast, with no recovery.** When `demandFullTalk` can't resolve the
  talk, `app.ts:4899-4903` calls back `null`, and `ui-manager.ts:4636-4641` shows
  `t('talksCouldNotLoadRetry')` as an error toast — **the translation key promises a retry, but no
  retry actually happens or is offered.** This is the literal dead end: talkId is a real pointer
  (not missing data), but a dangling one with no recovery path once it fails.
- **No traceback at the individual-question level — only ever "open the whole talk."** When one
  Me-tab entry groups multiple Q&A pairs (`renderAnswerItemsHtml`, `answers-view.ts:230-321`, one
  `.answer-outcome-item` per pair), there is **no click handler, `data-question-id`, or
  scroll/anchor logic anywhere** in that function — confirmed via grep, no `scrollIntoView`/anchor
  usage tied to a specific question exists in this file or `talk-response-dialog.ts`. Clicking
  anywhere only opens the talk as a whole via the one parent-row listener; there's no way to land
  on the specific question that produced a given answer.
  - **Partial infrastructure already exists for this, unused:** each answer item already computes
    and displays a `contextHash`/`contextLabel`/`contextPath` (`answers-view.ts:66-149,176-219,
    272-273`) showing *where in the flow/route DAG this answer sat* — but it's rendered as inert
    text, never wired to a click or passed into the destination dialog to jump/scroll to that
    question.
- **Destination asymmetry, worth resolving or at least documenting:** `showTalkDetail` branches on
  `myTalks[tid].role` (`ui-manager.ts:4620-4629`) — `'created'` opens the talk **editor**
  (`4623`), `'answered'`/`'copied'` opens the **read-only response dialog** (`4626`). A talk the
  user answered on themselves (self-test of their own created talk) keeps `role === 'created'`
  (`ui-manager.ts:6007-6010`), so it routes to the editor instead of the answer-viewing dialog an
  ordinary incoming-talk answer gets — a different experience for what the user perceives as "the
  same kind of thing: my answer to a question."

**Work**

- [x] Fix the actual dead end: when `demandFullTalk` fails, offer a real retry (re-attempt the
      mesh/identity-key resolution `app.ts:4886-4905` already does) instead of a one-shot error
      toast whose copy already claims retry behavior it doesn't perform. If retry genuinely can't
      succeed (talk gone for good), the toast/message should say so plainly rather than implying a
      retry that isn't there.
      **Done 2026-07-30.** `showNotification`'s new `retry` option re-invokes the exact same
      `showTalkDetail` call on click, so the identical lookup runs again (can succeed later if the
      mesh cache catches up). Left the existing copy ("Check your connection and try again.") as
      is — it now honestly describes what clicking does, rather than a new "talk gone for good"
      message; a truly permanent failure still shows this same retryable toast; a follow-up could
      add attempt-count-based wording if that's ever needed, not required by this fix.
- [x] Wire the already-computed `contextHash`/`contextPath` into the traceback: passing it through
      to `showTalkDetail`/`showTalkResponseDialog` so opening a multi-question entry can
      scroll/highlight the specific question that produced the clicked answer, instead of only
      landing on the talk as a whole.
      **Done 2026-07-30 — build-order item 13.** Used `questionId` as the wire format instead of
      `contextHash` (already unique per question, matches how `.review-question-block` is keyed).
- [x] Resolve or explicitly document the `'created'`-vs-`'answered'` destination asymmetry for
      self-answered own talks — decide whether self-test answers should route to the same
      read-only response view as any other answer, or whether routing to the editor is intended
      and just needs a one-line note so it isn't mistaken for a bug later.
      **Done 2026-07-30.** Decided self-test answers route to the read-only response view, same as
      any other answer — Me-tab clicks always mean "show my answer." `showTalkDetail` gained a
      `preferAnswerView` option; `showTalkDetailAsAnswer` (bound only to `displayAnswersList`)
      passes it, leaving the Talks-tab OUT-row and "My Talks" dialog editor-opening behavior
      untouched for `role:'created'` talks reached from those two contexts.
- [x] Test: `stage1` — a talk purged from local storage: clicking its Me-tab entry surfaces a real
      retry affordance (not just a dead toast), and a successful retry opens the talk normally.
      **Done 2026-07-30:** `35-me-answer-dead-end-retry.spec.ts`. Confirmed it fails without the
      fix and passes 3/3 with it.
- [x] Test: `stage1`/`stage3` — a multi-question flow/route entry: clicking an individual nested
      question's answer opens the talk scrolled/highlighted to that specific question, not just
      the talk's first screen.
      **Done 2026-07-30:** `36-per-question-deep-link.spec.ts` (stage1). Confirmed it fails
      without the fix and passes 3/3 with it.
- [x] Test: `stage1` — a self-answered own-created talk's Me-tab entry: confirm which destination
      it opens (editor or response view) matches the resolved design decision above.
      **Done 2026-07-30:** `05-talks-edit.spec.ts` — "Self-answered own talk: Me-tab entry opens
      the response view, not the editor." Confirmed it fails without the fix, passes with it.

---

## R. Fast-first-render as a general principle for every long list, not just Contacts `[Sonnet]`

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

- [ ] Split `displayContactsList()`'s render into two phases: render `visiblePeers.slice(0, N)`
      (first-chunk size to be decided, e.g. matching `CREATOR_REPLY_PAGE_SIZE`'s precedent of 25,
      or a smaller "above the fold" count) **without waiting on `runBeforeRender`'s awaits**, then
      run `contactPreRenderSync`/`prefetchPeerLocations` in the background and re-render/append the
      remaining peers once they resolve — mirroring the existing Replies-panel slice pattern
      (`ui-manager.ts:191,320,2898,2935-2941`), just applied here for the first time.
  - [ ] Decide whether "the rest" appends automatically in the background (true "quietly" per the
        requirement) or behind a `#load-more`-style control like the Replies panel uses — the
        requirement's wording ("backend thread retrieves all data quietly") points at automatic
        background fill, not a manual button, but confirm before implementing.
- [ ] Make sure the first-chunk render doesn't depend on `contactPreRenderSync`/
      `prefetchPeerLocations` data at all for its basic fields (name, sort key) — only badges/
      distance/etc. that genuinely need that data should update in place once it arrives, so the
      first chunk is a real fast-path, not just a smaller version of the same blocking wait.
- [ ] Revisit M6's `prefetchPeerHeadshots` design in light of this: it should follow the same
      non-blocking, fill-in-place pattern as the location/mesh-sync data once this item lands, not
      add a third sequential blocking `await` to `beforeRender`.
- [ ] Add a real timing assertion to (or alongside) `04-heavy-user-gui-stress.spec.ts` — the
      existing `warnIfSlow`/`catch`-and-log checks should gain a hard time-to-first-row bound (e.g.
      "first contact row visible within Xs of navigating to Contacts, with 500 seeded contacts"),
      so this can't silently regress again the way it did before this requirement was raised.
- [ ] Test: `stage5`/`mass` — with 500 seeded contacts, the first chunk of rows is visible well
      before `contactPreRenderSync`/`prefetchPeerLocations` would have resolved (assert on wall
      time, not just eventual correctness); the remaining ~475 rows appear shortly after, without
      the user having to do anything if "automatic quiet fill" is the chosen design.

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
- [ ] Apply the same slice-first-N + quiet-background-fill treatment as R1, using whatever shared
      helper R's "Recommended approach" below lands on.
- [ ] Test: `stage5`/`mass` — with 500 seeded talks, the first chunk of OUT+IN rows is visible
      immediately on opening the Talks tab; the rest fills in without blocking the tab.

### R3. Me tab Answers list

- **Audit (2026-07-29).** Same shape as R2: `displayAnswersList` (`answers-view.ts:337`) has no
  `async`/`await` at all, called synchronously from the nav handler (`ui-manager.ts:1716`) — no
  blocking chain. But both its row builders iterate the *entire* history array and
  `appendChild` per entry with no limit (`answers-view.ts:389,455`). Same advisory-only timing
  check exists (`warnIfSlow('me render', contentMs, 5000)`, `04-heavy-user-gui-stress.spec.ts:295`).
- [ ] Same slice-first-N + quiet-background-fill treatment, same shared helper.
- [ ] Test: `stage5`/`mass` — with 500 seeded answers, the first chunk of entries is visible
      immediately on opening the Me tab; the rest fills in without blocking the tab.

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

- [ ] Extract one small shared helper — e.g. `renderListProgressively(container, items, {
      firstChunkSize, renderRow, onFirstChunkRendered? })` — that does exactly the R1 two-phase
      split (slice first N, write it immediately, then process the rest off the main blocking path
      and append/patch in place) and use it for R1 (Contacts), R2 (Talks), and R3 (Answers) rather
      than three separate implementations. R4/R5 can adopt it later without urgency.
- [ ] Land this helper alongside (or as part of) R1's implementation, since R1 is first in Q's
      build order and needs the most complete version of it (first-chunk render decoupled from a
      genuinely blocking prefetch chain, not just decoupled from a big array).
- [ ] Test: unit test for the shared helper itself (first-chunk-immediate, remainder
      deferred/appended, no item duplicated or dropped across the two phases) — one test giving
      confidence to all of R1-R3 rather than duplicating the same assertion three times.

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

**Work**

- [ ] Implement `CHECKPOINT_CREATED` as a new ledger event kind (SRS §28.9.2) — merkle root over
      the sorted CIDv1 array of the pruned range, SEA-signed, chained via `prev` like any other
      ledger event — and the corresponding pruning-window logic (keep the last M=500 events in
      full detail per SRS §28.9.2).
- [ ] Implement the delta-sync protocol change SRS §28.9.6 requires: when a peer requests an event
      that's been pruned, return the merkle proof instead of the raw event node.
- [ ] Implement the analogous message-checkpoint structure for `pairConversations/*/messages/*`
      (SRS §28.9.4 — commits to both message ids and ciphertext hashes; keep the last
      K_retain=200 messages per conversation in full detail).
- [ ] Decide the real numeric retention windows for production (SRS §28.9 proposes N=100/M=500 for
      the ledger and K=50/K_retain=200 for messages as starting points, not settled production
      values) — this is the one piece of the design that's a policy choice, not an implementation
      detail.
- [ ] Test: unit — a pruned range's checkpoint correctly verifies an O(log N) proof for an
      arbitrary event/message in that range, and rejects a forged proof.
- [ ] Test: `stage2`/`stage3` — after enough messages/events to trigger pruning, older
      full-detail nodes are gone from local storage, the checkpoint exists, delta-sync between two
      peers still succeeds (one offering a proof instead of raw history), and message history still
      renders correctly in the UI up to the retention window.

---

## T. Chatroom-hierarchy broadcast isolation leak: room-scoped mesh session gets stomped back to a stale boot-time room `[Opus]`

Found 2026-07-30 investigating a genuinely reproducible (non-flaky, fails in full isolation)
failure in `stage2/00h-chatroom-hierarchy-broadcast.spec.ts` ("Broadcaster on North America does
not register inbox for peer joined only under United States" — FR-BM-7, parent-room broadcasts
must not reach a peer who only joined a child/leaf room).

**Root cause #1 (found and fixed):** `initializeChatrooms()` (`app.ts`, the boot-time flow) does
`chatroomId = findOptimalChatroomHierarchical(...)` (often resolves to `global`), sets
`this.currentChatroomId = chatroomId`, then `await`s `chatroomService.joinChatroom(chatroomId,
...)` — a Gun write with retries that can take a while — before finally calling
`chatroomService.subscribeToMembers(chatroomId, ...)`. If the user has already navigated to a
*different* room during that await window (e.g. immediately clicking into a room right after
`bootstrapUser` returns, as this test and any fast-navigating E2E flow does), this callback's
closure-captured `chatroomId` is stale: it wins the single-slot `subscribeToMembers` race against
the newer room's subscription and silently re-scopes the live `PeerMeshService` session — and any
subsequent room-broadcast issued from it — back to the stale boot-time room, even though
`this.currentChatroomId`/the UI correctly show the room the user navigated to. Confirmed via live
instrumentation: Tom's mesh session properly scoped to `north-america` (empty member/neighbor set,
correct — he's alone there), then a `WebChatroomService.membersListCallback` fired with a
closure-captured `chatroomId === 'global'`, reconnecting Tom's mesh to Jerry (who transiently
touches `global` during his own boot) and leaking the broadcast to him.
- [x] **Fixed:** guard the boot-time `subscribeToMembers` call (and its callback) on
      `this.currentChatroomId === chatroomId`, skipping the stale subscription entirely if the
      user has since navigated elsewhere. Verified: no regressions across headcount, chatroom-nav,
      mesh-ping, mesh-response-match, and P0 direct-talk-delivery specs; full unit suite (1048
      tests), `tsc`, and `lint` all clean.

**Root cause #2 (found, not yet fixed):** the same test *still* fails after the fix above — a
second, distinct trigger re-invokes the same stale-'global'-reassignment pattern. Live
instrumentation after the fix showed `this.currentChatroomId` itself (not just the mesh session)
reverting to `'global'` a second time, from the same `subscribeToMembers` singular-slot race, but
the synchronous stack trace only shows the debounced-timeout caller inside
`WebChatroomService` (async origin lost) — the actual second caller that invokes the
equivalent of `initializeChatrooms()`'s boot assignment (or emits `'chatroomChanged'` with
`'global'`) a second time, later in the session, was not pinned down before time was reallocated
to other work this session. Neither of the two known `'chatroomChanged'` emit sites
(`chatrooms-view.ts:264`'s row-click, `app.ts:931`'s location-suggestion-banner Join click) fire in
this test, so it's something else — possibly a second, independent call to
`findOptimalChatroomHierarchical`-style room (re)assignment triggered by a location update, a
reconnect/resume path, or similar.

- [ ] Find the second caller: instrument `subscribeToMembers` itself (`web-chatroom-service.ts`)
      with a synchronous stack trace at the exact call site (not inside the debounced Gun
      callback, which loses the async origin) to catch the actual second invocation with `'global'`
      as the target room.
- [ ] Fix it the same way as root cause #1 (guard against re-asserting a stale/default room once
      the user has navigated elsewhere), or find the shared underlying cause and fix both at once
      if it's the same trigger manifesting twice.
- [ ] Once fixed, confirm `00h-chatroom-hierarchy-broadcast.spec.ts`'s "does not register inbox"
      test passes reliably (run it standalone at least 3× in a row, per this session's own
      verification convention for flaky-looking failures).
- [ ] Audit whether this same class of bug (boot-time default-room assignment racing a fast
      subsequent navigation) affects other mesh-room-scoped features beyond broadcast — e.g.
      direct-peer-send, mailbox fallback targeting, or presence — since the underlying race is in
      shared boot/navigation plumbing, not broadcast-specific code.

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
