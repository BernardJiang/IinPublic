import { computeTalkIdFromTalkData } from '../../shared/cid';
import type { UiLanguage } from './ui-translations';

export type ChatbotTemplate = {
  answers: any[];
  talkData: any;
};

export function getCopyTalkAutoSave(): boolean {
  const value = localStorage.getItem('copyTalkAutoSave');
  return value === null || value === 'true';
}

export function setCopyTalkAutoSave(enabled: boolean): void {
  localStorage.setItem('copyTalkAutoSave', String(enabled));
}

export function getChatbotEnabled(): boolean {
  const value = localStorage.getItem('chatbotEnabled');
  return value === null || value === 'true';
}

export function setChatbotEnabled(enabled: boolean): void {
  localStorage.setItem('chatbotEnabled', String(enabled));
}

export type AutoAnswerScope = 'same-context' | 'whenever';

/** One device-wide rule for every answer marked Auto. Defaults to "Whenever offered". */
export function getAutoAnswerScope(): AutoAnswerScope {
  return localStorage.getItem('iinpublic_auto_answer_scope') === 'same-context'
    ? 'same-context'
    : 'whenever';
}

export function setAutoAnswerScope(scope: AutoAnswerScope): void {
  localStorage.setItem('iinpublic_auto_answer_scope', scope);
}

export function getAutoAnswerPreferenceMode(): 'auto' | 'whenever' {
  return getAutoAnswerScope() === 'whenever' ? 'whenever' : 'auto';
}

/**
 * docs/TODO.md §BB: one-time opt-in consent to let the chatbot auto-resolve a `location`
 * builtIn question using this device's own blurred location — opt-IN (default false), unlike
 * `chatbotEnabled`'s opt-out default, since this specifically governs an automated decision
 * driven by location data. Precise location sharing is a separate, unrelated, still-manual-only
 * feature untouched by this flag.
 */
export function getLocationAutoMatchConsent(): boolean {
  return localStorage.getItem('locationAutoMatchConsent') === 'true';
}

export function setLocationAutoMatchConsent(consent: boolean): void {
  localStorage.setItem('locationAutoMatchConsent', String(consent));
}

export function getUiLanguagePreference(defaultLanguage: UiLanguage = 'en'): UiLanguage {
  const stored = String(localStorage.getItem('iinpublic_ui_language') || '').toLowerCase();
  if (stored === 'en' || stored === 'zh') return stored;
  localStorage.setItem('iinpublic_ui_language', defaultLanguage);
  return defaultLanguage;
}

export function setUiLanguagePreference(language: UiLanguage): void {
  localStorage.setItem('iinpublic_ui_language', language);
}

export function getDefaultTalkLanguagePreference(defaultLanguage: UiLanguage = 'en'): UiLanguage {
  const stored = String(localStorage.getItem('iinpublic_default_talk_language') || '').toLowerCase();
  return stored === 'en' || stored === 'zh' ? stored : defaultLanguage;
}

export function setDefaultTalkLanguagePreference(language: UiLanguage): void {
  localStorage.setItem('iinpublic_default_talk_language', language);
}

export type ColorScheme = 'goldenHour' | 'tropicalForest' | 'snowMountain' | 'beachSunset';
export const COLOR_SCHEMES: ColorScheme[] = ['goldenHour', 'tropicalForest', 'snowMountain', 'beachSunset'];
const DEFAULT_COLOR_SCHEME: ColorScheme = 'goldenHour';

export function getColorSchemePreference(): ColorScheme {
  const stored = localStorage.getItem('iinpublic_color_scheme');
  return (COLOR_SCHEMES as string[]).includes(stored || '')
    ? (stored as ColorScheme)
    : DEFAULT_COLOR_SCHEME;
}

/**
 * Persists the choice and applies it immediately (sets the same [data-color-scheme]
 * attribute on <html> that index.html's inline boot script reads on the next load —
 * this call handles the *current* session, the boot script handles the next reload).
 */
export function setColorSchemePreference(scheme: ColorScheme): void {
  localStorage.setItem('iinpublic_color_scheme', scheme);
  document.documentElement.setAttribute('data-color-scheme', scheme);
}

/**
 * docs/TODO.md §V — when a content edit mints a new talk, the predecessor is deleted by
 * default; advanced users can flip this to keep it (disabled) instead. Default false
 * (delete) matches Bernard's 2026-08-01 decision.
 */
export function getKeepOldTalkOnEdit(): boolean {
  return localStorage.getItem('keepOldTalkOnEdit') === 'true';
}

export function setKeepOldTalkOnEdit(enabled: boolean): void {
  localStorage.setItem('keepOldTalkOnEdit', String(enabled));
}

/** Device-local flag: has this browser/device ever finished (or skipped) the first-run walkthrough? */
export function getHasSeenWalkthrough(): boolean {
  return localStorage.getItem('iinpublic_walkthrough_seen') === 'true';
}

export function setHasSeenWalkthrough(seen: boolean): void {
  localStorage.setItem('iinpublic_walkthrough_seen', String(seen));
}

/**
 * Versioned device-local gate for the actionable first-run guide. The legacy walkthrough
 * flag counts as seen so an existing installation is never surprised by a new automatic modal.
 */
export function getHasSeenActionableGuide(): boolean {
  return localStorage.getItem('iinpublic_actionable_guide_seen_v1') === 'true'
    || getHasSeenWalkthrough();
}

export function setHasSeenActionableGuide(seen: boolean): void {
  localStorage.setItem('iinpublic_actionable_guide_seen_v1', String(seen));
}

export function getChatbotTemplate(talkId: string): ChatbotTemplate | null {
  try {
    const raw = localStorage.getItem('chatbotTemplates');
    if (!raw) return null;
    const templates = JSON.parse(raw) as Record<string, ChatbotTemplate>;
    return templates[talkId] || null;
  } catch {
    return null;
  }
}

export function saveChatbotTemplate(talkId: string, data: ChatbotTemplate): void {
  try {
    const raw = localStorage.getItem('chatbotTemplates');
    const templates: Record<string, ChatbotTemplate> = raw ? JSON.parse(raw) : {};
    templates[talkId] = data;
    const contentId = computeTalkIdFromTalkData(data.talkData);
    if (contentId && contentId !== talkId) {
      templates[contentId] = data;
    }
    localStorage.setItem('chatbotTemplates', JSON.stringify(templates));
  } catch (error) {
    console.warn('Failed to save chatbot template:', error);
  }
}

/**
 * OPEN-36 offline nearby switches (Android app). Both default ON; turning one off takes effect
 * immediately (`iinpublic-nearby-settings-changed`, handled in app.ts).
 */
export const NEARBY_SETTINGS_EVENT = 'iinpublic-nearby-settings-changed';

export function getNearbyWifiDirectEnabled(): boolean {
  try { return localStorage.getItem('iinpublic_nearby_wifi_direct') !== '0'; } catch { return true; }
}

export function getNearbyBluetoothEnabled(): boolean {
  try { return localStorage.getItem('iinpublic_nearby_bluetooth') !== '0'; } catch { return true; }
}

export function setNearbySetting(kind: 'wifi-direct' | 'bluetooth', enabled: boolean): void {
  try {
    localStorage.setItem(kind === 'wifi-direct' ? 'iinpublic_nearby_wifi_direct' : 'iinpublic_nearby_bluetooth', enabled ? '1' : '0');
  } catch { /* storage blocked: the switch applies to this session only */ }
  window.dispatchEvent(new CustomEvent(NEARBY_SETTINGS_EVENT));
}
