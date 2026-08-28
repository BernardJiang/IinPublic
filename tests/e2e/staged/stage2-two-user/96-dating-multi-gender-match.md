# 96-dating-multi-gender-match

covers: §DD (reshaped Dating template — `buildDatingTemplate`, talk-templates.ts; the fan-out
veto extension in `evaluateRouteFanOutMatch`, talk-engine.ts)

Real cross-browser proof of docs/TODO.md §DD's multi-value gender preference matching, built
this session as several independent Pair-tag branches fanning out (parallel, threshold 1 — any
ONE accepted gender is enough) off a shared `ageRange` root, rather than one Pair-tag question
with several answers (which would break the exact-text hash a Pair-tag match relies on).

Building this surfaced three real, general bugs beyond the template itself, each fixed in this
session and each independently unit-tested:

1. `tryBuildChatbotAnswersFromFlattened` (answer-preference-resolution.ts) used to walk
   `questions[]` in flat array-storage order instead of following the real
   `nextQuestionId`/`nextQuestionIds` DAG — it only ever worked by coincidence, since every
   existing talk-generation path happened to emit array order matching a valid visit order.
2. The mesh delivery intake filter's grammar/spam check (`talk-intake-filters.ts`) built its
   "subject text" from every question's own text without deduplication — several parallel
   branches legitimately reusing a short label (e.g. three Pair-tag branches all declaring the
   same author word) read as spam and got the whole talk rejected at delivery, before matching
   ever ran.
3. `collectRouteEditorQuestions` (route-editor-model.ts) never preserved a builtIn root's
   fan-out `parallelMatchThreshold` on save — even though a prefilled value loaded correctly
   into the live editor model, it silently reverted to "require ALL children" (no existing spec
   had ever exercised a builtIn-root fan-out with a non-default threshold before).

This spec proves the full, integrated result — a real chatbot auto-reply (zero manual clicks)
correctly matches only the accepted gender branch and correctly refuses the others (the "men"
and "non-binary people" branches genuinely fail to auto-answer for a "women"-declared responder,
via the chatbot's existing PREFERENCE_CONFLICT gate — not a permissive fallback), and correctly
produces no match at all when the responder's gender isn't in the author's accepted set.
`83-talk-template-picker.spec.ts` covers the template's structural prefill;
`talk-engine.test.ts` unit-tests the fan-out veto directly.
