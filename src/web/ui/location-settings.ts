import type { TalkIntakeFilters } from '../../shared/types';
import type { UiTranslationKey } from './ui-translations';
import type { ConnectivitySettings } from './connectivity-settings';
import {
  DEFAULT_QUIET_RADIUS_METERS,
  MAX_QUIET_PLACES,
  QUIET_PLACE_RADII,
  type QuietAction,
  type QuietSettings,
} from '../../shared/quiet-places';
import { loadQuietSettings, saveQuietSettings } from '../services/quiet-settings-store';
import { showEncounterLocationPicker } from './encounter-location-picker';
import { formatDistance } from './distance-units';

type T = (key: UiTranslationKey) => string;

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

const AREA_OPTIONS: Array<{ value: ConnectivitySettings['nearbyPrivacyMode']; label: UiTranslationKey; meters: number }> = [
  { value: 'close-nearby', label: 'locationAreaClose', meters: 400 },
  { value: 'neighborhood', label: 'locationAreaNeighborhood', meters: 1_000 },
  { value: 'citywide', label: 'locationAreaCitywide', meters: 10_000 },
  { value: 'regional', label: 'locationAreaRegional', meters: 50_000 },
];

const card = 'padding:12px;border:1px solid var(--border-strong);border-radius:10px;background:var(--bg-subtle);margin-bottom:14px;';
const help = 'font-size:0.82em;color:var(--text-tertiary);';

/**
 * "Your location": where you appear (Resident = blurred GPS, Traveler ✈ = a chosen point), the area
 * size others see, and — for Residents — quiet places. `encounterBlock` is the chosen-point picker.
 */
export function renderLocationSection(input: {
  t: T;
  connectivity: ConnectivitySettings;
  hasGps: boolean;
  traveler: boolean;
  encounterBlock: string;
}): string {
  const { t, connectivity, hasGps, traveler } = input;
  const source = hasGps
    ? `<fieldset data-testid="settings-location-source" style="${card}border-style:solid;">
        <legend style="font-weight:600;padding:0 4px;">${t('locationSourceTitle')}</legend>
        <label style="display:flex;gap:8px;align-items:flex-start;margin:4px 0;cursor:pointer;">
          <input type="radio" name="settings-location-source" value="resident" ${traveler ? '' : 'checked'} data-testid="settings-location-source-resident">
          <span><strong>${t('locationSourceResident')}</strong><br><small style="${help}">${t('locationSourceResidentHelp')}</small></span>
        </label>
        <label style="display:flex;gap:8px;align-items:flex-start;margin:4px 0;cursor:pointer;">
          <input type="radio" name="settings-location-source" value="traveler" ${traveler ? 'checked' : ''} data-testid="settings-location-source-traveler">
          <span><strong>${t('locationSourceTraveler')}</strong><br><small style="${help}">${t('locationSourceTravelerHelp')}</small></span>
        </label>
      </fieldset>`
    : `<div style="${card}"><strong>${t('locationSourceTraveler')}</strong><div style="${help}margin-top:4px;">${t('locationSourceWebOnly')}</div></div>`;
  const area = `<div style="${card}">
      <label style="display:flex;flex-direction:column;gap:7px;font-size:0.9em;">
        <strong>${t('locationAreaTitle')}</strong>
        <select id="settings-nearby-privacy-mode" class="form-input" data-testid="settings-nearby-privacy-mode">
          ${AREA_OPTIONS.map((option) => `<option value="${option.value}" ${connectivity.nearbyPrivacyMode === option.value ? 'selected' : ''}>${t(option.label).replace('{distance}', formatDistance(option.meters)).replace('{shown}', formatDistance(1_000))}</option>`).join('')}
        </select>
        <small style="${help}">${t('locationAreaHelp')}</small>
      </label>
    </div>`;
  return `${source}${traveler ? input.encounterBlock : ''}${area}${traveler ? '' : renderQuietPlaces(t, loadQuietSettings())}`;
}

