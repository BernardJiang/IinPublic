# Test: Talks Matching - Contextual Chatbot Choice Reuse

covers: SPEC-12.3  <!-- auto-seeded; refine by hand -->

**Features tested:** version-2 context hashing, complete choice-set guard, user fallback, known-context choice reuse

---

## What this test does (in plain English):

Three users: Tom (receiver), Jerry (sender A), Bob (sender B).

1. **Context A (Apple available):**
   - Jerry sends a talk containing the exact question "Favorite fruit?" with Apple as an option.
   - Tom answers Apple in auto mode.
   - This answer is stored under the version-2 context containing the question and full choice set.

2. **Context B (Apple missing):**
   - Jerry sends the same exact question, but options are Banana/Mango (no Apple).
   - Auto mode must not reuse incompatible Apple memory.
   - Talk is dispatched to Tom, and Tom answers Banana.

3. **Context A returns exactly:**
   - Bob creates a different two-question Talk whose first question has the same Apple/Banana set.
   - The Talk identity differs, but the normalized first-question frame is identical.
   - The chatbot repeats Apple for question 1 and opens directly on question 2 for Tom.

## Verifications:

- ✅ Contextual reuse depends on the exact normalized question and complete choice set.
- ✅ A changed choice set creates a different context and requires user input.
- ✅ An identical context across independently-authored talks repeats the known choice.
- ✅ A different surrounding Talk does not prevent reuse when the current rolling context matches.
