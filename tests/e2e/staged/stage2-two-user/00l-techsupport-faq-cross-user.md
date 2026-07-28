# Test: A Different User Gets an Already-Answered Question Auto-Answered

covers: docs/TODO.md K5 Item 6 (stage2 cross-user auto-answer)

**File:** 00l-techsupport-faq-cross-user.spec.ts
**Features tested:** the FAQ bundle is genuinely global — once TechSupport answers a question for
one asker, a completely different asker who has never interacted with TechSupport about that topic
gets the same answer instantly, with **zero** developer/TechSupport involvement in their own turn.

---

## What this test does (in plain English):

1. Tom (ordinary user 1) asks TechSupport a brand-new question. TechSupport boots (K3 mode), drains
   the mailbox, and answers it — the only point in the whole test where a TechSupport session
   exists.
2. TechSupport's browser context is closed for good before Jerry ever appears.
3. Jerry (ordinary user 2, a fresh bootstrap with no prior history) opens his own support
   conversation and asks the **exact same question text** Tom asked.
4. **Core assertion:** Jerry's conversation immediately shows the real answer TechSupport gave Tom
   — not the "a human will get back to you here" new-question ack — proving the answer came from
   the public FAQ bundle cache, not from any live TechSupport round trip for Jerry.

This is the multi-user counterpart to `stage1/09-support-faq-reask-no-duplicate.spec.ts`, which
covers the same-user re-ask case at stage1; this one specifically needs two distinct real users, so
it lives at stage2 per the execution rule (lowest stage that can verify the choice).

---

**Helpers used:** `clearGunForStage2Spec`, `bootstrapUser`, `waitForTabActive`,
`expectCurrentUserIsTechSupportRoot`. TechSupport mode boot mirrors the local helper already used
in stage1 specs 05/07/09.
