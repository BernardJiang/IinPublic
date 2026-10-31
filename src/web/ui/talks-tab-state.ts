import { settingsStorage } from '../services/core-storage';

/** The Talks tab's filters, sort and scroll position, kept across restarts (local only). */
export const TALKS_TAB_STATE_KEY = 'iinpublic_talks_tab_state';

export type TalksTabState = {
  showIncoming: boolean;
  showOutgoing: boolean;
  enabledTypes: string[];
  sort: 'recent' | 'oldest' | 'latest-reply' | 'matches' | 'responses' | 'match-rate' | 'weighted' | 'title';
  query: string;
  completion: 'all' | 'unanswered' | 'answered' | 'ignored';
  outcome: 'all' | 'match' | 'mismatch';
  dateFrom: string;
  dateTo: string;
  scrollTop: number;
};

export function writeTalksTabState(state: TalksTabState): void {
  try {
    settingsStorage.setItem(TALKS_TAB_STATE_KEY, JSON.stringify(state));
  } catch {
    /* local-only preference persistence is optional */
  }
}

export function readTalksTabState(): Partial<TalksTabState> | null {
  try {
    const raw = settingsStorage.getItem(TALKS_TAB_STATE_KEY);
    return raw ? JSON.parse(raw) as Partial<TalksTabState> : null;
  } catch {
    return null;
  }
}
