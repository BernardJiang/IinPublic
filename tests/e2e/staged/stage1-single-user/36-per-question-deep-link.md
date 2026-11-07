# 36-per-question-deep-link

covers: SPEC-13.7, SPEC-26.2

Verifies the per-question deep link from the Me tab into a multi-question flow's response view.
A completed two-question flow produces one Me-tab row per question, and each row carries the
`data-question-id` that produced it (the flattened-history model). It then verifies that
`showTalkResponseDialog`'s `targetQuestionId` option renders both review blocks but
scrolls/highlights only the `.review-question-block` for the requested question, leaving the
other block unhighlighted — i.e. the deep link lands on the exact question, not the talk's
first screen.
