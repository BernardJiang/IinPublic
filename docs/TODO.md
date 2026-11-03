# IinPublic TODO

Last reconciled: 2026-10-31.

This file contains the current execution focus plus explicitly deferred open work. Completed
implementation history is in
`docs/completed.md`; product requirements and design decisions are authoritative in
`docs/specs/iinpublic-technical-specifications.md`. The separate
`docs/IinPublic Identity & Key Architecture TODO.md` is a design specification and keeps its own
implementation plan.

Actions that require the product owner, physical handling, privileged host changes, credentials or
an outside reviewer are mirrored in `docs/OWNER-TODO.md`. This file remains the canonical issue
record.

The current product priority is **bug fixes and improvements to the website and Android app**.
Pause new features and broad architecture work. Work on the shared web runtime, browser behavior,
Android shell, and website↔Android interoperability only where they address a verified defect,
reliability, performance, privacy, or release-readiness issue. The order below, not the numeric
issue ID, defines execution priority. Do not start paused or deferred work unless it directly
blocks this maintenance focus or the product owner explicitly promotes it.
Run the Android availability preflight before physical-device work. When an issue is completed,
move its outcome and verification evidence to `docs/completed.md`, remove it here, and do not reuse
its ID.

## Current status (2026-10-31)

- The repository is at 1.0.207. The last documented production website deployment is 1.0.200;
  Android 1.0.205 responsiveness checks are documented on P30, PH-1, and FRD-L04. Do not infer
  that 1.0.207 is installed on phones or deployed to the website from version metadata alone.
- The web, server, shared core, and Android paths are implemented and have extensive unit,
  integration, browser, and physical-device coverage. Recent stalled-hub responsiveness tests
  passed 28/28 twice, and Android 1.0.205 measurements showed prompt tap reactions on three
  phones. This does not close the owner-reported two-phone offline discovery or DM journey.
- The last canonical full gate is **red**: 3,713 Jest passes / 1 failure and 34 E2E failures
  on 2026-10-30. Focused website reruns now pass the TechSupport trio, age-vouch/dating,
  person/DM navigation, linked-device sync, cross-navigation, and both buy/sell cases after
  fixes below. The isolated Jest failure is fixed and its 9-test suite passes. The first
  six-worker light rerun finished **348 passed, 12 skipped, 2 failed**; both residual cases
  passed targeted reruns after repair. A second full light rerun finished **347 passed,
  12 skipped, 3 failed**: message history after reload (29), an incoming device handoff
  card (74), and mutual deal confirmation (88). The handoff screen now rechecks for a late
  archive and its spec passed 3 repeated browser runs. Conversation refresh now preserves and
  merges deal confirmations; 88 passed 3 repeated browser runs after this fix. Message history
  after reload (29), handoff (74), and deal confirmation (88) passed the next complete
  six-worker light shard. That shard finished **349 passed, 12 skipped, 1 failed**: the master
  showed a TechSupport delegate grant before Dana could receive it. Grant issuance now waits
  for the server's verified storage response; the delegate case passes alone and the support
  trio passes twice with six workers (6/6). A full light shard after this last change remains
  pending.
  `test:all` has not yet been rerun, so OPEN-94 remains open.
- The two UI size-budget suites mentioned in the earlier responsiveness audit now pass locally
  (4 tests on 2026-10-30); they are not current blockers.
- Device-core privacy and host-command work has substantial focused validation. OPEN-91 is now
  closed as the architecture-delivery umbrella; deferred expansion is tracked as OPEN-103 and
  OPEN-104. The walking/transit and unplugged battery gates remain unverified under OPEN-81.

## Active maintenance queue — website and Android first

