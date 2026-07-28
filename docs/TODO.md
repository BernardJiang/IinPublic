# IinPublic TODO

Last updated: 2026-07-28

This file tracks only open work. Completed items are archived in `docs/completed.md`.
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specifications.md` (§19.13, §19.14, REQ-P2P-09–29; mesh talk delivery design §23; libp2p/IPFS §25 — supersedes Phase D §24; find-similar §22)

## Model routing legend

Each item is tagged with the cheapest model that can do it reliably, to optimize token spend:

- **`[Opus]`** — distributed-correctness / ordering / architecture is the hard part; design mistakes cascade.
- **`[Sonnet]`** — standard implementation against an existing spec or pattern.
- **`[Haiku]`** — mechanical, fully specified work; running test suites; scaffolding from a written design.

Token-saving rules: for `[Opus]` items, have Opus write a short design note first, then hand implementation + tests to Sonnet. `- [ ] Test:` items belong to whichever model implemented the step.

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

Source: `docs/gui-layout-catalog-and-e2e-plan.md` Part 6

> Shipped subset (smoke set, device profiles, size sweep, cross-platform harness,
> X1/X2) archived in `docs/completed.md` 2026-07-19.

- [~] CI runners: Mac mini (P2 Electron), Windows (P3), Linux (P4) — added `test:e2e:native-app:win` / `:linux` scripts; wiring these into the actual CI system is left to the CI config (needs the runner infra).
- [~] **X3** identity linking website ↔ webapp — scaffolded skipped spec (needs I's protocol + real website/webapp on CI). `(nightly)`
- [~] **X4** mobile-profile ↔ desktop-app matching + threads — scaffolded skipped spec. `(nightly)`
- [~] **X5** three-platform stage-3 network incl. thread isolation — scaffolded skipped spec. `(nightly)`
- [~] **X6** offline/mailbox across platforms, both directions — scaffolded skipped spec. `(nightly)`

> **G verification:** config parses; `platform-smoke` runs on `chromium` + (with `E2E_DEVICE_PROFILES=1`) `iphone-webkit`/`android-chromium`; `cross-platform` X1/X2 enumerate. X3–X6 are `test.skip` scaffolds awaiting the native/website build + item I on the CI runners.

### I. Multi-device identity linking (redesign §10, catalog T10) `[Opus]`

Source: `docs/gui-redesign-plan.md` §10 — user decision 2026-07-13

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

Source: `docs/gui-redesign-plan.md` §11 — user decision 2026-07-13

No server login/logout exists; a public-PC session leaves an identity behind. Build a verifiable local wipe with optional encrypted handoff to a linked personal device first.

> Shipped subset (wipe engine, erase dialog, handoff archive + merge, stage1/72,
> stage2/72) archived in `docs/completed.md` 2026-07-19.

- [~] **New** `cross-platform/x7-sync-then-erase.spec.ts` — scaffolded skipped spec (needs the P2P handoff transfer + receiver import wired). `[Opus]`

> **J verification:** handoff build/merge has 7 passing unit tests; `stage1/72` (wipe + fresh boot) and `stage2/72` (sync-progress + gating) compile and drive the full UI; `tsc`/`lint` clean. The wipe engine and dialogs are wired into Settings; the encrypt-to-pub P2P transfer + receiver import are the remaining app.ts wiring, tracked by X7.

---

## K. TechSupport as a true built-in presence `[Opus]`

Source: `docs/design/techsupport-bootstrap-contract.md` (contract to be amended by K1–K3 below).

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

- [ ] **Run it against a real deployment and paste the numbers here**, then decide a retention
      policy per path. A reaper without an agreed policy is how real data gets lost, so the
      numbers come first.
- [ ] Tombstone semantics: Gun is append-oriented and P2P, so a "delete" that a peer never sees can
      be resurrected on the next sync. Any reaper needs a tombstone the peers honour, or a
      compaction that runs on each device against its own store.
- [ ] Decide whether trimming is relay-side, device-side, or both. Under the P2P model the relay
      cannot be the sole authority — each device holds its own Gun graph.
> **Blocked on you, not on code.** The remaining L2 items are policy, not implementation:
> how long a room visit stays interesting, what a tombstone means on a graph where a peer that
> was offline during the delete can resurrect it on next sync, and whether trimming runs on the
> relay, on each device, or both. Under the P2P model the relay cannot be the sole authority —
> every device holds its own Gun graph — so "delete" is closer to "convince every replica to
> forget", which is a design decision before it is a task.

> **Open question:** are the lifetime badges worth their cost at all? If "visits ever" is not a
> number users act on, replacing both with "active now" deletes this entire problem class. Worth
> answering before building the reaper.

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
