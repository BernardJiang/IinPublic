/**
 * The app's chatbot over the device graph (OPEN-106 step 2e v): what it answers for a Talk, the
 * lookups the answer dialog resolves each question from, and the tags I passed. It replaces the
 * old answer engine and its collections (`answer-preference-engine.ts`).
 *
 * The Talk is the app's body (`appTalkOf`), read from the graph by the app; its structure is the
 * one the graph stored, so its situations are the graph's. My place for a location question is my
 * most recent own Talk of the same title and tag side, and is compared only with my consent.
 */
import { locationsMutuallyContained, type LocationForContainment } from '../../../shared/built-in-comparisons';
import { findTagPairAncestor } from '../../../shared/talk-engine';
import type { DeviceGraph } from '../device-graph';
import { walkChatbot, type ChatbotAnswer, type ChatbotView, type ChatbotViewOptions } from '../answers';
import { tagScopeFor, talkStructureOf, type Perspective, type StructureQuestion } from '../talk-structure';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** One answer as the app's response carries it (`tryBuildChatbotAnswersFromFlattened`'s shape). */
export type AppChatbotAnswer = { questionId: string; answerId: string; answerText: string; mode: 'auto'; answerIds?: string[] };

export type AppChatbotOptions = {
  /** My own Talk (I answer it as its author), else one I received. */
  mine?: boolean;
  /** The user's consent to compare places (`locationAutoMatchConsent`). */
  locationConsent?: boolean;
};

function effectiveTagContext(
  currentUserId: string | undefined,
  talk: any,
  currentQuestion?: { id: string; contextPath?: Array<{ questionId: string; answerId: string }> },
): { mySelfTag: string | undefined; counterpartCandidates: Array<string | undefined>; isMine: boolean } {
  const isMine = !!(talk?.authorId && currentUserId && talk.authorId === currentUserId);
  const ancestor = currentQuestion ? findTagPairAncestor(talk, currentQuestion) : undefined;
  if (ancestor) {
    return isMine
      ? { mySelfTag: ancestor.questionText, counterpartCandidates: [ancestor.answerText], isMine }
      : { mySelfTag: ancestor.answerText, counterpartCandidates: [ancestor.questionText], isMine };
  }
  return { mySelfTag: undefined, counterpartCandidates: [undefined], isMine };
}

/**
 * §BB: source side "b" of `locationsMutuallyContained` from whatever MY OWN most-recently
 * created talk of matching (selfTag, title) scope already carries as its ordinary
 * `authorLocation`/`locationRadiusMiles` — see `Question.builtIn`'s own doc comment (types.ts)
 * for why location reuses a counterpart talk's fields instead of a separately-typed value like
 * quantity/priceRange/timeFrame. Scoped the same way `typedPreferenceState` is (myTag + title),
 * so two same-titled talks with different tags/locations don't bleed into each other. Pure/
 * synchronous — `myTalks` is the already-loaded `getMyTalks()` map, not read internally, so this
 * is directly unit-testable.
 */
export function myMostRecentLocationTalk(
  myTalks: Record<string, any>,
  currentUserId: string | undefined,
  mySelfTag: string | undefined,
  title: string | undefined,
): LocationForContainment | undefined {
  if (!title) return undefined;
  const normalizedTitle = title.trim().toLowerCase();
  // Tags compare as words: one Talk may say "sell" and the counterpart's "Sell".
  const normalizedTag = String(mySelfTag || 'general').trim().toLowerCase();
  let best: { timestamp: string; location: LocationForContainment } | undefined;
  for (const entry of Object.values(myTalks)) {
    if (entry.role !== 'created') continue;
    if (String(entry.title || '').trim().toLowerCase() !== normalizedTitle) continue;
    const fullTalk = entry.fullTalk || entry;
    const questions: any[] = Array.isArray(fullTalk?.questions) ? fullTalk.questions : [];
    const locationQuestion = questions.find((q: any) => q?.builtIn?.kind === 'location');
    if (!locationQuestion) continue;
    const { mySelfTag: ownTag } = effectiveTagContext(currentUserId, fullTalk, locationQuestion);
    if (String(ownTag || 'general').trim().toLowerCase() !== normalizedTag) continue;
    const authorLocation = fullTalk?.authorLocation;
    const locationRadiusMiles = entry.locationRadiusMiles ?? fullTalk?.locationRadiusMiles;
    if (!authorLocation || locationRadiusMiles == null) continue;
    if (!best || entry.timestamp > best.timestamp) {
      best = { timestamp: entry.timestamp, location: { authorLocation, locationRadiusMiles } };
    }
  }
  return best?.location;
}

