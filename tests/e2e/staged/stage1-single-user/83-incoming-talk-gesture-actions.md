# 83-incoming-talk-gesture-actions

covers: SPEC-3.6, SPEC-13.6

The same gestures on every Talks row (owner design 2026-11-21): swipe left or the row's ✕ passes;
swipe right, swipe down or a tap likes; long-press selects the row for the AppBar's ✕ ♡ 📌.

1. **Flow, Survey and Route.** For each type: 📋 keeps the Talk in My Talks (role `copied`, the
   row stays); a swipe right and a swipe down each open it to answer (the answer popup shows its
   title; closing it leaves the row); a swipe left and the row's ✕ each pass it (row gone, role
   `ignored`). The Ignored filter then lists the six passed rows, each restorable.
2. **A finger swipe on a phone.** In a touch, phone-sized browser, a real finger swipe left on a
   tag passes it and a swipe right likes it. (Before rows had `touch-action: pan-y`, the browser
   took the sideways move as a page pan and cancelled the gesture, so nothing happened.)
3. **Tags.** A tag row is the control itself, with one ✕ and no other button. Pass (left swipe)
   is content-scoped: the same tag from a different sender stays suppressed; tapping a passed row
   likes it again. A liked tag in Outgoing: a tap keeps it, its ✕ (undo) passes it, and the Me-tab
   answer entry disappears and comes back in step.
