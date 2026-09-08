# Test: A Delegate Answers a Support Question Without Ever Holding the Master Key

covers: docs/TODO.md K7 (delegated TechSupport answers), design note
docs/design/techsupport-k7-design-note.md

**File:** 00m-techsupport-delegate-answers.spec.ts
**Features tested:** the master TechSupport identity can extend "may answer support questions" to
another account by issuing a small signed, expiring, revocable credential — never by sharing the
master private key — and that delegate's answer still verifies and displays as TechSupport to the
asker, while the master can independently audit who actually answered.

---

## What this test does (in plain English):

1. Dana is an ordinary registered user — no special onboarding, no key handling.
2. The master (a real `dev:techsupport`-style session holding the DM key) opens the new
   "Delegates" panel and issues Dana a grant by her user id. This is the only step in the whole
   test where the master key is used.
3. Dana's own device picks up the grant live and shows an opt-in prompt — holding a valid grant
   never silently turns on delegate mode. She checks the box to accept.
4. Amy, a completely different ordinary user, asks TechSupport a brand-new question. Her client's
   fan-out delivery addresses an encrypted envelope to both the master and Dana (every currently
   valid delegate), so Dana's own local inbox receives the question independently of the master.
5. Dana — not the master — answers the question from her own Support Inbox panel, signing with her
   own account key.
6. **Core assertions:** Amy receives the real answer, still attributed to TechSupport, and never
   sees anything identifying Dana. Separately, the master's own Delegates panel shows a "Delegate
   activity" entry for the question, naming Dana's pub — proof the master can audit a delegate's
   answers without needing to be involved in answering them.

This is the multi-user (delegate + asker) counterpart to the single-operator flow in
`stage1/07-support-inbox-answer-flow.spec.ts`; it needs two distinct ordinary users plus the master
context, so it lives at stage2 per the execution rule (lowest stage that can verify the choice).

**Not covered here** (left as documented, non-automated behavior per the design note): revoking a
delegate mid-session does not force out an already-open session; a revoked delegate's previously
published answers remain valid.

---

**Helpers used:** `clearGunForStage2Spec`, `bootstrapUser`, `expectCurrentUserIsTechSupportRoot`.
TechSupport master-mode boot mirrors the local helper already used in stage1 specs 05/07/09 and
stage2 spec 00l.
