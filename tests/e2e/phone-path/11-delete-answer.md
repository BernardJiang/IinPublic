# 11 — Delete my answer across phones
covers: OPEN-106 step 4

**File:** `tests/e2e/phone-path/11-delete-answer.spec.ts`

Alice on phone A writes a Talk and broadcasts it; Bob on phone B answers it as a match and both
get the conversation. Bob then deletes that answer the way a person would: Me tab, long-press the
row, Delete answer, confirm. The walk is shared: `journeys/delete-answer-journey.ts`.

Checked on Bob's side: the Me row is gone and the Talk no longer holds his answer. Checked on
Alice's side: her device forgets how it decided Bob's answer (`ix/outcome`), and her conversation
with Bob is withdrawn with "They deleted their answer".
