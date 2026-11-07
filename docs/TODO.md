# IinPublic TODO

Last reconciled: 2026-11-06.

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

## Current status (2026-11-06)

- OPEN-106 (the device graph) is closed; details in `docs/completed.md`. OPEN-105 and OPEN-107 are
  also closed and migrated here. Production runs 1.0.225 (VPS on `dev`, 2026-11-05); phones under
  test run 1.0.231. OPEN-93 is closed: the exact preserved-identity airplane-mode check and the
  three-phone client-to-client relay both pass. Next by owner direction: OPEN-108 (signed event
  chain), OPEN-109 (trimming), OPEN-110 (all four tabs from the log).

## Earlier status (2026-11-02)

- The repository is at 1.0.207. The last documented production website deployment is 1.0.200;
  Android 1.0.205 responsiveness checks are documented on P30, PH-1, and FRD-L04. Do not infer
  that 1.0.207 is installed on phones or deployed to the website from version metadata alone.
- The web, server, shared core, and Android paths are implemented and have extensive unit,
  integration, browser, and physical-device coverage. Recent stalled-hub responsiveness tests
  passed 28/28 twice, and Android 1.0.205 measurements showed prompt tap reactions on three
  phones. This does not close the owner-reported two-phone offline discovery or DM journey.
- The canonical full gate is **green** as of 2026-11-02: typecheck and lint passed; Jest passed
  3,600 tests with 15 intentional skips; and the merged Playwright run passed 389 cases with
  26 intentional skips and no unexpected or flaky outcomes. All E2E phases returned `rc=0`:
  light, stage5, mesh-batch, mesh-isolated, find-similar, cross-browser, isolated,
  heavy-staged, mass, and the physical C10 phone path. OPEN-94 is complete; repair details and
  the 44m03s canonical-run evidence are recorded in `docs/completed.md`.
- The two UI size-budget suites mentioned in the earlier responsiveness audit now pass locally
  (4 tests on 2026-10-30); they are not current blockers.
- Device-core privacy and host-command work has substantial focused validation. OPEN-91 is now
  closed as the architecture-delivery umbrella; deferred expansion is tracked as OPEN-103 and
  OPEN-104. The walking/transit and unplugged battery gates remain unverified under OPEN-81.

## Active maintenance queue — website and Android first

- [ ] **OPEN-108 — The event log as a signed chain; exchanges both people sign (owner direction
  2026-11-05; spec §31.13 REQ-GRAPH-40..45).** The system is one log of ask and answer events (who,
  where, when, how) on Gun; Talks are structured series of them; the user and the chatbot both
  write them; the four tabs are views of it. History cannot be changed; the present and future stay
  free (a change or deletion is a new event). Review 2026-11-05 against OPEN-106's code: events and
  content are a git-like DAG and each pair log is numbered, hash-linked and signed, but my own events
  are not chained or signed, the receiver's acknowledgement is an unsigned `read: { n }`, the two
  sides of an exchange are not linked by hash, and answers and Talk versions carry no `where`.
  - [x] Device chain: `seq`, `prev`, `sig` on every event I write; `ix/head`; canonical hashing
    shared with the pair log (`keys.ts` `canonicalJson`); unit tests for order, tamper and a gap.
    Done 2026-11-06 (`99149fcf`): `device-graph/chain.ts` + 9 tests; other-authored (`by`) records
    and pre-sequenced events from my other devices never consume my seq.
  - [x] Verification in the index rebuild: `chainBreaks` and the first bad `seq` in the graph
    status; never rewritten. A phone and a browser verify the same chain (no ICU-only code, see the
    2026-11-05 grammar-filter bug).
    Done 2026-11-06 (`944b0ad3`): `rebuildIndexes({ chain })` returns the verification (fromDay
    rejected); `graph.status.chain` reports `chainBreaks`/`firstBadSeq`; deliberate full walk per
    status call (a head-keyed cache would hide tampering — OPEN-109 checkpoints are the cost bound).
  - [x] `where` (blurred cell) on my answers and Talk versions; `mode` / `link` everywhere they are known.
    Done 2026-11-06 (`1bef6767`): locator hook stamps all my events (Talk create/edit/delete, my
    answers/deletions) with the blurred cell + private gps sidecar, signed by the chain.
    Remaining: wire a live locator into the web worker host (page-provided fix → worker).
  - [x] Signed acknowledgement `ack: { n, hash, when, sig }` in the pair head; the sender keeps
    acknowledgements (`ix/ack/<peer>`); `reEntry` on answer entries; the arrival event keeps the
    sender's entry `{ n, hash, when }`. Shared time = both signed times; skew over 10 min shown.
    Done 2026-11-06 (`5fa208ae`): legacy `read` still written/cleared for old peers; skew exposed
    at `status(peer).lastAck.skewMs` — GUI skew display lands with the E2E slice.
  - [x] Redaction: erase a deleted record's content on request, keep its event and hash.
    Done 2026-11-06 (`74919395`): `redactEvent` + `deviceGraph.redact` core request; chain still
    verifies; shared q//a/ records never cleared.
  - [ ] E2e: two people exchange, each side proves the other's signed entry and acknowledgement;
    a tampered local event is reported after restart (web, phone path, real phones).
    **Web part done 2026-11-06** (`edd5eaea`, stage2/97-signed-exchange-chain, passes ~50 s).
    Remaining: phone path and real phones.

