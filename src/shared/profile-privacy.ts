import type { ProfileAttributeVisibility, QuestionAnswer } from './types';

export const PROFILE_VISIBILITY_LABELS: Record<ProfileAttributeVisibility, string> = {
  public: 'Everyone',
  contacts_only: 'Contacts only',
  private: 'Just me',
};

export function normalizeProfileAttributeVisibility(v: unknown): ProfileAttributeVisibility {
  if (v === 'public' || v === 'contacts_only' || v === 'private') return v;
  return 'public';
}

/**
 * Strips profile Q&A rows the viewer is not allowed to see.
 * - public: anyone
 * - contacts_only: verified viewer is in the owner's known-people list (internal compatibility only)
 * - private: owner only (handled by skipping this filter for an authenticated owner)
 * The public HTTP route always uses the stranger view until authenticated sharing exists.
 */
export function filterProfileAttributesForViewer(
  profile: QuestionAnswer[],
  opts: { viewerIsContact: boolean },
): QuestionAnswer[] {
  return profile.filter((qa) => {
    const vis = normalizeProfileAttributeVisibility(qa.visibility);
    if (vis === 'private') return false;
    if (vis === 'contacts_only') return opts.viewerIsContact;
    return true;
  });
}
