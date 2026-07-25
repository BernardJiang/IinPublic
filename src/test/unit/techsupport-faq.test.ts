import {
  buildSupportFaqEntry,
  isAnswerableSupportQuestion,
  lookupSupportAnswer,
  normalizeSupportQuestion,
  supportAutoAnswerMessageId,
  supportHumanAnswerMessageId,
  supportQuestionKey,
  upsertSupportFaqEntry,
  type SupportFaqEntry,
} from '../../shared/techsupport-faq';
import { acceptsIncomingTalks, TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';

/** docs/TODO.md K5 — TechSupport ignores talks; answers known questions, queues new ones. */

describe('acceptsIncomingTalks (K5: TechSupport ignores all talks)', () => {
  it('refuses talks for the TechSupport root', () => {
    expect(acceptsIncomingTalks(TECHSUPPORT_ROOT_USER_ID)).toBe(false);
  });

  it('allows talks for ordinary users', () => {
    expect(acceptsIncomingTalks('user-123')).toBe(true);
  });
});

describe('normalizeSupportQuestion', () => {
  it('collapses case, whitespace, and trailing punctuation to one form', () => {
    const forms = [
      'How do I log in?',
      'how do i log in',
      '  HOW   DO  I   LOG IN???  ',
      'How do I log in!!!',
      'How do I log in.',
    ];
    const normalized = forms.map(normalizeSupportQuestion);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('how do i log in');
  });

  it('keeps internal punctuation that carries meaning', () => {
    expect(normalizeSupportQuestion('what is a talk? and a route?')).toBe(
      'what is a talk? and a route',
    );
  });

  it('handles Chinese questions and their full-width punctuation', () => {
    expect(normalizeSupportQuestion('怎么登录？')).toBe('怎么登录');
    expect(supportQuestionKey('怎么登录？')).toBe(supportQuestionKey('怎么登录'));
  });

  it('returns empty for input carrying no question', () => {
    expect(normalizeSupportQuestion('')).toBe('');
    expect(normalizeSupportQuestion('   ')).toBe('');
    expect(normalizeSupportQuestion('???')).toBe('');
    expect(normalizeSupportQuestion(null)).toBe('');
  });
});

describe('supportQuestionKey', () => {
  it('is stable across equivalent phrasings', () => {
    expect(supportQuestionKey('How do I log in?')).toBe(supportQuestionKey('how do i log in'));
  });

  it('differs for different questions', () => {
    expect(supportQuestionKey('how do i log in')).not.toBe(supportQuestionKey('how do i log out'));
  });

  it('returns empty for an unanswerable question rather than a collidable key', () => {
    expect(supportQuestionKey('   ')).toBe('');
    expect(supportQuestionKey('???')).toBe('');
  });

  it('agrees with isAnswerableSupportQuestion', () => {
    expect(isAnswerableSupportQuestion('hi?')).toBe(true);
    expect(isAnswerableSupportQuestion('  ')).toBe(false);
  });
});

describe('lookupSupportAnswer', () => {
  const entry: SupportFaqEntry = {
    questionKey: supportQuestionKey('how do i log in'),
    canonicalQuestion: 'how do i log in',
    answer: 'Open the app; your device identity signs you in automatically.',
    answeredAt: '2026-07-25T00:00:00.000Z',
  };

  it('auto-answers a previously answered question, regardless of phrasing', () => {
    const result = lookupSupportAnswer('HOW DO I LOG IN???', [entry]);
    expect(result.status).toBe('known');
    if (result.status === 'known') expect(result.entry.answer).toBe(entry.answer);
  });

  it('works from a Map bundle as well as an iterable', () => {
    const map = new Map([[entry.questionKey, entry]]);
    expect(lookupSupportAnswer('how do i log in', map).status).toBe('known');
  });

  it('reports a new question with a usable key for the inbox', () => {
    const result = lookupSupportAnswer('how do i delete my account', [entry]);
    expect(result.status).toBe('new');
    if (result.status === 'new') expect(result.questionKey).toBeTruthy();
  });

  it('treats an empty FAQ as all-new', () => {
    expect(lookupSupportAnswer('anything at all', undefined).status).toBe('new');
    expect(lookupSupportAnswer('anything at all', []).status).toBe('new');
  });

  it('does not queue an inbox entry for a message carrying no question', () => {
    expect(lookupSupportAnswer('   ', [entry]).status).toBe('unanswerable');
    expect(lookupSupportAnswer('!!!', [entry]).status).toBe('unanswerable');
  });
});

describe('buildSupportFaqEntry / upsertSupportFaqEntry', () => {
  it('promotes an answer so the next asker is auto-answered', () => {
    const built = buildSupportFaqEntry({
      question: 'How do I delete my account?',
      answer: 'Settings → Erase this device.',
      answeredAt: '2026-07-25T12:00:00.000Z',
    });
    expect(built).not.toBeNull();
    const bundle = upsertSupportFaqEntry([], built!);
    const result = lookupSupportAnswer('how do i delete my account', bundle);
    expect(result.status).toBe('known');
  });

  it('rejects an empty question or empty answer', () => {
    expect(buildSupportFaqEntry({ question: '  ', answer: 'x' })).toBeNull();
    expect(buildSupportFaqEntry({ question: 'real question', answer: '   ' })).toBeNull();
  });

  it('replaces rather than duplicates an existing answer', () => {
    const first = buildSupportFaqEntry({ question: 'q?', answer: 'old' })!;
    const second = buildSupportFaqEntry({ question: 'Q!', answer: 'new' })!;
    const bundle = upsertSupportFaqEntry(upsertSupportFaqEntry([], first), second);
    expect(bundle).toHaveLength(1);
    expect(bundle[0].answer).toBe('new');
  });

  it('does not mutate the input bundle', () => {
    const original: SupportFaqEntry[] = [];
    upsertSupportFaqEntry(original, buildSupportFaqEntry({ question: 'q?', answer: 'a' })!);
    expect(original).toHaveLength(0);
  });
});

describe('deterministic message ids', () => {
  it('are stable for the same input, so a replay is idempotent', () => {
    expect(supportAutoAnswerMessageId('msg-1')).toBe('support_auto_msg-1');
    expect(supportHumanAnswerMessageId('abcd1234')).toBe('support_answer_abcd1234');
  });
});
