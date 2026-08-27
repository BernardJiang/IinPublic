import type { UiTranslationKey } from './ui-translations';

/**
 * Built-in "start from a template" library (talk editor usability follow-up — the editor's
 * empty-form starting point was hard to use from scratch). Each template returns a plain
 * `Talk`-shaped object with no `id` — the exact shape `showTalkEditorDialog(existingTalk?)`
 * already accepts as a prefill (proven by the existing "copy a talk"/survey-follow-up call
 * sites in ui-manager.ts), so a template opens the ordinary editor pre-filled and fully
 * editable, and is created fresh on save rather than edited-in-place.
 *
 * All eight are `type: 'route'` — a real branching DAG (contextPath-tracked, one node per
 * root-to-leaf position — `docs/`, `src/shared/talk-engine.ts`), not the simpler linear `flow`
 * shape. A Pair-tag root (`Question.reciprocalTagContext`) still opens every template exactly
 * like the old flow versions did (offerer tag vs. counterpart tag, e.g. buy/sell), but the body
 * now genuinely branches — e.g. Buy/Sell's "sell" answer fans out (parallel, not chained) across
 * every item for sale, each item its own Simple tag whose one answer itself fans out into
 * independent Model/Condition/Price-range specs that must all check out — matching how a real
 * screening conversation would fork, and how a second/third item gets added to the same talk.
 *
 * `buildRouteTalk`/`flattenRouteTree` below turn a small recursive tree description
 * (`RouteQuestionSpec`) into the flat `questions[]` + `contextPath`/`nextQuestionId` shape the
 * route engine and editor expect (`route-editor-model.ts`'s `initializeRouteEditorQuestions`
 * reads exactly this shape back in). Answer ids/contextHashId/etc. are intentionally NOT
 * hand-computed here — `processTalkForm`'s route branch (`collectRouteEditorQuestions`,
 * ui-manager.ts) regenerates all of that fresh from the editor's live state at save time, the
 * same as if the author had built the DAG by hand in the route editor.
 */
export type TalkTemplateId = 'buySell' | 'taxi' | 'job' | 'dating' | 'roommate' | 'lostFound' | 'petSitting' | 'tutor';

export type TalkTemplateDefinition = {
  id: TalkTemplateId;
  icon: string;
  labelKey: UiTranslationKey;
  descKey: UiTranslationKey;
  build: () => any;
};

/** One node of a hand-authored route DAG, before ids/contextPath are assigned. */
type RouteAnswerSpec = {
  text: string;
  isIgnore?: boolean;
  isMatch?: boolean;
  /** Present iff this answer continues the DAG with a single follow-up question. */
  next?: RouteQuestionSpec;
  /** Present iff this answer fans out into 2+ independently-answered sibling specs
   * (`Answer.nextQuestionIds`) — e.g. an item's Model/Condition/Price-range, all required
   * unless `parallelThreshold` says otherwise (mirrors the route editor's own "+Parallel Q"). */
  parallel?: RouteQuestionSpec[];
  /** Only meaningful alongside `parallel`. Omit for the default (all of `parallel` required). */
  parallelThreshold?: number;
};

type RouteQuestionSpec = {
  text: string;
  /** Pair-tag root marker — mirrors `Question.reciprocalTagContext`. */
  reciprocalTagContext?: boolean;
  /** Simple tag (self-match) — mirrors `Question.tagKind`. Needs exactly one non-ignore
   * answer whose text equals this question's own text (`normalizeTagKey` comparison,
   * `TalkValidator.validateTagKindFields`). */
  tagKind?: 'simple';
  /** A built-in comparator leaf (e.g. Dating's ageRange, Buy/Sell's price range) — `answers`
   * stays empty; TalkAutofix synthesizes the Compatible/Not-compatible pair. */
  builtIn?:
    | { kind: 'ageRange'; ageRange: { age: number; acceptableRange: { min: number; max: number } } }
    | { kind: 'priceRange'; priceRange: { min: number; max: number } };
  answers: RouteAnswerSpec[];
};

