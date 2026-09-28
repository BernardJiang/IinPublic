# Test: Actionable First-Run Guide

covers: SPEC-12.4, SPEC-13.2

**File:** `87-onboarding-walkthrough.spec.ts`

## What this test does

1. Opts into automatic onboarding on a clean device profile.
2. Chooses the Quick Community Poll starter and opens the optional product-reference tour.
3. Closes the reference tour and confirms the selected starter is still present.
4. Opens the real Talk editor and proves no Talk was saved before **Create**.
5. Reloads to verify the versioned seen gate, then checks the empty-Talk starter shelf and both
   durable Settings → Help & Tour actions.
6. Repeats the custom-prompt path at a 320px phone viewport and checks for horizontal overflow and
   an accessible, in-viewport primary action.

## Verifications

- The automatic experience is the three-step actionable guide, not the six-slide reference tour.
- Exactly six featured starters appear.
- The reference tour returns to the guide without losing state.
- Starter and custom choices become editable drafts but are not implicitly saved or broadcast.
- The guide stays dismissed after reload while both onboarding paths remain available in Settings.
- The shared web/Android UI remains usable at 320px.
