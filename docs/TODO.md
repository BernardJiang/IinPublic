# IinPublic TODO

Last reconciled: 2026-08-27 (§BB location auto-match consent and §DD multi-value gender/race
preference matching both landed — see docs/completed.md. §I X8 same-device linking E2E and a
real embedded-node hub-peer env-leak fix landed 2026-08-26; X3 remains the only Priority 2 item
still blocked on native-shell CI runners, Priority 3.)

This file contains active work only. Completed implementation history is in
`docs/completed.md`; product requirements and design decisions are authoritative in
`docs/specs/iinpublic-technical-specifications.md`.

## Priority 2 — identity linking and public-device handoff

### I. Multi-device identity linking

- [x] Freeze v1 semantics: direct mutual `LINK_IDENTITY` edges between independent SEA identities;
  no transitive cluster, implicit sync, merged authorship, or recovery authority. See
  `docs/architecture/identity-v1-semantics.md`.
- [x] Start the **Identity & devices** Settings shell with identity fingerprint/status, local
  protection status, renameable privacy-minimized installation metadata, and linked identities.
- [x] Review and approve `docs/security/local-identity-password-custody-design.md` for staged
      implementation. The exact scrypt profile, authenticated v2 envelope, and IndexedDB
      compare-and-swap foundation, crash-safe set/change coordinator, startup unlock, explicit
      lock, atomic v1 migration, and staged set/change/remove UI are implemented. Password removal
      requires the current password and explicitly warned, verified v2-to-v1 downgrade. Native
      lifecycle adapters/benchmarks and the remaining production release conditions are in
      `docs/security/local-identity-password-custody-review.md`.
- [ ] Later harden password-free custody beyond v1 with a reviewed non-extractable WebCrypto-key
      format for supported browsers and OS Keychain/Keystore adapters for native shells.
- [x] Wire `WebIdentityLinkService` into `app.ts`; entered codes now publish a real SEA-signed
  one-sided attestation and display **Waiting for approval** until mutual confirmation exists.
- [x] Complete the two-installation mutual approval path with a versioned expiring code, real QR,
  optional camera scan, signed request discovery, graph-verified rows, replay rejection, and
  revocation convergence. Covered by `stage2-two-user/73-identity-link-mutual.spec.ts`.
- [x] Make removal local-first with a durable signed revocation outbox, immediate trust denial,
  startup/Settings retry, pending/removed/conflicted/invalid states, and lost-device reconnection
  coverage in `stage2/73`.
- [x] Show verified direct links in peer detail without merging Contacts, authorship, reputation,
  blocks, or Q&A. `WebIdentityLinkService.isLinked(peerPub)` is self-scoped (resolves the edge
  between the viewer's own identity and a given pubkey), so this shows "this peer is one of MY
  OWN verified-linked identities" — the only relationship v1's direct-mutual-only, no-transitive-
  cluster semantics actually define; there is no general "does this peer have any links to
  anyone" index. New `#peer-linked-identity-section` in the peer-detail overlay
  (`ui-manager.ts`), populated by `user-detail-view.ts`'s `openPeerDetailView` via a new
  `UserDetailViewDeps.isLinkedIdentity(peerId)` dep — async, guarded against a stale resolution
  landing after the user has navigated to a different peer (same pattern `resolvePeerStageName`
  already used). Wired end to end: `ui-manager.ts`'s `isLinkedIdentityLive` resolves the peer's
  pub via `gunService.getPublicUser`, then calls a new `identityLinkChecker` hook
  (`setIdentityLinkHooks({ isLinked })`) backed by `WebIdentityLinkService.isLinked` in `app.ts`.
  Purely informational (a small badge + note) — no data is aggregated or merged across the two
  identities. Covered by `user-detail-view.test.ts` (5 tests: renders/doesn't render, clears on
  peer switch, discards a stale resolution for an abandoned peer).
- [x] Wire URL-fragment, loopback, and clipboard same-device linking shortcuts (spec §10.3).
  New `identity-link-fragment.ts` (`buildLinkFragmentUrl`/`parseLinkFragmentPayload`/
  `clearLinkFragmentFromUrl`) and `loopback-probe.ts` (`probeLoopbackNode`/`loopbackLinkUrl`).
  URL-fragment: "Copy link" in the code dialog copies `<origin><path>#link=<code>`; on boot,
  `app.ts`'s `checkForPendingIdentityLinkFragment` decodes and clears a `#link=` fragment
  entirely client-side (never reaches a server) and opens the Enter-code dialog pre-filled,
  skipping typing. Clipboard: a "Paste" button (`navigator.clipboard.readText`, feature-detected)
  in the Enter-code dialog; Copy/Copy-link already existed. Loopback: the "app on this computer"
  is this same codebase in embedded-node mode on `127.0.0.1:<port>` (`embedded-node-config.ts`) —
  a silent `/health` reachability probe (no new endpoint, no new CORS/security surface) decides
  whether to show a one-click "Link with the app on this computer" button, which composes with
  the URL-fragment mechanism (`window.open(loopbackLinkUrl(code))`) rather than inventing a
  separate secret-carrying protocol. **Known gap:** the reverse "Open in app to link" direction
  (browser → native app via a custom URL scheme) needs native-shell deep-link registration not
  buildable/testable without a real Electron/mobile shell (Priority 3, not yet connected to CI).
  Side effect: found `qrcode` (a real `package.json` dependency `link-code-qr.ts` already used)
  was missing from `node_modules` — `npm ci` restored it, which also fixed 6 previously-broken
  test suites (`linked-devices-dialog.test.ts`, `link-code-qr.test.ts`,
  `ui-startup-chatrooms.test.ts`, `identity-password-custody-manager.test.ts`,
  `identity-custody-store.test.ts`, `production-topology-contract.test.ts`) that had nothing to
  do with this change. Covered by `identity-link-fragment.test.ts` (10 tests), `loopback-probe.test.ts`
  (8 tests), and new cases in `linked-devices-dialog.test.ts` (prefill, paste, copy-link,
  loopback-button visibility).
- [x] Enable and pass X8 same-device linking E2E. **Landed 2026-08-26** — see
  `docs/completed.md`. Also found+fixed a real `E2E_GUN_MEMORY_ONLY`/`DEV_GUN_FRESH` env-leak
  bug that was silently zeroing the embedded-node child's upstream Gun peers (affected the
  pre-existing S3 embedded-node spec too). **New known gap surfaced by this work:** the
  production-default embedded-node relay mode (`explicit-http`) only relays a narrow allowlist
  (discovery/signaling/presence/room-membership) between a native shell and the hub —
  `identity-link-requests` isn't in it, so whether same-device linking (or mesh talk delivery,
  which S3 also needs) actually completes on a real native shell talking to the real public hub
  is still open; X8 forces `IINPUBLIC_EMBEDDED_HUB_MODE=gun-peer` as a test-only workaround, not
  proof of the production path. Needs a dedicated look at whether `identity-link-requests` (and
  whatever S3 needs) should join the relay allowlist, or whether same-device linking should
  instead lean on LAN discovery to bypass the hub restriction entirely.
