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

## BB. Opposite-tag deal matching: typed built-in questions (quantity/price/time frame/location) `[Opus]`

**Not yet designed at the code level — needs an `[Opus]` design note before implementation**, same
posture as K7. Scope below is the output of a design conversation with Bernard (2026-08-10);
preserved as-is so a future session doesn't have to re-derive it. **Checked against the SRS
2026-08-10 — now written up as `docs/specs/iinpublic-technical-specifications.md` §30**
("Opposite-Attribute Matching: Typed Comparisons, Preference-Sets, and the Dating Use Case"),
which generalizes this section's scope (offer/request → preference-sets) and adds a second worked
use case (dating, §DD below). §30 also confirmed two adjacent items were **already spec'd but
unbuilt** before this session — see §CC (financial-data filter, spec §7.4) and note that the
adult-content gate this design assumed still needed building (§30.6, `dating_requires_...`) turned
out to be **already fully implemented** (`Talk.isAdult` + `age_gate` intake filter + `ageVerified`,
FR-SP-7/8) — no gap there, just a talk-editor enforcement rule to add (§DD).

**Motivation.** §Role-based matching (shipped 2026-08-10, see `docs/completed.md`) added a single
hardcoded `Talk.role: 'offer' | 'request'` pair so two same-side talks (two buyers) can never
auto-match. Bernard wants this generalized into a real **opposite-tag registry** (buy/sell,
hiring/jobseeking, male/female, and user-definable pairs beyond whatever's predefined), plus three
**built-in typed question kinds** (quantity, price range, time frame, location) that compare actual
values instead of matching exact text — today's chatbot auto-reply (`exact-chatbot-memory.ts`) only
ever does string equality, which can't express "$400 is inside $300–500" or "5 miles apart."

**Decisions made (scope, not implementation):**

- **Tag, not talk-level role field.** `role` becomes tag-based: any tag can declare an opposite tag
  (buy↔sell, hiring↔jobseeking, …), app-predefined set plus user-created pairs. Tags need a
  *canonical* identity (resolved by normalized name, the same way question text is today) — two
  users each typing "buy" must resolve to the same tag object, or the opposite-pairing never
  connects across users. Governance/conflict policy for user-defined pairs (first-write-wins?
  admin-curated only? mutable?) is explicitly unresolved, see below.
- **Self-describing tags, decoupled question wording.** A talk is tagged for what *it* is (a buyer's
  talk is tagged "buy," never "sell") — but the literal first question shown to a responder is
  auto-generated from a per-tag template addressed outward ("Do you sell {item}?" for a "buy"-tagged
  talk), not hand-typed by the author. This is what keeps the mirrored-wording requirement the
  chatbot's exact-text matching depends on intact without asking two different people to
  independently type identical text.
- **Reuse flow/route, not a new talk type.** Rejected the earlier "order-independent attribute-set"
  idea (would have needed a 5th talk type). Instead: the app's own talk-creation UI prescribes a
  fixed section order (tags → time frame/location → quantity/price → item specifics), so two
  talks naturally align without the *engine* needing to be order-independent. Each built-in
  question still resolves to exactly the 2 outcomes flow/route already understand (proceed /
  ignore) — `checkIfMatch`, `TalkAutofix`, and route's DAG/contextHash mechanics need **zero**
  changes. The only new thing is *how* those 2 outcomes get chosen: computed from typed values
  instead of picked from pre-written text or looked up by exact string.
- **Question schema:** `Question.builtIn?: { kind: 'quantity'|'priceRange'|'timeFrame'|'location';
  quantity?: number; priceRange?: {min,max}; timeFrame?: {start,end}; location?: {latitude,
  longitude,radiusMiles} }`. `answers[]` stays structurally the same (2 entries), just
  app-generated instead of author-typed when `builtIn` is set.
- **Typed preference storage, scoped by tag.** A responder's own quantity/price/time/location
  preference is *not* global (someone may want $300–500 on a notebook and $10–20 on a book at the
  same time) — store per tag (or tag+item), parallel to but structurally separate from
  `exact-chatbot-memory.ts` (which only stores strings).
- **Comparison semantics, confirmed 2026-08-10:**
  - Quantity: buyer's want `N`, seller's declared available `M` → match iff `N <= M`.
  - Price range / time frame: same interval-overlap function for both (`a.min <= b.max && b.min <=
    a.max`) — time frame is just dates instead of dollars.
  - Location: **simplest version** — mutual containment, `distance <= buyerRadius && distance <=
    sellerRadius` (not the looser "combined radii overlap" reading). Operates on the
    already-blurred coordinate the app stores today (§X) — no new precision exposure.
- **A computed "not compatible" is trustworthy enough to auto-resolve, unlike missing data.**
  Distinguish "responder has no stored preference for this attribute" (abort auto-reply, deliver to
  the human inbox — same as today's missing-history behavior) from "responder has a preference and
  the numbers genuinely don't overlap" (confident auto-ignore, no human review needed — this is
  exact math, not a heuristic text reuse).
- **No-auto-match still reaches a human.** If any question — built-in or ordinary text-choice —
  can't auto-resolve, the talk just sits as a normal unanswered incoming talk, exactly like today.
  No new fallback mechanism needed; item-specifics questions (the part most likely to need a human,
  per Bernard) already work this way.
- **Route for multi-item listings.** A seller offering several different items uses one route talk:
  tags/time-frame/location asked once at the talk level (shared across items), then a branch point
  per item, each branch carrying its own quantity/price. Avoids needing N separate talks for N
  items — resolves the earlier "buy A and sell B simultaneously" question via N separate *talks*
  (one per deal), but multiple *items within one side of one deal* via route branches.

**Not yet decided:**

- Whether this needs a new SRS/FR entry before implementation (see note above).

**Resolved:**

- ~~Tag-pair governance~~ and ~~auto-generated question-template wording authorship~~ — resolved
  2026-08-11 (see spec §30.7 / this doc's §DD): no separate governance process, tag pairs and their
  templates are ordinary tags under the existing FR-TG-1 (free creation) / FR-TG-4 (popularity-ranked
  suggestion) rules, same answer to both questions.
- ~~All-or-nothing vs. threshold~~ — resolved 2026-08-11 (Bernard): **all-or-nothing.** A match
  requires every built-in comparison and every ordinary text-choice question in the chain to
  resolve compatible — no partial/scored matching. Matches how flow/route already behave today (one
  failing answer already blocks a match); no new scoring model or "close but not exact" UI needed.
- ~~Does location need a per-question radius, or reuse the existing talk-level fields?~~ — resolved
  2026-08-11 during Phase 2 implementation: **reuse.** `Question.builtIn` for `kind: 'location'`
  carries no nested lat/long/radius fields at all; the mutual-containment comparison (Phase 3) reads
  each side's own `Talk.authorLocation`/`Talk.locationRadiusMiles` directly — already populated at
  talk creation, already the basis for today's location-based intake filtering (§X), no duplicated
  coordinates on the question.

**Implementation plan (draft phases — re-sequence once the design note above is written):**

1. ✅ **Shipped 2026-08-11.** Tag opposite-pair registry: canonical tag identity (normalized-name
   keyed, mirroring `makeQuestionId`), a predefined seed set (buy/sell, hiring/jobseeking,
   male/female), storage for user-created pairs, a `getOppositeTag(tag)` lookup. New
   `src/shared/tag-opposite-pairs.ts`, unit-tested (`tag-opposite-pairs.test.ts`), no persistence
   wiring yet (lands with Phase 5's talk-editor UI).
2. ✅ **Shipped 2026-08-11.** Extended `Talk`/`Question` types (`types.ts`) with `builtIn` per the
   schema above (`BuiltInQuestionKind`/`BuiltInQuestionSpec`); `TalkAutofix.fix` auto-generates the
   2 synthetic answers (`Compatible`/`Not compatible`, isMatch/isIgnore) for a `builtIn` question
   with no author-typed answers, feeding them into the *existing* first-answer-normalization step
   unchanged — a builtIn question ends up terminal-match or linked-to-next exactly like any other
   flow question, no new engine logic needed there. **No `TalkValidator` exemption was needed**
   (unlike `answerSelectionMode: 'multiple'`): the synthetic 2-answer (one match, one ignore) shape
   already satisfies every existing flow-question validation rule verbatim.
3. ✅ **Shipped 2026-08-11.** Typed preference storage (new `src/shared/typed-preference-store.ts`,
   tag-scoped local store — `makeTypedPreferenceScopeKey(tagId, item?)` so the same user's
   quantity/price/time preference for two different items under the same tag never collides,
   last-write-wins) + the three comparison functions in new `src/shared/built-in-comparisons.ts`
   (`intervalsOverlap` shared by price range and time frame — closed intervals, touching endpoints
   count as overlapping; `quantitySufficient(want, have)`; `locationsMutuallyContained`, reusing
   the existing `haversineMilesBetween` and each side's own `Talk.authorLocation`/
   `locationRadiusMiles`, fails closed — not "compatible" — when either side lacks a location or
   radius). All pure functions, unit-tested including boundary cases (touching/nested/disjoint
   intervals, N==M/N&lt;M/N&gt;M quantity, exact-boundary and asymmetric-radius location cases).
4. ✅ **Shipped 2026-08-11.** Wired comparison resolution into
   `resolveAnswerPreferenceForTalkQuestion` (`ui-manager.ts`) via a new pure dispatcher, new
   `src/shared/built-in-question-resolution.ts`'s `resolveBuiltInQuestion` — runs BEFORE the
   multi-select/single-select exact-text branches so a `builtIn` question's app-generated
   placeholder answer text ("Compatible"/"Not compatible") is never memorized or exact-text
   matched by mistake. New localStorage-backed persistence for `typed-preference-store.ts`
   (`getTypedPreferenceState`/`setTypedPreferenceState` in `answer-preferences-storage.ts`,
   mirroring the existing exact-chatbot-memory persistence pair; also cleared by
   `clearAnswerPreferences`).
   - **Wired now:** `quantity`, `priceRange`, `timeFrame` — using role (specifically MY OWN
     role, `complementRole(talk.role)` — the incoming talk's role complement, matching what
     `processTalkForm` saves under when I author my own talk, see Phase 5) as an **interim**
     typed-preference scope substitute for the real opposite-tag (Phase 1's registry), since a
     talk carries no resolvable deal-tag until a tag picker is wired into the editor (still not
     shipped as of Phase 5, see below). Revisit the scope key once that lands.
   - **Deliberately deferred:** `location` — always resolves `ASK_USER` (falls through to the
     human inbox, same as "no stored preference"). Needs a geo/privacy-aware source for the
     responder's OWN location + radius (their blurred coordinate, or a matching counterpart
     talk's `authorLocation`/`locationRadiusMiles`) that hasn't been designed yet;
     `locationsMutuallyContained` (Phase 3) is ready to be called once that source exists. Never
     guesses — fails safe to manual answering, not a silent wrong resolution.
   - Unit-tested (12 cases covering missing-preference vs. computed-incompatible, both role
     directions for quantity, kind-mismatch, price/time-frame overlap and disjoint cases) plus a
     full e2e regression run (`04-dealmaker-chatbot-match.spec.ts`,
     `85-multi-value-checkbox-match.spec.ts`, all pass unmodified) confirming the new early-return
     branch doesn't affect ordinary (non-`builtIn`) questions. **No dedicated e2e coverage for
     the builtIn path itself yet** — there is no UI path to create a `builtIn` talk or set a
     typed preference until Phase 5 ships; the original test plan's e2e cases (quantity-
     insufficient, price-overlap, location-outside-radius, route multi-item) apply once it does.
5. **Shipped 2026-08-11 (partial — typed input widgets only, see below).** Talk editor UI: a
   per-question "Compare using:" `<select>` (`.builtin-kind`, mirroring §FF's
   `answer-selection-mode` toggle exactly) with `quantity`/`priceRange`/`timeFrame`/`location`
   options, each swapping in its own typed input widget (`talk-editor-form-helpers.ts`'s
   `applyBuiltInKindToQuestion`) in place of the ordinary "+ Add Answer" UI — hides the answers
   container AND clears `required` off its now-invisible `.answer-text` inputs (a real risk:
   `display:none` does not reliably exempt a `required` field from native form-submit
   validation, unlike the `hidden` attribute). `processTalkForm` (ui-manager.ts) reads the typed
   value via `readBuiltInSpecFromQuestion`, forces `answers: []` (so `TalkAutofix.fix` generates
   the synthetic pair per Phase 2), and — as a side effect — saves that same value into MY OWN
   `typed-preference-store` (the same store Phase 4 reads when auto-resolving someone else's
   talk), closing the loop without needing a separate "declare your preference" screen. Early
   per-field validation (empty/invalid typed values) reuses the existing
   `showTalkValidationError` early-return pattern, not native HTML `required` (deliberately, for
   the same display:none reason above). Edit-reopen correctly rehydrates the kind + typed value
   (the `answerSelectionMode` toggle has this same gap unfixed from §FF — noted, not fixed here,
   out of scope for this change).
   - **Real bug caught and fixed before shipping:** `resolveBuiltInQuestion`'s scope key
     originally used the INCOMING talk's own role directly, but `processTalkForm`'s save-side
     effect scopes by MY OWN talk's role — for a buyer responding to a seller's `role: 'offer'`
     talk, that's `'offer'` (their role) vs `'request'` (my role, saved when I created my own
     talk) — two different strings that would never match. Fixed by scoping the read side by
     `complementRole(talk.role)` (my own role) instead. Caught before any UI wiring existed, via
     reasoning through the new end-to-end e2e test below, not a live incident.
   - E2E: new `tests/e2e/staged/stage2-two-user/86-builtin-quantity-match.spec.ts` — 2 tests,
     both zero manual clicks, driven entirely through the real talk editor: buyer wants 2 /
     seller has 5 (2≤5) auto-matches; buyer wants 10 / seller has 2 (10>2) resolves to no-match
     automatically (never sits waiting on a human — proving the "computed incompatible is
     trustworthy enough to auto-resolve" decision actually holds through the full UI→engine→UI
     path). Plus a full regression run (`04-dealmaker-chatbot-match`,
     `85-multi-value-checkbox-match`, `86-builtin-quantity-match`, 7/7 pass).
   - **NOT shipped**: the tag-pair picker (leading section) and "auto-generated first-question
     preview from the tag-pair template." Deliberately deferred — building it now wouldn't
     change any live behavior, since Phase 4's resolver still scopes by `talk.role`, not by any
     tag (`Talk.tags` stays hardcoded to `[]` everywhere in the editor, unchanged this phase);
     revisit once there's an actual consumer for tag-scoped preferences, otherwise it's
     speculative UI. `location` also still has no editor input (by design — it reuses the talk's
     own existing location/radius fields, see Phase 2) and no auto-resolution wiring yet (Phase 4
     deferred it for the same geo/privacy-source reason).
6. Route branch integration: per-branch quantity/price fields, talk-level time frame/location shared
   across branches.

**Test plan:**

- Unit: `talk-engine.test.ts` or a new `built-in-questions.test.ts` — interval-overlap (exact
  boundary cases: touching-but-not-overlapping ranges, fully-nested ranges, disjoint ranges),
  quantity sufficiency (`N == M`, `N < M`, `N > M`), location mutual-containment (asymmetric radii,
  exactly-at-the-boundary distance) — each as pure-function tests, no app scaffolding needed.
- Unit: tag opposite-pair resolution (canonicalization, predefined pairs, user-created pairs, the
  conflicting-redefinition case once the governance decision above is made).
- Unit: `TalkAutofix`/`TalkValidator` handling of `builtIn` questions (synthetic answers generated
  correctly, existing flow/route invariants still enforced).
- E2E: extend `tests/e2e/staged/stage4-four-user/04-dealmaker-chatbot-match.spec.ts` (or a sibling
  spec) with — a quantity-insufficient case (buyer wants more than seller has → no match, still
  reaches human inbox); a price-overlap-but-not-identical case (two non-equal ranges that genuinely
  overlap → auto-match, proving this is real interval math, not exact-text luck); a
  location-outside-radius case (both directions: buyer outside seller's radius, and the reverse);
  a route multi-item listing where only one branch's quantity/price is compatible.
- E2E: confirm the "no stored preference at all" case still delivers to the human inbox unanswered,
  distinct from the "computed incompatible" case which should resolve to ignore without ever
  opening a modal.

---

## CC. Mandatory financial-transaction safety warning + automatic card-number block `[Sonnet]`

> **Complete 2026-08-11** — see docs/completed.md. Financial-data detection (card/IBAN/routing/
> sort-code/wallet, Luhn-checked) mandatorily blocks talk creation and conversation messages;
> two-checkpoint safety reminder shipped as a once-per-day toast (revised from an earlier
> tap-to-acknowledge banner design, rejected by Bernard as too disruptive/repetitive). Not yet
> done: e2e coverage of the toast itself (unit-tested only so far).

---

## DD. Dating as a generalized opposite-attribute matching profile `[Opus]`

**Design note, not yet implemented.** Extends §BB's generalized preference-set model (§30.2 of the
spec) to a second worked use case beyond marketplace deals, per Bernard's request (2026-08-10).
Written up in full at `docs/specs/iinpublic-technical-specifications.md` §30.6 — this section is
the pointer + implementation/test plan; see §30 for the complete rationale.

**Motivation.** The existing `TC-DATE-01` scenario (spec §15.3) hand-writes bespoke yes/no questions
("Are you Female?", "Is your weight in [range]?") with no reusable schema and no typed comparisons.
Bernard wants a real matchmaking-profile model: gender-seeking-gender (not just one fixed opposite —
seeking multiple genders must be expressible), age range, race, location, gated by mandatory
adult-only verification, with a high-res photo sent once matched.

**Decisions made (scope, not implementation) — see spec §30.6 for full detail, revised 2026-08-11:**

- **Gender is NOT a simple opposite pair like `role`.** It needs the fuller self-tag +
  preference-set generalization from §BB/§30.2: each user declares their own gender tag *and* a
  preference-set of genders they'll accept (can hold more than one value). Match requires mutual
  set-membership, not a single fixed-complement lookup. **Storage correction (2026-08-11):** this
  is an `AnswerRecord` in the Q&A system (§EE), not a profile field — walks back an earlier draft
  that suggested `user-public-profile`.
- **Gender, sex, and race/ethnicity are free-text, user-editable, opinion-neutral (2026-08-11) —
  not a fixed enum.** No app-predefined closed vocabulary, no pre-seeded defaults, no validation
  or remapping of entered text; suggestions rank purely by observed usage (FR-TG-4). Sex and gender
  are separate fields with no assumed relationship. **This is exactly why the synonym-fold table
  (§30.2) is required, not optional:** a `"male"`-seeking-`"female"` talk and a `"woman"`-seeking-
  `"man"` talk describe a correct match, but literal string equality never connects them —
  `"male"`/`"man"` and `"female"`/`"woman"` must fold to the same two canonical buckets for
  auto-match to fire, while each user still sees their own original word choice unchanged. Preference-set default is always empty/"no
  preference." See spec §30.6 for the full principle.
- **Age uses a new, third comparison primitive:** mutual point-in-range (`myAge ∈ theirRange AND
  theirAge ∈ myRange`) — distinct from the interval-overlap primitive used for price/time-frame,
  because one side of the comparison is a fact (an actual age) and only the other side is a range.
  Do not reuse the interval-overlap function for this. **Trust caveat:** self-declared, honesty-
  based — NOT backed by `ageVerified` (which proves only a boolean 18+, no actual age).
- **Race/ethnicity** reuses the same preference-set-membership primitive as gender — no new
  mechanism. **Resolved 2026-08-11: mutual**, same as every other hard criterion, for consistency
  (a one-directional variant is a second mechanism to maintain without reducing the underlying
  concern).
- **Location** is a direct, unmodified reuse of §BB's mutual-radius-containment built-in.
- **Adult-only gate turned out to already be fully implemented** — `Talk.isAdult`
  (`src/shared/types.ts:211`), the `age_gate` intake-filter reason
  (`src/shared/talk-intake-filters.ts:177-178`), and `ageVerified`
  (`AGE_VERIFICATION_THRESHOLD = 3`, FR-SP-7/8) already block delivery of any `isAdult: true` talk
  to an unverified recipient. **The only new work is a talk-editor enforcement rule**: talks using
  the gender/seekingGenders tag pair (or any future tag the app marks "dating-category") must force
  `isAdult = true` and must not let the author uncheck it — today `isAdult` is a freely-togglable
  🔞 checkbox with no category-based enforcement.
- **Photo attachment is decided by the author at talk-creation time, never by the chatbot at match
  time (corrected 2026-08-11 — replaces the earlier "live post-match prompt" idea).** The author
  optionally attaches a photo when building the talk; because that consent is explicit and already
  given, delivery on match is automatic mechanical follow-through — no second live prompt needed.
  Reuses the existing conversation-attachment mechanism (`IpfsAttachment`,
  `src/web/app/app.ts`), delivered into the new conversation **after** §CC's T2 safety notice.
  Public headshot (FR-UM-4) stays low-res/blurred pre-match; the pre-attached photo is the thing
  that changes hands post-match. Surfaces in the "Me" tab (§EE) as a row within that talk's own
  context section, same as any other criterion.

**Not yet decided (spec §30.7):** all-or-nothing vs. scored/threshold matching when a talk mixes
several built-ins. (Tag-pair governance and race mutuality were resolved 2026-08-11, above; template
authorship was resolved alongside tag-pair governance — no app-authored canon, same FR-TG rules.)

**Implementation plan:**

1. Depends on §BB phases 1–2 (tag opposite-pair/preference-set registry, `Question.builtIn` schema,
   comparison-function library) — this section adds the `ageRange` mutual-point-in-range primitive
   to that same library and the gender/sex/race preference-set tags (free-text, §EE's Q&A store) to
   the registry.
2. Talk-editor enforcement rule: detect a dating-category tag on the talk and force+lock
   `isAdult = true` (extends the existing 🔞 checkbox UI in `talk-editor-dialog.ts`, §13.2).
3. Photo-attachment field on the talk-creation form (author picks a file when building the talk, not
   a runtime prompt); wire automatic delivery into conversation-bootstrap on match, after §CC's T2
   notice.
4. Update `TC-DATE-01` (spec §15.3) into a `TC-DATE-02` acceptance scenario using the generalized
   schema once implemented, retiring the bespoke yes/no version.

**Test plan:**

- Unit: mutual point-in-range primitive (boundary ages exactly at range edges, asymmetric ranges,
  point outside range on one side only).
- Unit: preference-set mutual-membership match (single-value sets reproduce today's `role` behavior
  exactly — regression guard; multi-value sets match against any accepted member).
- Unit: talk-editor validation rejects saving a dating-category talk with `isAdult = false`.
- Unit: gender/sex/race fields accept and preserve arbitrary free text unchanged (no validation
  rejection, no remapping to a canonical value) — a value with no synonym-table match still stores
  and displays correctly, it just doesn't auto-resolve against another user's differently-worded
  entry (falls to human review, per §30.4).
- Unit: synonym-fold table connects `"male"`↔`"man"` and `"female"`↔`"woman"` to the same canonical
  bucket — a `male`-seeking-`female` self-tag/preference-set pair mutually matches a
  `woman`-seeking-`man` pair even though no string is literally equal on either side; each user's
  stored/displayed value is verified unchanged (the fold affects matching only, never storage).
- E2E: two users with mutually compatible gender/preference-set/age-range/location match and reach
  a conversation; a third user just outside the age range or radius does not match; an unverified
  (not-yet-`ageVerified`) user never receives the dating talk at all (delivery-time block, not a
  match-time rejection — assert the talk never appears in their incoming list, per existing
  `age_gate` intake-filter test pattern in `talk-intake-filters.test.ts`).
- E2E: a talk created with a pre-attached photo delivers it automatically into the new conversation
  on match, after §CC's T2 safety notice, with no live prompt shown to either user; a talk created
  with no attachment delivers none.

---

## EE. Profile scope narrowed to identity chrome; "Me" tab gets a pinned header + sections `[Sonnet]`

> **Partially shipped 2026-08-11.** Implementation-plan steps 2–3 (pinned identity header,
> section-grouping by talk/context-cluster) are done — see `src/web/ui/answers-view.ts`
> (`buildAnswerSections`, the identity-header render, per-section `renderListProgressively`) and
> `docs/completed.md`. **Step 1 (redirect §BB/§DD's typed built-ins to the `AnswerRecord` store) is
> not applicable yet** — §BB hasn't been implemented, so there is no typed-built-in write path to
> redirect. Revisit step 1 when §BB ships. Category-prefixed section titles (FR-TG-2) are wired and
> ready but currently a no-op in practice, since no talk-creation path populates `Talk.tags` yet
> (separate pre-existing gap, not part of this section's scope) — sections fall back to the talk's
> own title, which is what's live today.

**Design note, not yet implemented (2026-08-11).** Corrects an architecture call made earlier in
§BB/§DD's design (storing typed criteria like gender/seeking-preference on `user-public-profile`)
and generalizes a UX problem Bernard raised independently: the "Me" tab is heading toward a single
long flat list as more talk categories (marketplace criteria, dating criteria, ordinary chit-chat)
accumulate answers. Written up in full at spec §3.1 (FR-UM-3, FR-UM-9) and §13.7.1 — this section is
the pointer + implementation/test plan.

**Decisions made (scope, not implementation) — see spec §3.1/§13.7.1 for full detail:**

- **Profile is narrowed to non-string/media identity attributes only: StageName + headshot.**
  Nothing else lives there. FR-UM-3 (originally "profile is a list of Q&A pairs") is revised —
  that description now describes the "Me" tab's answer list, not profile.
- **Every other user-declared attribute — including the typed built-ins from §BB/§DD (gender,
  seeking-preference, age, race, price range, quantity, location radius) — is an ordinary
  `AnswerRecord`** in the same `(questionId, contextHash)`-keyed store that already backs the "Me"
  tab (FR-QA-14) and chatbot memory. This directly corrects the profile-storage call made in §DD's
  original draft. Precedent that this pattern already works: `Talk.role`'s typed value already
  rides inside `ChatbotQuestionSummary.summary.role`, part of the existing answer-memory record —
  this section generalizes that, it doesn't invent a new mechanism.
- **StageName is pinned as the "Me" tab's first row (FR-UM-9)** and also shown in the profile
  editor — the one deliberate exception to "profile content lives only in profile," since identity
  is worth surfacing at the top of every view of "me."
- **"Me" tab sections (§13.7.1):** pinned identity header (not part of the scrolling list) → General
  section (context-free answers, today's flat list unchanged) → one collapsible section per
  context-cluster, titled by the source talk's existing tag category (reuses FR-TG-2's Craigslist-
  style catalog labels — "Personals," "For Sale," etc., no new taxonomy). A second listing of the
  same category (e.g. two different "For Sale" items) gets its own separate section, never merged.
  Most-recently-touched section open by default — same collapsible-itemized-list pattern Settings
  pages already use.

**Implementation plan:**

1. Talk-editor / talk-creation changes for §BB/§DD's typed built-ins: write to the `AnswerRecord`
   store (not a profile field) — supersedes any profile-write code path drafted under §DD before
   this correction.
2. "Me" tab: extract the pinned identity header component (StageName + headshot), reusable in both
   the "Me" tab and the profile editor.
3. "Me" tab: section-grouping logic — derive section title from the source talk's FR-TG-2 category
   tag; group by context-cluster (talk instance), not by raw question text; collapsible with
   most-recently-touched open by default.
4. Update `docs/specs/iinpublic-technical-specifications.md` §18 cross-reference matrix rows once
   shipped (currently marked "not yet implemented").

**Test plan:**

- Unit: section-title derivation from a talk's tag category; two same-category talks produce two
  distinct sections, not one merged section.
- Unit: `AnswerRecord` round-trip for a typed built-in value (gender/seeking-preference) — confirms
  storage lives in the answer store, not in `user-public-profile`.
- E2E: "Me" tab renders pinned identity row (StageName + headshot) above the sectioned list; editing
  StageName in the profile editor updates the pinned row without a page reload.
- E2E: a user with a "For Sale" listing and a "Personals" (dating) talk sees two separate sections,
  each showing only that talk's own criteria — no cross-contamination between listings.

---

## FF. Multi-value ("pick any that apply") questions + set-intersection matching `[Sonnet]`

> **Complete 2026-08-11** — see docs/completed.md. Schema, set-intersection match engine, chatbot
> multi-select auto-fill (now wired into both of `ui-manager.ts`'s auto-resolution paths, zero-click
> matching proven end to end), talk-editor "pick one / pick any that apply" toggle, response-dialog
> checkbox UI, and e2e coverage all shipped. Found and fixed four real bugs along the way (not by
> inspection — each one broke an e2e test): `TalkAutofix`/`TalkValidator` each had their own
> separate copy of "only the first flow answer may be isMatch"; two structurally-identical
> multi-select talks from different authors (same question/option text, different isMatch/isIgnore
> assignment) collided on the same content-identity hash since `Talk.role` is the only field that
> hash accounts for beyond raw text (fixed by using `role`, as designed, not a new mechanism); and
> the chatbot wiring itself initially passed content-hash answer ids straight through instead of
> translating them to the talk's own positional ids, so nothing downstream could match. Not done:
> talk-editor UI for large option counts (searchable chip input instead of a flat checklist) —
> deferred, low priority, most talks won't hit this.

**Design note, not yet implemented (2026-08-11).** Answers Bernard's question: today's chatbot
matching is strict single-value exact-text match (FR-QA-7) with no way to express "accept any of
these values" as one criterion, and no AND/OR logic within a single question. Written up in full at
spec §3.4 (FR-QA-15, FR-QA-16) and §30.8 — this section is the pointer + implementation/test plan.

**Motivation.** Concrete case: a buyer wants a used notebook and would accept either of two specific
models — "do you have any of them?" Today's schema has no way to express this as a single question;
it also has no general AND/OR authoring concept, which risked pushing the design toward a
boolean-expression-builder UI that non-technical users can't be expected to use.

**Decisions made (scope, not implementation) — see spec §30.8 for full detail:**

- **No boolean-logic UI needed.** AND across attributes already exists as flow/route sequencing —
  each subsequent question is an implicit AND with everything before it. The only missing primitive
  is OR *within* one question, and a checkbox list ("select all that apply") already means exactly
  that to anyone who has filled out a form. Sequence = AND, checklist = OR is sufficient for the
  concrete case and most realistic matching needs — no expression tree, no boolean vocabulary in
  any user-facing string.
- **Schema:** `Question.answerSelectionMode: 'single' | 'multiple'`. Authoring UI uses the
  well-known "Multiple choice vs. Checkboxes" toggle (as in common survey-builder tools).
- **Match rule generalizes, doesn't replace, today's exact match.** Every stored answer — single-
  or multi-select — is a set of answer IDs; a `'single'`-mode answer is a set of size one. Match
  predicate: **set intersection is non-empty.** Two singletons intersect iff equal, so every
  existing `'single'`-mode question is unaffected — this is a strict superset of current behavior,
  not a breaking change.
- **Chatbot auto-reply generalizes the same way TEMPORARY mode already works** (FR-QA-9: auto-fire
  if a saved ID is present in the current option set), applied per-checkbox instead of once per
  question. Still pure ID-based lookup — FR-QA-7's no-fuzzy/no-AI-matching invariant is unchanged.
- **Large option sets** should use a searchable/filterable chip-style multi-select (reusing the tag
  system's existing popularity-ranked-suggestion input idiom, FR-TG-4) rather than a long static
  checklist, so this stays usable for non-technical users even with many options.
- Orthogonal to §BB's built-in typed comparisons (quantity/priceRange/timeFrame/location/ageRange)
  — those are continuous numeric/geographic comparisons; this is discrete/categorical OR-sets. Both
  can appear in the same talk without conflict.

**Implementation plan:**

1. Extend `Question` with `answerSelectionMode`; extend the answer-submission UI (talk-response
   dialog, chatbot auto-fill) to render/produce a set of IDs instead of one when `'multiple'`.
2. Generalize the match predicate used by `checkIfMatch` / tag-type checkbox logic to ID-set
   intersection; verify the existing single-select path is unchanged (regression, not rewrite).
3. Generalize `ChatbotQuestionSummary`'s TEMPORARY-mode lookup to iterate a saved ID array against
   the current option set, checking each independently.
4. Talk editor: add the "Multiple choice / Checkboxes" toggle per question; for large option counts,
   swap the flat checklist for the searchable chip-input component already used for tags.

**Test plan:**

- Unit: set-intersection match predicate — non-empty overlap matches, disjoint sets don't, singleton
  vs. singleton reproduces exact-equality behavior exactly (regression guard for every existing
  `'single'`-mode question).
- Unit: chatbot auto-fill on a `'multiple'`-mode question pre-checks exactly the remembered IDs
  present in the current option set, leaves others unchecked, never invents a selection.
- E2E: extend the dealmaker-style spec with a buyer accepting two models via checkboxes and a seller
  offering one of them → match; a seller offering neither → no match, same as an ordinary
  single-value mismatch today.
- E2E: existing single-select flow/route/tag specs pass unchanged (confirms non-breaking
  generalization).

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

- Multi-device person identity semantics: one person may have multiple device-based SEA identities,
  but the project has not decided whether the linked cluster gets a durable person identifier, how
  Q&A and Talk authorship appear across devices, whether credit/reputation aggregate, how
  loss/replacement/revocation works, or whether contacts and blocks apply per device or per person.
  Keep the current mutual-link-attestation model until this is discussed and specified; discovery
  must not treat a linked cluster as one canonical SEA identity. See
  `docs/iinpublic_discovery_design(3).md` §3. `[Opus]`
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
