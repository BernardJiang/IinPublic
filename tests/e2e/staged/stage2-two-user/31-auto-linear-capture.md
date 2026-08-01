# Test: Auto Linear Capture from DM Shorthand

covers: docs/TODO.md §V (FR-TK-7), full pipeline: parser → mandatory confirmation → chip
rendering (sender + receiver) → chip-tap quick-reply → terminator → saved Talk.

**File:** 31-auto-linear-capture.spec.ts

## What this test does (in plain English):

1. **Setup:** Tom and Jerry establish a direct-p2p DM conversation, same helper every other
   messaging spec uses (`prepareDirectP2PConversation`).
2. **Shorthand triggers a mandatory confirmation:** Tom types `Do you like coffee? Yes; No.`
   and hits send. Instead of the message going out immediately, a confirmation modal appears
   showing the parsed question and answers — the message is not sent until Tom explicitly
   confirms.
3. **Chips, not raw text, on both sides:** once confirmed, Tom's own copy of the message
   renders as a card with tappable "Yes"/"No" buttons — not the raw `CAPTURED_QUESTION:{...}`
   payload that actually went over the wire. Jerry, receiving the same message independently,
   sees the identical chip rendering, proving the marker-based detection works for a receiver
   who never saw Tom's confirmation step.
4. **Tapping a chip is a quick-reply:** Jerry taps "Yes" — this sends "Yes." back to Tom as an
   ordinary chat message (not a formal talk answer, since the real Talk doesn't exist yet at
   this point in the capture). The tapped button becomes disabled so it can't be re-tapped.
5. **A terminator ends the capture, no confirmation needed:** Tom sends
   `Great, let's meet tomorrow.` — a plain sentence with no `?`. No confirmation modal appears
   for this one (it's not shorthand), and it finalizes the capture session in the background.
6. **The captured line is now a real Talk:** Tom's own Talks/OUT list shows a new `flow`-type
   talk titled from the captured question, provable without needing to know its generated id
   in advance (searched by visible text).

## What this deliberately does NOT test (out of scope for this spec):

- The append-to-an-existing-talk-thread case (typing shorthand while already inside a specific
  talk's DM thread) — same underlying `finalizeCaptureSession` handler, different `scopeTalkId`
  branch; covered by unit tests (`flow-capture.test.ts`) rather than a second full E2E run.
- Declining the confirmation (sends as plain text, no talk side-effects) — straightforward to
  unit-test the underlying parse/decode logic; not repeated here as a second browser flow.
- Multi-line sessions with more than one captured question before the terminator — the merge/
  chaining logic (`TalkAutofix.fix` re-linking) is covered by unit tests
  (`FlowCapture.buildCapturedQuestions` / `assembleCapturedTalk` describe blocks).

**Helpers used:** `prepareDirectP2PConversation`, `afterLoad`/`afterSync`/`afterNav`/`afterAction`,
`attachE2eBrowserTabLabel`, `clearGunForStage2Spec`.
