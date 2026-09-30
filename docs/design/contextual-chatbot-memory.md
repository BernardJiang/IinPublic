# Contextual Chatbot Memory

Status: authoritative design, implemented 2026-09-30

## Product rule

The chatbot repeats a choice only when the user previously made that choice under the same known
context. If no exact context record exists, the chatbot returns the question to the user. It does
not guess, search older answers, apply semantic similarity, reuse an answer merely because it is
still offered, or silently skip an unknown situation.

The user-facing choices are:

- **Same context** — remember this choice and repeat it only on an exact context match.
- **Just once** — use the choice for this response but do not let the chatbot repeat it.

Old “Temporary,” “Permanent,” and global “Suppressed” matching are not part of the contextual
resolver. Legacy records without a complete version-2 context never auto-answer; the user answers
once to create a safe contextual record.

## One context algorithm for every question

A question frame commits to everything visible at the current decision point:

```text
Frame(Q) = normalize({
  talkType,
  language,
  questionText,
  choiceTexts: sort(unique(choiceTexts)),
  answerSelectionMode,
  pairTagScope
})
```

Choice display order is deliberately ignored. Adding, removing, or changing a choice changes the
frame. Text normalization trims, collapses whitespace, and case-folds consistently. Positional
question/answer IDs are not used because independently-authored talks may assign different IDs to
identical content.

The rolling context uses SHA-256 with the domain/version string
`iinpublic-answer-context-v2`:

```text
C1 = SHA256(version, ROOT, Frame(Q1))
C2 = SHA256(version, C1, normalize(A1), Frame(Q2))
C3 = SHA256(version, C2, normalize(A2), Frame(Q3))
```

The previous hash already commits to its question, choice set, and every earlier step. Computing
the next context therefore consumes only one previous context hash, the answer selected there,
and the current question frame. It never rebuilds the complete preceding chain.

The answer-memory record is keyed by the resulting 64-character context hash:

```text
flat_v2_<contextHash> -> {
  contextVersion: 2,
  contextHash,
  answerText,
  mode: "temporary" | "manual"
}
```

`temporary` is retained only as an internal storage compatibility value. Its user-facing name is
“Same context and choices.”

## Talk-type application

- **Tag/root:** parent is `ROOT`; the context still contains the question/tag and complete choice
  set.
- **Survey:** every question is independent and therefore starts from `ROOT`.
- **Flow:** the next question uses the immediately preceding question context and selected answer.
- **Route:** each active branch uses its immediate parent question context and the answer that led
  into that branch. Previously answered fan-out siblings are not parents and do not affect the
  hash. The special `matchThreshold` specification set remains root-independent by construction.

Reciprocal Pair tags use normalized `mySelfTag`/`counterpartTag` structural scope because opposite
peers intentionally see inverse surface wording. This scope is committed into the same context
hash; it is not a question-only fallback.

## Resolver

For an ordinary authored question:

1. Compute the current version-2 context hash.
2. Look up that exact hash.
3. If an auto-reusable record exists and its saved choice exists in this identical choice set,
   return that choice as `KNOWN_CONTEXT_MATCH`.
4. Otherwise return no answer and show the question to the user.

There is no weaker fallback. In particular:

- same question + changed choice set -> ask;
- same question + changed preceding answer -> ask;
- same saved answer appearing in a different context -> ask;
- contextless legacy memory -> ask;
- reordered but otherwise identical choices -> repeat the known choice.

Built-in typed comparisons and reciprocal Pair-tag traversal are structural matching features,
not learned answer-memory fallbacks. They remain separately identified by their reason codes.

## Worked Flow example

Adam answers:

1. `Buying fruit? [Yes, No]` -> `Yes`
2. `Which season? [Summer, Winter]` -> `Summer`
3. `Favourite fruit? [Apple, Banana, Strawberries]` -> `Apple`

Question 3 is remembered under `C3 = H(C2, Summer, Frame(Q3))`.

- The identical path and choices repeat `Apple`.
- Reordering the three fruit choices repeats `Apple`.
- Adding `Orange` changes `Frame(Q3)`, so Adam is asked.
- Reaching Q3 after choosing `Winter` changes `C3`, so Adam is asked.
- After Adam answers either new situation, that new context gets its own record.

## Privacy and migration

Only the fixed-size SHA-256 context is required for matching. Existing display-oriented
`contextLabel` fields may retain a human-readable preceding Q/A breadcrumb for the Me tab, but
they are not authoritative matching inputs.

Legacy temporary/permanent/suppressed records do not contain the complete choice-set context and
must not be guessed into version 2. They remain visible as history where applicable, but the
resolver asks the user and writes a new version-2 contextual record after the next choice.
