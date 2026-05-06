import {
  generateRandomStageName,
  interestsFromCommaInput,
  isValidStageName,
  normalizeQuestionKey,
} from '../../shared/user-utils';

describe('normalizeQuestionKey', () => {
  it('trims and lowercases for preference keys', () => {
    expect(normalizeQuestionKey('  Hello World  ')).toBe('hello world');
  });
});

describe('interestsFromCommaInput', () => {
  it('parses comma and semicolon separated tokens into Tag records', () => {
    const tags = interestsFromCommaInput('Coffee, Tennis; Hiking');
    expect(tags).toHaveLength(3);
    expect(tags[0]).toMatchObject({ name: 'Coffee', category: 'other', popularity: 1 });
    expect(tags[0].id).toMatch(/^int_/);
    expect(tags[1].name).toBe('Tennis');
    expect(tags[2].name).toBe('Hiking');
  });

  it('dedupes by slug and returns empty for blank input', () => {
    expect(interestsFromCommaInput('a, a , A')).toHaveLength(1);
    expect(interestsFromCommaInput('  \n  ')).toEqual([]);
  });
});

describe('generateRandomStageName', () => {
  it('returns a string starting with "User"', () => {
    expect(generateRandomStageName()).toMatch(/^User/);
  });

  it('returns exactly 18 characters (4 prefix + 14 random)', () => {
    expect(generateRandomStageName()).toHaveLength(18);
  });

  it('uses only lowercase alphanumeric characters in the random portion', () => {
    // Run multiple times to reduce flakiness from randomness
    for (let i = 0; i < 50; i++) {
      const name = generateRandomStageName();
      expect(name).toMatch(/^User[a-z0-9]{14}$/);
    }
  });

  it('produces unique names across many calls', () => {
    const names = new Set(Array.from({ length: 1000 }, () => generateRandomStageName()));
    // With 36^14 ≈ 4.7e21 possibilities, collisions in 1000 samples are astronomically unlikely
    expect(names.size).toBe(1000);
  });
});

describe('isValidStageName', () => {
  describe('valid names', () => {
    it('accepts a simple alphabetic name', () => {
      expect(isValidStageName('Alice')).toBe(true);
    });

    it('accepts a name with numbers', () => {
      expect(isValidStageName('User123')).toBe(true);
    });

    it('accepts a name with spaces', () => {
      expect(isValidStageName('Tom Jerry')).toBe(true);
    });

    it('accepts a name with allowed punctuation (hyphen, underscore, dot, comma, exclamation, question, apostrophe)', () => {
      expect(isValidStageName("Tom-Jerry")).toBe(true);
      expect(isValidStageName("Tom_Jerry")).toBe(true);
      expect(isValidStageName("Tom.Jerry")).toBe(true);
      expect(isValidStageName("Tom,Jerry")).toBe(true);
      expect(isValidStageName("Tom!")).toBe(true);
      expect(isValidStageName("Tom?")).toBe(true);
      expect(isValidStageName("Tom's")).toBe(true);
    });

    it('accepts exactly 3 characters (minimum length)', () => {
      expect(isValidStageName('abc')).toBe(true);
    });

    it('accepts exactly 50 characters (maximum length)', () => {
      expect(isValidStageName('a'.repeat(50))).toBe(true);
    });

    it('accepts mixed-case names', () => {
      expect(isValidStageName('TomJerry')).toBe(true);
    });
  });

  describe('invalid names', () => {
    it('rejects an empty string', () => {
      expect(isValidStageName('')).toBe(false);
    });

    it('rejects a name with fewer than 3 non-whitespace chars (whitespace-only)', () => {
      expect(isValidStageName('  ')).toBe(false);
    });

    it('rejects a 2-character name', () => {
      expect(isValidStageName('ab')).toBe(false);
    });

    it('rejects a name longer than 50 characters', () => {
      expect(isValidStageName('a'.repeat(51))).toBe(false);
    });

    it('rejects names with special characters outside the allowed set', () => {
      expect(isValidStageName('Tom@Jerry')).toBe(false);  // @
      expect(isValidStageName('Tom#Jerry')).toBe(false);  // #
      expect(isValidStageName('Tom$Jerry')).toBe(false);  // $
      expect(isValidStageName('<script>')).toBe(false);   // HTML angle brackets
      expect(isValidStageName('Tom\nJerry')).toBe(false); // newline
    });

    it('rejects null / undefined inputs gracefully', () => {
      expect(isValidStageName(null as unknown as string)).toBe(false);
      expect(isValidStageName(undefined as unknown as string)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('trims whitespace before checking minimum length', () => {
      // "  a  " trimmed is 1 char → too short
      expect(isValidStageName('  a  ')).toBe(false);
    });

    it('accepts name with leading/trailing spaces if content is long enough and valid', () => {
      // "  abc  " trimmed is 3 chars — passes length; pattern includes spaces so the full string is valid
      expect(isValidStageName('  abc  ')).toBe(true);
    });
  });
});
