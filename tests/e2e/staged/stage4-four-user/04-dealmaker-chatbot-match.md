# Test: Dealmaker — Chatbot Auto-Matches Strangers on a Used-Notebook Deal

covers: SPEC-12.3

**File:** 04-dealmaker-chatbot-match.spec.ts
**Features tested:** Chatbot exact-question-text auto-reply, flow talks, self-answers recorded at talk-creation time, four simultaneous independently-authored talks in one room, partial-match isolation (some pairs match, others don't)

---

## What this test does (in plain English):

Four users — Adam, Eve, Bob, and Alice — each create their own talk describing one side of a used-notebook deal (used/one unit/model/price range/deal location/time frame), **before joining any chatroom and before ever knowing about each other**:

1. **Adam** (buyer) creates a flow talk with six yes/no criteria questions about the notebook he wants.
2. **Eve** (seller) creates a flow talk with the **exact same** six questions and answer wording as Adam's, each answered "yes" for herself.
3. **Bob** (buyer) creates a similar-looking flow talk, but every question is worded differently from Adam/Eve's (different model, price, location, time frame).
4. **Alice** (seller) creates a similar-looking flow talk too, worded differently again — from Adam/Eve's **and** from Bob's.

Only then do all four join the "Global" chatroom, turn on the chatbot (auto-reply), and broadcast the talks they already created. From this point on, nobody manually answers anything.

- Because Adam's and Eve's questions are textually identical, and each of them recorded "yes" as their own answer to every question when they created their own talk, the chatbot on each side recognizes the other's incoming talk purely from that self-answer history and answers it automatically — Adam and Eve end up matched into one deal.
- Because Bob's and Alice's talks use wording nobody else (including each other) ever answered before, the chatbot never has enough history to auto-answer them. Neither of them matches anyone — not each other, and not Adam or Eve.

## Verifications:

- ✅ Adam and Eve end up with a conversation with each other (checked from both sides).
- ✅ Adam has no conversation with Bob or Alice; Eve has no conversation with Bob or Alice.
- ✅ Bob has no conversations at all; Alice has no conversations at all.
- ✅ All of the above happens without a single manual click on an answer/response — the chatbot resolves everything from creation-time self-answers.

> **Why this matters:** Exercises the chatbot's exact-question-text memory (`src/shared/exact-chatbot-memory.ts`) across four independently-authored talks with no prior contact between any of the users — a scenario existing chatbot specs don't cover, since they all reuse the same talk re-announced to a second user rather than two textually-mirrored but separately-authored talks.

---

**Helpers used:** `bootstrapUser`, `createDealTalk` (local), `meetAndBroadcast` (local), `broadcastFromGlobalChatroom`, `submitTalkEditorAndWaitForOut`, `openSettingsSection`/`SETTINGS_SECTION.talkBehavior`, `clearGunForStage4Spec`, `launchFourBrowsers`/`shutdownFourBrowsers` (local, no shared 4-user helper existed)
