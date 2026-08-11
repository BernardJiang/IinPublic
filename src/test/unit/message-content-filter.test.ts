import { ContentFilter } from '../../shared/reputation';
import {
  filterOutgoingMessage,
  filterIncomingMessage,
  assessMessageContent,
} from '../../shared/message-content-filter';
import {
  DEFAULT_DIRTY_WORDS,
  normalizeDirtyWords,
  getDefaultTalkIntakeFilters,
} from '../../shared/talk-intake-filters';
import type { TalkIntakeFilters } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';

type MsgFilters = Pick<TalkIntakeFilters, 'blockDirtyWords' | 'requireGoodGrammar' | 'dirtyWords'>;

const dirtyOnly = (dirtyWords: string[] = [...DEFAULT_DIRTY_WORDS]): MsgFilters => ({
  blockDirtyWords: true,
  requireGoodGrammar: false,
  dirtyWords,
});

describe('ContentFilter.findDirtyWord (merge + tokenizer + casefold)', () => {
  it('merges the custom list with the built-in blocked words', () => {
    // "spam" is a built-in; "banana" is custom-only.
    expect(ContentFilter.findDirtyWord('this is spam', [])).toBe('spam');
    expect(ContentFilter.findDirtyWord('a ripe banana', [])).toBeNull();
    expect(ContentFilter.findDirtyWord('a ripe banana', ['banana'])).toBe('banana');
  });

  it('matches whole words only — "cocktail" does not trip "cock"', () => {
    expect(ContentFilter.findDirtyWord('cock', ['cock'])).toBe('cock');
    expect(ContentFilter.findDirtyWord('a fine cocktail', ['cock'])).toBeNull();
    expect(ContentFilter.findDirtyWord('classic', ['ass'])).toBeNull();
  });

  it('NFKC casefolds before matching (fullwidth + uppercase)', () => {
    expect(ContentFilter.findDirtyWord('FUCK you', [...DEFAULT_DIRTY_WORDS])).toBe('fuck');
    // Fullwidth latin letters normalize to ASCII under NFKC.
    expect(ContentFilter.findDirtyWord('ｆｕｃｋ', [...DEFAULT_DIRTY_WORDS])).toBe('fuck');
  });

  it('falls back to substring matching only for multi-token custom terms', () => {
    expect(ContentFilter.findDirtyWord('want some free money now', ['free money'])).toBe('free money');
    // single-token custom terms stay whole-word
    expect(ContentFilter.findDirtyWord('reoffer', ['offer'])).toBeNull();
  });
});

describe('normalizeDirtyWords', () => {
  it('lowercases, dedupes, drops <2 chars, and caps at 50', () => {
    const raw = ['FUCK', 'fuck', 'a', 'ok', ...Array.from({ length: 60 }, (_, i) => `word${i}`)];
    const out = normalizeDirtyWords(raw);
    expect(out).toHaveLength(50);
    expect(out.filter((w) => w === 'fuck')).toHaveLength(1);
    expect(out).not.toContain('a');
    expect(out).toContain('ok');
  });

  it('returns [] for non-arrays', () => {
    expect(normalizeDirtyWords(undefined)).toEqual([]);
    expect(normalizeDirtyWords('fuck')).toEqual([]);
  });
});

describe('getDefaultTalkIntakeFilters seeds the dirty-word list', () => {
  it('includes the four defaults', () => {
    expect(getDefaultTalkIntakeFilters().dirtyWords).toEqual(['fuck', 'cunt', 'bitch', 'cock']);
  });
});

