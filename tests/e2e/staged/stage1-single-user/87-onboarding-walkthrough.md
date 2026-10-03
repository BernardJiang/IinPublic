# Test: First-Run Introduction

covers: SPEC-12.4, SPEC-13.2

**File:** `87-onboarding-walkthrough.spec.ts`

## What this test does

1. Opts into automatic onboarding on a clean device profile.
2. Confirms slide 1 opens with **Build your digital you** and the repeat promise.
3. Confirms there is no Skip button or disabled Back button on the first slide.
4. Exercises Next and Back, then closes with the window's close control.
5. Opens the ordinary Talks list, verifies all seven demo-contact Talks, and removes one demo
   contact with its remaining Talks.
6. Reloads to verify the versioned seen gate and checks the durable Settings actions.
7. Repeats the introduction at a 320px phone viewport and checks for horizontal overflow and an
   accessible, in-viewport Next action.

## Verifications

- The automatic experience is the straightforward introduction slide deck.
- “Say it once. Let your digital you repeat it.” is the first slide's main promise.
- The close icon is the only early exit; Back and Next provide unambiguous navigation.
- Seven ordinary incoming Talks from four removable demo contacts remain available after the tour.
- The introduction stays dismissed after reload while Help & Tour remains available in Settings.
- The shared web/Android UI remains usable at 320px.
