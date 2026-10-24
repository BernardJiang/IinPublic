import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

/**
 * The group bar above the people on the room screen, for Nearby and Places alike (§3.7 "Meeting new
 * people in groups"): which group of my order I am meeting, "Meet new people" (swap the whole
 * group for the next one immediately) and, past group 1, "Back to group 1".
 */
export type NearbyGroupBarState = {
  group: number;
  exhausted: boolean;
  /** People in the group now (without me). */
  people: number;
  place: boolean;
};

export type NearbyGroupBarDeps = {
  text: (key: UiTranslationKey) => string;
  emit: (event: string, data?: unknown) => void;
};

/** The deps of the latest sync: the bar outlives renders, so its one listener must not keep old ones. */
const latestDeps = new WeakMap<HTMLElement, NearbyGroupBarDeps>();

export function syncNearbyGroupBar(
  deps: NearbyGroupBarDeps,
  membersList: HTMLElement,
  state: NearbyGroupBarState | null,
): void {
  let bar = document.getElementById('nearby-group-bar');
  // Nothing to switch from: no group yet, or group 1 with nobody in it.
  if (!state || (state.group === 1 && state.people === 0)) {
    bar?.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'nearby-group-bar';
    bar.className = 'nearby-group-bar';
    bar.setAttribute('data-testid', 'nearby-group-bar');
    bar.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-group-action]')?.dataset.groupAction;
      const current = latestDeps.get(bar!);
      if (!current) return;
      if (action === 'back') current.emit('nearbyBackToFirstGroup');
      if (action === 'meet') current.emit('nearbyMeetNewPeople');
    });
  }
  // The list and room-detail views share one bar. Move it to the currently rendered people list
  // instead of leaving it inside a hidden view after navigation.
  if (bar.nextElementSibling !== membersList) membersList.insertAdjacentElement('beforebegin', bar);
  latestDeps.set(bar, deps);
  bar.dataset.group = String(state.group);
  bar.dataset.people = String(state.people);
  bar.dataset.place = String(state.place);
  bar.dataset.exhausted = String(state.exhausted);
  const title = state.group === 1
    ? deps.text(state.place ? 'placeGroupFirst' : 'nearbyGroupFirst')
    : deps.text(state.place ? 'placeGroupNext' : 'nearbyGroupNext').replace('{group}', String(state.group));
  const note = state.people > 0
    ? ''
    : deps.text(state.exhausted ? 'nearbyGroupExhausted' : 'nearbyGroupSearching');
  bar.innerHTML = `
    <div class="nearby-group-text">
      <div class="nearby-group-title" data-testid="nearby-group-title">${escapeHtml(title)}</div>
      ${note ? `<div class="nearby-group-note" data-testid="nearby-group-note">${escapeHtml(note)}</div>` : ''}
    </div>
    <div class="nearby-group-actions">
      ${state.people > 0 ? `<button type="button" class="btn primary-btn" data-group-action="meet" data-testid="nearby-meet-new-people">${escapeHtml(deps.text('nearbyMeetNewPeople'))}</button>` : ''}
      ${state.group > 1 ? `<button type="button" class="btn btn-secondary" data-group-action="back" data-testid="nearby-back-to-first-group">${escapeHtml(deps.text('nearbyBackToFirstGroup'))}</button>` : ''}
    </div>
  `;
}
