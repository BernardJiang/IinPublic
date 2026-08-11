# Test: Dealmaker — Chatbot Auto-Matches Strangers on a Used-Notebook Deal

covers: SPEC-12.3

**File:** 04-dealmaker-chatbot-match.spec.ts
**Features tested:** Two-sided deal roles (`Talk.role: 'offer' | 'request'`), chatbot exact-question-text auto-reply, flow talks, self-answers recorded at talk-creation time, four simultaneous independently-authored talks in one room, partial-match isolation (some pairs match, others don't)

---

## What this test does (in plain English):

**Test 1 — the deal itself.** Four users — Adam, Eve, Bob, and Alice — each create their own talk describing one side of a used-notebook deal (used/one unit/model/price range/deal location/time frame), **before joining any chatroom and before ever knowing about each other**:

1. **Adam** (buyer, role "request") creates a flow talk with six yes/no criteria questions about the notebook he wants.
2. **Eve** (seller, role "offer") creates a flow talk with the **exact same** six questions and answer wording as Adam's, each answered "yes" for herself.
3. **Bob** (buyer, role "request") creates a similar-looking flow talk, but every question is worded differently from Adam/Eve's (different model, price, location, time frame).
4. **Alice** (seller, role "offer") creates a similar-looking flow talk too, worded differently again — from Adam/Eve's **and** from Bob's.

Only then do all four join the "Global" chatroom, turn on the chatbot (auto-reply), and broadcast the talks they already created. From this point on, nobody manually answers anything.

- Because Adam's and Eve's questions are textually identical, each of them recorded "yes" as their own answer to every question when they created their own talk, and their roles are complementary (one "request", one "offer"), the chatbot on each side recognizes the other's incoming talk purely from that self-answer history and answers it automatically — Adam and Eve end up matched into one deal.
- Because Bob's and Alice's talks use wording nobody else (including each other) ever answered before, the chatbot never has enough history to auto-answer them. Neither of them matches anyone — not each other, and not Adam or Eve.

**Test 2 — the regression this feature exists to fix.** Two fresh users ("Buyer1", "Buyer2") each create a flow talk using the **exact same wording as Adam/Eve's talk** — but both declare role "request" (both buyers, not a buyer and a seller). Before `Talk.role` existed, this would have matched exactly like Adam and Eve did, because the chatbot's exact-question-text memory can't otherwise tell a buyer's answer history from a seller's. With roles in place, `checkIfMatch`'s same-role veto (`src/shared/talk-engine.ts`) refuses the match regardless of how exactly the text lines up — the test actively watches for a wrongful match for several seconds and asserts it never happens.

## Verifications:

- ✅ Adam and Eve end up with a conversation with each other (checked from both sides).
- ✅ Adam has no conversation with Bob or Alice; Eve has no conversation with Bob or Alice.
- ✅ Bob has no conversations at all; Alice has no conversations at all.
- ✅ All of the above happens without a single manual click on an answer/response — the chatbot resolves everything from creation-time self-answers.
- ✅ Two buyers with byte-identical criteria text never match each other, even though the old (pre-role) matching mechanism would have matched them.

> **Why this matters:** Exercises the chatbot's exact-question-text memory (`src/shared/exact-chatbot-memory.ts`) across four independently-authored talks with no prior contact between any of the users — a scenario existing chatbot specs don't cover, since they all reuse the same talk re-announced to a second user rather than two textually-mirrored but separately-authored talks. Test 2 specifically guards against text-only matching silently pairing up two people on the *same* side of a deal.

---

**Helpers used:** `bootstrapUser`, `createDealTalk` (local, now also selects `#talk-role`), `meetAndBroadcast` (local), `broadcastFromGlobalChatroom`, `submitTalkEditorAndWaitForOut`, `openSettingsSection`/`SETTINGS_SECTION.talkBehavior`, `clearGunForStage4Spec`, `launchFourBrowsers`/`shutdownFourBrowsers` (local, no shared 4-user helper existed)
