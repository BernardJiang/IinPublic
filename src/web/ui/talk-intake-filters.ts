import type { TalkIntakeFilters } from '../../shared/types';
import { getDefaultTalkIntakeFilters, normalizeCustomBlockedTerms } from '../../shared/talk-intake-filters';
export {
  type IncomingTalkFilterSubject as IncomingTalkCluster,
  filterIncomingTalkClusters,
  talkPassesIntakeFilters,
  intakeFilterRejectReasons,
} from '../../shared/talk-intake-filters';

const TALK_FILTERS_KEY = 'iinpublic_talk_intake_filters';

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
    };
  } catch {
    return getDefaultTalkIntakeFilters();
  }
}

export function setTalkIntakeFilters(filters: TalkIntakeFilters): void {
  localStorage.setItem(TALK_FILTERS_KEY, JSON.stringify(filters));
}
