# Test: TechSupport Single-User Tab Traversal

**File:** baa-techsupport-single-user-tabs.spec.ts  
**Features tested:** Full UI tab traversal for a single logged-in user — verifies every navigation panel (Chatrooms, Contacts, Talks, Me, Settings) renders correctly with expected elements.

---

## What this test does (in plain English):

Boots TechSupport from the stage 0 storage state, then systematically clicks through every top-level nav tab to verify key UI elements are present and populated. Acts as a smoke test for all pages of single-user functionality.

1. **Setup:** Restores `TechSupport Stage0` browser context, confirms header shows "TechSupport", room = "Global", headcount = 1.
2. **Chatrooms tab:** Clicks nav → verifies chatroom list shows "Global" with visible headcount badge.
3. **Contacts tab:** Clicks nav → verifies contacts list + filter name input + relation filter dropdown (with "Partners" option) + sort order dropdown (with "Relevance score").
4. **Talks tab:** Clicks nav → verifies talks list, ALL/IN/OUT nav filters, OUT sort options (Most matches, Latest reply, Weighted performance), creator-replies panel, reply filter query/type/language/grouping/sorting controls.
5. **Me tab:** Clicks nav → verifies answers content area visible + 4 talk-type filters + 3 tag-state checkboxes.
6. **Settings tab:** Clicks nav → verifies stage name input = "TechSupport", edit profile button, credit visibility toggle, profile languages, filter languages (en checked), storage inspector.

> **Why this matters:** Catches broken UI rendering after code changes. If any tab fails to render expected elements, the whole app is suspect. This runs before any multi-user tests as a first-line smoke gate.

---

**Helpers used:** `isStagePipeline`, `bootstrapTechSupport`, `assertStatusChecks`, `afterNav`, `afterSync`, `headless`
