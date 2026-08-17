# Route multi-spec matching — order-independent partial match, ranked results (§30.2)

Adam is selling nothing — he's *buying* an iPhone, and wants to describe it with three
independent specs (color, condition, item) without caring what order a seller happens to
declare them in, and without requiring a seller to match every single spec to be worth talking
to. He authors one `route`-type talk with a root question that has three sibling branches —
color / condition / item — each ending in its own ordinary match/ignore leaf question, plus a
`matchThreshold: 2` (2 of 3 specs matching is enough to count as a candidate).

Eve answers all three specs as matching (white, used, iPhone) — a 100% match. Bob answers two of
three as matching (white, used) but says his item is not an iPhone — a 67% partial match, still
at or above the threshold, so still counted as a match, just a weaker one.

The test walks the actual response-dialog UI for both responders (radio pick + "Continue" per
spec, not a direct API/engine shortcut), confirming the new multi-branch walk mode really works
end to end: the dialog shows each of the three specs in turn (skipping the root's own
"pick one" step), and only resolves match/mismatch once all three are answered.

Both responses reach Adam and form conversations. Adam opens the existing "Matched items" list
(the creator-replies panel, reached from the talk row's long-press details popup →
"View Responses" — the same panel that already lists "who answered my talk?"), switches its sort
to "Match % (highest first)," and sees Eve's 100% ranked above Bob's 67% — each row showing its
stored percentage. Clicking Eve's row opens the conversation with her directly (not the profile
view), letting Adam review ranked candidates and then go straight to DMing the one he wants to
deal with.

**What this proves:**
- Order-independence: the 3 specs are siblings off one root, not a linear chain — a seller could
  declare them in any order and the match logic doesn't care.
- Partial-match-as-normal-case: a match doesn't require 100% agreement, just >= `matchThreshold`.
- Ranking: multiple matched candidates for one talk sort by descending match percentage.
- Existing UI reuse: "Matched items" is the existing creator-replies/"who answered?" panel, not
  a new view — extended with a percentage chip, a `match-percent` sort option, and a
  click-through straight to the matched responder's conversation.
- Zero regression to ordinary route talks: this is a *new* mode gated on `matchThreshold` being
  set; talks without it keep today's single-path terminal-answer behavior (covered separately by
  `route-hr-hiring-match-detection.spec.ts` and `82-route-editor-multi-item-builtin.spec.ts`).
