import type { UiTranslationKey } from './ui-translations';
import type { CohortTraversalSnapshot } from './cohort-traversal-view-model';

const STATUS_TEXT: Record<Exclude<CohortTraversalSnapshot['status'], 'ready'>, UiTranslationKey> = {
  visiting: 'chatroomCohortVisiting',
  returning: 'chatroomCohortReturning',
  full: 'chatroomCohortFull',
  offline: 'chatroomCohortOffline',
  error: 'chatroomCohortError',
};

/**
 * One status line under the current Nearby room, only while a group switch is pending, failed, or
 * you are visiting another group (🏠 Home returns). Other groups are rows in the room list.
 */
export function cohortStatusLine(
  snapshot: CohortTraversalSnapshot,
  text: (key: UiTranslationKey) => string,
): string {
  if (snapshot.status !== 'ready') return text(STATUS_TEXT[snapshot.status]);
  if (!snapshot.isDefaultGroup) return `${text('chatroomCohortVisitingReady')} ${text('chatroomCohortHomeHint')}`;
  // Other groups of this area are ordinary rows in the room list; nothing extra to say here.
  return '';
}