function renderQuietPlaces(t: T, quiet: QuietSettings): string {
  const action: QuietAction = quiet.quietNowAction;
  const rows = quiet.places.map((place) => `
      <div class="settings-quiet-place" data-quiet-id="${escape(place.id)}" data-testid="settings-quiet-place" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0;">
        <input type="text" class="form-input settings-quiet-name" maxlength="40" value="${escape(place.name)}" aria-label="${escape(t('quietPlaceName'))}" style="flex:1;min-width:120px;">
        <select class="form-input settings-quiet-radius" aria-label="${escape(t('quietPlaceRadius'))}" style="width:auto;">
          ${QUIET_PLACE_RADII.map((radius) => `<option value="${radius}" ${place.radiusMeters === radius ? 'selected' : ''}>${formatDistance(radius)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-secondary settings-quiet-remove">${t('quietPlaceRemove')}</button>
      </div>`).join('');
  return `<div data-testid="settings-quiet-places" style="${card}">
      <strong>${t('quietTitle')}</strong>
      <div style="${help}margin:4px 0 8px;">${t('quietHelp')}</div>
      <label style="display:flex;gap:10px;align-items:center;cursor:pointer;">
        <input type="checkbox" id="settings-quiet-now" data-testid="settings-quiet-now" ${quiet.quietNow ? 'checked' : ''}>
        <span><strong>${t('quietNow')}</strong></span>
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
        <span>${t('quietActionTitle')}</span>
        <select id="settings-quiet-action" class="form-input" data-testid="settings-quiet-action">
          <option value="blur" ${action === 'blur' ? 'selected' : ''}>${t('quietActionBlur').replace('{distance}', formatDistance(50_000))}</option>
          <option value="hide" ${action === 'hide' ? 'selected' : ''}>${t('quietActionHide')}</option>
        </select>
      </label>
      <div style="font-size:0.88em;font-weight:600;margin:12px 0 2px;">${t('quietPlacesTitle')}</div>
      ${rows || `<div style="${help}">${t('quietPlacesEmpty')}</div>`}
      ${quiet.places.length < MAX_QUIET_PLACES ? `<button type="button" class="btn" id="settings-quiet-add" data-testid="settings-quiet-add" style="margin-top:6px;">${t('quietPlaceAdd')}</button>` : ''}
      <label style="display:flex;gap:10px;align-items:center;cursor:pointer;margin-top:12px;">
        <input type="checkbox" id="settings-quiet-schedule" data-testid="settings-quiet-schedule" ${quiet.schedule.enabled ? 'checked' : ''}>
        <span>${t('quietSchedule')}</span>
        <input type="time" class="form-input" id="settings-quiet-start" value="${quiet.schedule.start}" style="width:auto;" aria-label="${escape(t('quietScheduleStart'))}">
        <span>–</span>
        <input type="time" class="form-input" id="settings-quiet-end" value="${quiet.schedule.end}" style="width:auto;" aria-label="${escape(t('quietScheduleEnd'))}">
      </label>
      <div style="${help}margin-top:8px;">${t('quietLimits')}</div>
    </div>`;
}

/** Talk audience: everyone in the room, Residents only, or Contacts only (contacts always pass). */
export function renderTalkAudience(t: T, filters: Pick<TalkIntakeFilters, 'contactsOnlyTalks' | 'residentsOnlyTalks'>): string {
  const value = filters.contactsOnlyTalks ? 'contacts' : filters.residentsOnlyTalks ? 'residents' : 'everyone';
  const option = (key: string, label: UiTranslationKey, helpKey: UiTranslationKey) => `
      <label style="display:flex;gap:8px;align-items:flex-start;margin:6px 0;cursor:pointer;">
        <input type="radio" name="settings-talk-audience" value="${key}" ${value === key ? 'checked' : ''} data-testid="settings-talk-audience-${key}">
        <span><strong>${t(label)}</strong><br><small style="${help}">${t(helpKey)}</small></span>
      </label>`;
  return `<fieldset data-testid="settings-talk-audience" style="${card}margin-top:14px;">
      <legend style="font-weight:600;padding:0 4px;">${t('talkAudienceTitle')}</legend>
      ${option('everyone', 'talkAudienceEveryone', 'talkAudienceEveryoneHelp')}
      ${option('residents', 'talkAudienceResidents', 'talkAudienceResidentsHelp')}
      ${option('contacts', 'talkAudienceContacts', 'talkAudienceContactsHelp')}
    </fieldset>`;
}

/** Wire the quiet-place controls; every change saves at once (device only) and re-renders. */
export function bindQuietPlaces(deps: { t: T; rerender: () => void }): void {
  const root = document.querySelector('[data-testid="settings-quiet-places"]');
  if (!root) return;
  const update = (change: (quiet: QuietSettings) => void, rerender = false) => {
    const quiet = loadQuietSettings();
    change(quiet);
    saveQuietSettings(quiet);
    if (rerender) deps.rerender();
  };
  document.getElementById('settings-quiet-now')?.addEventListener('change', (event) => {
    update((quiet) => { quiet.quietNow = (event.currentTarget as HTMLInputElement).checked; });
  });
  document.getElementById('settings-quiet-action')?.addEventListener('change', (event) => {
    const action = (event.currentTarget as HTMLSelectElement).value === 'hide' ? 'hide' : 'blur';
    update((quiet) => {
      quiet.quietNowAction = action;
      quiet.schedule.action = action;
      quiet.places = quiet.places.map((place) => ({ ...place, action }));
    });
  });
  const saveSchedule = () => update((quiet) => {
    quiet.schedule.enabled = !!(document.getElementById('settings-quiet-schedule') as HTMLInputElement | null)?.checked;
    quiet.schedule.start = (document.getElementById('settings-quiet-start') as HTMLInputElement | null)?.value || quiet.schedule.start;
    quiet.schedule.end = (document.getElementById('settings-quiet-end') as HTMLInputElement | null)?.value || quiet.schedule.end;
  });
  ['settings-quiet-schedule', 'settings-quiet-start', 'settings-quiet-end'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', saveSchedule);
  });
  root.querySelectorAll<HTMLElement>('.settings-quiet-place').forEach((row) => {
    const id = row.dataset.quietId || '';
    row.querySelector('.settings-quiet-name')?.addEventListener('change', (event) => {
      update((quiet) => {
        quiet.places = quiet.places.map((place) => place.id === id ? { ...place, name: (event.currentTarget as HTMLInputElement).value } : place);
      });
    });
    row.querySelector('.settings-quiet-radius')?.addEventListener('change', (event) => {
      const radius = Number((event.currentTarget as HTMLSelectElement).value);
      update((quiet) => {
        quiet.places = quiet.places.map((place) => place.id === id ? { ...place, radiusMeters: radius } : place);
      });
    });
    row.querySelector('.settings-quiet-remove')?.addEventListener('click', () => {
      update((quiet) => { quiet.places = quiet.places.filter((place) => place.id !== id); }, true);
    });
  });
  document.getElementById('settings-quiet-add')?.addEventListener('click', () => {
    const t = deps.t;
    const relabel: Partial<Record<UiTranslationKey, UiTranslationKey>> = {
      encounterPickerTitle: 'quietPickerTitle',
      encounterPickerIntro: 'quietPickerIntro',
      encounterPickerConfirm: 'quietPickerConfirm',
      encounterPickerDisclosure: 'quietPickerDisclosure',
    };
    showEncounterLocationPicker({
      t: (key) => t(relabel[key as UiTranslationKey] ?? key as UiTranslationKey),
      initial: null,
      onConfirm: (point) => update((quiet) => {
        quiet.places.push({
          id: `quiet-${Date.now().toString(36)}`,
          name: `${t('quietPlaceDefaultName')} ${quiet.places.length + 1}`,
          latitude: point.latitude,
          longitude: point.longitude,
          radiusMeters: DEFAULT_QUIET_RADIUS_METERS,
          action: quiet.quietNowAction,
        });
      }, true),
    });
  });
}
