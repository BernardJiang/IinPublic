import type { Tag } from './types';

/**
 * Parses a comma / semicolon / newline separated list into {@link Tag} records
 * for the user's public interests (category `other` until catalog UX exists).
 */
export function interestsFromCommaInput(raw: string): Tag[] {
  const parts = raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 24);
  const seen = new Set<string>();
  const out: Tag[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const name = parts[i].slice(0, 80);
    if (!name) continue;
    const slugBase = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    const slug = slugBase || `n-${i}`;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      id: `int_${slug}`,
      name,
      category: 'other',
      popularity: 1,
    });
  }
  return out;
}

/**
 * Generates a random stage name in the format: UserXXXXXXXXXXXXXX
 * where X is a random alphanumeric character (0-9, a-z)
 * Total length: 4 (User) + 14 (random) = 18 characters
 */
export function generateRandomStageName(): string {
  const prefix = 'User';
  const length = 14;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let randomString = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    randomString += chars[randomIndex];
  }

  return prefix + randomString;
}

/**
 * Validates if a stage name meets the requirements
 * - Must be at least 3 characters
 * - Must be at most 50 characters
 * - Can contain letters, numbers, spaces, and basic punctuation
 */
/** Normalize question text for preference / answer keying (matches UIManager). */
export function normalizeQuestionKey(questionText: string): string {
  return questionText.trim().toLowerCase();
}

export function isValidStageName(stageName: string): boolean {
  if (!stageName || stageName.trim().length < 3) {
    return false;
  }

  if (stageName.length > 50) {
    return false;
  }

  // Allow letters, numbers, single spaces, and basic punctuation.
  // NOTE: Use a literal space rather than \s so that newlines, tabs, and other
  // whitespace control characters are rejected.
  const validPattern = /^[a-zA-Z0-9 \-_.,!?']+$/;
  return validPattern.test(stageName);
}