- [ ] **OPEN-106 — Question-keyed graph store: each question once, Talks and the Me tab as links
  (release blocker, owner decision 2026-11-01).** Must be done before release.

  **Specified 2026-11-02: spec §31 (Device Graph Data Model), which supersedes the "Target design"
  below and the draft where they differ.** Every record is an event or content, no types; nothing is
  stored twice, as in git. The question is the key; a full-length context hash is the situation; a
  Talk is the event that wrote it, and every edit is a new event that is re-sent; built-in values
  such as a price range count as choices; all hashes are SHA-256. Text is exact, with a grammar
  filter for English and Chinese (a received Talk with an error is ignored whole, no spelling
  correction). §31.12 lists the open issues to settle before coding.

  **Full design:** `docs/design/device-graph.md` (draft). It widens this issue from questions to the
  one graph behind all four tabs: people, contacts, places, GPS, exchanges and reverse edges, plus how
  encryption and communication work with it. The sections below cover the question and Talk part.

  **Why.** The first project plan (2026-01-19) said the app "should maintain a list of questions and
  answers in the database" and that questions are "linked together" to form a Talk. Searches of
  `src` and `docs` history found no commit that built this. Instead a Talk is one JSON string
  (`questionsJson` from 2026-04-05, `fe571bd4`), and the Me tab reads its own log (`myAnswerHistory`
  from 2026-05-14, `0eb8b8e6`). Gun cannot see a question inside a string, so its per-field state
  and links go unused here.

  **Evidence, 2026-11-01.**
  - A question's text is stored 10 times across 7 collections on the C10 and 30 times across 8
    collections on the PH-1 (plain text matches, so a title with the same words also counts), plus
    the encrypted Talk copy.
  - Benchmark of the real engine on a Mac, 10,000 Talks of 3 questions, about 800-byte filler
    entries, no disk or start-up cost: 55 MB in memory. Answering a Talk took 165 ms before the
    single-key fix below, and saving one answer took 110 ms, both growing linearly. A hash lookup
    took about 4 ns, so nearly all of it was whole-map copying.
  - Current costs that the small fixes do not solve: saving an answer is O(N) (whole-map copy and
    compare), start-up loads every entry with one Gun read each, the Me tab regroups by text on every
    render, and text is duplicated across collections.

  **Size and speed benchmark, 2026-11-02** (1,000 contacts, 10,000 Talks × 5 questions, 50,000 Me
  tab rows; Gun + Radisk file store; Mac, plus the phone stress route below).
  - Mac: current design 159 MB written, 179 MB on disk, start-up 14 s and **946 MB heap** (every
    collection loaded); spec §31 design 103 MB, 134 MB on disk, start-up 0.25 s, 17 MB heap. Writes:
    396 s vs 487 s (2.5× more, smaller nodes). Cold reads cost 1.5–4 ms per node (Mac and phones).
  - **Fixed: Radisk corrupted its own files on Node.** Gun's `lib/yson.js` `JSON.parseAsync` breaks
    nested objects where it pauses; radisk wrote the damage back (a link's state key became
    `"undefined"`), and Gun's merge loop then dropped the rest of that node (a 10,000-entry list read
    back as 2,539). Radisk now uses plain JSON (`scripts/patch-gun-radix.js`; test
    `gun-radisk-large-node.test.ts`). Likely the root cause of the 2026-09-04 radix crashes too.
  - **Fixed: phones ran unpatched Gun.** Since 2026-09-23 the phone's Node loads Gun from
    `platforms/mobile/nodejs-project/node_modules/gun`, which no build patched; the `android:*`
    scripts now patch it (from 1.0.218).
  - **Open: a node larger than one Radisk file (1 MB, about 7,000 links) is answered in parts.** Gun
    answers after the first file; with the GraphStore's 30 ms wait a 10,000-entry list read 3,800
    entries (all by 500 ms on the Mac; on the P30, 3,795 at 2.1 s, 3,903 at 2 s, all 10,000 by 5 s). Today `local/collections/answerPreferences` crosses this at about 1,400
    answered Talks. §31.8 needs bucketed index nodes (for example by month, each well under 1 MB).
  - **Open: Gun never evicts its memory graph** (every node read stays in `root.graph`), and Radisk
    keeps every parsed file. A store larger than memory needs an LRU eviction of unsubscribed nodes.
  - Gun treats `once(cb, { wait: 0 })` as 99 ms.
  - Phone stress route (debug, loopback-only, own folder, no peers):
    `POST /api/debug/storage-stress?talks=10000` then `GET /api/debug/storage-stress/<id>`.

  **Target design.** Everything stays under `local/`, so the sharing policy keeps it on the device.
  Hash keys use normalised text. Language is part of a question's key. A question has no choices and
  no answer of its own, because both vary by Talk and context.

  ```
  Text, each exactly once
    q/<hash>            { text, language }
    a/<hash>            { text }

  Talks, structure only, no question or answer text
    talk/<cid>          { type, title, start or 0..n: →step, tag: →q, accepts: →q }
    talk/<cid>/<n>      { q: →q/<hash>, 0..n: →choice, rules that belong to this step }
    talk/<cid>/<n>/<m>  { a: →a/<hash>, next: →step, match, ignore }

  Me tab, links only
    me                  { <context>: →me/<context> }
    me/<context>        { q: →q/<hash>, a: →a/<hash>, talk: →talk/<cid>, after: →me/<previous> }
  ```

  Worked example: every Talk below asks "How often do you play?", and `q/<that hash>` exists once.
  - Flow, Tennis partner: step 1 "Do you play tennis?" with `Yes` → step 2 "How often do you play?"
    with `Weekly` as the match and `Daily` as ignore.
  - Route, Hobby friend: "What do you play?" with `Tennis` → step 2 and `Piano` → step 3. Steps 2 and
    3 link the same question node on two branches.
  - Survey, Weekend habits: an ordered list of steps, no `next`.
  - Tag, tennis: `talk/<cid>` links one question. A Pair tag adds `accepts: →q/<buy>`.

  The Me tab walks `me`, groups by the `q` link, and follows links for text:
  ```
  How often do you play?
     → Weekly   (Do you play tennis? → Yes)
     → Daily    (What do you play? → Piano)
     → Monthly  (Weekend habits)
  ```

  **Rules.**
  - Talk ids stay content hashes computed by `computeTalkCIDv1`, so ids, deduplication and delivery
    do not change. The hash payload must not depend on how a Talk is stored.
  - Talks reach the receiver as nodes through Gun sync (owner direction, 2026-11-01), written once in
    the author's signed space under a per-Talk key, with one encrypted grant per receiver. See "Talk
    exchange by Gun sync" in `docs/design/device-graph.md`. No readable text or guessable hash reaches
    a relay: extend the wire audit (`tests/e2e/talks-matching/09-talk-content-not-on-hub-wire.spec.ts`)
    to the new souls.
  - Context keys use `buildQuestionContextHash` (`flattened-answer-keys.ts`), never `contextHashId`,
    which hashes positional ids only.
  - Node writes use exact souls and links as `gunGraphStore.put` does. A chained put can wait forever
    for an absent private parent.
  - GUI reads stay synchronous through an in-memory view filled from the nodes, loaded on demand.

  **Decide before coding.**
  1. Spelling: "Tennis" and "tennis" become one node showing the first spelling seen. Proposed: accept.
  2. Language in the question key. Proposed: yes.
  3. Label for a context with no earlier step. Proposed: the Talk title.
  4. One context reached from two Talks: `talk` becomes a list of links. Proposed: yes.
  5. Deleting: a node stays while anything links to it, so removing a Talk needs a sweep for unlinked
     nodes, and Gun keeps tombstones. Define what "deleted" promises.
  6. Encryption: encrypt Gun's storage chunks with an Android Keystore key instead of individual
     values, and drop the encrypted Talk copy. Encrypting values would break traversal. See
     `docs/design/device-graph.md`. The website needs its own answer. A privacy decision for the owner.
  7. Whether `exactChatbotMemory`, `answerPreferences`, `flattenedAnswerPreferences`,
     `myQuestionAnswers`, `questionDefaultContracts` and `myAnswerHistory` all become reads of these
     nodes, or some stay. Proposed: all of them, in phases.

  **Phases.**
  - [ ] 1. Finish `docs/design/device-graph.md`, record the decisions above and update the spec.
  - [ ] 2a. Prototype sync. Done in browsers on 2026-11-01 (see "Experiments" in the design): a
    3-question Talk as signed, encrypted nodes over a real WebRTC channel, answered by key lookup in
    6 ms, catching up after reconnect. Still needed: the same inside the phones' embedded Node,
    WebRTC between real phones, many peers, and the outgoing audience filter, because Gun sent the
    pair's ciphertext to an uninvolved connected peer.
  - [ ] 2b. Measure storage: on the FRD and P30, compare write and read cost of the node shape against
    the current records at 10,000 Talks. Radisk rewrites its whole chunk (up to 1 MB) on each flush,
    and `gunGraphStore` reads wait at least 30 ms, so a cold 3-question lookup is estimated near
    100 ms. Add a recently-used cache if the numbers need it.
  - [ ] 3. Add the store in `src/core/` (question, answer, Talk and `me` nodes, split and rebuild),
    with unit tests for all four Talk types, Pair tags, route branches and multi-select.
    - Started 2026-11-02, not wired into the app: `src/shared/grammar-filter.ts` (`en-v1`,
      `zh-v1`), `src/core/device-graph/` — `keys.ts` (SHA-256 question, answer, context v3,
      structure and answer-set keys), `event-id.ts` (persisted counter, reserved in blocks),
      `node-store.ts` (exact-soul writes, no parent links), `talk-structure.ts` (a Talk's structure
      as `rev/`, `q/`, `a/` nodes and back), `talk-events.ts` (create, edit as a new version, read,
      history, list), `index-buckets.ts` (monthly or daily buckets). Test `device-graph.test.ts`,
      including a Talk written and read back from Radisk on disk.
    - Then `answers.ts` (situations, answer sets `s/`, answer events; `ix/ctx` Same context,
      `ix/whenever` Whenever offered, `ix/q/<key>/mine` + bucketed `ix/me` for the Me tab,
      `ix/answered`; a chatbot that walks a Talk by key lookups and stops at the first question it
      cannot answer) and `arrivals.ts` (the author's version copied once, a private arrival event
      per delivery, `ix/received`, grammar-ignored Talks recorded but not stored, newest version
      wins). A received Pair-tag structure is stored from the responder's side as `rev/<hash>-r`.
      Test `device-graph-answers.test.ts`.
    - `events.ts`: every event is listed in `ix/day/<yyyy-mm-dd>`; `rebuildIndexes` puts back
      every index an event implies after a crash, and a second run writes nothing (an answer's
      private sidecar `ev/<id>/q` maps each situation to its question, for the Me tab).
  - [ ] 4. **Started 2026-11-02: the graph mirror** (`src/core/device-graph/mirror.ts`, hooked into
    `createCoreHandler`'s `collection.upsert`). Every `myTalks` write is also written to the graph
    (my Talks as Talk events and versions; Talks I answered as the author's version, one arrival
    per sender and my answer events), read back and compared; counts in `local/ix/mirror`, read
    with the core request `deviceGraph.status`. Off unless the `deviceGraph` setting is "true" (or
    `IINPUBLIC_DEVICE_GRAPH=1` on a node); never awaited, never fails the app's write. Old ids map
    through `ix/legacy/<oldTalkId>`; imported Talks skip the grammar check (§31.10). Tests
    `device-graph-mirror.test.ts`; phone-path journey 02 turns it on and asserts both phones'
    status (passed 2026-11-02). Not yet run: a browser (web worker, IndexedDB) journey with it on,
    real phones, and a full `test:all` with it on.
    - Browser (web worker + IndexedDB): the wire audit (`talks-matching/09`) runs with the mirror
      on and passes: no graph soul reaches the hub, and Tom's Talk is mirrored. Page hook
      `window.__iinpublic_device_graph_status()`, e2e helper `tests/e2e/helpers/device-graph.ts`.
      Found: a `copied` entry is someone else's Talk kept in my list; it was mirrored as mine.
    - Chatbot walk now answers built-in questions (price range, time frame, age range, quantity)
      from `ix/typed/<questionKey>`, my declared values (written by my own Talk's built-ins and by
      typed answers I give), with the same comparisons and `<qid>_compatible` choice ids as today,
      and auto-proceeds a Pair-tag question with one real choice. Location still asks. Unlike
      today's `typedPreferenceState`, the declaration is scoped by the question key (text,
      language, Pair-tag side), not by the Talk title.
    - **Grammar filter vs today's templates:** Pair tags in `talk-templates.ts` are lower case
      ("sell", "buy"). `en-v1` capitalises them, so once receivers apply the filter, a template
      Talk from an older app version is ignored whole. Capitalise the templates (and accept
      both in the `isSell` check, which already lower-cases) before turning the filter on.
    - **Real phones, 2026-11-02 (1.0.220–1.0.222, all four: P30, PH-1, FRD, C10).** Debug
      route `POST /api/debug/device-graph/backfill` (loopback, not in production) turns the mirror
      on and mirrors the Talks already on the phone; `GET /api/debug/device-graph` reads the
      counts. Back-fill: P30 6 Talks (4 mine, 2 received + 2 answers), FRD 1, PH-1 1, C10 0, all
      with 0 mismatches and 0 errors. `native-app/37` (two real phones, C10 + PH-1) turns the
      mirror on and asserts both phones' counts: passed twice.
    - **Speed.** Radisk confirms a write only after ~250 ms of batching, so writes that wait on
      each other cost a quarter second each: the first mirror took 3.2 s per Talk on the Mac and
      ~8 s on the P30. Writes are now batched (one read of every node, then one write of what is
      missing; the event and all its indexes in one batch; counts written off the critical path):
      0.83 s per Talk on the Mac; on phones 1.3 s for a new Talk (C10) and 3.0 s for a received
      Talk plus its answer (PH-1). A structure or answer set cut short by a crash is completed by
      the next write of the same content. Saving an answer in the final design costs two flushes
      (~0.5 s) against one today; consider a shorter Radisk batch wait for the graph's writes.
    - Still to do in this phase: a `test:all` with the mirror on everywhere.
  - [ ] 4. Write Talks to both stores, and check that a rebuilt Talk equals the original and hashes
    to the same id.
  - [ ] 5. Move the Me tab to `me` nodes, then remove its grouping code.
  - [ ] 6. Move the chatbot, preferences and defaults to the nodes. Keep `whenever` and root-default
    behaviour, and answer-frame exactness.
  - [ ] 7. Migrate existing data on start-up: resumable, repeat-safe, and able to survive a process
    kill part way. Keep old data until a verified read-back.
  - [ ] 8. Remove the old collections and the duplicate Talk copies.

  **Done when.**
  - A scan of a phone's radata finds each question text in exactly one node.
  - `me` and Talk nodes hold no question or answer text.
  - Lookup and save times are flat from 100 to 10,000 Talks on the FRD.
  - An upgraded phone keeps every Talk, answer and chatbot rule.
  - `npm run test:all`, phone-path journeys, and the real-phone journeys pass.
  - A two-user journey shows one question with answers from two Talks on the Me tab, and the chatbot
    answers a new Talk from them, asserted on the other user's side.

  **Small fixes already made ahead of this (2026-11-01, not yet on a phone).**
  - The Me tab no longer uses `contextHash` as its context key, because that value hashes positional
    ids: step 2 of two unrelated flows both got `d61994b8`, so one answer vanished. It now uses the
    readable label, which needs no data migration. A context-free answer keeps its own line.
  - The chatbot reads one key instead of deep-copying the map per question
    (`getFlattenedAnswerPreference`, `answeredBeforeFor`). `isPassedTag`, question defaults and saves
    still copy whole maps.
  - `contextHashId` still exists and is still positional. Do not build on it.