- [x] **OPEN-109 — Trim old history with signed checkpoints (spec §31.13 REQ-GRAPH-46..48).** Done
  2026-11-06: checkpoints `0028493d`, history trimming `5c951863`, pair-log trimming `6c64e3a5`.
  - [x] Signed checkpoint `cp/<seq>` `{ seq, hash, when, counts }`, chained like an event;
    verification starts from the newest.
    Done 2026-11-06 (`0028493d`): `writeCheckpoint` + `prevCp` chain; `verifyChain` scopes from
    `ix/cp` (reason `cp` on checkpoint tamper); `graph.status.chain.fromSeq`.
  - [x] Trimming from 90% down to 80%: whole days, oldest first; their events, index entries that
    point only to them, unreferenced content. Kept: the last 30 days, my active Talks, anything an
    open conversation, a confirmed deal or an unacknowledged log entry points to, the chatbot's
    remembered answers.
    Done 2026-11-06 (`5c951863`): `trimHistory`; fail-closed on unreadable owed logs; rebuild after.
  - [x] Pair logs trimmed only below the other person's signed acknowledgement, with a checkpoint
    entry they can verify.
    Done 2026-11-06 (`6c64e3a5`): `trimLog` + signed `cp` in the pair head; readers behind it
    verify the signature and fast-forward. Auto-trigger policy is a later product decision.
  - [x] Tests: a store filled past 90% trims to 80% and still verifies; nothing kept above is lost;
    the indexes rebuild from what remains. Covered by `device-graph-trim.test.ts` (`5c951863`).