- [ ] X3 website↔app remains skipped — needs a real native-shell CI runner (Priority 3), not a
  same-machine mechanism gap like X8 was.

### J. Sync-then-erase

- [x] Wire encrypted P2P handoff transfer and receiver import (spec §11.2). New
  `shared/handoff-protocol.ts` (pure, mirrors `identity-linking.ts`'s own signed-record
  shape: `EpubAnnouncement`, `HandoffEnvelope`, `HandoffAck`, all pipe-delimited signing
  inputs to avoid `SEA.verify`'s JSON-auto-parse trap) and
  `web-device-handoff-service.ts` (SEA/Gun wiring). Linked devices are known only by
  their signing `pub` (v1 never resolves userId), but encrypting requires the
  recipient's separate `epub` — every identity now publishes a signed `pub→epub` binding
  on boot (`identity-epub/<pub>`) so a linked device can find it without needing a
  userId. Sender: build archive → encrypt to receiver's verified epub → publish signed
  envelope (`handoff/<toPub>/<fromPub>`) → poll for the receiver's signed ack
  (`handoff-ack/<senderPub>/<receiverPub>`); `erase-device-dialog.ts` now shows an error
  and keeps Done disabled on any failure (no epub, ack timeout, verify/decrypt failure)
  instead of the old stub's silent local-only success. Receiver: `readIncomingHandoff`
  checked only against pubs the device already knows it's linked to (never a general
  discovery scan), surfaced as an explicit "Data available to import" card in Identity &
  devices (`linked-devices-dialog.ts`) — nothing merges until the user presses Import,
  which calls the existing `mergeHandoffArchive` and a new
  `WebUserService.importHandoffData` for the persisted fields, then publishes the ack.
  All flat/exact-key Gun paths (never `.map()` discovery) since both sides always
  already know both pubs before they need to read anything — see
  `web-device-handoff-service.ts`'s own doc comment. Found and fixed a real bug via the
  E2E run: `SEA.decrypt` auto-JSON-parses a JSON-shaped plaintext back into an object
  (the same class of quirk already documented for `SEA.verify` in
  `web-ledger-service.ts`), so a bare `String(dec)` produced the literal text
  `"[object Object]"` instead of the archive JSON — fixed by re-stringifying a non-string
  result. `stage2-two-user/72-sync-before-erase.spec.ts` was rewritten from its old stub
  assumption (any sync always locally "succeeds") to its now-correct one: a send to an
  unreachable device must fail loudly and never enable Done. Unit coverage:
  `handoff-protocol.test.ts` (14 tests, including forged-signature/wrong-recipient/
  cross-binding attacks), `web-device-handoff-service.test.ts` (10 tests, full two-
  instance send→read→decrypt and ack round trips over a shared fake Gun store),
  `erase-device-dialog.test.ts` (3 tests for the new error path).
