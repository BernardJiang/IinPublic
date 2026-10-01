import { normalizeIdentityText } from './cid';
import { portableSha256Hex } from './portable-sha256';

export const QUESTION_DEFAULT_CONTRACT_VERSION = 1 as const;
const QUESTION_DEFAULT_DOMAIN = 'iinpublic-question-default-v1';
const ANSWER_IDENTITY_DOMAIN = 'iinpublic-answer-identity-v1';

export type QuestionDefaultTagScope = {
  mySelfTag?: string | undefined;
  counterpartTag?: string | undefined;
};

export type QuestionDefaultAnswer = {
  answerHash: string;
  answerText: string;
  updatedAt: string;
};

export type QuestionDefaultContract = {
  version: typeof QUESTION_DEFAULT_CONTRACT_VERSION;
  questionKey: string;
  questionText: string;
  language: string;
  selectionMode: string;
  mySelfTag?: string;
  counterpartTag?: string;
  /** Highest priority first. Only answers explicitly selected as "Whenever offered" appear. */
  answers: QuestionDefaultAnswer[];
};

export type QuestionDefaultContractMap = Record<string, QuestionDefaultContract>;

/**
 * Stable identity for an exact authored question, deliberately excluding its choice set,
 * talk id/author, talk type, sequential position, and rolling parent context.
 */
export function buildQuestionDefaultKey(
  talk: { language?: string },
  question: { text?: string; answerSelectionMode?: string },
  tagScope: QuestionDefaultTagScope = {},
): string {
  const payload = {
    version: QUESTION_DEFAULT_CONTRACT_VERSION,
    domain: QUESTION_DEFAULT_DOMAIN,
    language: normalizeIdentityText(talk?.language || 'en'),
    question: normalizeIdentityText(question?.text),
    selectionMode: normalizeIdentityText(question?.answerSelectionMode || 'single'),
    selfTag: normalizeIdentityText(tagScope.mySelfTag),
    counterpartTag: normalizeIdentityText(tagScope.counterpartTag),
  };
  return portableSha256Hex(JSON.stringify(payload));
}

export function buildAnswerIdentityHash(answerText: string): string {
  return portableSha256Hex(JSON.stringify({
    domain: ANSWER_IDENTITY_DOMAIN,
    answer: normalizeIdentityText(answerText),
  }));
}

export function putQuestionDefault(
  contracts: QuestionDefaultContractMap,
  params: {
    questionKey: string;
    questionText: string;
    language?: string | undefined;
    selectionMode?: string | undefined;
    tagScope?: QuestionDefaultTagScope | undefined;
    answerText: string;
    updatedAt?: string | undefined;
  },
): QuestionDefaultContract {
  const answerHash = buildAnswerIdentityHash(params.answerText);
  const existing = contracts[params.questionKey];
  const answer: QuestionDefaultAnswer = {
    answerHash,
    answerText: params.answerText,
    updatedAt: params.updatedAt || new Date().toISOString(),
  };
  const contract: QuestionDefaultContract = {
    version: QUESTION_DEFAULT_CONTRACT_VERSION,
    questionKey: params.questionKey,
    questionText: params.questionText,
    language: normalizeIdentityText(params.language || 'en'),
    selectionMode: normalizeIdentityText(params.selectionMode || 'single'),
    ...(params.tagScope?.mySelfTag ? { mySelfTag: params.tagScope.mySelfTag } : {}),
    ...(params.tagScope?.counterpartTag ? { counterpartTag: params.tagScope.counterpartTag } : {}),
    // Choosing the contract again means "make this my first available preference." Existing
    // answers stay behind it as deterministic fallbacks (Kiwi, then Apple).
    answers: [answer, ...(existing?.answers || []).filter((candidate) => candidate.answerHash !== answerHash)],
  };
  contracts[params.questionKey] = contract;
  return contract;
}

export function removeQuestionDefault(
  contracts: QuestionDefaultContractMap,
  questionKey: string,
  answerHash: string,
): void {
  const existing = contracts[questionKey];
  if (!existing) return;
  const answers = existing.answers.filter((candidate) => candidate.answerHash !== answerHash);
  if (answers.length === 0) {
    delete contracts[questionKey];
    return;
  }
  contracts[questionKey] = { ...existing, answers };
}

/** Returns the first explicitly contracted answer that exists in the current authored options. */
export function resolveQuestionDefault(
  contracts: QuestionDefaultContractMap,
  questionKey: string,
  currentAnswers: Array<{ id?: string; text?: string }>,
): { answerId: string; answerText: string; answerHash: string } | null {
  const contract = contracts[questionKey];
  if (!contract || contract.version !== QUESTION_DEFAULT_CONTRACT_VERSION) return null;
  const available = new Map<string, { id?: string; text?: string }>();
  for (const answer of currentAnswers) {
    const hash = buildAnswerIdentityHash(String(answer?.text || ''));
    if (!available.has(hash)) available.set(hash, answer);
  }
  for (const preference of contract.answers) {
    const current = available.get(preference.answerHash);
    if (current?.id) {
      return {
        answerId: current.id,
        answerText: String(current.text || preference.answerText),
        answerHash: preference.answerHash,
      };
    }
  }
  return null;
}
