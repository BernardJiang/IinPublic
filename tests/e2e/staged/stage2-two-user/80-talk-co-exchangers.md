# 80-talk-co-exchangers

covers: SPEC-3.11, SPEC-26.2

Verifies Talk → "people I've separately exchanged this same content with" (co-exchangers). Two
explicit-id talks with identical question/answer content (same ledger identityKey, different
talk.id and authors) are exchanged in separate pairs: Tom authors Talk X answered by Jerry, and
Sam authors Talk Y answered by Tom. On Tom's Talk X row the matched-names line shows only Jerry
(Talk X's own direct exchange partner), while the row's details popup surfaces Sam as a
co-exchanger, joined purely by shared identityKey in Tom's own device graph (`ix/co/<peer>`).
This also demonstrates the privacy boundary: co-exchangers is a local-graph read only, never a
mesh-wide "who else has this content" query.
