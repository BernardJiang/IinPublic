export type FlatAnswerHistoryItem = {
  /** Talk-scoped id (e.g. `q_0`) — positional, used only to deep-link back into
   *  *this* talk's response dialog (`.review-question-block[data-question-id]`). */
  questionId: string;
  answerId: string;
  prompt: string;
  choice: string;
  kind: 'tag' | 'question';
  /** docs/TODO.md §LL.2 follow-up: only meaningful when `kind === 'tag'`. True for a self-match
   *  tag (Simple tag, or a literal `type:'tag'` talk with no `reciprocalTagContext`) — `choice`
   *  is the boolean "Checked"/"Unchecked". False for a Pair tag (`reciprocalTagContext`) — `choice`
   *  is the real accepted-answer text (e.g. "sell"), same shape as an ordinary question's answer. */
  booleanTag?: boolean;
  contextPath: string[];
  contextLabel?: string;
  mode?: string;
  contextHash?: string;
  /** Spec §20.3/REQ-LEDGER-14 content-addressed question identity —
   *  `Question.cidId` (CIDv1 of normalized text + sorted answer texts), stamped by
   *  `WebTalkService.stampQuestionCids` at talk create/update time. Same value for
   *  the same question regardless of which talk or talk type asked it — this is
   *  the correct key for merging "the same question" across talks in the Me tab.
   *  Absent for talks answered before this field existed. */
  questionContentId?: string;
};

export type FlatAnswerHistoryRecord = {
  id: string;
  talkId: string;
  title: string;
  type: string;
  language?: string;
  supportMessage?: boolean;
  supportChannel?: boolean;
  outcome: 'match' | 'mismatch';
  answeredAt: string;
  senderIds: string[];
  locationRadiusMiles?: number;
  items: FlatAnswerHistoryItem[];
};

export type FlatAnswerHistoryMap = Record<string, FlatAnswerHistoryRecord>;

const ANSWER_HISTORY_KEY = 'myAnswerHistory';

export function getFlatAnswerHistory(): FlatAnswerHistoryMap {
  try {
    const stored = localStorage.getItem(ANSWER_HISTORY_KEY);
    return stored ? (JSON.parse(stored) as FlatAnswerHistoryMap) : {};
  } catch {
    return {};
  }
}

export function setFlatAnswerHistory(history: FlatAnswerHistoryMap): void {
  localStorage.setItem(ANSWER_HISTORY_KEY, JSON.stringify(history));
}

export function upsertFlatAnswerHistory(record: FlatAnswerHistoryRecord): FlatAnswerHistoryMap {
  const history = getFlatAnswerHistory();
  history[record.id] = record;
  setFlatAnswerHistory(history);
  return history;
}

/**
 * Content-derived identity for a talk, independent of its (possibly per-sender-varying)
 * `talkId`. Used to recognize "the same talk content, answered before" across distinct
 * talk instances/ids — deliberately excludes location/sender fields that vary per delivery.
 */
export function getTalkContentKey(talk: any): string {
  const q = (talk.questions || []).map((qu: any) => ({
    text: qu.text,
    answers: (qu.answers || []).map((a: any) => a.text),
  }));
  const title = talk.type === 'tag' ? talk.title : '';
  const loc = talk.locationRadiusMiles != null ? String(talk.locationRadiusMiles) : '';
  return JSON.stringify({ q, loc, title, type: talk.type });
}

/**
 * Flattens a completed talk's answers into `FlatAnswerHistoryItem[]` (one row per
 * question/tag, deriving the display `choice`, `contextPath`/`contextLabel`, and
 * §LL.2's `booleanTag` distinction) and persists the record. Pure transform + a single
 * storage write — no DOM, no `UIManager` instance state.
 */
