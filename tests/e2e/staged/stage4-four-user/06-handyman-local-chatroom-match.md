# Test: Handyman ↔ Customer Matching in a Local Chatroom with Detailed Criteria

covers: docs/TODO.md §HH

**File:** 06-handyman-local-chatroom-match.spec.ts
**Features tested:** Two-sided deal roles (`Talk.role`), a real MULTI-CRITERION `builtIn`
comparison chain (`priceRange` -> `timeFrame` -> multi-select service category, all in one
flow talk), the typed-preference-store scoping fix (a talk with more than one `builtIn`
question), the non-terminal-`builtIn`-answer lookup fix, joining and broadcasting within a LOCAL
(city-level) chatroom, and zero-click chatbot auto-resolution across a chained builtIn+multi-select
flow.

---

## What this test does (in plain English):

Four users — Adam, Eve, Bob, and Alice — each create their own 3-question flow talk **before
joining any chatroom**, each shaped as: price-range question (`builtIn priceRange`) -> time-frame
question (`builtIn timeFrame`) -> service-category question (multi-select "pick any that apply",
always the LAST question in the chain — a `'multiple'`-mode question is always chain-terminal,
see the implementation note below).

1. **Adam** (handyman, role "offer") declares $50-100/hr, available Sept 1-30, offers
   Plumbing + Electrical.
2. **Alice** (customer, role "request") shares Adam's EXACT talk title and question wording, but
   declares her own (genuinely different, genuinely overlapping) values: wants $80-120/hr
   (overlaps Adam's $50-100), needs Sept 15 - Oct 15 (overlaps Adam's Sept 1-30), needs Plumbing
   (intersects Adam's Plumbing+Electrical).
3. **Eve** and **Bob** each get their own distinctly-reworded title + questions — different from
   Adam/Alice's AND from each other's — so neither the typed-preference scope key (title- and
   question-text-based) nor the multi-select exact-text memory ever resolves them against anyone.

All four then join the **San Diego** chatroom (the "local chatroom" from the scenario) and
broadcast. From this point on, nobody manually answers anything — real interval-overlap math
(`intervalsOverlap`) and set-intersection matching (`anySelectedIsMatch`) decide the outcome, not
exact-text luck.

## Two real bugs found and fixed while building this test:

1. **Typed-preference scope-key collision.** `typed-preference-store.ts`'s scope key was
   `(role, title)` only — a talk with TWO `builtIn` questions (priceRange AND timeFrame, both
   under the same title/role) saved both under the identical key, the second silently
   overwriting the first. `86-builtin-quantity-match.spec.ts` never caught this because it only
   ever used a single `builtIn` question per talk. Fixed by adding the question's own text as a
   third scope-key component (`makeTypedPreferenceScopeKey(role, title, questionText)`), both in
   the save side (`processTalkForm`) and the read side (`resolveBuiltInQuestion`).
2. **Non-terminal `builtIn` answer lookup.** `resolveAnswerPreferenceForTalkQuestion`'s builtIn
   dispatch picked the "compatible" answer by its `isMatch` flag — which only survives when the
   `builtIn` question is the LAST one in its chain. For any `builtIn` question that links to a
   NEXT question (price range and time frame here both do, since a service-category question
   follows), `TalkAutofix.fix`'s flow-normalization step strips `isMatch` and replaces it with
   `nextQuestionId` — the exact same redirect every ordinary flow question's first answer goes
   through. The lookup silently found nothing, aborting the whole chain at the first `builtIn`
   question. Fixed by extracting `pickBuiltInAnswer` (`built-in-question-resolution.ts`), which
   looks the answer up by its fixed, deterministic id (`${questionId}_compatible` /
   `${questionId}_incompatible`, set once at generation time and never changed) instead of by a
   flag that TalkAutofix may or may not have preserved.

Diagnosed by adding temporary instrumentation to the actual resolution call chain (not guessed):
confirmed the typed-preference save was correct, confirmed the incoming talk was delivered with
correct content, then traced exactly where `tryBuildChatbotAnswersFromFlattened`'s per-question
loop silently stopped.

## Implementation note (not a bug, a real constraint to get right):

A `'multiple'`-mode (checkbox) question is always chain-terminal — `TalkAutofix.fix` and
`TalkValidator` both enforce this. The service-category question MUST be last in the array;
putting it first (or anywhere before the builtIn questions) would fail validation outright.

## Verifications:

- ✅ Adam and Alice end up with a conversation with each other (checked from both sides), formed
  entirely within the San Diego chatroom, not Global.
- ✅ Adam has no conversation with Eve or Bob; Alice has no conversation with Eve or Bob.
- ✅ Eve has no conversations at all; Bob has no conversations at all.
- ✅ All of the above happens without a single manual click on an answer/response.
- ✅ Each talk creation (including the 2-builtIn-question combination) never triggers a
  validation error.

---

**Helpers used:** `bootstrapUser`, `createHandymanTalk` (local — builds a 3-question flow talk
mixing `builtIn` kind selectors and a multi-select answer list), `ensureInLocalRoom`/
`meetAndBroadcastLocally` (local, same as `05-taxi-local-chatroom-match.spec.ts`),
`disableTalkSendRateLimit` (local — `setTalkLedgerQuotaUnlimitedForE2e`, the same E2E-only hook
`00-three-user-talk-matrix.spec.ts` uses), `openSettingsSection`/`SETTINGS_SECTION.talkBehavior`,
`clearGunForStage4Spec`.
