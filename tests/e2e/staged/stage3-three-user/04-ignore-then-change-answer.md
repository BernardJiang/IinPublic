# Test: Ignore-Then-Change — Multi-Question Flow

covers: SPEC-3.6, SPEC-3.4  <!-- auto-seeded; refine by hand -->

**Features tested:** Multi-step question flows, initial mismatch then reopening to find a match, context hash behavior

---

## What this test does (in plain English):

Three users: Tom, Jerry, and Bob, all in the "Global" chatroom.

1. **Tom creates a multi-question talk** with several branching questions
2. **Tom broadcasts** to the room
3. **Jerry receives it**, goes through the questions, and ends up on the **mismatch** (ignore) branch
4. **Jerry then changes one of his earlier answers** — navigating back through the questions
5. **The new combination of answers** leads to a **match** instead
6. **Tom sees the match** notification
7. **Bob also answers** through the flow

## Verifications:

- ✅ A multi-step talk flow correctly follows branching logic based on answers
- ✅ Choosing the mismatch branch initially produces no match
- ✅ Changing earlier answers can convert a mismatch into a match
- ✅ The broadcaster receives a "Match!" notification when a responder's changed answers produce a match
- ✅ The talk matching system tracks answer history and context hashes correctly across multiple steps
