export type FlatAnswerHistoryItem = {
  /** Talk-scoped id (e.g. `q_0`) — positional, used only to deep-link back into
   *  *this* talk's response dialog (`.review-question-block[data-question-id]`). */
  questionId: string;
  answerId: string;
  prompt: string;
  choice: string;
  kind: 'tag' | 'question';
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
