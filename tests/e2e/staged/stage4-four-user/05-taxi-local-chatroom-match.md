# Test: Taxi Driver ↔ Passenger Matching in a Local Chatroom

covers: docs/TODO.md §GG

**File:** 05-taxi-local-chatroom-match.spec.ts
**Features tested:** Two-sided deal roles (`Talk.role: 'offer' | 'request'`), chatbot
exact-question-text auto-reply, flow talks, self-answers recorded at talk-creation time, joining
and broadcasting within a specific LOCAL (city-level) chatroom instead of Global, post-match DM
messaging, and the §CC financial-data guard correctly ignoring descriptive payment-method text.

---

## What this test does (in plain English):

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

All four then join the **San Diego** chatroom (not Global — this is the "local chatroom" from
the scenario) and broadcast the talks they already created. From this point on, nobody manually
answers anything.

- Because Adam's and Alice's questions are textually identical (including the licensed/
  experienced criterion and the payment-methods criterion), and their roles are complementary
  (driver "offer", passenger "request"), the chatbot auto-matches them from each side's own
  self-answer history — same mechanic as `04-dealmaker-chatbot-match.spec.ts`.
- Eve's and Bob's talks use wording nobody else (including each other) ever answered before, so
  neither matches Adam, Alice, or each other.

**Two things from Bernard's original scenario don't exist as real app features and are
deliberately simulated instead of built** (see `docs/TODO.md` §GG's analysis):

- **"Adam gets Alice's precise location to pick her up"** — there is no
  share-precise-location-on-match feature (explicitly deferred/unscoped). Simulated as a plain
  DM text message Alice sends to Adam after the match forms, and Adam replies — both messages
  arrive using the existing, fully-built conversation transport, no new engine code.
- **"Alice makes sure that Adam is a licensed, experienced taxi driver"** — there is no
  verification/vouch system for arbitrary claims. Modeled as an ordinary self-declared criterion
  that's part of the SAME matching chain (both sides self-answer "Yes, licensed and
  experienced.") — the test asserts this Q&A pair is real recorded data on Adam's own talk,
  standing in for Alice being able to see the claim.

## Verifications:

- ✅ Adam and Alice end up with a conversation with each other (checked from both sides), formed
  entirely within the San Diego chatroom, not Global.
- ✅ Adam has no conversation with Eve or Bob; Alice has no conversation with Eve or Bob.
- ✅ Eve has no conversations at all; Bob has no conversations at all.
- ✅ All of the above happens without a single manual click on an answer/response.
- ✅ Adam's talk creation (which includes payment-method text: "accepts major credit cards and
  cash") never triggers the §CC mandatory financial-data validation error.
- ✅ Adam's own recorded self-answer to "Are you a licensed and experienced taxi driver?" is
  "Yes, licensed and experienced." — real talk data, not a mocked claim.
- ✅ A post-match DM ("I am at 123 Main Street...") sent from Alice arrives and is visible in
  Adam's conversation view, and vice versa.

---

**Helpers used:** `bootstrapUser`, `createRideTalk` (local, adapted from the dealmaker spec's
`createDealTalk`), `ensureInLocalRoom`/`meetAndBroadcastLocally` (local — joins `san-diego`
instead of Global, then reuses `clickBroadcastUntilBulkAck` directly since it already falls back
to whatever room is currently open), `openConversationAndSendMessage`/`expectMessageVisible`
(local, mirrors the `showConversationDetail` + `#conversation-message-input` pattern from
`00j-messaging-edge-cases.spec.ts`), `openSettingsSection`/`SETTINGS_SECTION.talkBehavior`,
`clearGunForStage4Spec`.
