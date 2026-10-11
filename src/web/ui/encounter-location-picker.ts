import { CONFIG } from '../../shared/config';
import type { UiTranslationKey } from './ui-translations';

type MapLibre = typeof import('maplibre-gl');

export type EncounterPoint = { latitude: number; longitude: number };

export type EncounterLocationPickerDeps = {
  t: (key: UiTranslationKey) => string;
  initial: EncounterPoint | null;
  onConfirm: (point: EncounterPoint) => void;
  /** Injected in tests; defaults to the lazily loaded MapLibre bundle. */
  loadMap?: () => Promise<MapLibre>;
  /** Injected in tests; defaults to `navigator.geolocation`. */
  currentPosition?: () => Promise<EncounterPoint>;
};

function browserPosition(): Promise<EncounterPoint> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('geolocation unavailable')); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      reject,
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    );
  });
}

function parsePoint(latitudeText: string, longitudeText: string): EncounterPoint | null {
  if (!latitudeText.trim() || !longitudeText.trim()) return null;
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/**
 * Choose the encounter location: tap the map (or type coordinates). "Use my current location"
 * only centers the picker and drops a pin there — nothing is saved until the user confirms.
 */
export function showEncounterLocationPicker(deps: EncounterLocationPickerDeps): void {
  document.getElementById('encounter-location-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'encounter-location-modal';
  modal.dataset.testid = 'encounter-location-modal';
  modal.innerHTML = `
    <div class="modal-content size-m" role="dialog" aria-modal="true" aria-labelledby="encounter-location-title">
      <div class="modal-header"><h3 class="modal-title" id="encounter-location-title">${deps.t('encounterPickerTitle')}</h3></div>
      <p style="margin:0 0 8px;font-size:0.9em;">${deps.t('encounterPickerIntro')}</p>
      <div id="encounter-location-map" data-testid="encounter-location-map" style="height:300px;border-radius:10px;border:1px solid var(--border-strong);background:var(--bg-subtle);"></div>
      <div id="encounter-location-map-error" role="status" style="font-size:0.82em;color:var(--warning-text);margin-top:4px;"></div>
      <div id="encounter-location-map-status" role="status" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;"></div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:end;">
        <label style="flex:1;min-width:120px;font-size:0.82em;">${deps.t('encounterPickerLatitude')}
          <input type="number" step="any" min="-90" max="90" class="form-input" id="encounter-location-lat" data-testid="encounter-location-lat" style="width:100%;">
        </label>
        <label style="flex:1;min-width:120px;font-size:0.82em;">${deps.t('encounterPickerLongitude')}
          <input type="number" step="any" min="-180" max="180" class="form-input" id="encounter-location-lng" data-testid="encounter-location-lng" style="width:100%;">
        </label>
        <button type="button" class="btn" id="encounter-location-current" data-testid="encounter-location-current">${deps.t('encounterPickerUseCurrent')}</button>
      </div>
      <small style="display:block;margin-top:8px;color:var(--text-tertiary);">${deps.t('encounterPickerDisclosure')}</small>
      <div class="modal-actions" style="margin-top:12px;">
        <button type="button" class="btn" id="encounter-location-cancel">${deps.t('cancel')}</button>
        <button type="button" class="btn primary-btn" id="encounter-location-confirm" data-testid="encounter-location-confirm" disabled>${deps.t('encounterPickerConfirm')}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const latInput = modal.querySelector('#encounter-location-lat') as HTMLInputElement;
  const lngInput = modal.querySelector('#encounter-location-lng') as HTMLInputElement;
  const confirm = modal.querySelector('#encounter-location-confirm') as HTMLButtonElement;
  const status = modal.querySelector('#encounter-location-map-status') as HTMLElement;
  const mapError = modal.querySelector('#encounter-location-map-error') as HTMLElement;
  const mapContainer = modal.querySelector('#encounter-location-map') as HTMLElement;
  let mapApi: { map: import('maplibre-gl').Map; marker: import('maplibre-gl').Marker | null; maplibre: MapLibre } | null = null;
  let closed = false;

  const selected = (): EncounterPoint | null => parsePoint(latInput.value, lngInput.value);
  const refresh = (): void => { confirm.disabled = !selected(); };
  const placeMarker = (point: EncounterPoint, fly: boolean): void => {
    if (!mapApi) return;
    const lngLat: [number, number] = [point.longitude, point.latitude];
    if (!mapApi.marker) mapApi.marker = new mapApi.maplibre.Marker().setLngLat(lngLat).addTo(mapApi.map);
    else mapApi.marker.setLngLat(lngLat);
    if (fly) mapApi.map.jumpTo({ center: lngLat, zoom: Math.max(mapApi.map.getZoom(), 11) });
  };
  const select = (point: EncounterPoint, fly: boolean): void => {
    latInput.value = point.latitude.toFixed(5);
    lngInput.value = point.longitude.toFixed(5);
    placeMarker(point, fly);
    refresh();
  };

  if (deps.initial) select(deps.initial, false);
  latInput.addEventListener('input', () => { refresh(); const point = selected(); if (point) placeMarker(point, false); });
  lngInput.addEventListener('input', () => { refresh(); const point = selected(); if (point) placeMarker(point, false); });

  const close = (): void => { closed = true; mapApi?.map.remove(); modal.remove(); };
  modal.querySelector('#encounter-location-cancel')?.addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  confirm.addEventListener('click', () => {
    const point = selected();
    if (!point) return;
    close();
    deps.onConfirm(point);
  });
  modal.querySelector('#encounter-location-current')?.addEventListener('click', () => {
    status.textContent = deps.t('encounterPickerLocating');
    void (deps.currentPosition ?? browserPosition)()
      .then((point) => { if (!closed) { select(point, true); status.textContent = deps.t('encounterPickerCurrentHint'); } })
      .catch(() => { if (!closed) status.textContent = deps.t('encounterPickerCurrentFailed'); });
  });

  void (deps.loadMap ?? (async () => (await import('./chatroom-map-view')).loadMapLibre()))()
    .then((maplibre) => {
      if (closed) return;
      const start = selected();
      const map = new maplibre.Map({
        container: mapContainer,
        style: CONFIG.CHATROOM_MAP_STYLE_URL,
        center: start ? [start.longitude, start.latitude] : [0, 20],
        zoom: start ? 11 : 1.5,
        attributionControl: false,
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibre.AttributionControl({
        compact: true,
        customAttribution:
          '<a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · '
          + '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }));
      mapApi = { map, marker: null, maplibre };
      if (start) placeMarker(start, false);
      map.on('click', (event) => select({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }, false));
    })
    .catch(() => {
      if (!closed) mapError.textContent = deps.t('encounterPickerMapFailed');
    });
}
