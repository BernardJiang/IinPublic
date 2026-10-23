import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

/**
 * The group bar above the people on the room screen, for Nearby and Places alike (§3.7 "Meeting new
 * people in groups"): which group of my order I am meeting, "Meet new people" (swap the whole
 * group for the next one, after a confirmation) and, past group 1, "Back to group 1".
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
      if (action === 'meet') {
        const people = Number(bar!.dataset.people || '0');
        const place = bar!.dataset.place === 'true';
        void confirmMeetNewPeople(current, people, place).then((confirmed) => {
          if (confirmed) current.emit('nearbyMeetNewPeople');
        });
      }
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

/** In-page confirmation (a browser `confirm()` would block the app's own event loop). */
export function confirmMeetNewPeople(deps: NearbyGroupBarDeps, people: number, place: boolean): Promise<boolean> {
  document.getElementById('nearby-meet-confirm')?.remove();
  const modal = document.createElement('div');
  modal.id = 'nearby-meet-confirm';
  modal.setAttribute('data-testid', 'nearby-meet-confirm');
  modal.className = 'nearby-meet-confirm';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const body = deps.text(place ? 'placeMeetConfirmBody' : 'nearbyMeetConfirmBody').replace('{count}', String(people));
  modal.innerHTML = `
    <div class="nearby-meet-confirm-card">
      <div class="nearby-meet-confirm-title">${escapeHtml(deps.text('nearbyMeetConfirmTitle'))}</div>
      <p class="nearby-meet-confirm-body">${escapeHtml(body)}</p>
      <div class="nearby-meet-confirm-actions">
        <button type="button" class="btn btn-secondary" data-testid="nearby-meet-cancel">${escapeHtml(deps.text('cancel'))}</button>
        <button type="button" class="btn primary-btn" data-testid="nearby-meet-confirm-action">${escapeHtml(deps.text('nearbyMeetNewPeople'))}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return new Promise((resolve) => {
    const close = (confirmed: boolean) => {
      modal.remove();
      resolve(confirmed);
    };
    modal.querySelector('[data-testid="nearby-meet-cancel"]')?.addEventListener('click', () => close(false));
    modal.querySelector('[data-testid="nearby-meet-confirm-action"]')?.addEventListener('click', () => close(true));
    modal.addEventListener('click', (event) => { if (event.target === modal) close(false); });
  });
}
