/** The public profile fields both the Contacts and the person views read from a profile foundation. */

export function parsePublicProfileArray<T>(value: string | undefined, fallback: T[]): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

export function publicProfileFromFoundation(foundation: {
  headshot?: string | null | undefined;
  languagesJson?: string | undefined;
  profileJson?: string | undefined;
  interestsJson?: string | undefined;
}): { headshot: string; languages: string[]; profile: any[]; interests: any[] } {
  return {
    headshot: foundation.headshot || '',
    languages: parsePublicProfileArray<string>(foundation.languagesJson, []),
    profile: parsePublicProfileArray<any>(foundation.profileJson, []),
    interests: parsePublicProfileArray<any>(foundation.interestsJson, []),
  };
}