export function createAppChatbot(options: {
  graph: DeviceGraph;
  /** My Talks as the app keeps them (bodies read back), for my place. */
  myTalks?: () => Promise<Record<string, unknown>>;
  /** My user ID: whether a Talk in `myTalks` is mine. */
  userId?: () => string | undefined;
}) {
  const { graph } = options;

  async function viewOptionsFor(talk: Record<string, any>, perspective: Perspective, consent: boolean): Promise<ChatbotViewOptions> {
    const structure = talkStructureOf(talk);
    const out: ChatbotViewOptions = { title: String(talk.title ?? '') };
    if (!consent || !structure.questions.some((q) => q.builtIn?.kind === 'location')) return out;
    const myTalks = (await options.myTalks?.()) ?? {};
    const theirs: LocationForContainment | undefined = talk.authorLocation && talk.locationRadiusMiles != null
      ? { authorLocation: talk.authorLocation, locationRadiusMiles: talk.locationRadiusMiles } : undefined;
    out.locationCompatible = (question: StructureQuestion) => {
      const mine = myMostRecentLocationTalk(myTalks as Record<string, any>, options.userId?.(), tagScopeFor(structure, question, perspective).selfTag, talk.title);
      return mine && theirs ? locationsMutuallyContained(theirs, mine) : undefined;
    };
    return out;
  }

  function appAnswerOf(talk: Record<string, any>, answer: ChatbotAnswer): AppChatbotAnswer | undefined {
    const question = (talk.questions || []).find((q: any) => q?.id === answer.questionId);
    const chosen = (answer.answerIds || []).map((id) => (question?.answers || []).find((a: any) => a?.id === id)).filter(Boolean);
    if (!chosen.length) return undefined;
    const texts = chosen.map((a: any) => String(a.text ?? ''));
    return {
      questionId: answer.questionId,
      answerId: String(chosen[0].id),
      answerText: texts.join(', '),
      mode: 'auto',
      ...(question?.answerSelectionMode === 'multiple' ? { answerIds: chosen.map((a: any) => String(a.id)) } : {}),
    };
  }

  return {
    /** Every lookup for this Talk: the answer dialog resolves its questions from it. */
    async view(talk: Record<string, any>, opts: AppChatbotOptions = {}): Promise<ChatbotView> {
      const perspective: Perspective = opts.mine ? 'author' : 'responder';
      return graph.answers.chatbotView(talkStructureOf(talk), perspective, await viewOptionsFor(talk, perspective, opts.locationConsent === true));
    },

    /**
     * What the chatbot answers for this Talk by itself (`answers` only when it answers every
     * question it reaches), whether it is a tag I passed, and whether I answered it already.
     */
    async answer(talk: Record<string, any>, opts: AppChatbotOptions & { talkId?: string } = {}): Promise<{ answers: AppChatbotAnswer[] | null; passed: boolean; answered: boolean }> {
      const perspective: Perspective = opts.mine ? 'author' : 'responder';
      const structure = talkStructureOf(talk);
      const view = await graph.answers.chatbotView(structure, perspective, await viewOptionsFor(talk, perspective, opts.locationConsent === true));
      const walk = walkChatbot(structure, perspective, view);
      const answers = walk.complete && walk.answers.length
        ? walk.answers.map((a) => appAnswerOf(talk, a))
        : null;
      // Answered already: my latest answer is to this version (an edit is a newer version, to
      // answer again). Event ids begin with their time, so they compare in time order.
      let answered = false;
      if (opts.talkId) {
        const mine = await graph.answers.answered(opts.talkId);
        const version = (await graph.arrivals.read(opts.talkId))?.versionId ?? (await graph.talks.read(opts.talkId))?.versionId;
        answered = !!mine && (!version || mine > version);
      }
      return { answers: answers && answers.every(Boolean) ? answers as AppChatbotAnswer[] : null, passed: view.passed, answered };
    },

    /** I passed this tag (or take that back). */
    pass(talk: Record<string, any>, passed: boolean): Promise<boolean> {
      return graph.answers.pass(talkStructureOf(talk), passed);
    },
  };
}

export type AppChatbot = ReturnType<typeof createAppChatbot>;
