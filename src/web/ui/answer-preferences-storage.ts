export type AnswerPreferenceEntry = {
  answerId: string;
  answerText: string;
  mode: string;
  talkId?: string;
  questionText?: string;
  allAnswers?: any[];
  timestamp?: string;
  flatKey?: string;
};

import {
  createEmptyExactChatbotMemoryState,
  type ExactChatbotMemoryState,
} from '../../shared/exact-chatbot-memory';

export type AnswerPreferenceMap = Record<string, AnswerPreferenceEntry>;

export type MyQuestionAnswerEntry = {
  questionText: string;
  answerId: string;
  answerText: string;
  isIgnored: boolean;
  timestamp: string;
  location?: string;
};

function readJsonMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function writeJsonMap<T>(key: string, value: Record<string, T>): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getAnsweredTalkByContent(): Record<string, string> {
  return readJsonMap<string>('answeredTalkByContent');
}

export function setAnsweredTalkByContent(map: Record<string, string>): void {
  writeJsonMap('answeredTalkByContent', map);
}

export function getAnswerPreferences(): AnswerPreferenceMap {
  return readJsonMap<AnswerPreferenceEntry>('answerPreferences');
}

export function setAnswerPreferences(map: AnswerPreferenceMap): void {
  writeJsonMap('answerPreferences', map);
}

export function getFlattenedAnswerPreferences(): AnswerPreferenceMap {
  return readJsonMap<AnswerPreferenceEntry>('flattenedAnswerPreferences');
}

export function setFlattenedAnswerPreferences(map: AnswerPreferenceMap): void {
  writeJsonMap('flattenedAnswerPreferences', map);
}

export function clearAnswerPreferences(): void {
  localStorage.removeItem('answerPreferences');
  localStorage.removeItem('flattenedAnswerPreferences');
  localStorage.removeItem('exactChatbotMemory');
}

export function getExactChatbotMemory(): ExactChatbotMemoryState {
  try {
    const raw = localStorage.getItem('exactChatbotMemory');
    if (!raw) return createEmptyExactChatbotMemoryState();
    const parsed = JSON.parse(raw) as Partial<ExactChatbotMemoryState>;
    return {
      users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {},
      questions: parsed.questions && typeof parsed.questions === 'object' ? parsed.questions : {},
      answers: parsed.answers && typeof parsed.answers === 'object' ? parsed.answers : {},
    };
  } catch {
    return createEmptyExactChatbotMemoryState();
  }
}

export function setExactChatbotMemory(value: ExactChatbotMemoryState): void {
  localStorage.setItem('exactChatbotMemory', JSON.stringify(value));
}

export function getMyQuestionAnswers(): Record<string, MyQuestionAnswerEntry> {
  return readJsonMap<MyQuestionAnswerEntry>('myQuestionAnswers');
}

export function setMyQuestionAnswer(key: string, value: MyQuestionAnswerEntry): void {
  const all = getMyQuestionAnswers();
  all[key] = value;
  writeJsonMap('myQuestionAnswers', all);
}
