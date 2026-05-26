export type FlatAnswerHistoryItem = {
  questionId: string;
  answerId: string;
  prompt: string;
  choice: string;
  kind: 'tag' | 'question';
  contextPath: string[];
  mode?: string;
  contextHash?: string;
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