/**
 * Depth-first flattens a `RouteQuestionSpec` tree into `Question[]`, assigning `q_${n}` ids in
 * visit order (root first, then each answer's subtree before its next sibling — matching the
 * ordering convention of the hand-authored route talks in `tests/e2e/talks-matching/lib/`) and
 * building each node's `contextPath` from its ancestors' `(questionId, answerId)` pairs.
 */
function flattenRouteTree(root: RouteQuestionSpec): any[] {
  const out: any[] = [];
  let n = 0;

  function walk(spec: RouteQuestionSpec, contextPath: { questionId: string; answerId: string }[]): string {
    const id = `q_${n++}`;
    const question: any = { id, text: spec.text, contextPath, answers: [] };
    if (spec.reciprocalTagContext) question.reciprocalTagContext = true;
    if (spec.tagKind) question.tagKind = spec.tagKind;
    if (spec.builtIn) question.builtIn = spec.builtIn;
    out.push(question);

    spec.answers.forEach((a, i) => {
      const aid = `${id}_a${i}`;
      if (a.parallel && a.parallel.length > 0) {
        const childIds = a.parallel.map((childSpec) =>
          walk(childSpec, [...contextPath, { questionId: id, answerId: aid }]),
        );
        const answer: any = { id: aid, text: a.text, nextQuestionIds: childIds };
        if (a.parallelThreshold != null) answer.parallelMatchThreshold = a.parallelThreshold;
        question.answers.push(answer);
      } else if (a.next) {
        const childId = walk(a.next, [...contextPath, { questionId: id, answerId: aid }]);
        question.answers.push({ id: aid, text: a.text, nextQuestionId: childId });
      } else {
        const answer: any = { id: aid, text: a.text, isTerminal: true };
        if (a.isIgnore) answer.isIgnore = true;
        if (a.isMatch) answer.isMatch = true;
        question.answers.push(answer);
      }
    });

    return id;
  }

  walk(root, []);
  return out;
}

function buildRouteTalk(title: string, root: RouteQuestionSpec, isAdult = false): any {
  return { type: 'route', title, isAdult, questions: flattenRouteTree(root) };
}

/**
 * The common shape shared by every non-Dating template: a Pair-tag root (offerer tag vs.
 * counterpart tag), then one branching category question, then a final per-branch question
 * whose answers are the match/ignore terminals.
 */
function buildPairTagBranchRoute(opts: {
  title: string;
  tag: string;
  counterpartTag: string;
  ignoreTagText: string;
  branchQuestionText: string;
  branchAnswers: string[];
  finalQuestionText: string;
  finalMatchText: string;
  finalIgnoreText: string;
}): any {
  return buildRouteTalk(opts.title, {
    text: opts.tag,
    reciprocalTagContext: true,
    answers: [
      {
        text: opts.counterpartTag,
        next: {
          text: opts.branchQuestionText,
          answers: opts.branchAnswers.map((answerText) => ({
            text: answerText,
            next: {
              text: opts.finalQuestionText,
              answers: [
                { text: opts.finalMatchText, isMatch: true },
                { text: opts.finalIgnoreText, isIgnore: true },
              ],
            },
          })),
        },
      },
      { text: opts.ignoreTagText, isIgnore: true },
    ],
  });
}

/**
 * The deepest template, matching the requested buy/sell walkthrough: 1) buy/sell (Pair-tag
 * root), 2) each item for sale is its own Simple tag (self-match — the item name IS the
 * question, `93-route-parallel-spec-fanout-buy-sell.spec.ts`'s proven shape), which itself
 * fans its one answer out into 3) model, condition, and price range as independent parallel
 * specs (`Answer.nextQuestionIds`/`parallelMatchThreshold`) that must ALL match for that item —
 * not a linear chain, since a real screening conversation asks these in any order and every
 * one has to check out. "sell" fans out across every item (`parallelThreshold: 1` — ANY one
 * item's full spec-set matching is enough), so adding a 3rd, 4th, ... item for sale to the
 * same talk is just another "+Parallel Q" on that same answer in the route editor, not a new
 * talk.
 */
