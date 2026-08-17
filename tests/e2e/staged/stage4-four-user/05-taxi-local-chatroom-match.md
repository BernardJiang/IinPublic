# Test: Taxi Driver ↔ Passenger Matching in a Local Chatroom

covers: docs/TODO.md §GG

**File:** 05-taxi-local-chatroom-match.spec.ts
**Features tested:** Two-sided deal roles (`Talk.role: 'offer' | 'request'`), chatbot
exact-question-text auto-reply, flow AND tag talks, self-answers recorded at talk-creation time,
joining and broadcasting within a specific LOCAL (city-level) chatroom instead of Global,
distance-based closest-match ranking (`src/shared/closest-match.ts`), marketplace-exclusivity
"busy, reject new inquiry" (`isExclusiveMarketplaceTalk` guard in `app.ts`), post-match DM
messaging, and the §CC financial-data guard correctly ignoring descriptive payment-method text.

Three tests, three `describe` blocks, in order of increasing sophistication.

---

## Test 1 — "Adam+Alice auto-match in the local room; Eve+Bob never match anyone"

Four users — Adam, Eve, Bob, and Alice — each create their own talk describing their side of a
taxi ride, **before joining any chatroom and before ever knowing about each other**:

1. **Adam** (driver, role "offer") creates a flow talk with four yes/no criteria: ride timing,
   pickup zone, "are you a licensed and experienced driver?", and accepted payment methods.
2. **Alice** (passenger, role "request") creates a flow talk with the **exact same** four
   questions and answer wording as Adam's, each answered "yes" for herself.
3. **Eve** (driver, role "offer") creates a similar-looking flow talk, but every question is
   worded differently from Adam/Alice's.
4. **Bob** (passenger, role "request") creates a similar-looking flow talk too, worded
   differently again — from Adam/Alice's **and** from Eve's.

All four then join the **San Diego** chatroom (not Global) and broadcast the talks they already
created. From this point on, nobody manually answers anything. Because Adam's and Alice's
questions are textually identical and their roles are complementary, the chatbot auto-matches
them from each side's own self-answer history — same mechanic as
`04-dealmaker-chatbot-match.spec.ts`. Eve's and Bob's talks use wording nobody else ever answered
before, so neither matches anyone.

