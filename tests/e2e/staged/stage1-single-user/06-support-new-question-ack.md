# Test: A Brand-New Support Question Renders a Signed Acknowledgement

covers: docs/TODO.md K5 (design note §Item 2, miss path)

**File:** 06-support-new-question-ack.spec.ts
**Features tested:** the hit/miss branch that replaced the old blanket "Thanks for the message"
canned reply. Asking TechSupport a question it has never seen renders a compiled, pre-signed
acknowledgement ("a human will get back to you here") instead.

---

## What this test does (in plain English):

1. One ordinary user boots (stage1 convention). The K2 signed greeting renders first, as
   established by spec 03.
2. The user opens the support conversation and sends a never-before-asked question.
3. **Core assertion:** the reply is the new signed ack template (personalized with the user's
   stage name), not the old blanket `supportReply` string — confirming the hit/miss branch is
   wired in and taking the miss path for an unrecognized question.
4. The stored message record (`support_ack_<messageId>`) carries `ackLocale`/`ackSignature`/
   `ackAuthorPub`, and independently re-verifying those fields against the compiled ack template
   succeeds — the same authenticity discipline K2's greeting uses.

> **Scope note:** this only covers the miss-path *acknowledgement*. It does not yet cover mailbox
> delivery to the TechSupport device or the operator answering it — those need a `dev:techsupport`
> context and are tracked as further K5 Item 6 tests in docs/TODO.md.

---

**Helpers used:** `clearGunForStage1Spec`, `gotoWebApp`, `waitForTabActive`, `verifySupportAck`
(imported directly from `src/shared/techsupport-greeting`).
