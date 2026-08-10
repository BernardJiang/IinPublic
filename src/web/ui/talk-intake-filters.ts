import type { TalkIntakeFilters } from '../../shared/types';
import { getDefaultTalkIntakeFilters, normalizeCustomBlockedTerms, normalizeDirtyWords, DEFAULT_DIRTY_WORDS } from '../../shared/talk-intake-filters';
export {
  type IncomingTalkFilterSubject as IncomingTalkCluster,
  filterIncomingTalkClusters,
  talkPassesIntakeFilters,
  intakeFilterRejectReasons,
} from '../../shared/talk-intake-filters';

const TALK_FILTERS_KEY = 'iinpublic_talk_intake_filters';
const TALK_FILTERS_OWNER_KEY = 'iinpublic_talk_intake_filters_owner';

export function getTalkIntakeFilters(): TalkIntakeFilters {
  try {
    const raw = localStorage.getItem(TALK_FILTERS_KEY);
    if (!raw) return getDefaultTalkIntakeFilters();
    const parsed = JSON.parse(raw) as Partial<TalkIntakeFilters>;
    return {
      ...getDefaultTalkIntakeFilters(),
      ...parsed,
      allowedLanguages: Array.isArray(parsed.allowedLanguages) && parsed.allowedLanguages.length > 0
        ? parsed.allowedLanguages
        : ['en'],
      allowedTalkTypes: Array.isArray(parsed.allowedTalkTypes) && parsed.allowedTalkTypes.length > 0
        ? parsed.allowedTalkTypes
        : ['flow', 'survey', 'tag', 'route'],
      customBlockedTerms: normalizeCustomBlockedTerms(parsed.customBlockedTerms ?? []),
      dirtyWords: parsed.dirtyWords === undefined
        ? [...DEFAULT_DIRTY_WORDS]
        : normalizeDirtyWords(parsed.dirtyWords),
    };
  } catch {
    return getDefaultTalkIntakeFilters();
  }
}

export function setTalkIntakeFilters(filters: TalkIntakeFilters): void {
  localStorage.setItem(TALK_FILTERS_KEY, JSON.stringify(filters));
}

/** Whether this device has persisted intake filters (i.e. getTalkIntakeFilters() would not just return defaults). */
export function hasStoredTalkIntakeFilters(): boolean {
  try {
    return localStorage.getItem(TALK_FILTERS_KEY) != null;
  } catch {
    return false;
  }
}

/**
 * Which user id the persisted filters were last saved for. Used to tell a genuine same-user
 * reload (where localStorage is authoritative — see setTalkIntakeFiltersOwner's doc comment)
 * apart from a stored value that belongs to a different identity than the one being rendered
 * now (a fresh/returning user on a device that previously held someone else's session, or an
 * identity swap mid-session) — in the latter case the stored filters must not be applied.
 */
export function getTalkIntakeFiltersOwner(): string | null {
  try {
    return localStorage.getItem(TALK_FILTERS_OWNER_KEY);
  } catch {
    return null;
  }
}

/** Tag the persisted filters with the user id they belong to; call whenever filters are saved for a known user. */
export function setTalkIntakeFiltersOwner(userId: string): void {
  try {
    localStorage.setItem(TALK_FILTERS_OWNER_KEY, userId);
  } catch {
    /* best-effort */
  }
}