describe('filterOutgoingMessage / filterIncomingMessage', () => {
  it('blocks a message containing a default dirty word and reports it', () => {
    const r = filterOutgoingMessage('you fuck', dirtyOnly());
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('dirty_words');
    expect(r.word).toBe('fuck');
  });

  it('passes a clean message', () => {
    expect(filterOutgoingMessage('have a nice day', dirtyOnly()).passed).toBe(true);
  });

  it('"cocktail" passes even with cock in the list', () => {
    expect(filterOutgoingMessage('lets get a cocktail', dirtyOnly()).passed).toBe(true);
  });

  it('empty list + enabled = built-ins only', () => {
    expect(filterOutgoingMessage('this is spam', dirtyOnly([])).passed).toBe(false);
    expect(filterOutgoingMessage('you fuck', dirtyOnly([])).passed).toBe(false); // fuck is a built-in too
  });

  it('disabled filter performs no check', () => {
    const off: MsgFilters = { blockDirtyWords: false, requireGoodGrammar: false, dirtyWords: [...DEFAULT_DIRTY_WORDS] };
    expect(filterOutgoingMessage('you fuck', off).passed).toBe(true);
  });

  it('receive path uses the same logic as send', () => {
    const f = dirtyOnly();
    expect(filterIncomingMessage('you fuck', f)).toEqual(filterOutgoingMessage('you fuck', f));
  });

  it('empty/whitespace text always passes', () => {
    expect(filterOutgoingMessage('   ', dirtyOnly()).passed).toBe(true);
    expect(filterOutgoingMessage('', dirtyOnly()).passed).toBe(true);
  });

  it('grammar filter blocks below-threshold text and reports grammar', () => {
    const grammarOnly: MsgFilters = {
      blockDirtyWords: false,
      requireGoodGrammar: true,
      dirtyWords: [],
    };
    // Five heavily-repetitive sentences each dock the grammar score, landing below 0.7.
    const bad = 'aa aa aa aa aa aa. aa aa aa aa aa aa. aa aa aa aa aa aa. aa aa aa aa aa aa. aa aa aa aa aa aa.';
    const r = filterOutgoingMessage(bad, grammarOnly);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('grammar');
  });

  it('reports dirty word before grammar when both fail', () => {
    const both: MsgFilters = { blockDirtyWords: true, requireGoodGrammar: true, dirtyWords: [...DEFAULT_DIRTY_WORDS] };
    const r = assessMessageContent('fuck fuck fuck fuck fuck fuck fuck fuck fuck fuck', both);
    expect(r.reason).toBe('dirty_words');
  });

  it('null filters pass', () => {
    expect(assessMessageContent('you fuck', null).passed).toBe(true);
  });
});

describe('financial-data check (FR-FIN-1 – FR-FIN-5)', () => {
  it('blocks a card number even with all other filters disabled/absent', () => {
    const r = assessMessageContent('here is my card 4111 1111 1111 1111', null);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('financial_data');
  });

  it('is non-configurable — fires regardless of the filters argument', () => {
    const off: MsgFilters = { blockDirtyWords: false, requireGoodGrammar: false, dirtyWords: [] };
    expect(assessMessageContent('4111111111111111', off).reason).toBe('financial_data');
    expect(assessMessageContent('4111111111111111', undefined).reason).toBe('financial_data');
  });

  it('is checked before dirty words/grammar', () => {
    const both: MsgFilters = { blockDirtyWords: true, requireGoodGrammar: true, dirtyWords: [...DEFAULT_DIRTY_WORDS] };
    const r = assessMessageContent('fuck you, card is 4111 1111 1111 1111', both);
    expect(r.reason).toBe('financial_data');
  });

  it('ordinary talk text with no financial data still reaches the dirty-word/grammar checks', () => {
    const r = assessMessageContent('you fuck', dirtyOnly());
    expect(r.reason).toBe('dirty_words');
  });

  it('outgoing and incoming paths both block financial data for an ordinary sender', () => {
    expect(filterOutgoingMessage('4111 1111 1111 1111', dirtyOnly()).reason).toBe('financial_data');
    expect(filterIncomingMessage('4111 1111 1111 1111', dirtyOnly(), { senderId: 'someone' }).reason).toBe(
      'financial_data',
    );
  });

  it("TechSupport's dirty-word/grammar exemption does NOT extend to financial data (FR-FIN-5)", () => {
    const r = filterIncomingMessage('card 4111 1111 1111 1111', dirtyOnly(), { senderId: TECHSUPPORT_ROOT_USER_ID });
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('financial_data');
  });

  it("TechSupport is still exempt from dirty words once financial data isn't present", () => {
    const r = filterIncomingMessage('you fuck', dirtyOnly(), { senderId: TECHSUPPORT_ROOT_USER_ID });
    expect(r.passed).toBe(true);
  });
});
