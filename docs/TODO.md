# IinPublic TODO

Last updated: 2026-08-02

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
  reader); W's Gap 1 (**complete 2026-08-01**) and X (**complete 2026-08-01**) — both already
  shipped, see §W/§X; Y1 (new 2026-08-01 — stop stamping `authorId` to the copier at copy time,
  seed `original*` fields from the source talk instead, same shape as §V's already-built
  `buildRevisedTalkDraft` seeding, just applied to the copy path); Y2 (revised 2026-08-01, no
  longer needs a design note now that the tombstone half was dropped — fix
  `graph-size-report.ts`'s stale matcher, then generalize §L2's `planVisitCounterPrune` pattern to
  `ownerIncomingTalkIndex/<userId>/<identityKey>`). None of these need new architecture beyond the
  Session-1 dispatcher itself.
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
  - U (new 2026-08-01 — **complete 2026-08-01**) — broadcast to a contact group with
    deferred/offline delivery, real-browser-verified. See §U.
  - V (FR-TK-7, spec'd 2026-01-19, never built — **complete 2026-08-01**) — Auto Linear Capture
    from DM shorthand, including the two-author credit model and the append/edit-mints-new-id
    policy. Real-browser-verified, not just unit-tested. See §V.

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

### Current state (K1–K6, L1, L2 complete; K7 new)

K1, K2, and K3 (below) landed 2026-07-25/26 — see `docs/completed.md` and the three design notes
(`docs/design/techsupport-k1-design-note.md`, `-k2-`, `-k3-`) for the implementation record. K4
(fixture 2026-07-26, partial conversion 2026-07-30, full conversion 2026-08-01), K5 (fully,
including its `answeredBy` question — resolved 2026-08-01), K6 (fully, including its two stage1
tests), L1 (CRDT counter, including retiring the legacy-scalar fallback), and L2 (device-side
size-triggered prune + fold-aggregate retention, plus the extended time/location/user size-report
breakdown) have since landed too — see their `docs/completed.md` entries and §L2's own 2026-08-01
decision note. What's left for the K/L series:

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

> **Complete 2026-08-01** — see `docs/completed.md` (2026-07-26: committed stage0 fixture + shared
> baseline guard; 2026-08-01: full remaining-call-site conversion, 58 files / 119 sites, plus the
> `resetTalksMatchingSession` gap fix). Zero `maybeClearGunDatabases()` references remain outside
> the `clearGunForStageNSpec` helpers themselves.

### K5. TechSupport DM Q&A: ignore talks, answer questions `[Opus]`

> **Complete 2026-07-27/28** — see `docs/completed.md` and design note
> `docs/design/techsupport-k5-design-note.md`. TechSupport ignores all talks, auto-answers known
> questions from a signed FAQ bundle, queues new questions for a human. The `answeredBy` open
> question is resolved 2026-08-01 — multi-operator answering became its own item, **K7**, instead.

---

### K7. TechSupport answer delegation: redirect a question, relay the answer back `[Opus]`

**Deferred 2026-08-01 (Bernard).** Explicitly shelved, not forgotten — no design note started,
no implementation work. Revisit when it becomes a priority; the scope below is preserved as-is
so a future session doesn't have to re-derive it.

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

> **Complete 2026-08-01** — see `docs/completed.md`. L1: the three chatroom badges (active
> members, lifetime visits, lifetime unique visitors) are a CRDT G-Counter now, and the legacy
> shared-scalar fallback is fully retired. L2: device-side, size-triggered, fold-before-delete
> pruning (`DEFAULT_VISIT_COUNTER_MAX_SLOTS = 500`) plus the extended `graph-size-report.ts`
> (topLocations/topUsers/ageBuckets breakdown).

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

> **R1/R2/R3 complete 2026-07-31** — see `docs/completed.md`. Contacts (the worst case — a genuine
> ~3.2s blocking pre-render chain plus no pagination), Talks, and Me/Answers all render their first
> chunk immediately and fill the rest in quietly, via one shared helper
> (`render-list-progressively.ts`). R4 (chatroom members) and R5 (conversations/support-inbox)
> stay explicitly low-priority/no-immediate-work below — not part of this pass.

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

> **Done 2026-07-31** — `src/web/ui/render-list-progressively.ts`, unit-tested
> (`render-list-progressively.test.ts`, 6 tests), used by R1/R2/R3 — see `docs/completed.md`.

---

## S. Adopt merkle-checkpoint pruning for the ledger and conversation messages `[Opus]`

> **Implementation complete 2026-08-01** (design note:
> `docs/design/section-s-merkle-checkpoint-pruning-design-note.md`) — see `docs/completed.md` for
> the full record, including four real, previously-invisible bugs real E2E testing found and
> fixed. **Two items stay open below**, not silently closed: the production retention-number
> formula (decided, not yet implemented) and an unreliable message-pruning bug.

- [ ] Decide the real numeric retention windows for production. **Decided 2026-08-01 (Bernard):
      derive the per-category slot counts from one shared total-storage budget, not three
      independently guessed numbers** — see "Storage-budget-driven retention formula" below.
      **Not yet implemented** — `graph-size-report.ts` needs an avg-bytes-per-node extension and
      the checkpoint-window/`DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS` constants need to switch from
      flat literals to values derived from the formula.
- [ ] **Message-side pruning is unreliable in a real browser** — `prunedThroughCount` sometimes
      advances without the corresponding deletes landing. Root cause not yet found; see the design
      note's Item 7 "Done" note and `30-ledger-message-pruning-e2e.spec.ts`'s inline comments for
      the investigation so far. Not blocking, but not silently passing either.

**Storage-budget-driven retention formula (2026-08-01).** Replaces the "three separately guessed
numbers" framing above with one shared input: a single total local-retention budget `B` (bytes),
split evenly across the prunable categories, converted to a slot count per category using each
category's *measured* average node size — not another guess. This also folds in §Y2's incoming-talk
clusters, which were left on a flat, unrelated `DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS = 500` guess
with no connection to the ledger/message numbers.

```
B = TOTAL_LOCAL_RETENTION_BUDGET_BYTES        # one tunable constant, e.g. 8 MB to start
categories = { ledger, messages, incoming_talks }   # extend the list if a 4th ever qualifies

for each category c in categories:
  share_c    = B / len(categories)            # equal thirds — "balanced" means no category
                                               # is a priori favored, not equal item counts
  avg_bytes_c = measured average serialized size of one node in c
                (graph-size-report.ts, extended to sum byte length per category —
                 same "measure before reaping" discipline §L2/§Y2 already established)
  cap_c      = floor(share_c / avg_bytes_c)   # slots, not bytes

when live_count_c > cap_c: prune oldest-first down to cap_c
  (unchanged — planVisitCounterPrune / the checkpoint window / planIncomingTalkClusterPrune
   already do exactly this; only where cap_c comes from changes)
```

**Worked example**, using the per-node byte sizes the spec already publishes (SRS §28.7/§9.5) —
not invented for this: ledger event ≈350B, encrypted message ≈800B. Incoming-talk clusters have
no published average yet (size varies with a talk's own question count — up to ~5KB for a complex
route DAG per SRS §28.7's own `talks/<talkId>` estimate, since the cluster wire format embeds that
same `questionsJson` plus a small senders map) — this is exactly the number the size-report
extension needs to measure for real before the cap is set, not guess: the worked example below
uses a placeholder ~1.5KB average to illustrate the mechanism only.

| Category | share (B=8MB÷3) | avg bytes/node | cap (slots) |
|---|---|---|---|
| ledger | 2.67 MB | 350B | ≈7,900 events |
| messages | 2.67 MB | 800B | ≈3,500 messages |
| incoming-talk clusters | 2.67 MB | ~1.5KB (placeholder, needs measuring) | ≈1,870 clusters |

This is why a flat "500 for everything" (today's `DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS`) isn't
storage-fair: a cluster node is ~2–4× bigger than a message and ~4× bigger than a ledger event, so
equal *slot counts* across categories means wildly unequal *actual bytes* — a budget-driven split
gives the bigger-per-node category fewer slots for the same storage footprint, which is the
actually-balanced outcome. `B=8MB` itself is a starting default in the same spirit as
`DEFAULT_VISIT_COUNTER_MAX_SLOTS` — ship adjustable, tune once real deployment numbers exist.

---

## T. Chatroom-hierarchy broadcast isolation leak: room-scoped mesh session gets stomped back to a stale boot-time room `[Opus]`

> **Complete 2026-07-30** — see `docs/completed.md`. Both root causes resolved; root cause #2
> was a test-helper issue (a shared E2E click-helper's Global-default fallback), not product code.

---

## U. Broadcast to a contact group, online or not, with deferred delivery `[Opus]`

> **Complete 2026-08-01** — see `docs/completed.md`. Second broadcast entry point (Contacts tab,
> beyond room broadcast): pick a named group (*All*, a `RelationshipLabel`, or any distinct
> `customLabel` in use — v1-simplest, no schema change), send regardless of online status, reusing
> `deliverTalkToReceiversOverMesh` verbatim (mesh-flood-plus-existing-mailbox-fallback, nothing new
> needed for "defer until online, drop after timeout"). Unit-tested (13 tests) and real-browser
> verified (`32-broadcast-to-contact-group.spec.ts`).

---

## V. Auto Linear Capture: create/append a Talk from DM shorthand (FR-TK-7 — spec'd day one, never built) `[Opus]`

> **Complete 2026-08-01** — see `docs/completed.md`. FR-TK-7/FR-TK-8/UI-1d/TC-LIN-01's DM-shorthand
> capture (`Question? Answer1; Answer2.` → tappable chips → terminator sentence → saved `flow`
> talk draft) is built, unit-tested, and real-browser-verified
> (`31-auto-linear-capture.spec.ts`). Simplified grammar (no `**`/`*` markers — first answer
> continues, any other ends it), mandatory-confirm diversion, `FlowCapture`/`assembleCapturedTalk`
> reuse, the edit-mints-a-new-id policy (`supersedesTalkId`, delete/keep-old Settings toggle), and
> the two-author credit schema (`originalAuthorId`/`originalCreatedAt`/`originalAuthorLocation` vs.
> current `authorId`) are all shipped — title edits count as neither creation nor authorship.
> **One still-open call, kept visible:** whether a metadata-only edit (title/tags, staying on the
> existing in-place `updateTalk` path) should reassign `authorId`/`createdAt`/`authorLocation` to
> the editor, or keep preserving them as today. Not yet decided; not blocking anything shipped.

---

## W. Incremental re-broadcast: don't resend talks a recipient already has `[Sonnet]`

> **Complete 2026-08-01/02** — see `docs/completed.md`. The literal "100 exchanged, 120 rebroadcast
> → 20 new" scenario was already correct; two adjacent gaps found while verifying it are now both
> closed. Gap 1 (received-but-unanswered talks weren't suppressed) fixed via a per-receiver
> narrowing pass. Gap 2 (three uncoordinated "don't resend" implementations) unified per Bernard's
> decision into one ledger-based mechanic: a new `TALK_SENT` ledger event + `sent` map on
> `TalkLedgerDoc`, a single `shouldSuppress()` predicate (`exchanged` OR `sent`), all three send UIs
> (room broadcast, group broadcast, "Send My Talks") routed through the one
> `deliverTalkToReceiversOverMesh` chokepoint, and the old room-broadcast-history/
> `localTalkExchanges`-as-gate mechanisms retired. Also shipped: a completeness refinement (a
> partial survey answer is never sent to the sender as complete) and a follow-up ignore-semantics
> fix (the dedicated "Ignore" opt-out — distinct from an author-provided `isIgnore` answer — now
> correctly withholds the whole response from the sender at any question, in any talk type, per
> `84-receiver-ignore-withholds-from-sender.spec.ts`). Full Jest suite green (95/95) throughout.

- [ ] Decide whether `sendBulkTalk`/`BulkSendJob` should be removed as dead code or finished as a
      real feature — currently neither, which is its own small hazard for whoever finds it next.

---

## X. Talk.authorLocation stores a raw coordinate — violates the SRS's own blurred-location requirement `[Sonnet]`

> **Complete 2026-08-01** — see `docs/completed.md`. `Talk.authorLocation` was storing the raw GPS
> coordinate at creation, violating `FR-CR-8`/`NFR-S-1`'s blurred-by-default requirement. Fixed at
> the one real write site (`app.ts`) via a new `LocationPrivacy.blurCoordinatePair()` — a coarse
> ~2km grid-snapped numeric pair, chosen over a region-string so the three existing numeric
> consumers (`haversineMilesBetween`, `formatTalkDistanceFromAuthor`, `cid.ts`'s location hash)
> needed zero changes. Precise-location-sharing-by-request stays a separate future feature;
> `Chatroom.location`/`BusinessInfo.coordinates` audited and confirmed as the legitimate
> deliberate-disclosure carve-out, not the same bug. Unit-tested, full suite green (91/91).

---

## Y. Incoming-talk lifecycle: copy authorship bug + missing retention `[Sonnet]`

> **Complete 2026-08-01** — see `docs/completed.md`. **Y1:** copying an incoming talk was stamping
> the copier as `authorId` immediately (via `toOwnedOutgoingTalk()`), contrary to Bernard's "he
> doesn't become the author unless he edits it." Fixed by deleting `toOwnedOutgoingTalk()` outright
> — a copy now keeps the original sender as `authorId` through copy/broadcast/reopen; an actual
> content edit is what transfers authorship, routed through §V's `buildRevisedTalkDraft()` +
> `originalAuthorId` machinery (`82-copy-then-edit-transfers-authorship.spec.ts`). Along the way,
> found and fixed a real bug: `WebTalkService.createTalk()`'s field whitelist was silently dropping
> `originalAuthorId`/`originalCreatedAt`/`originalAuthorLocation`/`supersedesTalkId` on any revised
> draft (affected §V's DM-shorthand path too, not just this fix). **Y2:** incoming-talk clusters had
> zero retention, and the existing size-report tool couldn't even measure the category (stale
> matcher path). Fixed the matcher, then added `planIncomingTalkClusterPrune()` — a direct
> generalization of §L2's `planVisitCounterPrune` (oldest-`updatedAt`-first, no aggregate fold
> needed since answered Q&A survives independently in the Me tab),
> `DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS = 500`. The proposed post-trim tombstone was dropped
> from scope — Bernard confirmed it solves a problem that doesn't exist. CLAUDE.md's Gun-paths
> list and invariants section were corrected to match; a separate, larger staleness was found and
> deliberately left out of scope — CLAUDE.md's "Route modules"/"Talk delivery flow" prose still
> names `talk-delivery-routes.ts`/`peer-routes.ts` and an `upsertIncomingTalkForUser` step that no
> longer exist post-P2P-migration — worth its own doc pass.

---

## Z. Talks tab GUI redesign (2026-08-02 session) — row layout + gestures shipped, detail popups still need review `[Sonnet]`

Shipped this session, iterated screenshot-by-screenshot with Bernard before implementing: direction
(In/Out) and type (Tag/Flow/Survey/Route) checkboxes replacing the old dropdowns; IN/OUT merged
into one chronologically-sorted list (no more separate section headers); incoming vs. outgoing now
visually distinct by background tint + which side the type-color border sits on, not just tiny
icons; the app-bar status line and the "Stats:" strip merged into one line; sender identity moved
off the row into the details popup; row layout collapsed to two lines with the direction+type icon
badge in the top-left corner; 🔍/ℹ️/🗑️ buttons replaced by tap-to-open, long-press-for-details, and
a swipe-left-to-delete gesture; 📣 broadcast-toggle unified into the same checkbox widget the tag
pill already used; 📊 survey results folded into the stats line, full breakdown one tap away inside
the long-press popup. Drag up/down on an incoming row now also does quick-ignore / quick-copy
without opening the response dialog. All of this is real, implemented, and covered by the existing
E2E suite (`74-talk-row-person-traceback.spec.ts`, `79-compact-talk-row-in.spec.ts`,
`37-compact-talk-rows-out.spec.ts`, `80-talk-co-exchangers.spec.ts`, and others) — not a mockup.

- [ ] **The long-press details popups themselves were never individually reviewed** — up to
      4 types × 2 directions = 8 distinct popup variants (tag has no popup at all today; the other
      6 — flow/survey/route × in/out — share one generic layout). They preserve every field that
      used to be on the row (sender, expiry, location, language, co-exchanged people, role badge,
      survey full-results link) but were carried over as-is, not redesigned. Same
      screenshot-then-iterate process as the row layout: capture each variant, review with Bernard,
      then implement.

---

## AA. Contacts tab: nickname display + row/interaction redesign `[Sonnet]`

> **Complete 2026-08-03.** Nickname semantics locked in and implemented; row layout and
> interaction redesign shipped (screenshot-reviewed as a mockup first, then implemented for
> real).

**Nickname semantics** — user-owned display name per contact, distinct from `stageName` (which the
contact themselves controls):
- A nickname defaults to the contact's current `stageName` — until the user deliberately edits it,
  the displayed name always mirrors whatever the contact is currently calling themselves.
- The moment the user edits the nickname and saves, it becomes sticky: a private, local decision
  that does **not** follow the contact's future `stageName` changes.
- This was already partially implemented (`KnownPerson.nickname`, `contact-relationship-nickname`
  modal field, and `buildDisplayName`'s empty-nickname-falls-back-to-live-stageName logic already
  gave the right *behavior*) — what changed is `buildDisplayName` (`contacts-view.ts:119-125`) now
  returns the nickname **alone** when set, instead of the old combined
  `"{nickname} ({stageName})"` form.

**Layout/interaction redesign** (screenshot-reviewed with Bernard 2026-08-03, then implemented):
- [x] Row shows the nickname only when one is set, falling back to `stageName` otherwise.
- [x] "Broadcast to group…" is now an icon-only button (📣, `.contacts-broadcast-icon-btn`),
      label moved to a `title`/`aria-label` tooltip — matches the Talks tab's icon-badge
      convention (§Z).
- [x] Header count + the separate "Stats: ..." line merged into one, via
      `ContactsViewDeps.updateStatsStrip(prefix)` → `displayContextualStatistics('contacts-stats-strip', prefix)`
      — same move §Z made for the Talks tab. The old dedicated `#contacts-status-text` app-bar
      span is gone.
- [x] Per-row relationship label is stated once (`buildMetaLine`'s trailing segment) — the second
      meta line dropped its duplicate `"Relationship: X"` wording, now just `"Sent N · Received N"`.
- [x] Tap targets split: tapping the **name** (`.contact-item-name`, underlined) opens a DM
      directly (`openPeerDetail` → `openUserConversationFirst`, unchanged); tapping the row
      anywhere else opens the same User-layout detail view without also opening a conversation
      (`openPeerDetailOnly` → `openPeerDetailForUser`, new). Delegated click handler in
      `contacts-view.ts` branches on `target.closest('.contact-item-name')`.

Covered by `src/test/unit/contacts-view.test.ts` (updated fixtures + a new click-target-split
assertion) and `tests/e2e/staged/stage1-single-user/00-ui-navigation-settings.spec.ts`.

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
