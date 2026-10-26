import { normalizeQuietSettings, defaultQuietSettings, type QuietSettings } from '../../shared/quiet-places';
import { settingsStorage } from './core-storage';

/**
 * Quiet places stay on this device only: never written to Gun, the hub, or device sync. (They are
 * not encrypted at rest: the only key available is stored beside them, which would add no real
 * protection on a device someone else controls.)
 */
const KEY = 'iinpublic_quiet_settings_v1';
export const QUIET_SETTINGS_EVENT = 'iinpublic-quiet-settings-changed';

export function loadQuietSettings(): QuietSettings {
  try {
    const raw = settingsStorage.getItem(KEY);
    return raw ? normalizeQuietSettings(JSON.parse(raw)) : defaultQuietSettings();
  } catch {
    return defaultQuietSettings();
  }
}

export function saveQuietSettings(value: QuietSettings): QuietSettings {
  const normalized = normalizeQuietSettings(value);
  try {
    settingsStorage.setItem(KEY, JSON.stringify(normalized));
  } catch { /* storage blocked: applies to this session only */ }
  window.dispatchEvent(new CustomEvent(QUIET_SETTINGS_EVENT, { detail: normalized }));
  return normalized;
}
