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
 * now genuinely branches — e.g. Buy/Sell's item category fans out into per-category follow-up
 * questions (model, for iPhone) before converging on condition → price range, matching how a
 * real screening conversation would fork.
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
  /** Present iff this answer continues the DAG instead of terminating it. */
  next?: RouteQuestionSpec;
};

type RouteQuestionSpec = {
  text: string;
  /** Pair-tag root marker — mirrors `Question.reciprocalTagContext`. */
  reciprocalTagContext?: boolean;
  /** A built-in comparator leaf (e.g. Dating's ageRange) — `answers` stays empty; TalkAutofix
   * synthesizes the Compatible/Not-compatible pair. */
  builtIn?: { kind: 'ageRange'; ageRange: { age: number; acceptableRange: { min: number; max: number } } };
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
    if (spec.builtIn) question.builtIn = spec.builtIn;
    out.push(question);

    spec.answers.forEach((a, i) => {
      const aid = `${id}_a${i}`;
      if (a.next) {
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
 * The deepest template, matching the requested buy/sell walkthrough: 1) buy/sell (Pair-tag root)
 * 2) item category — iPhone branches into 3) model, everything else skips straight to condition
 * — 4) condition, 5) price range (match/ignore terminal). Item category fanning out into a
 * per-category sub-tree before converging on the shared condition/price-range shape is the
 * genuinely branching part a linear `flow` talk couldn't express.
 */
function buildBuySellTemplate(): any {
  const priceRangeNode = (): RouteQuestionSpec => ({
    text: 'Does a price range of $400-800 work for both of you?',
    answers: [
      { text: 'Yes, that range works', isMatch: true },
      { text: 'No, different range', isIgnore: true },
    ],
  });
  const conditionNode = (): RouteQuestionSpec => ({
    text: 'What condition is it in?',
    answers: [
      { text: 'New / like new', next: priceRangeNode() },
      { text: 'Used', next: priceRangeNode() },
    ],
  });

  return buildRouteTalk('Buy / Sell', {
    text: 'buy',
    reciprocalTagContext: true,
    answers: [
      {
        text: 'sell',
        next: {
          text: 'What are you looking to buy or sell?',
          answers: [
            {
              text: 'iPhone',
              next: {
                text: 'Which model?',
                answers: [
                  { text: 'iPhone 15 or newer', next: conditionNode() },
                  { text: 'iPhone 14 or 13', next: conditionNode() },
                  { text: 'iPhone 12 or older', next: conditionNode() },
                ],
              },
            },
            { text: 'Something else', next: conditionNode() },
          ],
        },
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
 * §DD: the one template that needs the new `ageRange` built-in comparator
 * (`built-in-question-resolution.ts`) instead of a plain text final question — a relationship-
 * goal branch (Casual/Serious) fans out into its own ageRange node so each goal can carry its
 * own default age + acceptable range, and `isAdult` is pre-checked (also force-locked by
 * `TalkAutofix.fix`, talk-engine.ts, and by `syncAdultLockFromBuiltInKinds` scanning the route
 * editor's own `.route-builtin-kind` selects, regardless of what the editor UI does or doesn't
 * otherwise enforce).
 */
function buildDatingTemplate(): any {
  const ageRangeNode = (age: number, min: number, max: number): RouteQuestionSpec => ({
    text: 'Age range',
    builtIn: { kind: 'ageRange', ageRange: { age, acceptableRange: { min, max } } },
    answers: [],
  });

  return buildRouteTalk(
    'Dating',
    {
      text: 'seeking women',
      reciprocalTagContext: true,
      answers: [
        {
          text: 'seeking men',
          next: {
            text: 'What are you looking for?',
            answers: [
              { text: 'Something casual', next: ageRangeNode(28, 21, 35) },
              { text: 'Something serious', next: ageRangeNode(30, 25, 40) },
            ],
          },
        },
        { text: 'Not interested', isIgnore: true },
      ],
    },
    true,
  );
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
