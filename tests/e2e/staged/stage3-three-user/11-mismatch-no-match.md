# Test: Mismatch — No Match Notification, Zero Match Count

covers: SPEC-3.6, SPEC-3.4  <!-- auto-seeded; refine by hand -->

**Features tested:** When ALL responders pick the ignore branch, no match occurs, no toast appears, status shows 0 matches, Answers tab shows Mismatch

---

## What this test does (in plain English):

Two users: Tom and Jerry, both in the "Global" chatroom.

1. **Tom creates a talk** called "E2E Mismatch No Match Flow" (question: "Want to play tennis?" with Yes=match, No=ignore)
2. **Tom broadcasts** the talk

3. **Jerry receives the talk** and answers "No thanks." (the ignore/mismatch branch)

4. **Neither Jerry nor Tom** sees a "Match!" notification toast
5. **Tom's status bar** does NOT show any match count
6. **Jerry's Answers tab** lists the talk with a "Mismatch" label

## Verifications:

- ✅ When a responder picks the ignore branch, NO "Match!" toast appears for either party
- ✅ The broadcaster's status bar does not report any matches
- ✅ The responder's Answers tab correctly labels the talk as "Mismatch"
- ✅ No conversation is created between Tom and Jerry (since there was no match)

> **Why this matters:** Tests that the system correctly handles the case where a talk generates zero matches — no false matches, no phantom notifications.
