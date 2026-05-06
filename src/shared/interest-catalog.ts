import type { TagCategory } from './types';

/** Stable order for profile-editor dropdowns. */
export const INTEREST_CATEGORY_SELECT_ORDER: TagCategory[] = [
  'community',
  'discussion',
  'personals',
  'jobs',
  'gigs',
  'resumes',
  'for-sale',
  'housing',
  'services',
  'other',
];

/** Short labels for the Me-tab interest category dropdown. */
export const INTEREST_CATEGORY_LABELS: Record<TagCategory, string> = {
  'for-sale': 'For sale',
  housing: 'Housing',
  services: 'Services',
  community: 'Community',
  personals: 'Personals',
  jobs: 'Jobs',
  gigs: 'Gigs',
  resumes: 'Resumes',
  discussion: 'Discussion',
  other: 'Other',
};

/**
 * Curated interest strings → category for nicer tags than a flat "other" list.
 * Matching is case-insensitive exact on the trimmed token.
 */
export const INTEREST_SUGGESTIONS_BY_CATEGORY: Readonly<Partial<Record<TagCategory, readonly string[]>>> = {
  community: ['Hiking', 'Book club', 'Volunteering', 'Cycling', 'Running', 'Photography', 'Music'],
  discussion: ['Politics', 'Philosophy', 'Science', 'Tech', 'Climate', 'Sports talk'],
  personals: ['Networking', 'Language exchange', 'New in town'],
  jobs: ['Hiring', 'Career advice', 'Mentorship'],
  gigs: ['Freelance', 'Side projects', 'Creative collab'],
  resumes: ['Open to work', 'Internships'],
  'for-sale': ['Vintage', 'Electronics', 'Furniture'],
  housing: ['Roommate', 'Sublet', 'House hunting'],
  services: ['Tutoring', 'Repairs', 'Design help'],
};

export function categoryForInterestToken(name: string, defaultCategory: TagCategory): TagCategory {
  const key = name.trim().toLowerCase();
  if (!key) return defaultCategory;
  const entries = Object.entries(INTEREST_SUGGESTIONS_BY_CATEGORY) as Array<[TagCategory, readonly string[]]>;
  for (const [cat, names] of entries) {
    if (names.some((n) => n.toLowerCase() === key)) return cat;
  }
  return defaultCategory;
}
