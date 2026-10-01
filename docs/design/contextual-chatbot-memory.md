# Contextual Chatbot Memory

Status: authoritative design, implemented 2026-10-01

## Product rule

The chatbot repeats a choice only when the user previously made that choice under the same known
context. A choice made at `ROOT` is the user's unconditional default for that exact question
frame, so it may also be reused when the identical frame appears later in a flow. A more-specific
rolling-context choice overrides that root default. If neither record exists, the chatbot returns
the question to the user unless the user explicitly created a **Whenever offered** contract. It
does not guess, apply semantic similarity, derive subset/superset rules, or silently skip an
unknown situation.

The user-facing choices are:

- **Same context** — remember this choice and repeat it only on an exact context match.
- **Whenever offered** — make this answer the first preference for this exact question whenever
  the answer is among the current choices. Previously contracted answers remain ordered fallbacks.
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

## Whenever offered contract

This explicit contract is stored separately from rolling context memory. Its question identity
commits to normalized language, question text, selection mode, and Pair-tag scope, but deliberately
excludes the choice set, parent context, sequential position, talk type, talk id, and author:

```text
questionDefaultKey = SHA256("iinpublic-question-default-v1", {
  language, questionText, answerSelectionMode, pairTagScope
})

questionDefaultContracts[questionDefaultKey] = {
  version: 1,
  answers: [kiwiAnswerHash, appleAnswerHash] // highest priority first
}
```

Selecting **Whenever offered** moves that exact normalized answer to the front. It never generates
or stores hashes for possible subsets. At resolution time, the chatbot walks this usually tiny
explicit list and selects the first answer present in the current authored choices. If none is
present, it asks the user. This rule is supported only for ordinary single-choice questions;
multi-select remains an explicit user decision.

For example, `[Kiwi, Apple]` means: choose Kiwi when offered, otherwise Apple when offered,
otherwise ask. It is a literal ordered contract, not a ranking inferred from answer history.

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
2. Look up that exact rolling-context hash.
3. If an auto-reusable record exists and its saved choice exists in this identical choice set,
   return that choice as `KNOWN_CONTEXT_MATCH`.
4. Otherwise compute the `ROOT` hash for the same complete current frame. If a reusable root
   record exists, return it as `KNOWN_ROOT_CONTEXT_MATCH`.
5. Otherwise look up the explicit question-default contract. Return its first currently offered
   answer as `KNOWN_QUESTION_DEFAULT`.
6. Otherwise return no answer and show the question to the user.

A **Just once** response is kept in answer history but is not a reusable rolling-context rule and
therefore does not shadow an existing root default.

The root lookup is not a question-only or answer-text fallback: it recomputes the full frame and
therefore keeps the same complete choice-set guard. In particular:

- same question + changed choice set -> ask unless a contracted Whenever offered answer is present;
- same question + changed preceding answer -> use an exact record for that new rolling context,
  otherwise use the identical root-frame default if one exists, otherwise ask;
- a non-root saved answer appearing in a different context -> ask;
- contextless legacy memory -> ask;
- reordered but otherwise identical choices -> repeat the known choice.

Built-in typed comparisons and reciprocal Pair-tag traversal are structural matching features,
not learned answer-memory fallbacks. They remain separately identified by their reason codes.

## Worked Flow example

Bob first answers this root question:

1. `Which fruit do you like? [Apple, Banana, Pears]` -> `Apple`

That creates a root default for this exact frame.

- Reordering the choices to `[Banana, Pears, Apple]` repeats `Apple`.
- Changing membership to `[Banana, Kiwi, Apple]` changes the frame, so Bob is asked.
- Putting the original frame after `Do you like fruits? -> Yes` still repeats `Apple`, because a
  root answer follows its exact frame to any sequential position.
- If Bob later chooses a different answer under that exact flow path, the rolling-context record
  wins there; the root default remains unchanged elsewhere.

If Bob instead chooses **Whenever offered** for Apple, the exact choice set is irrelevant: both
`[Banana, Apple]` and `[Apple, Banana, Pears, Kiwi]` use Apple. If Bob later chooses Whenever
offered for Kiwi, the ordered contract becomes `[Kiwi, Apple]`; a set containing Kiwi uses Kiwi,
while a set containing Apple but not Kiwi falls back to Apple. An exact rolling/root-frame record
still has higher precedence.

