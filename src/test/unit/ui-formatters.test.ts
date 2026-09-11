import {
  formatTimeAgo,
  formatExpiration,
  formatLocationRadius,
  escapeHtml,
  tagAnswerSuffix,
} from '../../web/ui/ui-formatters';

describe('formatTimeAgo', () => {
  const at = (msAgo: number) => new Date(Date.now() - msAgo);

  it('returns Just now for sub-minute', () => {
    expect(formatTimeAgo(at(30_000))).toBe('Just now');
  });

  it('returns minutes for <1h', () => {
    expect(formatTimeAgo(at(5 * 60_000))).toBe('5m ago');
  });

  it('returns hours for <24h', () => {
    expect(formatTimeAgo(at(3 * 3_600_000))).toBe('3h ago');
  });

  it('returns days for <7d', () => {
    expect(formatTimeAgo(at(2 * 86_400_000))).toBe('2d ago');
  });

  it('returns locale date string for >=7d', () => {
    const d = at(10 * 86_400_000);
    expect(formatTimeAgo(d)).toBe(d.toLocaleDateString());
  });
});

describe('formatExpiration', () => {
  const now = Date.UTC(2026, 4, 25, 12);
  const future = (ms: number) => Date.now() + ms;
  const oneDay = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns Forever for null', () => {
    expect(formatExpiration(null)).toBe('Forever');
  });

  it('returns Forever for undefined', () => {
    expect(formatExpiration(undefined)).toBe('Forever');
  });

  it('returns Expired for past timestamp', () => {
    expect(formatExpiration(Date.now() - 1000)).toBe('Expired');
  });

  it('returns <1d for <=1 day remaining', () => {
    expect(formatExpiration(future(oneDay - 1000))).toBe('Expires in &lt;1d');
  });

  it('returns days for <=7 days', () => {
    expect(formatExpiration(future(3 * oneDay))).toBe('Expires in 3d');
  });

  it('returns weeks for <=30 days', () => {
    expect(formatExpiration(future(14 * oneDay))).toBe('Expires in 2w');
  });

  it('returns months for <=365 days', () => {
    expect(formatExpiration(future(60 * oneDay))).toBe('Expires in 2mo');
  });

  it('returns years for >365 days', () => {
    expect(formatExpiration(future(730 * oneDay))).toBe('Expires in 2y');
  });
});

describe('formatLocationRadius', () => {
  it('returns Anywhere for null', () => {
    expect(formatLocationRadius(null)).toBe('Anywhere');
  });

  it('returns Anywhere for undefined', () => {
    expect(formatLocationRadius(undefined)).toBe('Anywhere');
  });

  it('returns miles string', () => {
    expect(formatLocationRadius(25)).toBe('25 mi');
  });
});

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes less-than', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes double quote', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quote', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('handles combined special characters', () => {
    expect(escapeHtml('<b class="x">A&B</b>')).toBe(
      '&lt;b class=&quot;x&quot;&gt;A&amp;B&lt;/b&gt;',
    );
  });
});

describe('tagAnswerSuffix', () => {
  it('returns empty for a talk with no questions', () => {
    expect(tagAnswerSuffix({ title: 'Buy a bike' })).toBe('');
  });

  describe('Pair-tag root (reciprocalTagContext)', () => {
    it('returns empty when the single declared answer equals the root question text', () => {
      const talk = {
        questions: [
          {
            text: 'sell',
            reciprocalTagContext: true,
            answers: [{ text: 'sell', isMatch: true }],
          },
        ],
      };
      expect(tagAnswerSuffix(talk)).toBe('');
    });

    it('renders a "?answer" suffix when the declared answer differs from the keyword', () => {
      const talk = {
        title: 'Buy a bike',
        questions: [
          {
            text: 'Buy a bike',
            reciprocalTagContext: true,
            answers: [{ text: 'sell', isMatch: true }],
          },
        ],
      };
      expect(tagAnswerSuffix(talk)).toBe(
        '<span class="talk-tag-answer-suffix" style="color:var(--text-tertiary);font-weight:400;margin-left:2px;">?sell</span>',
      );
    });

    it('escapes hostile answer text', () => {
      const talk = {
        title: 'Buy a bike',
        questions: [
          {
            text: 'Buy a bike',
            reciprocalTagContext: true,
            answers: [{ text: '<script>evil</script>', isMatch: true }],
          },
        ],
      };
      expect(tagAnswerSuffix(talk)).toContain('&lt;script&gt;evil&lt;/script&gt;');
      expect(tagAnswerSuffix(talk)).not.toContain('<script>evil</script>');
    });

    it('falls through to the ordinary isMatch-answer path when there is more than one non-ignore answer', () => {
      const talk = {
        title: 'keyword',
        questions: [
          {
            text: 'keyword',
            reciprocalTagContext: true,
            answers: [
              { text: 'sell', isMatch: true },
              { text: 'trade', isMatch: false },
            ],
          },
        ],
      };
      // singleNonIgnoreAnswer returns undefined for >1 non-ignore answers, so the
      // reciprocal-tag branch is skipped; the fallback path's matchAnswerText ('sell')
      // differs from the talk's own title ('keyword'), so a suffix still renders.
      expect(tagAnswerSuffix(talk)).toContain('?sell');
    });
  });

  describe('ordinary (non-reciprocal) tag', () => {
    it('returns empty when the matched answer equals the talk title', () => {
      const talk = {
        title: 'Coffee',
        questions: [{ text: 'Coffee', answers: [{ text: 'Coffee', isMatch: true }] }],
      };
      expect(tagAnswerSuffix(talk)).toBe('');
    });

    it('renders a suffix when the matched answer differs from the talk title', () => {
      const talk = {
        title: 'Coffee',
        questions: [{ text: 'Coffee', answers: [{ text: 'Espresso', isMatch: true }] }],
      };
      expect(tagAnswerSuffix(talk)).toContain('?Espresso');
    });

    it('reads from fullTalk when the talk itself has no questions/title', () => {
      const talk = {
        fullTalk: {
          title: 'Coffee',
          questions: [{ text: 'Coffee', answers: [{ text: 'Espresso', isMatch: true }] }],
        },
      };
      expect(tagAnswerSuffix(talk)).toContain('?Espresso');
    });

    it('returns empty when there is no matched answer', () => {
      const talk = { title: 'Coffee', questions: [{ text: 'Coffee', answers: [{ text: 'Tea', isMatch: false }] }] };
      expect(tagAnswerSuffix(talk)).toBe('');
    });
  });
});