**Two things from Bernard's original scenario don't exist as real app features and are
deliberately simulated instead of built** (see `docs/TODO.md` §GG's analysis):

- **"Adam gets Alice's precise location to pick her up"** — no share-precise-location-on-match
  feature exists (explicitly deferred/unscoped). Simulated as a plain DM text message.
- **"Alice makes sure that Adam is a licensed, experienced taxi driver"** — no verification/vouch
  system exists. Modeled as an ordinary self-declared criterion in the same matching chain.

### Verifications:

- ✅ Adam and Alice end up with a conversation with each other (checked from both sides), formed
  entirely within the San Diego chatroom, not Global.
- ✅ Adam has no conversation with Eve or Bob; Alice has no conversation with Eve or Bob.
- ✅ Eve has no conversations at all; Bob has no conversations at all.
- ✅ All of the above happens without a single manual click on an answer/response.
- ✅ Adam's talk creation never triggers the §CC mandatory financial-data validation error.
- ✅ Adam's own recorded self-answer to the licensed/experienced question is real talk data.
- ✅ A post-match DM sent from Alice arrives and is visible in Adam's conversation view, and vice
  versa.

**Helpers used:** `bootstrapUser`, `createRideTalk`, `ensureInLocalRoom`/`meetAndBroadcastLocally`,
`openConversationAndSendMessage`/`expectMessageVisible`, `openSettingsSection`/
`SETTINGS_SECTION.talkBehavior`, `clearGunForStage4Spec`.

---

## Test 2 — "each driver matches its nearest passenger; a losing driver racing for the same passenger is rejected once busy"

Follow-up scenario, its own 5-browser `describe` block: Adam, Eve, and Frank are drivers with
**byte-identical** offer wording; Bob and Alice are passengers with the same identical wording as
a request. All 5 broadcast into the San Diego room with chatbot enabled.

This exercises real new engine behavior, not just content-based selectivity like Test 1:

- **Closest match is symmetric, not passenger-only.** `Talk.authorLocation` is populated
  automatically at talk-creation time from each user's (test-pinned) location. Whichever side of a
  `role: 'offer'`/`'request'` pair receives MULTIPLE same-content candidates from different
  authors stages and ranks them by real distance (`pickClosestCandidate`) before committing —
  offerers ranking multiple requesters and requesters ranking multiple offerers both work the same
  way; there is no one-directional restriction. Geography here is deliberately chosen so **both**
  directions' independent rankings agree (mutual nearest-neighbor): Eve is pinned essentially on
  top of Bob (and far from Alice) so Eve↔Bob forms as a clean, uncontested pair; Adam and Frank are
  both pinned near Alice (and far from Bob) so **both** correctly rank Alice as their nearer
  passenger and race for her — testing the busy guard on purpose.
  - A **known, accepted limitation**: without geography chosen for mutual agreement, this
    bidirectional design does not guarantee a single globally-optimal pairing (that would need a
    fully coordinated bipartite stable-matching solver across independent P2P devices, which is
    out of scope) — a driver farther from a passenger than another driver could still end up
    racing for her if its own ranking (comparing only its own candidates) also puts her first.
- **Busy / reject new match inquiry** is the guarantee actually being tested by the Adam/Frank
  race: once Alice's first match forms, her own talk is immediately (synchronously, before any
  further `await`) marked disabled — closing the race window between the check and the flag being
  set. A second inquiry to her is rejected by two independent guards: the live mesh-response path
  (`handleMeshTalkResponse` in `app.ts`) and a second, separate Gun-sync path
  (`ingestConversationRecords`) that a losing responder's own device can otherwise reach around the
  first guard through — both had to be closed. **What is NOT asserted**: the losing driver's own
  device may still locally believe it matched (a responder commits its own conversation the
  instant it computes `isMatch === true`, before ever hearing back from the owner — pre-existing
  app architecture, not something this feature changes or corrects). Only the **owner's** own view
  is asserted as authoritative.

### Verifications:

- ✅ Eve ends up with exactly Bob as her only conversation partner (and vice versa) — uncontested,
  no ranking needed.
- ✅ Eve's own talk becomes disabled (busy) once matched.
- ✅ Alice settles on exactly one partner (either Adam or Frank — which one is a real mesh-timing
  race and deliberately not asserted).
- ✅ The winning driver's own talk becomes disabled (busy) once matched.

**Additional helpers used:** `pinStableE2eLocation` (accepts an optional `{latitude, longitude}`
override — previously hardcoded to San Diego for every caller), `isOwnTalkDisabled` (local).

---

## Test 3 — "a single-question tag talk on each side is enough for the chatbot to match two strangers"

Per feedback after Tests 1–2: a `type: 'tag'` talk — one question, a checkbox-style yes/no — is
all a driver or passenger should need to author; multi-question flow criteria lists shouldn't be
required just to say "I'm available, here's where I am." One driver and one passenger each create
the simplest possible tag talk with identical wording and opposite roles, broadcast, and match
with zero manual clicks — proving the matching engine (`checkIfMatch`, the marketplace busy guard)
is talk-type-agnostic: it keys only on `Talk.role`, never on question count or structure, so this
required zero additional application code beyond Tests 1–2.

Distance-based closest-ranking with multiple simultaneous candidates is deliberately NOT re-tested
here (Test 2 already covers it) — with only one candidate on each side there is nothing to rank.
Matching stays exact-text throughout; fuzzy/approximate matching is out of scope by design (see
`feedback_simple_talks_exact_match` memory) — the only "fuzzy" element anywhere in this feature is
the continuous numeric distance comparison in Test 2's ranking, not the content match itself.

### Verifications:

- ✅ The passenger ends up with exactly the driver as her conversation partner.
- ✅ Busy-on-match applies to the simplest talk shape too, via the same code path as Tests 1–2 —
  the passenger's own talk becomes disabled once matched.

**Helpers used:** `bootstrapUser`, `selectTalkEditorType(page, 'tag')`, `clearGunForStage4Spec`,
`prepareLocalBroadcast`/`clickBroadcastUntilBulkAck` (shared with Test 2).
