import { getMyTalks, setMyTalks } from './my-talks-storage';
import type { UiTranslationKey } from './ui-translations';

export type TalkBroadcastToggleDeps = {
  emit: (event: string, payload: unknown) => void;
  t: (key: UiTranslationKey) => string;
  displayTalksList: () => void;
};

/**
 * Phase F: disabling broadcast withdraws the talk from active delivery — emits `withdrawTalk`,
 * and (step 10) `retractTalk` too, since an unchecked tag is a hard retraction that must flood
 * a tombstone so offline responders learn the talk is gone. Patches any already-rendered rows
 * in place (checkbox state survives, no full list re-render) when they exist; falls back to a
 * full `displayTalksList()` re-render only when the talk isn't currently rendered.
 */
export function setTalkDisabled(talkId: string, disabled: boolean, deps: TalkBroadcastToggleDeps): void {
  const myTalks = getMyTalks();
  if (!myTalks[talkId]) return;
  myTalks[talkId].disabled = !!disabled;
  setMyTalks(myTalks);
  if (disabled) {
    deps.emit('withdrawTalk', { talkId });
    deps.emit('retractTalk', { talkId, retractedAt: Date.now() });
  }
  // Patch visible rows so checkboxes stay in DOM and keep responding (no full list re-render)
  const talksList = document.getElementById('talks-list');
  const rows = talksList?.querySelectorAll(`.talk-list-item[data-talk-id="${talkId}"]`);
  if (rows && rows.length > 0) {
    rows.forEach((row) => {
      const item = row as HTMLElement;
      item.classList.toggle('talk-broadcast-disabled', !!disabled);
      item.classList.toggle('talk-broadcast-enabled', !disabled);
      const checkbox = row.querySelector('.talk-broadcast-toggle-checkbox') as HTMLInputElement | null;
      if (checkbox) checkbox.checked = !disabled;
      const badge = checkbox?.closest('.talk-icon-badge') as HTMLElement | null;
      if (badge) badge.title = disabled ? deps.t('talksBroadcastOff') : deps.t('talksBroadcastOn');
    });
  } else {
    deps.displayTalksList();
  }
}
