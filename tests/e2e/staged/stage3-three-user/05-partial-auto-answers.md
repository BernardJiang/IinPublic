# Test: Partial Auto-Answers — Flattened Context Memory

**Features tested:** User preference memory (flattened context hashes), auto-fill of previously answered questions, new hash triggers manual answer

---

## What this test does (in plain English):

Two users: Tom and Jerry.

### Part 1: Tom creates the first talk, Jerry answers

1. **Tom creates a talk** with multiple questions (Q1, Q2, Q3)
2. **Jerry answers all three questions** manually
3. **The system saves Jerry's answers** as "flattened preferences" tied to the context hash of this talk

### Part 2: Tom creates a second talk, Jerry auto-fills Q1-Q2

4. **Tom creates a second talk** with the same Q1 and Q2 but a different Q3 (so the overall context hash is different)
5. **Jerry sees the second talk** — Q1 and Q2 are **auto-filled** from his previous answers, but Q3 requires a manual answer since it's new
6. **Jerry only has to answer Q3**

## Verifications:

- ✅ The system remembers Jerry's answers to questions that appear in multiple talks (flattened preferences)
- ✅ When a new talk shares questions with a previous talk, those questions are auto-filled
- ✅ New questions (that haven't been answered before) still require manual input
- ✅ The context hash differentiates between talks even when most questions overlap
