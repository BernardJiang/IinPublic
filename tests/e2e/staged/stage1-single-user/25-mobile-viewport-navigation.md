# Test: Mobile Viewport Navigation

**File:** `25-mobile-viewport-navigation.spec.ts`

**Features tested:** Phone-sized viewport, bottom navigation, primary panel visibility, horizontal overflow guard

## What this test does

1. Opens the app at a 390x844 mobile viewport.
2. Visits Chatrooms, Contacts, Talks, Answers, and Me from the bottom nav.
3. Verifies each primary panel is visible.
4. Verifies the document does not horizontally overflow the phone viewport.