- [x] Enable and pass a real send→ack→import round trip:
  `stage2-two-user/74-device-handoff-transfer.spec.ts` — two real linked browser
  installations, a real encrypted transfer, a real receiver Import click, and an
  assertion that the transferred data actually lands on the receiver. **Known gap:** the
  official `cross-platform/x7-sync-then-erase.spec.ts` stays `test.skip` — it
  specifically wants a hosted *website* linked to a native *webapp* (Electron/
  embedded-node), which needs a real native-shell CI runner not yet connected
  (Priority 3), not a mechanism gap; see that spec's own updated doc comment.

## Priority 3 — native and cross-platform verification

- [ ] Connect the Mac mini, Windows, and Linux native-app jobs to real CI runners.
- [ ] Enable and pass X4 mobile↔desktop matching and threads.
- [ ] Enable and pass X5 three-platform thread isolation.
- [ ] Enable and pass X6 bidirectional offline/mailbox delivery.
- [ ] Add iPhone native-shell coverage when an iOS shell is available. Android is already shipped
  and physically exercised; do not describe it as a browser-profile stand-in.

## Priority 4 — matching and profile follow-ups

### BB. Typed opposite-tag matching follow-ups

`Talk.role` ('offer'/'request') has been fully replaced by `Talk.selfTag`/`preferenceSet` (spec
§30.2) — `checkIfMatch`, `exact-chatbot-memory.ts`, `resolveBuiltInQuestion`, and the talk editor
all read the new fields; `role`/`TalkRole` no longer exist anywhere in the codebase. Price-overlap
matching (`intervalsOverlap` + `builtIn.priceRange`) is E2E-covered end to end with
non-identical, genuinely overlapping ranges (`stage2-two-user/87-price-overlap-buy-sell-
match.spec.ts`) — a `type: 'route'` talk turned out unnecessary for that case; a single-question
`type: 'flow'` talk with one `builtIn` question already covers it.

- [x] Design a privacy-safe source for the responder's blurred location/radius, then wire location
  auto-resolution using the existing mutual-containment comparison. **Landed 2026-08-27** — see
  `docs/completed.md`. Bernard's design: blurred location may auto-answer once the user grants a
  one-time opt-in consent (default OFF); precise location stays entirely separate/manual, never
  auto-sent by chatbot (e.g. taxi/meetup use cases where a driver/passenger explicitly chooses to
  share precisely) — that precise-location feature remains its own deferred item, untouched.
  New `locationAutoMatchConsent` setting (`ui-settings-storage.ts`) gates a new
  `myMostRecentLocationTalk` lookup (`answer-preference-resolution.ts`, over the already-local
  `getMyTalks()`) that sources side "b" of `locationsMutuallyContained` from my own most-recent
  matching-scope talk's `authorLocation`/`locationRadiusMiles`, exactly the shape the original
  research note below proposed.
- [x] Persist user-created opposite-tag pairs; seeded pairs already work. **Landed 2026-08-23** —
  see `docs/completed.md`.
- [x] Support talk-level shared time/location questions before route item branches. **Landed
  2026-08-23** — see `docs/completed.md`.
- [x] Add E2E cases for missing preference and `location`'s unconditional-ASK_USER fallback to
  the human inbox. **Landed 2026-08-26** — see `docs/completed.md`.
  `stage2-two-user/95-builtin-ask-user-fallback.spec.ts`. (Real cross-browser route matching is
  covered separately — `stage2-two-user/92-route-shared-builtin-root-branches.spec.ts`.)

### DD. Generalized dating matching

Design is specified in technical specification §30.6. The age-range comparator and multi-value
gender/race preference matching are now both fully wired and shipping (as the built-in Dating
talk template); the remaining bullet — photo-delivery consent/safety copy — carries its own
product/safety judgment call and is left for a dedicated pass.

- [x] Implement mutual preference-set membership and the age point-in-range primitive. **Landed
  2026-08-23** — `mutualPreferenceSetMembership`/`ageRangeMutuallyAcceptable`
  (`src/shared/built-in-comparisons.ts`), 9 new unit tests. Pure functions only, matching the
  file's existing `intervalsOverlap`/`quantitySufficient`/`locationsMutuallyContained` style —
  `mutualPreferenceSetMembership` generalizes `checkIfMatch`'s existing one-directional
  `preferenceSet` veto to a real two-sided check (both sides' own selfTag/preferenceSet
  supplied), matching that veto's exact permissive default for a missing counterpart selfTag.
- [x] Wire `ageRange` as a real `BuiltInQuestionKind`, and force+lock `isAdult` for talks that use
  it. **Landed 2026-08-24** — see `docs/completed.md`.
- [x] Wire multi-value gender/race preference matching. **Landed 2026-08-27** — see
  `docs/completed.md`. Bernard's design: NOT `mutualPreferenceSetMembership` (a single Pair-tag
  question can only ever have one accepted answer, `singleNonIgnoreAnswer` — a preference SET on
  one question would break the exact-text hash a Pair-tag match relies on, and isn't unique/
  order-independent) — instead, several independent Pair-tag branches (one per accepted gender)
  fan out in parallel off the shared `ageRange` root, `parallelMatchThreshold: 1` (OR semantics).
  `mutualPreferenceSetMembership` itself stays unwired/unused — superseded by this approach for
  Dating; still available for some other future use case needing a genuine two-sided
  (selfTag, preferenceSet) check outside a question tree.