function buildBuySellTemplate(): any {
  const item = (opts: {
    name: string;
    modelText: string;
    priceMin: number;
    priceMax: number;
  }): RouteQuestionSpec => ({
    text: opts.name,
    tagKind: 'simple',
    answers: [
      {
        text: opts.name,
        parallel: [
          { text: 'Model', answers: [{ text: opts.modelText, isMatch: true }] },
          { text: 'condition', answers: [{ text: 'used', isMatch: true }] },
          {
            text: 'price range',
            builtIn: { kind: 'priceRange', priceRange: { min: opts.priceMin, max: opts.priceMax } },
            answers: [],
          },
        ],
      },
    ],
  });

  return buildRouteTalk('Buy / Sell', {
    text: 'buy',
    reciprocalTagContext: true,
    answers: [
      {
        text: 'sell',
        parallelThreshold: 1,
        parallel: [
          item({ name: 'iPhone', modelText: 'iPhone 15 or newer', priceMin: 300, priceMax: 400 }),
          item({ name: 'iPad', modelText: 'iPad 10th gen or newer', priceMin: 200, priceMax: 350 }),
        ],
      },
      { text: 'Not interested', isIgnore: true },
    ],
  });
}

function buildTaxiTemplate(): any {
  return buildPairTagBranchRoute({
    title: 'Taxi Ride',
    tag: 'passenger',
    counterpartTag: 'driver',
    ignoreTagText: 'Not right now',
    branchQuestionText: 'What type of ride?',
    branchAnswers: ['Standard', 'XL (more seats)', 'Pool (shared ride)'],
    finalQuestionText: 'Are you available right now?',
    finalMatchText: 'Yes, right now',
    finalIgnoreText: 'No, not now',
  });
}

function buildJobTemplate(): any {
  return buildPairTagBranchRoute({
    title: 'Job Seeker / Hiring',
    tag: 'job seeker',
    counterpartTag: 'hiring',
    ignoreTagText: 'Not looking',
    branchQuestionText: 'What role are you interested in?',
    branchAnswers: ['Engineering', 'Sales', 'Support'],
    finalQuestionText: 'How many years of experience?',
    finalMatchText: '2+ years',
    finalIgnoreText: 'Less than 2 years',
  });
}

/**
 * Everyday-errand templates (find-more-use-cases follow-up) — same Pair-tag-root route shape as
 * buy/sell/taxi/job, covering the routine day-to-day coordination this app targets: splitting a
 * room, reuniting a lost item with its owner, lining up a pet sitter, finding a study/tutoring
 * partner.
 */
function buildRoommateTemplate(): any {
  return buildPairTagBranchRoute({
    title: 'Roommate Search',
    tag: 'need a roommate',
    counterpartTag: 'have a room',
    ignoreTagText: 'Not looking',
    branchQuestionText: "What's your monthly budget?",
    branchAnswers: ['Under $800', '$800-1200', 'Over $1200'],
    finalQuestionText: 'When do you need to move in?',
    finalMatchText: 'Within a month',
    finalIgnoreText: 'Not for a while',
  });
}

function buildLostFoundTemplate(): any {
  return buildPairTagBranchRoute({
    title: 'Lost & Found',
    tag: 'lost something',
    counterpartTag: 'found something',
    ignoreTagText: 'Nothing lost',
    branchQuestionText: 'What did you lose?',
    branchAnswers: ['Wallet', 'Phone', 'Keys', 'Something else'],
    finalQuestionText: 'Where did you lose/find it?',
    finalMatchText: 'Same neighborhood',
    finalIgnoreText: 'Different area',
  });
}

function buildPetSittingTemplate(): any {
  return buildPairTagBranchRoute({
    title: 'Pet Sitting',
    tag: 'need a pet sitter',
    counterpartTag: 'offering pet sitting',
    ignoreTagText: 'Not needed',
    branchQuestionText: 'What kind of pet?',
    branchAnswers: ['Dog', 'Cat', 'Something else'],
    finalQuestionText: 'How long is the sit?',
    finalMatchText: 'A day or less',
    finalIgnoreText: 'Multiple days',
  });
}

function buildTutorTemplate(): any {
  return buildPairTagBranchRoute({
    title: 'Study Buddy / Tutoring',
    tag: 'need a tutor',
    counterpartTag: 'offering tutoring',
    ignoreTagText: 'Not looking',
    branchQuestionText: 'What subject?',
    branchAnswers: ['Math', 'Science', 'Language', 'Something else'],
    finalQuestionText: 'What level?',
    finalMatchText: 'High school',
    finalIgnoreText: 'College or above',
  });
}

