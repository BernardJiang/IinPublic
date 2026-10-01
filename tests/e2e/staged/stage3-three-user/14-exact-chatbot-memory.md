# Test: Talks Matching - Contextual Chatbot Choice Reuse

covers: SPEC-12.3  <!-- auto-seeded; refine by hand -->

**Features tested:** version-2 context hashing, complete choice-set guard, user fallback, known-context choice reuse

---

## What this test does (in plain English):

Five users: Bob (receiver), and Adam, Alice, Tom, and Jerry (senders).

1. **Adam teaches Bob a root default:**
   - Adam asks "Which fruit do you like?" with Apple, Banana, and Pears.
   - Bob chooses Apple in **Same context** mode.
   - This stores Apple for the complete root question frame.

2. **Alice reorders the same choices:**
   - Alice asks the same question with Banana, Pears, and Apple.
   - Choice order does not change the frame, so Bob's chatbot pre-fills Apple.

3. **Tom changes choice membership:**
   - Tom asks the same question with Banana, Kiwi, and Apple.
   - Apple still appears, but Pears was replaced by Kiwi, so the frame is different.
   - Bob must answer Apple himself.

4. **Jerry places the original frame second:**
   - Jerry first asks "Do you like fruits?" with Yes/No.
   - Bob manually answers Yes.
   - Jerry's second question is the original fruit frame in reordered form.
   - Bob's root Apple default follows the identical frame to question 2 and fills it automatically.

## Verifications:

- ✅ A root answer is an unconditional default for the exact normalized question frame.
- ✅ Choice order does not affect frame identity.
- ✅ Changed choice membership creates a different frame and requires user input.
- ✅ A root default applies to the same frame at any later sequential position.
- ✅ The completed two-question response records both Bob's manual Yes and chatbot-filled Apple.
