import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

export type LocationRoomSuggestionDeps = {
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, values: Record<string, string | number>) => string;
};

export function showLocationRoomSuggestion(roomName: string, onJoin: () => void, deps: LocationRoomSuggestionDeps): void {
  document.getElementById('location-room-suggestion')?.remove();
  const host = document.getElementById('chatroom-list-container');
  if (!host) return;
  const banner = document.createElement('div');
  banner.id = 'location-room-suggestion';
  banner.className = 'location-room-suggestion';
  banner.innerHTML = `
    <span>${escapeHtml(deps.tf('locationSuggestedRoom', { room: roomName }))}</span>
    <button type="button" data-action="join">${escapeHtml(deps.t('locationSuggestedRoomJoin'))}</button>
    <button type="button" data-action="dismiss" aria-label="Dismiss">×</button>`;
  banner.querySelector<HTMLButtonElement>('[data-action="join"]')?.addEventListener('click', () => {
    banner.remove();
    onJoin();
  });
  banner.querySelector<HTMLButtonElement>('[data-action="dismiss"]')?.addEventListener('click', () => banner.remove());
  host.prepend(banner);
}