- [ ] **OPEN-94 — `test:all` failure backlog surfaced 2026-10-30 (restored-gate fallout).**
  The canonical gate was red 2026-10-01 → 10-30 because this worktree's `.env.local` held the
  pre-rotation TechSupport key while the trust anchors rotated 2026-09-27 (commit b4b58d6c);
  the fail-closed boot guard zeroed every E2E phase each night. The 2026-10-30 run used a
  corrected key; `scripts/check-env-drift.js` (`npm run doctor:env`, wired as `pretest:all`,
  commit 57cd0b87) now fails quickly on drift. **This checkout's current `.env.local` is
  unconfigured again**; the configured key exists in the sibling `IinPublic.claude` worktree.
  Focused TechSupport tests loaded that key only for their test process. Restore this checkout's
  local configuration before a canonical `test:all` run.
  The first full run after the fix (59m6s) booted all phases and exposed the backlog hidden
  by the red month: jest 3713 pass / **1 fail**, E2E **34 failed tests** across 7 phases
  (light 23, stage5 2, mesh-isolated 1, find-similar 1, isolated 1, mass 2, phone-path 4);
  mesh-batch, heavy-staged and cross-browser passed. The list below records focused repairs;
  remaining failures still need an isolated verdict without weakening assertions.
  - [ ] **OPEN-94c — Stage2/3 two-party interaction cluster (light phase).**
    Solo-rerun evidence 2026-10-30 (PW_WORKERS=6, no concurrent stage5, ports cleaned):
    23 failed / 327 passed again. **20 tests reproduce in BOTH runs — genuine regressions,
    not contention:** TechSupport trio (94b), 21c-reputation-vouch, 60/61 peer layout +
    appbar, 74-talk-row-traceback ×3, 78-dm-inbox-affordance, 81-graph-traversal,
    88-asymmetric-attachment, 89-buy-sell-cross-talk, 94/96 dating match, 95-device-sync,
    00f-ux, 00g-age-gating, 09-cross-navigation, 79-dm-inbox-multi-sender. Cluster centres on
    the two-party match → conversation → DM path; suspect window is the 10-26 → 10-29
    OPEN-91 P5.4 host-command/ledger changes or the 1.0.201–203 navigation work (red month
    hid the introducing commit. **Focused repair status (2026-10-31):** the TechSupport trio,
    21c/94 age checks, 60/61/74/78/81 navigation, 88 attachment, 89 buy/sell (both cases),
    95 device sync, 96 dating (both cases), 00f/00g/09/79 three-user journeys now pass in
    targeted Chromium runs. Fixes cover explicit person→DM navigation, closing a long-press
    popup, age-vouch read consistency, device-sync namespace sharing, live author-reply refresh,
    and direct device-core Gun writes with explicit parent links. The latter removed strict local
    storage-ack failures seen in 89/96; the exchange log survived a reload in stage1/94.
    The first complete six-worker light rerun finished 348 passed / 12 skipped / 2 failed.
    `21a-reputation-block-count` exposed an unnecessary fallback API block that raced the UI's
    background publish; the UI-only assertion now passes solo and in the second full shard.
    `28-stage-zero-n2n` exposed a profile-save completion overwriting a concurrent stage-name
    change; the merge fix passes solo and in the second full shard. That second shard finished
    347 passed / 12 skipped / 3 failed. The device-handoff screen's one-shot archive check
    could miss a readable archive; it now rechecks while open, with 3 repeated browser passes
    and 17/17 linked-dialog unit tests. The 88 failure also reproduced once in three isolated
    repeats: a conversation refresh dropped `dealConfirmedByJson`, and a stale peer snapshot
    could replace a local confirmation. Both paths now preserve/union confirmations; 88 passed
    three repeated browser runs and focused unit checks. The next complete light shard passed
    29, 74, and 88 under six workers, then failed only `00m-techsupport-delegate-answers`
    (349 passed / 12 skipped / 1 failed). The master locally cached the signed delegate grant
    before the remote storage path confirmed it; issuance now awaits the server's verified POST
    before the master roster advances. The delegate case passes solo and the support trio passes
    twice with six workers (6/6); its grant-cache unit suite passes 4/4. **Remaining:** a final
    full light-shard run on this last fix, then the broader `test:all` gate. Triage the public
    `user-tags` Gun ack timeout still seen in passing runs.
    **Contention/order flakes (failed in only one of the two runs):** 54-chatroom-map,
    82-list-pins, 13-me-filters (in-suite only); 64-option-matrices, 69-matched-talk-threads,
    24-profile-privacy-visibility (solo only) — treat as flakiness backlog, not regressions.
  - [ ] **OPEN-94d — Heavy/timing phases:** stage5 (starter-tags, 15-nearby-audience-shapes),
    mesh-isolated (02-mesh-broadcast find-similar), find-similar (chatbot auto-matches),
    isolated-02 mixed saturation, mass (05 layout tour, 06 map showcase), phone-path ×3
    (04 mismatch-block; 07b reconnect — "WebRTC connection replaced"; 09 tag-graph-tour, which
    passed in one of two runs on 2026-10-31). Phone-path 02 was fixed with OPEN-102. Direct phone-path
    runs need `DISABLE_HMR=true`, or Place creation is refused.
    **2026-10-31 journey-coverage follow-on:** J-PLACE-12 and map-side J-PLACE-11 assertions were
    added to phone-path 01/03, and real UI-path DM reopen/composer-send assertions were added to
    the shared talk-match-chat journey (used by native-app/37 and phone-path/02). Focused rerun:
    phone-path/02 passes with the new UI-path assertions; phone-path/01 and phone-path/03 currently
    fail earlier at existing Place creation (`createPlace` timeout, creator stays `nearby-v3`) so
    the new map assertions do not execute yet. Keep this as OPEN-94d triage, not a new regression.
    Triage each: contention flake vs genuine regression (per skill: failing all retries =
    genuine).
  - [ ] **OPEN-94e — Remaining known test debt from the responsiveness audit.** Reconcile the
    HEAD-reproducing E2E failures listed in `docs/testing/gui-responsiveness-audit.md`
    (including contacts-to-DM navigation expectations) with 94b–d. The two UI size-budget
    suites cited there now pass (4 tests, 2026-10-30). Update stale expectations only when the
    intended product behavior is documented; fix genuine regressions without weakening assertions.

- [ ] **OPEN-96 — Field delivery gaps from the 2026-10-31 walk.** Retest first on the current build: the
  OPEN-100 memory crash may explain (a) and (b), but a clean rerun has not shown that. After that
  crash Android delayed the background service's restart by about 35 minutes, and "Stopping
  service due to app idle" followed, so a crash can also pause background delivery. (a) A late auto-answer was
  lost: PH-1 recorded `walk-late` as outcome match/answeredBy chatbot, but P30's ledger and outing
  never received it, more than 45 minutes later with both online. The PH-1 process had died at
  airplane-mode-on, and the phone was then rebooted, so isolate whether that caused it.
  (b) P30's Nearby list was empty after `walk-return`'s 13:29:50 Broadcast; replies arrived
  10 minutes later (13:39:39, 13:40:15), exactly once. Likely tied to the FRD crash loop and hub
  timeouts, but the logs from that minute were overwritten. (c) The outing review reports
  0 pending although journey-bob's `walk-late` reply never arrived.

- [ ] **OPEN-98 — Outing controls lost with `d3cecef7` (2026-10-23).** Stopping now means unticking
  **Collect nearby matches**. Tag Talks are chips with no broadcast on/off control, so a disabled
  one cannot be re-enabled on the phone. `broadcastMatchCollection` still has a handler but no UI.
  Fixed on 2026-11-01, not yet on a phone: Settings has **Review collection** for the latest
  outing, the review shows Talk titles, and the field guide matches.

- [ ] **OPEN-99 — PH-1 Bluetooth crash loop during the walk (2026-10-31).** From 13:08:45 the
  stack aborted every ~4 s (`startup_timer_expired`, then the Bluetooth HAL) until a reboot; no
  crash in the 30 minutes after it. Storage was fine (72% free). IinPublic's involvement is
  unknown: the planned force-stop test was not run before the reboot. Treat as an observation
  unless it recurs with a BLE-using Always mode.

- [ ] **OPEN-105 — E2E coverage metadata drift and untagged-spec backlog (found 2026-10-31).**
  `coverage-matrix.md` had drifted to an older snapshot (212 specs) while the suite now contains
  330 specs. Regenerated matrix on 2026-11-01 now reports 330 specs, 94 untagged specs, and 139
  anchors without passing coverage. Keep this updated in regular health/review runs and reduce the
  untagged backlog incrementally (new specs should carry coverage tags when applicable).
  - [x] Regenerate `docs/testing/coverage-matrix.md` from `npm run coverage:matrix`.
  - [x] Refresh `tests/e2e/README.md` to describe the current suite layout and canonical docs.
  - [x] Add covers tags for high-value journeys (`phone-path/01/02/03`, `native-app/33`, `native-app/37`), reducing untagged specs 120 → 115.
  - [x] Add covers tags for remaining phone-path journeys (`04/05/06/07/07b/08/09/10`), reducing
    untagged specs 115 → 107.
  - [x] Add covers tags for high-value native-app journeys (`02/04/05/18/19/23/27/28/29/35/36/38/39`),
    reducing untagged specs 107 → 94.
  - [ ] Tag/highlight remaining high-value untagged specs (next: more native-app and cross-platform
    journeys) so
    matrix traceability improves without broad one-shot churn.

- [ ] **OPEN-93 — Two-phone park offline Wi-Fi Direct discovery (reported 2026-10-29).**
  Current work is browser-first. Physical checks in this session may use C10 only; defer the
  multi-phone reproduction until the owner makes another device available.
  Airplane mode with Wi-Fi and Bluetooth re-enabled did not make two phones find each other.
  Post-visit USB preflight found C10's Nearby Wi-Fi Devices/Bluetooth permissions denied and Honor
  FCP-AN10's Wi-Fi off; the exact park pair and its then-current radio/room states are unconfirmed.
  The service could report Searching with no discovery running, would retain a permission denial
  after a Settings grant until restart, and incorrectly required Bluetooth permission for the
  Wi-Fi-only fallback. These code paths now report the blocker and retry once ready; focused tests
  pass. Android 1.0.202 was installed in place on all five USB phones on 2026-10-29. **Remaining gate:** confirm the pair/status, reproduce
  and verify the full airplane-mode two-phone journey without clearing identities. Checklist:
  `docs/guides/PARK_OFFLINE_WIFI_DIRECT_CHECK.md`.

- [ ] **OPEN-92 — Message Send and navigation responsiveness on Android (reported
  2026-10-29).** Earlier freezes were fixed in `bd7427e8`, `2846414a` and 1.0.202/1.0.203. On
  2026-10-31 the owner asked for an instant local message and a Send button that never blocks, and
  reported delays of 10 s or more and a lost message. App 1.0.214 changes the send path: the message
  shows and the composer clears at once; encryption and delivery no longer wait for the local save
  (one shared private-write queue took 0.6 s on P30 and 7.9 s on FRD-L04); the mailbox goes at
  once when no direct link is open; a failed save returns the text to the composer. Measured with
  `npm run test:android:dm -- <a> <b> --no-launch`, P30 ↔ FRD, both directions, link connected:
  own message 69–335 ms, arrival 0.4–0.8 s, exactly once. Own message on FRD misses the script's
  200 ms budget (about 300 ms). The owner confirmed 1.0.214 feels fast, including the first message.
  J-CHAT-04 (`tests/e2e/journeys/dm-speed-journey.ts`) now guards this inside `native-app/37`, so the
  Android sweep runs it: it passed on PH-1 + FRD-L04, app 1.0.217 (own message 56 ms, worst arrival
  178 ms, with a 4 s slow-save case), and in `phone-path/02`. **Remaining gate:** FCP-AN10 when
  attached. C10 is excluded.

- [ ] **OPEN-101 — Open DM defects from the 2026-10-31 timing session.** (a) Private saves are
  slow because every private write shares one queue and each DM rewrites and re-encrypts the whole
  conversation; FRD-L04 took 7.9 s for one write and saw repeated main-thread stalls of about 1 s.
  (b) "hi 12" (P30, 16:36; probably the slow read fixed under OPEN-102, not proven) was saved, but the mailbox refused it with `epub not found` although the
  sender had just used that key. It reached FRD only about 30 minutes later, after the direct link
  reconnected and the phones synced. The key is now passed through and posting retries 5 times, but
  this path has not been re-proven on phones. There is still no per-message delivered/failed state. (c) A received message can
  stay undecrypted. Since 2026-11-01 it shows "This message could not be decrypted." instead of raw
  `SEA{...}` (not yet on a phone); why it never re-decrypts is still open. (d) P30's app died 12 s after launch at
  16:51:30 with no crash record, and a local `/health` once took about 3 s; causes unknown.
  (e) DM sessions report `WebRTC connection replaced` around start-up. (f) `getUserPub` gave up on
  the first missing peer record instead of retrying; fixed in 1.0.215 with a unit test.

## Paused implementation and field qualification — track, but do not start new features

OPEN-103/OPEN-104 and OPEN-81's remaining adoption work are paused under the maintenance-only
direction. Fix an existing privacy or correctness defect if it is verified; otherwise leave their
remaining implementation scope parked. OPEN-76/77/79 remain open release or evidence tasks, not
active feature development.

- [ ] **OPEN-103 — OPEN-91 follow-on: sharing-policy compatibility migration and legacy audiences.**
  Complete the deferred P2 scope: migrate historical graph copies, review legacy shared roots and
  audiences, and enforce sharing settings consistently at the compatibility boundary without
  reopening hub-visible private relationships.

- [ ] **OPEN-104 — OPEN-91 follow-on: host-owned domain effects and live host views.**
  Complete deferred P5.4 scope by moving GUI-owned effects (encryption scheduling, transport/fanout,
  chatbot, Nearby, conversation side effects) into host commands and replacing cached GUI decisions
  with complete live host-backed view semantics across web/native windows.

- [ ] **OPEN-81 — Match collection outings: prepare Talks, walk through a mall or ride transit,
  collect replies, then review the few people who matter most (started 2026-10-20).** The transport
  is substantially ready (multiple OUT Talks, Nearby v3, delayed mailbox replies, Android offline
  links and background mode), but the product still treats the activity as unrelated broadcasts,
  replies and Contacts. The shipping gate is one continuous, resumable workflow with an honest
  summary and useful ranking. Do not call the use case ready from the 498-person simulation alone:
  physical qualification currently covers four phones, including the native background agent, but
  literal walking/transit qualification is still outstanding.
  - [x] **G1 — Durable outing identity and evidence (first slice, 2026-10-20).** Add a bounded,
    versioned local collection-session store; snapshot the active scope, selected Talk ids and
    blurred public point; associate each intended peer + Talk delivery with the active outing; keep
    late match/mismatch/ignore results attached after Stop or process restart; stamp the existing
    local exchange projection with the collection id. Focused unit tests cover delayed replies,
    receiver narrowing, repeated encounters and corrupt storage.
  - [x] **G2 — One Start/Stop collection control (2026-10-21).** Put the control beside the current Nearby/Place
    group, show elapsed time / people reached / replies / matches, restore an active outing after a
    restart, and make Broadcast clearly feed it. Starting a new outing ends the previous one; Stop
    freezes the send/location context but continues accepting late replies.
    The restored card now reports elapsed/reached/replies/pending/matches, has a primary Broadcast
    action using the existing audited send path, and opens the latest outing review. Starting a new
    outing still ends the previous one; late replies continue to attach after Stop.
  - [x] **G3 — Correct place and time semantics (2026-10-21).** Snapshot a freshly confirmed, privacy-blurred
    location at send time rather than relying on `Talk.authorLocation` from Talk creation; retain
    distance-at-encounter; handle indoor/no-GPS and subway movement without pretending the reading
    is precise; define when a moving outing rolls to a new area. Each send now records GPS,
    traveler, Place or unavailable explicitly; only the public snapped cell is stored. Encounter
    distance uses the peer's public Nearby card, and a changed public cell starts a new area segment
    inside the same outing.
  - [x] **G4 — Materialized outing review (2026-10-21).** Add a collection detail screen with reached, pending,
    matched, mismatched and late counts; preserve repeated peer + Talk outcomes instead of the
    current latest-only `peerId::talkId` projection; link each person to their replies and chat;
    allow pin, dismiss and private notes. Review preserves the repeated outcome timeline, exposes
    late/location evidence, links each row to the existing replies + DM view, and persists local-only
    pin/dismiss/note state.
  - [x] **G5 — Importance-aware ranking (2026-10-21).** Let the author mark Talks/questions as important or
    must-have, then rank within this outing by must-have failures, weighted answer strength,
    matched-Talk breadth, trust/relationship, distance-at-encounter and freshness. Reuse the
    weighted `find-similar` primitives rather than the Contacts tab's current fixed relevance
    formula. Explain the top reasons and never silently hide candidates. Talk and question editors
    now persist Normal/Important/Must-have weights; outing ranking uses shared `matchScore`, hard
    failures, breadth, relationship history, blurred encounter distance and freshness. The default
    review includes every person and explains its leading signals; pin/dismiss are explicit.
  - [x] **G6 — Real background collection (2026-10-21, code gate).** Move the minimum receive/match/outbox/session work out
    of the Android WebView into the foreground-service path, survive screen-off and process death,
    reconcile without duplicate outcomes, and disclose vendor battery restrictions. "Always" mode
    must resume the exact active outing; "While open" must say collection is paused.
    - [x] The reviewed boundary is now implemented: Android keeps approved policy in a
      Keystore-encrypted store, reads the SEA pair through an app-internal custody method (never the
      new WebView bridge), and provisions a bearer-protected loopback processor in the embedded
      foreground node. It decrypts Talk mailbox bodies/responses, enforces room/intake/contact/age/
      block policy, uses only exact pre-approved auto-answers, durably relays the response outbox,
      classifies matches and binds late responses to the snapshotted outing.
    - [x] Reconciliation is encrypted, persistent and idempotent: the native processor journals
      before mailbox acknowledgement; WebView resume replays through the existing Talk/ledger
      handlers and acknowledges only completed events. The active room, outing associations and
      policy survive ordinary Android process recreation. Rejected/blocked mail is consumed rather
      than waking repeatedly; unsupported non-Talk mail remains for the foreground UI.
    - [x] Product disclosure distinguishes **Always — background Talk exchange** from **While open —
      pauses in background**, states that a persistent notification is used, and warns that vendor
      battery savers can still delay/stop delivery unless unrestricted battery use is allowed.
      Host SEA-cycle, authorization, durable-relay, policy, mailbox-relay and packaged-mobile gates
      pass. Physical screen-off/process-death bench paths now pass on P30, C10, PH-1 and Honor
      FRD-L04 (2026-10-28); carried-field and real vendor battery behavior remain open under G7.
  - [ ] **G7 — Qualification gate.** Add a deterministic 498-person model for ranking and storage,
    a 10–20 simulated-client outing, and physical Android runs for walking movement, subway/no-GPS,
    Wi-Fi ↔ cellular ↔ offline transitions, screen-off, restart, delayed replies and repeated
    encounters. Keep the existing four-phone test, but do not use it as the crowd-scale claim.
    - [x] Deterministic host gates (2026-10-21): 498-person delivery/storage/review and a 16-client
      moving outing with pending, cold-start, delayed and repeated cases
      (`match-collection-scale.test.ts`, `match-collection-outing-model.ts`).
    - [x] Automated physical Android bench matrix (2026-10-21, app 1.0.187): P30/C10/PH-1
      Wi-Fi-off catch-up; P30 cellular-only ↔ C10 Wi-Fi; four-phone online ring; and a C10 receiver
      with Activity closed, screen off, forced Doze and killed process. Android restarted the
      foreground service, returned the exact approved encrypted answer in 5.727 s after the outing
      had stopped, and WebView resume reconciled it exactly once. See
      `docs/testing/android-match-collection-g7.md`. **2026-10-28 regression:** repaired native
      Gun RPC acknowledgement stalls and connection-replacement races; the 1.0.199 four-phone
      ring (3.7 min) and P30/C10/PH-1 offline catch-up (2.6 min) pass again. Native screen-off
      process recovery, late reply and exact replay pass with all four phones as receivers:
      P30 6.153 s, C10 5.626 s, PH-1 6.313 s, Honor FRD-L04 5.895 s. Every run retains one
      outing result, the exact whole-Talk/selected-tag responder identities and zero pending events.
    - [ ] Carried field gate: literal walking movement, a transit/subway route with genuine no-GPS,
      physical repeated encounters and broader vendor battery behavior. Fixed coordinates, radio
      toggles and simulated reconnects do not qualify those real-world conditions.
      **2026-10-31 walking attempt, app 1.0.207, not passed:** P30 + PH-1 carried, FRD-L04 left at
      home. `walk-out` matched both peers within seconds; both encounters stayed in one outing
      with no duplicates, and the outing survived an app restart. Limits: the owner ended the
      outing mid-run (13:08:08) and it was reopened by editing its record over USB; `walk-return`
      took 10 minutes; journey-bob's `walk-late` reply never arrived, with the PH-1 rebooted and
      its app opened by hand during that step; distance walked and GPS loss were not recorded.
      See OPEN-96, OPEN-98 and OPEN-99; OPEN-95, OPEN-97, OPEN-100 and OPEN-102 are complete. Rerun after OPEN-96/98. Transit remains not run.
  - [ ] **G8 — Adoption and abuse edges.** Measure the cold-start case where receivers lack saved
    auto-answers, add actionable pending states, carry the completed starter credit/block-count
    policy into launch review, and treat iOS as unsupported until its native background/discovery
    work is qualified.
    - [x] Cold-start pending pairs are measured in the 16-client model; review has a default-visible
      **Needs follow-up** filter and opens the person's existing replies/chat directly.
    - [x] The OPEN-70 starter credit/block-count defenses are complete: 12 distinct incoming Friend
      marks, fewer than three received blocks, one lifetime Place, and continuing lifecycle checks.
      Optional stronger Place defenses remain a separate owner decision; iOS remains unsupported
      until its separate native qualification exists.
- [ ] **OPEN-76 — Physical transport, radio and battery measurements (carried over from OPEN-40
  G2.5 and its P1 discovery item on 2026-10-20).** The 2026-10-18/20 rounds
  (`docs/testing/android-transport-measurements.md`) cover hub, LAN, offline Wi-Fi Direct, mobile
  data, isolated BLE, duplicate accounting, provider duty counters, and online↔offline Talk exchange
  with concurrent Wi-Fi STA + Wi-Fi Direct on three supported phones. The only remaining gate is the
  owner's long unplugged battery run; Android's USB-attached battery model cannot substitute for it.
  Also carried from OPEN-72: on a phone, writing the incoming cluster (~0.8 s) and
  `cacheReceivedTalk` (~0.6 s) dominate accepting a Talk, and the mesh ACK wait
  (`DEFAULT_MESH_ACK_TIMEOUT_MS`, 3 s) is shorter than a phone's ~3.7 s round trip, so a slow
  receiver gets one redundant re-flood (deduplicated). Tune with the measurements, not before.
  - [ ] **Owner overnight run, 2026-10-31 23:17 to 2026-11-01 10:11 (11 h 54 min, 1.0.217): not a
    pass.** No active hour was run (screen on 3 to 4 min per phone). P30 gave no result: Huawei
    scheduled power off (about 00:30, back about 08:00), so the app was gone by morning. PH-1: 89%
    to 83%, same process alive, awake 12.5%, app CPU about 3 min, Bluetooth scanning for the whole
    run, gauge unreliable (bad battery). FRD: 91% to 50% (3.4% an hour, about 1,200 mAh), same
    process alive, awake 63%, app CPU 2 h 27 min, wake locks only about 12 min, about 23,000
    wakeups, led by GPIO23 (12,857) and Wi-Fi receive; deep Doze only about 58 min. Node on the FRD
    kept polling all night while PH-1 stayed asleep. How much of the FRD drain is the app is
    unproven: it needs a control night with the app stopped. Rerun on P30 with the schedule off,
    and on the FCP. Also seen: bursts of Gun `chain not yet supported` dumps in the Node log (about 5 to
    7 MB on FRD and PH-1 at the 10:12 wake-up). Likely cause, not reproduced:
    `sweepTransientSignalGraph` deletes `p2p-signal` parent nodes that open chains still hold, so
    gun.js line 642 replays their links with no state. A delegate-invite lookup that finds nothing
    now answers 204 instead of a logged 404.
  - [ ] **Owner daytime run, 2026-11-01 about 10:52 to 17:22 (6.5 h, 1.0.217): not a pass.** No
    active hour again (screen on 3 to 9 min), and the FRD app was not stopped, so no control. C10:
    63% to 55% (1.2% an hour), app alive until 17:23:06. P30: 89% to 82% (1.1% an hour), but the app
    only ran about 15 min, so that is close to a no-app figure; last log 11:04:46, cause unknown, no
    crash record. PH-1: 92% to 80% (1.8% an hour), alive. FRD: 47% to 20% (4.2% an hour), alive,
    awake about 63% again. FRD also lost charge on the USB hub, so it needs a wall charger.
    **Crash found and fixed (source only, not on a phone yet):** C10 Node exited with status 7 on
    `send ENETUNREACH 224.0.0.251:5353`: bonjour-service throws mDNS send errors unless given an
    error callback. `LanGunDiscovery` now passes one. The error reaches logcat (tag `nodejs`) but
    not `node-stdio.log`, and Android then delayed the service restart by over an hour.
  - [x] **Automatable A — Measurement harness:** add per-provider scan-window/duty-cycle counters,
    logical-delivery and wire-byte/duplicate accounting, timer overrides, and retained JSON evidence.
  - [x] **Automatable B — Physical bench matrix:** on at least three attached phones, isolate BLE
    discovery, exercise 30 s / 10 min / 30 min schedules, and run online↔offline Talk exchange with
    Wi-Fi STA + Wi-Fi Direct concurrency across PH-1, P30, C10 and Honor where supported.
    Completed on P30, C10 and PH-1 on 2026-10-22. The supported Honor FCP-AN10 closeout then passed
    the complete three-phone offline Wi-Fi Direct journey with P30 and C10 (ring Talks plus Honor
    background delivery); the old Honor Android 7 remains unable to join a credentialed group. The
    hardware run used accelerated windows while deterministic tests cover the production 30 s /
    10 min / 30 min caps.
  - [x] **Automatable C — Tune from evidence:** select production discovery timers and adjust the
    mesh ACK timeout only if the measurements justify it; wire `NearbyCandidateRegistry` route
    selection only if duplicate hardware routes are observed.
    Retained 30 s / 10 min / 30 min and the 3 s ACK: 306 sent and 306 received frames produced zero
    duplicate frames and zero duplicate Talk bodies, so neither ACK inflation nor route-selection
    wiring is justified. Native idempotence reduced P30 BLE advertiser starts from 67 to 4 per
    ~200 s mixed run. **2026-10-27 follow-up:** fixed conflicting scan policies in the discovery
    tick and advertisement refresh. The P30/C10 mixed-nearby bench passed with native P30 scan
    starts reduced from 19 to 3 over comparable ~200 s windows; all four Talk bodies arrived
    without duplicate accepted bodies. Both online owner/client regression tests pass. This
    removes the repeated scan-toggle defect, but does not establish real unplugged energy use;
    timers and the ACK timeout remain unchanged. See the transport report for limitations.
  - [x] **Automatable D — Regression/reporting:** add focused deterministic tests, rerun the relevant
    Android matrix, and append the measurements and limitations to the transport report.
  - [ ] **Owner action:** perform the long unplugged battery run after the automated harness is
    ready; procedure and acceptance evidence are tracked in `docs/OWNER-TODO.md`.
- [ ] **OPEN-77 — Protocol release key custody (operator action, carried over from OPEN-40 on
  2026-10-20).** Place the K3 and K4 vault/passphrase pairs in separate durable offline backups,
  verify restoration, and remove the working copies from the development machine when the release
  ceremony no longer needs them. K3 signed M3 and is spent; K4 signs M4, which must commit a newly
  generated K5. Do not call custody production-ready merely because the local encrypted files exist.
- [ ] **OPEN-79 — Delegate roster watcher: read the log (from 2026-10-24; carried over from OPEN-32).**
  Read `~/IinPublic/delegate-roster-monitor.jsonl` on the VPS after several days of uptime. OPEN-32's
  root cause stays open until a `cache` line is caught; none caught means the cache keeps covering it.

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