For a choice learned only inside a flow, the rolling path remains exact. For example, Adam answers:

1. `Buying fruit? [Yes, No]` -> `Yes`
2. `Which season? [Summer, Winter]` -> `Summer`
3. `Favourite fruit? [Apple, Banana, Strawberries]` -> `Apple`

Question 3 is remembered under `C3 = H(C2, Summer, Frame(Q3))`.

- The identical path and choices repeat `Apple`.
- Reordering the three fruit choices repeats `Apple`.
- Adding `Orange` changes `Frame(Q3)`, so Adam is asked.
- Reaching Q3 after choosing `Winter` changes `C3`, so Adam is asked unless Adam separately has a
  root default for the identical Q3 frame.
- After Adam answers either new situation, that new context gets its own record.

## Privacy and migration

Exact matching uses the fixed-size SHA-256 context. Whenever offered additionally stores one
fixed-size question-identity hash and the explicitly selected answer hashes; it never enumerates
choice combinations. Existing display-oriented
`contextLabel` fields may retain a human-readable preceding Q/A breadcrumb for the Me tab, but
they are not authoritative matching inputs.

A context hash cannot be converted from one version to another — there is no reversible mapping
from an old digest back to the structured inputs that produced it, and even if there were, the
algorithm change may have redefined what "the same situation" means. So versioning here is never
an in-place record upgrade (contrast `src/shared/p2p-schema-migrations.ts`, which *does* upgrade
small stable-identity records in place — that works there because those records have a well-
defined default to backfill; a content hash does not).

Instead, `src/web/ui/answer-context-migration.ts` runs once per `ANSWER_CONTEXT_VERSION` bump, at
app boot, with no user interaction, and **regenerates** current-version memory from the durable,
version-independent source of truth every talk's own record already carries:
`myTalks[id].fullTalk` (the real question DAG) plus every recorded `(talkId, questionId) →
answer` in the legacy `answerPreferences` map (written for every self-answer and every answered
response, regardless of algorithm version). It replays that history through the *current*
`saveAnswerPreference`/`resolveAnswerPreferenceForTalkQuestion` — the walk mirrors
`tryBuildChatbotAnswersFromFlattened`'s own DAG traversal (root → fan-out, Pair-tag exclusion from
the rolling chain, `builtIn` nodes resolved live rather than requiring a recorded self-answer) —
so the result is what a live session would have produced under the new algorithm. The chatbot
therefore does not "forget everything and ask again" across a version bump; it re-teaches itself
instantly and silently.

`flattenedAnswerPreferences` is cleared and fully rebuilt as part of this (old-version keys are
unrecoverable dead weight, not data worth preserving in place — their key shape alone encodes a
retired algorithm). The legacy `answerPreferences` map is not cleared; it is the migration's
input, and gets refreshed in place (same key, current `contextHash`/`contextVersion`) as a side
effect of the replay, which is also what keeps the Me tab's own display in sync.

Question-default contracts use their own `iinpublic-question-default-v1` domain and version. They
are not synthesized from existing Same context history because broadening an old exact rule would
change what the user authorized. A future change to their identity fields or precedence must use a
new contract domain/version and must not reinterpret version-1 records silently.

**Policy for the next version bump:** any change to `Frame(Q)`'s field set, its normalization, or
how parent-context chaining works must bump both `ANSWER_CONTEXT_VERSION` and
`ANSWER_CONTEXT_DOMAIN` (`flattened-answer-keys.ts`) — this is what actually isolates the new
hash namespace from the old one; the `contextVersion` field alone does not catch a payload-shape
change if the constant isn't bumped. No new migration code should be needed:
`answer-context-migration.ts` re-runs its same replay automatically once the marker is stale.
Add a new characterization test for the retired version (mirroring
`answer-preference-resolution-characterization.test.ts`'s "does not infer... from contextless
legacy answer history") to document what the old shape can no longer do, and extend
`answer-context-migration.test.ts` with a fixture for whatever new structural case the change
introduces (the Dating-template `builtIn` root + Pair-tag branch case is the existing example of
"why a generic DAG replay beats trying to reuse the live self-answer list directly").
