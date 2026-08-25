import type { UiTranslationKey } from './ui-translations';

/**
 * Built-in "start from a template" library (talk editor usability follow-up — the editor's
 * empty-form starting point was hard to use from scratch). Each template returns a plain
 * `Talk`-shaped object with no `id` — the exact shape `showTalkEditorDialog(existingTalk?)`
 * already accepts as a prefill (proven by the existing "copy a talk"/survey-follow-up call
 * sites in ui-manager.ts), so a template opens the ordinary editor pre-filled and fully
 * editable, and is created fresh on save rather than edited-in-place.
 *
 * All four are Pair-tag matches (`Question.reciprocalTagContext`, types.ts) sharing one
 * generator, `buildTwoSidedOfferTemplate` — not four independently hand-rolled structures.
 * `type: 'flow'` throughout: the simplest shape to read/edit, matching the already-proven
 * buy/sell and taxi Pair-tag examples (89-buy-sell-chatbot-cross-talk-match.spec.ts,
 * 05-taxi-local-chatroom-match.spec.ts) rather than a route DAG.
 *
 * Answer ids/contextHashId/etc are intentionally NOT set here — `processTalkForm` (ui-manager.ts)
 * reads the live DOM at save time and regenerates all of that fresh, exactly as if the user had
 * hand-typed the same values; this file only needs to produce values the editor's rehydration
 * code (talk-editor-dialog.ts) knows how to read into form fields. `nextQuestionId: 'q_1'` on a
 * non-last question's real answer mirrors that convention (`q_${index}`, positional) — though
 * `updateAllAnswerDropdowns` also auto-defaults an unset/stale value to the immediate next
 * question, so this is belt-and-suspenders, not load-bearing.
 */
export type TalkTemplateId = 'buySell' | 'taxi' | 'job' | 'dating';

export type TalkTemplateDefinition = {
  id: TalkTemplateId;
  icon: string;
  labelKey: UiTranslationKey;
  descKey: UiTranslationKey;
  build: () => any;
};

function buildTwoSidedOfferTemplate(opts: {
  title: string;
  tag: string;
  counterpartTag: string;
  ignoreTagText: string;
  q2Text: string;
  q2MatchText: string;
  q2IgnoreText: string;
  isAdult?: boolean;
}): any {
  return {
    type: 'flow',
    title: opts.title,
    isAdult: !!opts.isAdult,
    questions: [
      {
        id: 'q_0',
        text: opts.tag,
        reciprocalTagContext: true,
        answers: [
          { id: 'a_0_0', text: opts.counterpartTag, nextQuestionId: 'q_1' },
          { id: 'a_0_1', text: opts.ignoreTagText, isIgnore: true },
        ],
      },
      {
        id: 'q_1',
        text: opts.q2Text,
        answers: [
          { id: 'a_1_0', text: opts.q2MatchText, isMatch: true },
          { id: 'a_1_1', text: opts.q2IgnoreText, isIgnore: true },
        ],
      },
    ],
  };
}

function buildBuySellTemplate(): any {
  return buildTwoSidedOfferTemplate({
    title: 'Buy / Sell',
    tag: 'buy',
    counterpartTag: 'sell',
    ignoreTagText: 'Not interested',
    q2Text: 'What are you looking to buy or sell?',
    q2MatchText: 'iPhone',
    q2IgnoreText: 'Something else',
  });
}

function buildTaxiTemplate(): any {
  return buildTwoSidedOfferTemplate({
    title: 'Taxi Ride',
    tag: 'passenger',
    counterpartTag: 'driver',
    ignoreTagText: 'Not right now',
    q2Text: 'Are you available right now?',
    q2MatchText: 'Yes, right now',
    q2IgnoreText: 'No, not now',
  });
}

function buildJobTemplate(): any {
  return buildTwoSidedOfferTemplate({
    title: 'Job Seeker / Hiring',
    tag: 'job seeker',
    counterpartTag: 'hiring',
    ignoreTagText: 'Not looking',
    q2Text: 'What role are you interested in?',
    q2MatchText: 'Software Engineer',
    q2IgnoreText: 'Something else',
  });
}

/**
 * §DD: the one template that needs the new `ageRange` built-in comparator
 * (`built-in-question-resolution.ts`) instead of a plain text Q2 — each side declares their own
 * age + acceptable partner-age range, and `isAdult` is pre-checked (also force-locked by
 * `TalkAutofix.fix`, talk-engine.ts, regardless of what the editor UI does or doesn't enforce).
 */
function buildDatingTemplate(): any {
  return {
    type: 'flow',
    title: 'Dating',
    isAdult: true,
    questions: [
      {
        id: 'q_0',
        text: 'seeking women',
        reciprocalTagContext: true,
        answers: [
          { id: 'a_0_0', text: 'seeking men', nextQuestionId: 'q_1' },
          { id: 'a_0_1', text: 'Not interested', isIgnore: true },
        ],
      },
      {
        id: 'q_1',
        text: 'Age range',
        builtIn: { kind: 'ageRange', ageRange: { age: 30, acceptableRange: { min: 25, max: 40 } } },
        answers: [],
      },
    ],
  };
}

export const TALK_TEMPLATES: TalkTemplateDefinition[] = [
  { id: 'buySell', icon: '🤝', labelKey: 'talkTemplateBuySell', descKey: 'talkTemplateBuySellDesc', build: buildBuySellTemplate },
  { id: 'taxi', icon: '🚕', labelKey: 'talkTemplateTaxi', descKey: 'talkTemplateTaxiDesc', build: buildTaxiTemplate },
  { id: 'job', icon: '💼', labelKey: 'talkTemplateJob', descKey: 'talkTemplateJobDesc', build: buildJobTemplate },
  { id: 'dating', icon: '❤️', labelKey: 'talkTemplateDating', descKey: 'talkTemplateDatingDesc', build: buildDatingTemplate },
];
