# 95-builtin-ask-user-fallback

covers: §BB (`resolveBuiltInQuestion`'s `ASK_USER` fallback, `built-in-question-resolution.ts`)

Closes docs/TODO.md §BB's last open bullet: "Add E2E cases for location outside either radius and
missing preference falling to the human inbox." Prior builtin specs (86, 87, 94) only ever
exercise `resolveBuiltInQuestion`'s confident paths — a computed match and a computed
incompatible. This spec covers the two ways it instead falls back to `ASK_USER` (no auto-answer,
same as today's missing-history behavior for ordinary questions):

1. **No stored preference.** Alice broadcasts a `quantity` builtin talk (wants 3 widgets). Bob —
   unlike the seller side of `86-builtin-quantity-match.spec.ts` — never creates a matching talk
   of his own, so he has no typed preference stored for that scope at all. Asserts no
   auto-conversation forms even with chatbot enabled on both sides, then that Bob can still open
   the incoming talk and answer it manually (the safety net actually works, not just "nothing
   happens").
2. **`location` is unconditional `ASK_USER`.** `resolveBuiltInQuestion` returns `ASK_USER` for a
   `location` builtin question before it even looks at any preference — there's no auto-resolution
   to test "inside vs. outside radius" against yet (that's the still-open, deliberately-unimplemented
   "Design a privacy-safe source for the responder's blurred location/radius" bullet directly above
   this one in docs/TODO.md §BB). What's real today: a `location` builtin question always requires
   a manual human decision, regardless of chatbot settings. Same structure as case 1 — no
   auto-match, then a real manual answer completes it.

Both cases prove the fallback is a genuine safety net, not a silent drop: the talk reaches the
human inbox and a manual answer still produces a real match.
