# Test: UI Navigation and Settings Shell

**File:** 00-ui-navigation-settings.spec.ts  
**Features tested:** Bottom navigation tab contract, per-tab status bar/headers, Settings controls (languages, filters, UI toggle), Chinese localization of nav labels, talk autosave toggling, legacy profile tolerance, broadcast repeat suppression

---

## What this test does (in plain English):

A single-user sweep of the entire app shell, verifying each tab and all settings surfaces.

1. **Bottom navigation:** Exactly five tabs — Chatrooms, Contacts, Talks, Me, Settings (no Answers/Statistics tabs).
2. **Chatrooms tab:** Verifies action bar buttons (New Room, Return Home, Broadcast), no headcount in status bar when empty, duplicate-visit guard (re-joining Global doesn't increment visitCount), Asia room switching, return-home restores correct active-room highlight.
3. **Contacts tab:** Empty state shows "0 contacts from exchanged talks", action bar visible.
4. **Talks tab — creator replies panel:** Seeds 30 synthetic reply exchanges into localStorage. Verifies pagination (25 of 30 → load more → 30), language filter (zh → 15 rows), group-order toggle, filter persistence to localStorage, and clear-filters reset.
5. **Me tab:** Shows "Answered question history", filter buttons (All/Auto/Manual/Conditional), no settings controls in Me view.
6. **Settings tab:** Full surface area — stage name, headshot, languages, copy-talk autosave, chatbot toggle, grammar/dirty-word filters, distance bounds validation, photo type validation, storage inspector flags. UI language switch to Chinese → nav labels update (设置、话题), reload persists zh in localStorage, profile language stays separate from UI language.
7. **Autosave-to-myTalks on answer:** Completes a talk programmatically → verifies the talk appears in myTalks with `role: "copied"` + answerHistory entry; disabling autosave → `role: "answered"`, no talk row copied (answerHistory still present).
8. **Legacy profile tolerance:** Injects old-format string-valued `languages` and `talkFilters.allowedLanguages` → Settings renders without error, migrates to new array format correctly.
9. **Broadcast repeat suppression:** Records a broadcast conversation for a talk → same talk is suppressed on re-query unless `lastInteraction` timestamp changes.

## Verifications:

- ✅ Bottom nav has exactly 5 tabs in correct order
- ✅ Each tab shows correct status text, headers, and action bars
- ✅ Creator replies panel paginates correctly (25/30), filters by language, groups by talk, persists filter state
- ✅ Me tab merged into Talks — no separate Answers tab; answer history with mode filters visible
- ✅ Settings controls full surface area: distance bounds, stage name length, photo MIME validation
- ✅ UI language switch to Chinese propagates to nav labels, persistently stored in localStorage
- ✅ Copy-talk autosave toggle controls whether answered talks appear in Talks OUT list
- ✅ Legacy profile with string-valued fields tolerated and migrated gracefully
- ✅ Broadcast repeat-sender guard suppresses unchanged talk re-sends

> **Why this matters:** This is the master UI contract test. It verifies that every tab, button, status bar, filter, and settings surface behaves as specified — including the merge of Answers into Talks/Me and full Chinese UI localization.

---

**Helpers used:** `clearGunForStage1Spec`, `injectIdbClear`, `gotoWebApp`, `afterNav`, `afterSync`, `reloadAppReady`