- [ ] Add optional author-selected talk photo delivery after a successful match and safety notice.

### EE. Me/profile completion

- [ ] Store typed built-in declarations as `AnswerRecord` values rather than profile fields.
  **Research note (2026-08-23), not yet implemented:** no separate "profile field" was ever
  actually written for these (Bernard's original correction — completed.md, 2026-08-11 EE
  entry — headed that off before implementation: profile holds only StageName + headshot).
  What's actually true today: a typed built-in value (quantity/priceRange/timeFrame the author
  enters on their OWN question) is saved ONLY into `typedPreferenceState` (chatbot-only,
  invisible to the author) — `applyBuiltInKindToQuestion`/route's `answersHtml = q.builtIn ? ''`
  both hide the ordinary self-answer radio for a builtIn question, so no self-answer is ever
  recorded through the normal mechanism either. Net effect: the author's own typed declaration
  never appears anywhere in their own Me-tab Answers list today — arguably the same "invisible
  side value" problem the profile-field framing was trying to avoid, just realized via a
  different store. `answers-view.ts`'s "Answers" list is scoped to talks with
  `role === 'answered' || 'copied'` (things I responded to), not self-authored declarations, so
  the fix isn't a small display tweak — it needs a real decision on where a self-authored
  builtIn declaration should surface. Left open rather than guessing at that shape.
- [ ] Add typed-value round-trip and section-isolation E2E coverage. Blocked on the above.
- [x] Update the technical-specification implementation matrix. **Landed 2026-08-23** — Appendix
  18's stale "opposite-attribute preference-sets + typed built-ins... not yet implemented" row
  split to accurately reflect that §BB has substantially shipped, with `location` auto-resolution
  and §DD (dating) called out as the remaining not-implemented pieces.

### II. User-defined tag compatibility, generalized beyond symmetric opposites

**Landed:** the core data model — `Talk.selfTag: string` + `Talk.preferenceSet: string[]` (spec
§30.2), replacing `Talk.role` entirely. `checkIfMatch`'s veto is now
`preferenceSet.includes(responderSelfTag)` — a real membership check against a list, so "buy"
satisfied by several counterparts ("sell" AND "offer" AND "free") is already structurally
supported, not just a future idea. `exact-chatbot-memory.ts`'s auto-reply veto and
`resolveBuiltInQuestion`'s scope-key derivation were updated to match.

**Landed, 2026-08-19:** `#talk-preference-set` (talk-editor-dialog.ts) — an explicit, editable
counterpart-tag field next to `#talk-tag`. Auto-tracks the seeded single opposite live until the
author types their own value there (or opens an existing talk that already has one), at which
point that value wins outright, including declaring the SAME tag as `selfTag` itself ("match
fellow buy people" buddy-style talks — previously impossible, since auto-fill only ever produced
the opposite). `processTalkForm` reads whichever of the two fields has content, falling back to
the old single-opposite auto-fill when empty. Closed the last script-injected talk creation in
`89-buy-sell-chatbot-cross-talk-match.spec.ts`.

Still open — **superseded by §LL below, not to be built as originally scoped here:**
- [ ] No persistence for user-created pairs — the seeded registry (`tag-opposite-pairs.ts`:
  buy/sell, hiring/jobseeking, male/female) still only auto-fills a **single** `preferenceSet`
  value from those 3 hard-coded pairs; typing any other tag gets no auto-derived compatibility.
  Still real under §LL too (the registry becomes an editor-autofill-only convenience there), but
  persistence itself is unscoped either way.
- [ ] ~~No multi-value editing UI~~ — built as a comma-separated `#talk-preference-set` field
  above, but §LL rejects multi-value on a tag outright (a bare second word like "free" is
  ambiguous without its own question — give or receive?) and routes that need instead through
  §LL's single-answer rule: a second accepted tag becomes a second ANSWER ROW on an ordinary
  question, not a second comma-separated string entry. `#talk-preference-set` is expected to be
  retired once §LL lands, not extended.
- [ ] The question/answer-shaped generalization ("need a plumber" satisfied by "does plumbing")
  discussed alongside this is now the substance of §LL, not separate discussion.

### JJ. Bidirectional deal confirmation (spec §30.2, replaces the old auto-exclusivity guard)

Landed this session: a talk declaring `selfTag`/`preferenceSet` is no longer exclusive on its own
— several compatible candidates can each hold an open conversation (the earlier
`isExclusiveMarketplaceTalk`/closest-match auto-pick-and-reject machinery in `app.ts`, built for
taxi/dealmaker, was removed entirely). Instead, each conversation gets a "Confirm Deal" affordance
(`#conversation-confirm-deal-btn`, `showConversationDetail` in `ui-manager.ts`); once BOTH
participants confirm (`WebConversationService.confirmDeal`, `Conversation.dealConfirmedBy`), each
side's own device independently disables its own outstanding created deal-eligible talk(s)
(`maybeFinalizeConfirmedDeal`, `app.ts`) — detected reactively on whichever device confirms
second, and via Gun-sync on the other, since "both confirmed" can become true on either side.

