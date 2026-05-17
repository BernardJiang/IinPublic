# Test: Talks Matching - Exact Chatbot Q/A Memory Reuse

**Features tested:** Exact question/answer memory, option-compatibility checks, auto-reply fallback, memory-driven match auto-response

---

## What this test does (in plain English):

Three users: Tom (receiver), Jerry (sender A), Bob (sender B).

1. **Context A (Apple available):**
   - Jerry sends a talk containing the exact question "Favorite fruit?" with Apple as an option.
   - Tom answers Apple in auto mode.
   - This answer is stored in exact chatbot memory.

2. **Context B (Apple missing):**
   - Jerry sends the same exact question, but options are Banana/Mango (no Apple).
   - Auto mode must not reuse incompatible Apple memory.
   - Talk is dispatched to Tom, and Tom answers Banana.

3. **Context C (Apple returns):**
   - Bob sends the same exact question again with Apple available.
   - Chatbot should auto-reuse compatible historical Apple memory (not the incompatible latest Banana context).
   - Server returns `autoResponded: true` and match metadata indicating exact-memory reason.

## Verifications:

- ✅ Exact-memory reuse depends on exact question identity and option compatibility.
- ✅ When no compatible saved answer exists, chatbot does not force an auto answer and user input is required.
- ✅ When compatible options return, older exact memory can be reused automatically.
- ✅ Auto-response path records a bot-driven match with expected server response fields.
