/**
 * The grammar filter (spec §31.3a, D15). Keys hash exact text, so two spellings of one question
 * are two questions; this filter keeps simple punctuation and capitalisation consistent so that
 * they meet. English (`en-v1`) and Chinese (`zh-v1`) only; any other language is left exactly as
 * written. No spelling correction ("tenis" stays "tenis").
 *
 * Deterministic and offline: every device must produce the same output for the same input, or
 * keys diverge. A rule change is a new version (`en-v2`), never an edit of `en-v1`.
 *
 * - The editor replaces each question and choice with `filterText(...)` before a Talk is saved.
 * - A receiver ignores a whole Talk whose text the filter would change (`talkGrammarErrors`).
 */

export type GrammarVersion = 'en-v1' | 'zh-v1';
export type TextRole = 'question' | 'choice';

/** The rule set for a Talk's `language`, or undefined when that language has no filter. */
export function grammarVersionFor(language: string | undefined): GrammarVersion | undefined {
  const primary = String(language || '').trim().toLowerCase().split(/[-_]/)[0];
  if (primary === 'en') return 'en-v1';
  if (primary === 'zh') return 'zh-v1';
  return undefined;
}

const FULL_TO_HALF: Record<string, string> = { '？': '?', '！': '!', '，': ',', '：': ':', '；': ';', '。': '.' };
const HALF_TO_FULL: Record<string, string> = { '?': '？', '!': '！', ',': '，', ':': '：', ';': '；', '.': '。' };
const HAN = '\\p{Script=Han}';

function collapseSpaces(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function enV1(input: string, role: TextRole, endsWithQuestionMark: boolean): string {
  let text = collapseSpaces(input);
  text = text.replace(/[？！，：；。]/gu, (mark) => FULL_TO_HALF[mark]!);
  text = text.replace(/ +([?!.,:;])/gu, '$1');
  text = text.replace(/([,:;])(?=\p{L})/gu, '$1 ');
  text = text.replace(/[?!.]{2,}$/u, (run) => run[0]!);
  if (role === 'question' && endsWithQuestionMark && text) {
    text = /[.!]$/u.test(text) ? `${text.slice(0, -1)}?` : (text.endsWith('?') ? text : `${text}?`);
  }
  const firstWord = text.match(/^\S+/u)?.[0] || '';
  if (/^\p{Ll}/u.test(text) && !/\p{Lu}/u.test(firstWord.slice(1))) {
    text = text[0]!.toUpperCase() + text.slice(1);
  }
  return text;
}

function zhV1(input: string, role: TextRole, endsWithQuestionMark: boolean): string {
  let text = collapseSpaces(input);
  text = text.replace(new RegExp(`(${HAN}) +(?=${HAN})`, 'gu'), '$1');
  text = text.replace(new RegExp(`(${HAN}) *([?!,:;.])`, 'gu'), (_all, han: string, mark: string) => han + HALF_TO_FULL[mark]!);
  text = text.replace(/ *([？！，：；。]) */gu, '$1');
  text = text.replace(/[？！。]{2,}$/u, (run) => run[0]!);
  if (role === 'question' && endsWithQuestionMark && text) {
    text = /[。！?!.]$/u.test(text) ? `${text.slice(0, -1)}？` : (text.endsWith('？') ? text : `${text}？`);
  }
  return text;
}

/**
 * The corrected text. `endsWithQuestionMark: false` keeps a question's end as written: a tag
 * ("Tennis"), a Pair tag ("Buy" → "iPhone") or a built-in label is a name, not a sentence, and a
 * simple tag's answer must stay equal to its question.
 */
export function filterText(
  text: string,
  language: string | undefined,
  role: TextRole,
  options: { endsWithQuestionMark?: boolean } = {},
): string {
  const version = grammarVersionFor(language);
  const endsWithQuestionMark = options.endsWithQuestionMark ?? true;
  if (version === 'en-v1') return enV1(String(text ?? ''), role, endsWithQuestionMark);
  if (version === 'zh-v1') return zhV1(String(text ?? ''), role, endsWithQuestionMark);
  return String(text ?? '');
}

type GrammarQuestion = {
  id?: string;
  text?: string;
  answers?: Array<{ id?: string; text?: string }>;
  tagKind?: string;
  reciprocalTagContext?: boolean;
  builtIn?: unknown;
};
type GrammarTalk = { type?: string; language?: string; questions?: GrammarQuestion[] };

/** Whether a question's text is a sentence that must end with a question mark. */
export function questionNeedsQuestionMark(talk: { type?: string }, question: GrammarQuestion): boolean {
  return talk.type !== 'tag' && question.tagKind !== 'simple' && !question.reciprocalTagContext && !question.builtIn;
}

/** A copy of the Talk with every question and choice filtered (what the editor saves). */
export function applyGrammarToTalk<T extends GrammarTalk>(talk: T): T {
  if (!grammarVersionFor(talk.language)) return talk;
  return {
    ...talk,
    questions: (talk.questions || []).map((question) => ({
      ...question,
      text: filterText(question.text || '', talk.language, 'question', { endsWithQuestionMark: questionNeedsQuestionMark(talk, question) }),
      answers: (question.answers || []).map((answer) => ({ ...answer, text: filterText(answer.text || '', talk.language, 'choice') })),
    })),
  };
}

export type GrammarError = { questionId?: string | undefined; answerId?: string | undefined; text: string; corrected: string };

/** Every text the filter would change. A receiver ignores the whole Talk when this is not empty. */
export function talkGrammarErrors(talk: GrammarTalk): GrammarError[] {
  if (!grammarVersionFor(talk.language)) return [];
  const errors: GrammarError[] = [];
  for (const question of talk.questions || []) {
    const text = question.text || '';
    const corrected = filterText(text, talk.language, 'question', { endsWithQuestionMark: questionNeedsQuestionMark(talk, question) });
    if (corrected !== text) errors.push({ questionId: question.id, text, corrected });
    for (const answer of question.answers || []) {
      const answerText = answer.text || '';
      const answerCorrected = filterText(answerText, talk.language, 'choice');
      if (answerCorrected !== answerText) errors.push({ questionId: question.id, answerId: answer.id, text: answerText, corrected: answerCorrected });
    }
  }
  return errors;
}
