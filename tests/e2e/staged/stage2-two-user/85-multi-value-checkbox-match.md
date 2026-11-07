# 85-multi-value-checkbox-match

covers: SPEC-3.4, SPEC-12.3, SPEC-30.8

Multi-value ("pick any that apply") checkbox questions matched by set intersection. A buyer's
talk asks "Which models would you accept?" with Model A and Model B flagged as match options
and Model C as ignore. Seller 1 checks Model B — the checked set intersects the isMatch set,
so a match forms and both sides get a conversation. Seller 2 checks only Model C — disjoint
from the isMatch set, so no match and no conversation on either side.

A third test proves zero-click auto-resolution: buyer and seller independently author talks
with byte-identical checkbox question text and their own self-answers, enable the chatbot, and
broadcast; the chatbot's checked-set memory resolves the multi-select question with no manual
clicks and both sides end up matched.