/**
 * §DD: age asked first (`ageRange` built-in comparator, `built-in-question-resolution.ts`), then
 * its "Compatible" outcome fans out (parallel, `parallelMatchThreshold: 1` — OR semantics, any
 * ONE accepted gender is enough) into 3 independent Pair-tag (`reciprocalTagContext`) branches,
 * one per gender the author accepts — docs/TODO.md §DD's multi-value gender/race preference
 * matching, modeled as several independent Pair-tag declarations rather than one Pair-tag with
 * several answers (which would break the exact-text hash a Pair-tag match relies on — a single
 * question can only ever have ONE accepted answer, `singleNonIgnoreAnswer`).
 *
 * Each branch is a Pair-tag question FOLLOWED BY a trivial confirmation leaf, not a bare
 * Pair-tag leaf on its own — two real, empirically-found reasons, not just style:
 * 1. A Pair-tag's own answer-selection auto-proceeds unconditionally regardless of the
 *    responder's actual tag (`reciprocalOnlyAnswer`, answer-preference-resolution.ts) — the
 *    real veto only runs on a question AFTER a Pair-tag ancestor
 *    (`checkIfMatch`'s ancestor-aware veto / the chatbot's own PREFERENCE_CONFLICT gate,
 *    exact-chatbot-memory.ts — both existing, already proven by every other Pair-tag talk, e.g.
 *    buy/sell). A bare Pair-tag leaf has no such "question after it" for the veto to ever run
 *    against, so it would silently accept every gender. Mirrors exactly how every other
 *    Pair-tag talk in this file (Buy/Sell, Taxi, Job) is shaped — the Pair-tag is always
 *    followed by more content, never a leaf on its own.
 * 2. Each branch's confirmation-leaf text (distinct per branch: "Confirm: interested in
 *    men"/"...women"/"...non-binary people") doubles as the SHARED, predictable topic label two
 *    independently-authored talks both need to ask about for chatbot auto-matching to find each
 *    other at all — the exact same role "What model?"/"What price range?" plays in Buy/Sell.
 *    The 3 branches' OWN `myGender` text is deliberately left identical across all 3 (plain
 *    "men", not disambiguated) — `checkIfMatch`'s veto needs it to equal EXACTLY the literal
 *    word an author's own counterpart talk declares (see `myGender`'s own note below), so
 *    nothing may be appended to it. 3 identical short question texts in one talk used to trip
 *    the mesh delivery intake filter's grammar/spam heuristic before matching ever ran
 *    (`intakeFilterRejectReasons`/`intake_grammar`, talk-intake-filters.ts) — fixed at the
 *    source, in how that filter's subject text is built (`buildGrammarSubjectText` now
 *    deduplicates repeated question text — a route talk's parallel branches legitimately
 *    reusing a short label isn't spam), not by distorting this template's data to route around
 *    a false positive in a filter every OTHER talk relies on too.
 *
 * Hand-built (not `buildRouteTalk`/`RouteQuestionSpec`) because the DSL's `builtIn` variant
 * always leaves `answers: []` for `TalkAutofix.fix` to synthesize — it has no way to also attach
 * a `parallel` fan-out to the synthesized "Compatible" outcome. Answer ids on the root follow
 * `TalkAutofix`'s own `${questionId}_compatible`/`${questionId}_incompatible` convention exactly
 * (`pickBuiltInAnswer`, built-in-question-resolution.ts, looks them up by that exact shape) —
 * providing them here (non-empty `answers`) makes `TalkAutofix.fix` skip synthesis entirely and
 * defer to what's supplied, same as if the editor's "+ Add child" button had authored this
 * fan-out by hand (`92-route-shared-builtin-root-branches.spec.ts` proves a builtIn root can
 * already carry a child this way). `isAdult` is pre-checked (also force-locked by
 * `TalkAutofix.fix`, talk-engine.ts, and by `syncAdultLockFromBuiltInKinds` scanning the route
 * editor's own `.route-builtin-kind` selects, regardless of what the editor UI does or doesn't
 * otherwise enforce).
 *
 * `myGender` defaults to "men" for all 3 branches — deliberately drawn from the SAME 3-word
 * vocabulary ("men"/"women"/"non-binary people") the `acceptedGender` side uses, not a
 * different word like "male": a responder's own counterpart talk must declare `myGender` using
 * literally the word this or any other author's talk accepts (`checkIfMatch`'s veto is exact-text
 * — see `92`'s buy/sell precedent needing "buy"/"sell" on both sides, not synonyms), so keeping
 * both roles in one shared vocabulary is what makes swapping the default an obvious, correct
 * edit rather than a subtle trap. The author is expected to edit it when the default doesn't
 * apply — same as every other template's placeholder text (e.g. Buy/Sell's item names) is
 * expected to be customized, not used verbatim by everyone.
 */