- [ ] **Known gap:** confirming a deal does NOT mark a *different* candidate's conversation (e.g.
  a losing driver with their own separate talkId, matched against the same passenger's request)
  as "no longer available" — grouping "other candidates for the same underlying need" across
  different authors' own talkIds needs a mapping that doesn't exist yet.
  `05-taxi-local-chatroom-match.spec.ts`'s rewritten two-driver test documents this gap directly
  rather than asserting it works.
- [ ] `maybeFinalizeConfirmedDeal` currently disables **all** of the confirming user's outstanding
  created deal-eligible talks, not just the one specific to the confirmed conversation (bidirectional
  exchange means the conversation's own `talkId` field isn't a reliable way to find "my side" of a
  specific deal — see the function's doc comment). Fine for the "one active listing" scenarios
  this session's tests use; a user running several simultaneous listings and expecting confirming
  one deal to leave the others open is unhandled.

### KK. Context-aware chatbot answer matching, generalized beyond talk-title scoping

The target model: an incoming talk's question is never matched against a specific counterpart
talk directly — every question a user answers flattens into that user's own Me-tab Q&A store,
keyed by context, and a NEW incoming talk's question is resolved by looking itself up in that
flattened store. This is largely how the codebase already behaved for ordinary flow/tag
questions via two existing pieces, not a new mechanism that had to be built:
`saveAnswerPreference` (`ui-manager.ts`) writes every answered question into 3 stores at once
(exact-chatbot-memory, a context-aware flattened store, and a legacy per-talk-instance store);
`buildAnswerPreferenceLookupKey` (`shared/flattened-answer-keys.ts`) keys the flattened store by
the normalized chain of prior `{questionText, answerText}` pairs leading to the current question
— talk-identity-independent, which is exactly the per-context matching this design wants (except
for the first question in a chain, deliberately talk-independent for cross-talk reuse, and
tag/single-question talks, which are content-hash-scoped instead).

**Landed:**
- Lookup order fixed: `resolveAnswerPreferenceForTalkQuestion` now tries the context-aware
  flattened lookup FIRST (single-select only — the flattened store has no concept of a checked
  set), translating the stored answer back to the current talk's own answer id by TEXT (not by
  the stored id, which may belong to a different, independently-authored talk's id scheme).
  Falls back to context-free `exact-chatbot-memory` only when the flattened lookup has nothing.
- `selfTag`/`preferenceSet` now enter the context key via `myEffectiveTagContext` (`ui-manager.ts`)
  and `buildAnswerPreferenceLookupKey`'s new `tagContext` param. Correction from the original
  proposal in this section: hashing `preferenceSet` as ONE sorted+joined string (mirroring
  `cid.ts`'s talk-content-hash) turned out to be wrong, not just suboptimal — a single incoming
  talk only ever declares one `selfTag`, so a joined multi-member string can never be reconstructed
  from the read side, breaking the cross-talk lookup entirely for any talk whose `preferenceSet`
  has more than one member. The actual fix: fan out per `preferenceSet` member on SAVE (one
  bucket per member of the CURRENT talk being saved — bounded by that one talk's own tag count,
  not combinatorial across the question chain), single lookup per READ (an incoming talk has
  exactly one `selfTag`). E2E-verified end to end for the ordinary buy⇄sell case and for the
  collision this section was written to fix (a user's two same-item talks with different
  `preferenceSet` no longer bleed into each other) —
  `stage2-two-user/89-buy-sell-chatbot-cross-talk-match.spec.ts`. Still open: the "answering
  someone else's talk ad hoc, with no talk of my own in play" case has no `preferenceSet` to fan
  out at all (falls through to `mySelfTag`-only scoping, which is correct but coarser).

Still open:
- [ ] **Tag position is not fixed to "root" or "talk-level singular metadata."** The design pass
  this bullet used to call for is now written up in §LL below — a tag is really just a simplified
  single-question talk, and the fix is to model it as an ordinary node in the question chain
  rather than special-cased talk-level metadata, so `checkIfMatch`'s veto and the context-hash
  path both fall out for free instead of needing position-awareness bolted on.

### LL. Unify `type: 'tag'` and `selfTag`/`preferenceSet` into one mechanism (design, 2026-08-19; landed, 2026-08-19)

Design settled (Bernard, 2026-08-19), then implemented same day. Supersedes §II's now-struck-through
"multi-value editing UI" item and §KK's "tag position is not fixed to root" item above; both were
pointing at the same underlying redundancy.

**Landed exactly as originally proposed, no veto:** `type: 'tag'` talks carry NO `selfTag`/
`preferenceSet` at all — `processTalkForm`'s tag branch (`ui-manager.ts`) only ever produces one
ordinary `Talk.questions` entry: `text = keyword` (the tag word/title), one match answer whose
`text` is a new `#talk-answer` field's value (talk-editor-dialog.ts), defaulting to the same word
as the keyword when left untouched (self-match), and one "Ignore." answer. That question/answer
pair IS the whole declaration; `checkIfMatch`'s `preferenceSet` veto (talk-engine.ts) is untouched
code-wise but structurally a permanent no-op for tags now, since they never set the field. Matching
— manual checkbox or chatbot auto-reply — is the exact same plain text-based mechanism every other
question already uses (`exact-chatbot-memory.ts`'s exact-question-text memory): "buy"→"buy"
self-match and "buy"→"sell" opposite-pair both just fall out of whatever question/answer text the
two independent authors happened to choose — per Bernard: "for chatbot matching, there is no
concept of opposite, just answer matching," and "opposite meaning is defined by user in
question/answer format, they can be anything." `#talk-tag`/`#talk-preference-set` (spec §30.2
Phase 5) are UNCHANGED and stay flow/route-only (now single-value, no comma-split), hidden from the
tag form entirely. `?`-notation (ui-manager.ts's `tagAnswerSuffix`) renders by reading the answer
text straight off `Talk.questions[0].answers` for tag-type, or `selfTag`/`preferenceSet` (unchanged)
for flow/route. One accepted, deliberate consequence: two independently-created tag talks with the
literal same question AND answer text (e.g. both "sell" with both defaulting their accepted answer
to "buy") can wrongly auto-match via the chatbot's exact-text memory — no protection, by design,
since tag talks are meant to be simple/low-stakes and any real veto would just be re-adding the
special-case machinery this whole design pass exists to remove. A second, separate consequence:
`isDealEligibleTalk` (app.ts) requires both `selfTag` and a non-empty `preferenceSet`, so a
tag-talk match is never deal-eligible — no "Confirm Deal" step, the talk simply never auto-disables
on a tag match (same as any other plain talk; unaffected feature, not touched by this pass). The
seeded opposite-tag registry (`tag-opposite-pairs.ts`) is confirmed editor-autofill only — a
convenience default in `wireTagAnswerAutoFill`, never read by any matching/runtime path.

**The core idea:** `type: 'tag'` (the one-checkbox talk — hardcoded "Match."/"Ignore." answer
text) and `selfTag`/`preferenceSet` (talk-level metadata on flow/route talks, checked once as a
special veto in `checkIfMatch`) are the same concept expressed two different ways. A tag is
really just a single-question talk: title = question text (already true for `type: 'tag'`,
`processTalkForm`'s tag branch), and the single answer's TEXT is the accepted counterpart —
defaulting to the SAME word as the question (self-referential: "I'm tagged buy; match anyone else
tagged buy" — the classic "Tennis" interest-tag case), overridden by typing a different word when
the author wants an opposite-pair match ("buy" the question, "sell" the answer). Matching then
needs no special veto at all — it's the ordinary flattened-answer-store (§KK) lookup already used
for every other question, keyed on question text + answer text, exactly like any other
single-question flow talk.

**Real behavior change, not just a refactor:** today, a `#talk-tag`/`selfTag` with no known
seeded opposite falls back to "no `preferenceSet`, matches anyone" — inconsistent with what a
plain interest tag ("Tennis") has always actually meant (self-match, not "matches anyone"). Under
this design self-match becomes the one universal default; "matches anyone" is no longer a
distinct fallback state.

**Single answer only — draw the line there, not at multi-value.** Considered and rejected: an
author typing several accepted counterparts on one tag question ("buy" accepting "sell" OR
"free"). Rejected because a bare word like "free" is ambiguous outside its own dedicated
question — "free" could mean giving away or wanting to receive, and a single tag chip has no room
to disambiguate that. If an author genuinely needs multiple accepted answers, it's not a tag
anymore — it's an ordinary multi-answer question (the editor's existing "+ Add Answer" /
`answerSelectionMode` machinery already handles this for flow/route questions), not a
comma-separated list bolted onto the tag's own single-answer shape. This retires the shipped
`#talk-preference-set` free-text field (talk-editor-dialog.ts, §II) once implemented — that field
correctly closed the immediate gap, but a comma-separated string is the wrong shape once the
single-answer rule is settled; a second accepted tag should be a second answer ROW using the same
UI every other question already has, not a parsed string.

**Display notation:** when the answer differs from the question, render the tag as
`{question}?{answer}` — e.g. "buy?sell" for an opposite-pair tag, plain "buyer" (no `?`) for the
self-match/buddy case where question and answer are the same word. Distinguishes "Buy iPhone"
(seeking a seller) from "Buy Buddies iPhone" (seeking fellow buyers) at the chip/row level instead
of relying on the talk's title alone to carry that meaning — the exact ambiguity
`stage2-two-user/89-buy-sell-chatbot-cross-talk-match.spec.ts`'s two Adam talks exist to catch.

**Route placement (on hold): drag-and-drop, not typed metadata.** The longer-term vision for "tag
position is not fixed to root" is a graphical route editor where an author drags an existing tag
onto any node of a route DAG and it drops in as an ordinary question/answer pair at that
position — no separate label-and-type-out-a-question step, since the tag already carries its own
question/answer text. Depends on a drag-and-drop route editor that doesn't exist yet (today's
route editor is the custom DOM tree in talk-editor-dialog.ts, no graphical canvas) — explicitly
parked until that exists, not part of this design pass.

**Net effect: simplifies rather than adds.** One matching mechanism (ordinary question/answer via
the flattened-answer store) instead of two (checkbox-tag booleans + `selfTag`/`preferenceSet`
veto); one UI answer-editing surface (the existing question/answer rows) instead of two (that
surface plus a separate free-text preference field); one default rule (self-match) instead of an
inconsistent "matches anyone" fallback for the unrecognized-tag case.

Resolved during implementation:
- [x] `type: 'tag'` stayed a distinct wire type — still renders as a one-line chip, no Gun data
  migration; its answer TEXT (via the new `#talk-answer` field) became meaningful directly, no
  talk-level metadata involved.
- [x] `checkIfMatch`'s veto code was left in place (untouched) but is now a permanent no-op for
  `type: 'tag'`, since tags never set `preferenceSet`. Every existing caller
  (`exact-chatbot-memory.ts`, `resolveBuiltInQuestion`, `myEffectiveTagContext`) still applies to
  flow/route talks exactly as before, unaffected; `myEffectiveTagContext` also got the self-match
  responder-side fix described above, relevant to flow/route buddy-tag talks now (not tag-type,
  which no longer uses that code path at all).
- [x] No migration/rewrite for existing stored talks — old flow/route talks with no
  `preferenceSet` keep today's "matches anyone" read behavior; old tag talks with hardcoded
  "Match."/"Ignore." answer text are untouched too; only the editor's output for newly-saved
  tag talks changed.
- [x] Confirmed the seeded opposite-tag registry (`tag-opposite-pairs.ts`) is editor-autofill only
  (`talk-editor-dialog.ts`'s `wireTagAnswerAutoFill`), never read by any matching/runtime path.

### LL.1 Per-question `reciprocalTagContext` — generalizes the root-only tag fields (Bernard, 2026-08-20; landed same day)

The root-only `#talk-tag`/`#talk-preference-set` fields (spec §30.2 Phase 5, unchanged by this
item) can only declare ONE buy/sell-style context for a whole talk. This adds a checkbox next to
every question in the flow/route editor (`Question.reciprocalTagContext`, types.ts): when checked,
that question's own (text, its one non-`ignore` answer's text) pair defines the tag context for
every question after it in the same branch — usable anywhere in a tree, not just the root. A
nearer-scoped override: `myEffectiveTagContext` (ui-manager.ts) now tries
`findReciprocalTagAncestor` first (branch-aware via `Question.contextPath` for route, linear array
position for flow), falling back to the unchanged talk-level `selfTag`/`preferenceSet` fields when
no qualifying ancestor exists.

"Exactly one answer" turned out to mean exactly one NON-`ignore` answer, not `answers.length===1`
— `TalkValidator.validateQuestion` requires every question to carry an Ignore option regardless, so
an ordinary single-`match`/`next` + one `ignore` question (the editor's normal 2-answer default)
already qualifies; no special answer-count authoring step needed. `findReciprocalTagAncestor` and a
matching early-exit in `resolveAnswerPreferenceForTalkQuestion` both share one helper,
`singleNonIgnoreAnswer`.

That early-exit was itself a necessary addition, not just wiring: a reciprocal question whose own
text differs from anything the responder has ever answered before (e.g. a "buy" root vs. a "sell"
root — the whole point of an opposite pair) can never win the ordinary flattened-store/exact-text
memory lookup, since that lookup is inherently keyed on having seen this exact text before. Checking
the box already IS the full declaration, so a reciprocal question with exactly one real answer now
auto-proceeds unconditionally (`mode:'auto'`, `autoAnswerReason:'RECIPROCAL_TAG_CONTEXT'`) — the
same "no real decision to make" pattern `type:'tag'` already established for its own single
match-answer (§LL).

Explicitly out of scope, confirmed unaffected: `checkIfMatch`'s `preferenceSet` veto and
`resolveResponderSelfTagForAnswers` (talk-level only); `resolveBuiltInQuestion`/
`typed-preference-store.ts` (separate typed quantity/price mechanism); `talk-response-dialog.ts`
(responder UI unchanged — this is purely editor-authoring + matching-engine); survey and tag types
(survey has no branching; tag's single Q&A is already fully expressed via title/`#talk-answer`).

New coverage: `90-reciprocal-tag-context-non-root-question.spec.ts` — a "buy" flow talk and a
"sell" flow talk, each declaring their tag via an ordinary Q1 (not talk-level metadata), zero-click
auto-match on a shared downstream "Is it an iPhone?" question.

### LL.2 Explicit `Question.tagKind: 'simple'` + ancestor-aware match veto (Bernard, 2026-08-21; landed same day)

§LL/§LL.1 left two tags conflated under one boolean: a `type:'tag'` talk's own answer could still
diverge from its keyword with no explicit marker for *why*, and `reciprocalTagContext` (the
asymmetric "Pair tag" — question text = my declared tag, its one real answer = the accepted
counterpart) never actually gated a match anywhere but the talk root — it only ever fed chatbot
auto-fill context for downstream questions.

This adds `Question.tagKind?: 'simple'` (types.ts) as the explicit, mutually-exclusive counterpart
to `reciprocalTagContext`: a "simple tag" is self-match by definition — its one non-`ignore` answer
MUST equal the question's own text — usable on any question in any talk type (tag/flow/survey/route),
the same atomic building block `reciprocalTagContext` already was. `TalkValidator` enforces both
shapes now: a literal `type:'tag'` talk defaults to simple-tag text-equality unless
`reciprocalTagContext` is set (scoped to `talk.type === 'tag'` only — `validateTalk`'s "tag by
structure" heuristic also routes non-tag-type single-question/two-answer talks, e.g. a flow talk
with one `builtIn` comparison question, through the same validator and must stay permissive); a
`reciprocalTagContext` question's "exactly one non-ignore answer" rule — previously only gracefully
skipped at read time by `findReciprocalTagAncestor`, never actually enforced at save time — is now a
hard validation error too, via a shared `validateTagKindFields` helper (`validateQuestion` for
flow/survey, and route's own inline per-question loop, since route never routed through
`validateQuestion`). `TalkAutofix.fix` silently force-corrects a `tagKind:'simple'` question's
answer text to match its question, one shared step ahead of every type-specific branch.

The real generalization: `findReciprocalTagAncestor`'s ancestor-walk logic moved from
`ui-manager.ts` (web-only) into `talk-engine.ts` as an exported `findTagPairAncestor`, so
`checkIfMatch`'s own preference veto can consult it directly — a mid-tree `reciprocalTagContext`
ancestor now wins over the talk-root `preferenceSet` and actually vetoes a mismatched
`responderSelfTag`, the same precedence the chatbot-context derivation already used. `ui-manager.ts`
now delegates to the shared function instead of keeping its own copy.
`exact-chatbot-memory.ts`'s independent `PREFERENCE_CONFLICT` gate (`findAutoAnswer`/
`findAutoAnswerMultiple`, fed by a flat `incomingTalkPreferenceSet`) got the same treatment at its
caller (`resolveAnswerPreferenceForTalkQuestion`) — otherwise the chatbot could auto-answer past a
mid-tree conflict manual answering would now correctly refuse.

Editor UI: the tag-talk form gets an explicit "Pair tag" checkbox (`#tag-pair-checkbox`,
unchecked/simple by default, hides `#talk-answer` entirely until checked — no more silent
divergence). The flow/survey shared question template (`addQuestionToForm`) gets a sibling "Simple
tag" checkbox next to the existing "Pair tag" one, mutually exclusive; the route editor gets the
identical pair. Product-facing term for what internal code still calls `reciprocalTagContext`:
**"Pair tag."**

Explicitly out of scope, deferred to a separate design pass: an actual drag-and-drop node/graph
canvas editor for route (the generic per-question form is extended everywhere in this pass, not
replaced); decoupling "seeds context for later questions" from the pair-tag match itself (kept
coupled, as before).

## Priority 5 — TechSupport productionization

### K7. Delegated TechSupport answers

- [ ] Write the design note first: co-operator discovery, signed redirect, relayed answer,
  `answeredByDelegate` audit trail, timeouts, abuse controls, and privacy boundaries.
- [ ] Implement only after that design is approved.

- [ ] Define production TechSupport key custody and rotation tooling.
- [ ] Package the headless/off-server TechSupport agent.

## Smaller independent work

(2026-08-23 batch — R4/R5/FF measured, no action needed at current scale; Z/CC/sendBulkTalk/
authorship/architecture-prose landed. See `docs/completed.md`.)

## Deferred product decisions

- Multiple identities/profile switching on one device.
- Whether linked-device clusters receive a durable person identifier.
- Whether contacts, blocks, conversations, Q&A, credit, and reputation aggregate across linked
  identities; v1 remains mutual-link/display merge only.
- Precise-location sharing as an explicit opt-in feature.
- Talk bridging through a middle person remains version 2; discovery gossip and configurable mesh
  forwarding remain version 1.

## Verification rules

1. Put E2E specs in the lowest stage with enough users and add a companion `.md` explanation.
2. Assert durable state or stable UI signals, not transient toasts.
3. If a test exposes a product bug, fix the product rather than weakening the assertion.
4. Move completed work to `docs/completed.md` immediately.

## Nightly jobs

- `npm run health`
- `npm run test:e2e:parallel`
- `npm run test:e2e:heavy`
- `npm run test:e2e:mesh`
