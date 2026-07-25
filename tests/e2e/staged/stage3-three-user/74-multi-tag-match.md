# 74 — Answering multiple tag talks each records the right outcome

covers: SPEC-7.5  <!-- tag response dialog: no cross-talk state, no modal stacking -->

Regression for a bug where matching several tag talks in a row recorded the 2nd/3rd as a
mismatch: the tag response dialog looked its checkbox/submit up by fixed id via
`document.getElementById`, so a second stacked response modal read the FIRST modal's
unchecked box and turned a Match into a mismatch.

1. Adam broadcasts three DISTINCT tag talks (Dogs / Cats / Birds).
2. Opening a second response dialog while one is open leaves exactly one modal (no stacking).
3. Bob checks Match and submits each of the three.
4. All three are recorded as `match` on Bob's side (and Adam sees three matched exchanges) —
   none flip to mismatch. The exchange record is written asynchronously after the modal closes
   (QA-preference sync + mesh submit continue in the background), so Bob's side is polled rather
   than read once — a fixed wait was racy under a loaded parallel run.