export function saveFlatAnswerHistoryRecord(
  talkId: string,
  talk: any,
  completedAnswers: Array<{ questionId: string; answerId: string; answerText?: string; mode?: string }>,
  outcome: 'match' | 'mismatch',
  senders: string[],
): void {
  const questions = Array.isArray(talk?.questions) ? talk.questions : [];
  const talkType = String(talk?.type || '').toLowerCase();
  const items: FlatAnswerHistoryItem[] = completedAnswers.map((entry, index) => {
    const question = questions.find((item: any) => String(item?.id || '') === entry.questionId) || {};
    const answer = Array.isArray(question?.answers)
      ? question.answers.find((item: any) => String(item?.id || '') === entry.answerId)
      : null;
    // docs/TODO.md §LL.2 follow-up: an embedded tag/Pair-tag question (tagKind/
    // reciprocalTagContext, not just a literal type:'tag' talk) dissolves into the Me tab as a
    // tag too. `booleanTag` distinguishes the two sub-kinds within `kind:'tag'` — a self-match
    // tag has no meaningful answer text of its own (Checked/Unchecked), while a Pair tag's
    // accepted-answer text ("sell") is the whole point and must be shown, not hidden behind a
    // boolean. See `findTagPairAncestor`'s doc comment (talk-engine.ts) for what
    // reciprocalTagContext actually encodes.
    const isTag = talkType === 'tag' || question?.tagKind === 'simple' || !!question?.reciprocalTagContext;
    const booleanTag = isTag && !question?.reciprocalTagContext;
    const prompt = String(question?.text || talk?.title || `Question ${index + 1}`).trim();
    const rawChoice = String(entry.answerText || '').trim();
    const choice = isTag
      ? booleanTag
        ? answer?.isMatch
          ? 'Checked'
          : 'Unchecked'
        : String(answer?.text || '').trim() || 'Ignored'
      : rawChoice && rawChoice.toLowerCase() !== 'ignore'
        ? rawChoice
        : String(answer?.text || '').trim() || 'Ignored';
    const contextPath = Array.isArray(question?.contextPath)
      ? question.contextPath.map((step: any, stepIndex: number) => {
          const questionId = String(step?.questionId || '').trim();
          const parentQuestion = questions.find((item: any) => String(item?.id || '') === questionId);
          const answerId = String(step?.answerId || '').trim();
          const parentAnswer = Array.isArray(parentQuestion?.answers)
            ? parentQuestion.answers.find((item: any) => String(item?.id || '') === answerId)
            : null;
          const questionText = String(parentQuestion?.text || questionId || `Q${stepIndex + 1}`).trim();
          const answerText = String(parentAnswer?.text || answerId || '?').trim();
          return `${questionText}→${answerText}`;
        })
      : [];
    const flowContextLabel = completedAnswers
      .slice(0, index)
      .map((previousEntry, stepIndex) => {
        const previousQuestion = questions.find((item: any) => String(item?.id || '') === previousEntry.questionId);
        const previousAnswer = Array.isArray(previousQuestion?.answers)
          ? previousQuestion.answers.find((item: any) => String(item?.id || '') === previousEntry.answerId)
          : null;
        const previousPrompt = String(previousQuestion?.text || `Q${stepIndex + 1}`).trim();
        const previousRawChoice = String(previousEntry.answerText || '').trim();
        const previousChoice = previousRawChoice && previousRawChoice.toLowerCase() !== 'ignore'
          ? previousRawChoice
          : String(previousAnswer?.text || '').trim() || 'Ignored';
        return `${previousPrompt}→${previousChoice}`;
      })
      .filter(Boolean)
      .join(' · ');
    const contextLabel = talkType === 'tag' || talkType === 'survey'
      ? ''
      : talkType === 'flow'
        ? flowContextLabel
        : contextPath.join(' · ');
    const contextHash = talkType === 'tag' || talkType === 'survey'
      ? ''
      : String(question?.contextHashId || '').trim();
    const questionContentId = String(question?.cidId || '').trim();
    return {
      questionId: entry.questionId,
      answerId: entry.answerId,
      prompt,
      choice,
      kind: isTag ? 'tag' : 'question',
      ...(isTag ? { booleanTag } : {}),
      contextPath,
      contextLabel,
      ...(entry.mode ? { mode: entry.mode } : {}),
      ...(contextHash ? { contextHash } : {}),
      ...(questionContentId ? { questionContentId } : {}),
    };
  });
  upsertFlatAnswerHistory({
    id: `${getTalkContentKey(talk)}:${talkId}`,
    talkId,
    title: String(talk?.title || 'Answered Talk'),
    type: String(talk?.type || 'flow'),
    language: String(talk?.language || 'en').toLowerCase(),
    outcome,
    answeredAt: new Date().toISOString(),
    senderIds: [...new Set(senders.filter(Boolean))],
    ...(talk?.locationRadiusMiles != null ? { locationRadiusMiles: talk.locationRadiusMiles } : {}),
    items,
  });
}
