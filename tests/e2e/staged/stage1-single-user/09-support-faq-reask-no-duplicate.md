# Test: A Re-Asked Known Question Is a Hit, Not a Re-Answer

covers: docs/TODO.md K5 Item 6 (offline auto-answer + no duplicate FAQ row)

**File:** 09-support-faq-reask-no-duplicate.spec.ts
**Features tested:** two of K5's remaining Item 6 slices, combined into one flow since they share
the same setup: (a) a *known* question is still auto-answered even while TechSupport's device is
stopped, because the hit path never needs TechSupport online at all, and (b) asking the same
question twice does not create a second FAQ bundle row or regress the inbox entry back to pending.

---

## What this test does (in plain English):

1. One ordinary user asks a brand-new question (miss path, spec 06's flow).
2. TechSupport boots (K3 mode), drains the mailbox, answers the question, then **stops for good**
   — its browser context is closed and no TechSupport page exists for the rest of the test.
3. Snapshot check: exactly one FAQ bundle entry exists for the question's `questionKey`, and the
   `techsupport-inbox/<key>` entry is `status: answered`.
4. The **same user's still-open tab** asks the identical question a second time. Because TechSupport
   is gone, this only works if the answer comes from the asker's own locally cached, verified FAQ
   bundle (`handleSupportQuestion`'s `known` branch), not from a live round trip.
5. **Core assertions:**
   - The FAQ answer text renders a second time immediately (two answer bubbles total) — proving the
     re-ask took the hit branch.
   - The FAQ bundle still has exactly **one** entry for this `questionKey` (no duplicate row).
   - The inbox entry is still `status: answered` (not regressed to pending) — confirmed by code
     inspection too: `handleSupportQuestion`'s `known` branch never calls
     `postSupportQuestionToMailbox`, so a re-ask cannot touch `techsupport-inbox` at all.

> **Scope note:** does not cover the cross-user case (a *different* user benefiting from the same
> FAQ entry without ever having asked it) — that needs two real ordinary users and is covered by
> `stage2/00l-techsupport-faq-cross-user.spec.ts`.

---

**Helpers used:** `clearGunForStage1Spec`, `gotoWebApp`, `waitForTabActive`,
`expectCurrentUserIsTechSupportRoot`, `supportQuestionKey` (imported directly from
`src/shared/techsupport-faq`), `GET /api/test/export-snapshot` for direct Gun-graph assertions.