function buildDatingTemplate(): any {
  const genderBranch = (
    id: string,
    confirmId: string,
    answerId: string,
    confirmAnswerId: string,
    myGender: string,
    acceptedGender: string,
  ): any[] => [
    {
      id,
      text: myGender,
      contextPath: [{ questionId: 'q_0', answerId: 'q_0_compatible' }],
      reciprocalTagContext: true,
      answers: [{ id: answerId, text: acceptedGender, nextQuestionId: confirmId }],
    },
    {
      id: confirmId,
      text: `Confirm: interested in ${acceptedGender}`,
      contextPath: [
        { questionId: 'q_0', answerId: 'q_0_compatible' },
        { questionId: id, answerId },
      ],
      answers: [{ id: confirmAnswerId, text: 'Yes', isMatch: true, isTerminal: true }],
    },
  ];

  return {
    type: 'route',
    title: 'Dating',
    isAdult: true,
    questions: [
      {
        id: 'q_0',
        text: 'Age range',
        contextPath: [],
        builtIn: { kind: 'ageRange', ageRange: { age: 28, acceptableRange: { min: 21, max: 45 } } },
        answers: [
          {
            id: 'q_0_compatible',
            text: 'Compatible',
            isMatch: true,
            nextQuestionIds: ['q_1', 'q_2', 'q_3'],
            parallelMatchThreshold: 1,
          },
          { id: 'q_0_incompatible', text: 'Not compatible', isIgnore: true, isTerminal: true },
        ],
      },
      ...genderBranch('q_1', 'q_1c', 'a_1_match', 'a_1c_match', 'men', 'men'),
      ...genderBranch('q_2', 'q_2c', 'a_2_match', 'a_2c_match', 'men', 'women'),
      ...genderBranch('q_3', 'q_3c', 'a_3_match', 'a_3c_match', 'men', 'non-binary people'),
    ],
  };
}

export const TALK_TEMPLATES: TalkTemplateDefinition[] = [
  { id: 'buySell', icon: '🤝', labelKey: 'talkTemplateBuySell', descKey: 'talkTemplateBuySellDesc', build: buildBuySellTemplate },
  { id: 'taxi', icon: '🚕', labelKey: 'talkTemplateTaxi', descKey: 'talkTemplateTaxiDesc', build: buildTaxiTemplate },
  { id: 'job', icon: '💼', labelKey: 'talkTemplateJob', descKey: 'talkTemplateJobDesc', build: buildJobTemplate },
  { id: 'dating', icon: '❤️', labelKey: 'talkTemplateDating', descKey: 'talkTemplateDatingDesc', build: buildDatingTemplate },
  { id: 'roommate', icon: '🏠', labelKey: 'talkTemplateRoommate', descKey: 'talkTemplateRoommateDesc', build: buildRoommateTemplate },
  { id: 'lostFound', icon: '🔍', labelKey: 'talkTemplateLostFound', descKey: 'talkTemplateLostFoundDesc', build: buildLostFoundTemplate },
  { id: 'petSitting', icon: '🐾', labelKey: 'talkTemplatePetSitting', descKey: 'talkTemplatePetSittingDesc', build: buildPetSittingTemplate },
  { id: 'tutor', icon: '📚', labelKey: 'talkTemplateTutor', descKey: 'talkTemplateTutorDesc', build: buildTutorTemplate },
];
