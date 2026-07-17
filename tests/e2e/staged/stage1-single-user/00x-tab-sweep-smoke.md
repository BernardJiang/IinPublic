# Test: Tab Sweep Smoke (D6)

covers: SPEC-13.1, SPEC-12.4  <!-- auto-seeded; refine by hand -->

**File:** 00x-tab-sweep-smoke.spec.ts  
**Features tested:** Quick smoke check that key UI surfaces exist on every main tab — reply triage controls, OUT sort order, contacts filters, Me answer filters, Settings filter diagnostics

---

## What this test does (in plain English):

Fast single-user smoke test — visit each of the five main tabs and confirm expected controls are present.

1. **Setup:** Launch one browser at 640×1000 viewport. Clear databases. Navigate to web app.
2. **Settings tab:** Fill in stage name "Tab Sweep User".
3. **Chatrooms tab:** Verify navigation landed correctly.
4. **Talks tab:** Confirm `#creator-replies-panel` visible, sort options (Matches, Weighted performance), group-by dropdown present.
5. **Contacts tab:** Confirm `#contacts-filter-relation` visible, sort order includes "Weighted" option.
6. **Me tab:** Confirm preferences button and conditional answer filter visible.
7. **Settings tab (again):** Confirm filtered-incoming summary and grammar filter exist.

## Verifications:

- ✅ Reply triage panel and sort/group controls exist on Talks tab
- ✅ Contacts filter and sort order widgets present
- ✅ Me tab shows answer-history filters including "Conditional"
- ✅ Settings filter diagnostics (`#settings-filtered-incoming-summary`) visible

> **Why this matters:** Lightweight regression — catches UI regressions at the element-level without exercising full flow logic. Complements 00-ui-navigation-settings which does a deep dive into each surface.

---

**Helpers used:** `maybeClearGunDatabases`, `injectIdbClear`, `gotoWebApp`, `ensureWindowFitsViewport`, `afterLoad`, `afterNav`, `attachE2eBrowserTabLabel`, `attachFilteredConsoleLog`
