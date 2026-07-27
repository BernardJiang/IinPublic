# Test: TechSupport Operator Answers a Pending Question From the Support Inbox

covers: docs/TODO.md K5 (design note §Items 4+5)

**File:** 07-support-inbox-answer-flow.spec.ts
**Features tested:** the full operator loop — a pending question (delivered via the offline
mailbox, spec 06's miss path) appears in the support-inbox section of a `dev:techsupport`-mode
session; the operator answers it inline; the answer is delivered to the asker, the FAQ bundle is
published, and the inbox row disappears (flips to answered).

---

## What this test does (in plain English):

1. **Ordinary user boots first** and asks a brand-new question in the support conversation
   (same miss path as spec 06) — this delivers an encrypted `support-question-v1` envelope to
   TechSupport's offline mailbox.
2. **A second browser boots in TechSupport mode** (K3's canonical DM pair, mirroring spec 05).
   Booting drains the mailbox automatically, which ingests the question into TechSupport's OWN
   local Gun (`techsupport-inbox/<questionKey>`) — never a server route.
3. **Core assertion:** the pending question renders in the Settings/Me tab's support-inbox
   section (`.support-inbox-item`), proving the live `techsupport-inbox/*` subscription and the
   inbox UI are wired correctly end to end.
4. The operator fills the answer field and clicks "Answer & Publish" — one action that signs the
   updated FAQ bundle with the DM pair, publishes `techsupport-faq/<key>` and
   `techsupport-faq/bundle`, delivers the answer as a real DM to the asker's support thread, and
   flips the inbox entry to `answered`.
5. Assertions: the inbox row disappears (only pending entries render), the asker's support thread
   shows the delivered answer, and the published FAQ bundle contains the new entry.

> **Scope note:** this covers the operator-answers-once path. Re-ask-is-a-hit-with-no-duplicate
> and the `stage2` cross-user auto-answer are the remaining Item 6 tests tracked in
> docs/TODO.md.

---

**Helpers used:** `clearGunForStage1Spec`, `gotoWebApp`, `expectCurrentUserIsTechSupportRoot`,
`waitForTabActive` — TechSupport-mode boot mirrors spec 05's `bootstrapTechSupportMode`.