- [ ] **OPEN-110 — All four tabs read the one log (spec §31.13 REQ-GRAPH-49, §31.12 #16).** Me already
  reads the graph. Still outside it: chat messages (own Gun message store), Nearby encounters and
  Place visits (hub cards and Place records), the Talks tab's `myTalks`, and Contacts'
  `myConversations`, `dealTalkByConversation` and `needKeyByConversation`.
  - [ ] Chat messages as events (`conv`, `text`), in the pair log, with the DM transport as notify.
    **Graph-core half done 2026-11-06** (`0f4fe730`): `sendMessage` writes + exchanges chained
    message events, receiver's private copy, `ix/conv` + `ix/convs` indexes, `graph.sendMessage`
    request; two latent Gun-store chain bugs fixed en route. Remaining: the DM view reads the log
    and the old Gun message store is demoted to notify, then removed.
  - [ ] Nearby encounters and Place visits as events (`with`, `place`, `where`).
  - [ ] Talks tab from the graph indexes; `myTalks` reduced to device-local display state, then removed.
  - [ ] Contacts from people, exchanges and conversation events; the deal and key maps as events or
    indexes. Collections left only for settings and device-local state.

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
  **Phone-free repair 2026-11-02:** rebroadcasting the same peer/Talk pair in a later outing no
  longer deletes the earlier outing's delivery association, so its pending count stays honest.
  Native reply reconciliation now uses the journaled original outing id instead of whichever
  outing is newest when the WebView resumes. Deterministic unit coverage exercises both paths.
  The lost delivery and ten-minute field delay still require the carried rerun.

- [ ] **OPEN-99 — PH-1 Bluetooth crash loop during the walk (2026-10-31).** From 13:08:45 the
  stack aborted every ~4 s (`startup_timer_expired`, then the Bluetooth HAL) until a reboot; no
  crash in the 30 minutes after it. Storage was fine (72% free). IinPublic's involvement is
  unknown: the planned force-stop test was not run before the reboot. Treat as an observation
  unless it recurs with a BLE-using Always mode.

  - [x] Spec tagging backlog closed 2026-11-06 — all 331 E2E specs now carry valid `covers:`
    SPEC anchors (0 untagged, 0 unresolvable); details in `docs/completed.md`.

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
  **Phone-free repair 2026-11-05:** native-core private writes now serialize per record instead of
  sharing one device-wide queue, so a conversation save cannot wait behind unrelated owner-private
  bookkeeping; same-record ordering is preserved. Conversation history now uses a small manifest
  plus bounded encrypted segments (32 messages by default), so the common append re-encrypts only
  the final segment instead of the whole retained history. Existing v1 envelopes migrate lazily on
  their next append, with focused migration, pruning, and bounded-write coverage.
  (b) "hi 12" (P30, 16:36; probably the slow read fixed under OPEN-102, not proven) was saved, but the mailbox refused it with `epub not found` although the
  sender had just used that key. It reached FRD only about 30 minutes later, after the direct link
  reconnected and the phones synced. The key is now passed through, posting retries 5 times, and a
  successfully decrypted mailbox wrapper seeds the DM key cache immediately; this path has not been
  re-proven on phones. Outgoing messages now show and persist sender-local `sending`, `sent`, `queued`,
  or `failed` state: `sent` means the direct channel accepted the message and `queued` means the
  mailbox accepted it; neither is presented as a recipient read receipt. (c) A received message can
  stay undecrypted. Since 2026-11-01 it shows "This message could not be decrypted." instead of raw
  `SEA{...}` (not yet on a phone). The message subscription now retries unchanged ciphertext with
  bounded backoff when its peer key arrives, and no longer lets a stale initial private-store read
  overwrite a newer live message; focused unit coverage passes. Phone proof remains. (d) P30's app died 12 s after launch at
  16:51:30 with no crash record, and a local `/health` once took about 3 s; causes unknown.
  (e) DM sessions reported `WebRTC connection replaced` around start-up. A send now follows a
  coordinated replacement connection within its original deadline instead of treating that
  internal handoff as a delivery failure; phone proof remains. (f) `getUserPub` gave up on
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
      See OPEN-96 and OPEN-99; OPEN-95, OPEN-97, OPEN-98, OPEN-100 and OPEN-102 are complete. Rerun after OPEN-96. Transit remains not run.
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
- [x] **OPEN-79 — Delegate roster watcher: log read 2026-11-06.** 20 days of samples show the
  cache fallback serving 42% of roster reads (6,050 catches, 612 transitions) with zero
  incorrect rosters — the catch criterion is met and OPEN-32's root cause is now quantified;
  evidence in `docs/completed.md`.

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
