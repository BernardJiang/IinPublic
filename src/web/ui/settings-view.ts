import {
  type GPSCoordinate,
  type TalkIntakeFilters,
  type Tag,
  type User,
} from '../../shared/types';
import { normalizeProfileAttributeVisibility } from '../../shared/profile-privacy';
import { getFlatChatroomList } from '../../shared/chatroom-hierarchy';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { escapeHtml } from './ui-formatters';
import { renderSettingsSection } from './settings-section-template';
import { loadConnectivitySettings, type ConnectivityPreset } from './connectivity-settings';
import {
  COLOR_SCHEMES,
  getChatbotEnabled,
  getColorSchemePreference,
  getCopyTalkAutoSave,
  getDefaultTalkLanguagePreference,
  getKeepOldTalkOnEdit,
  getLocationAutoMatchConsent,
  type ColorScheme,
} from './ui-settings-storage';
import { renderDownloadAppSectionBody, type AppDownloadTextDeps } from './app-download';
import { avatarInnerHtml } from './profile-avatar';
import { languageOptionLabel, type UiLanguage, type UiTranslationKey } from './ui-translations';
import {
  filterIncomingTalkClusters,
  getTalkIntakeFilters,
  getTalkIntakeFiltersOwner,
  hasStoredTalkIntakeFilters,
  setTalkIntakeFilters,
  setTalkIntakeFiltersOwner,
} from './talk-intake-filters';
import {
  normalizeCustomBlockedTerms,
  normalizeDirtyWords,
  DEFAULT_DIRTY_WORDS,
} from '../../shared/talk-intake-filters';
import { CONFIG } from '../../shared/config';
import type { CustomChatroomRow } from './chatrooms-view';

export interface SettingsViewDeps {
  currentLocation: GPSCoordinate | undefined;
  incomingTalkClusters: any[];
  customChatrooms: CustomChatroomRow[];
  getHomeChatroomId: () => string;
  formatReasonCounts: (counts: Record<string, number>) => string;
  getUiLanguage: () => UiLanguage;
  formatTalkLanguage: (code: string) => string;
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, values: Record<string, string | number>) => string;
  appDownloadTextDeps: () => AppDownloadTextDeps;
  techSupportDelegateEligible: boolean;
  techSupportDelegateOptedIn: boolean;
  bindSettingsControls: () => void;
  refreshStorageInspector: () => Promise<void>;
  refreshDownloadAppSection: () => Promise<void>;
  renderSupportInboxSectionIfPresent: () => void;
  renderSupportDelegatesSectionIfPresent: () => void;
  renderSupportDelegateOptInSectionIfPresent: () => void;
  applySettingsSectionView: (sectionId: string | null) => void;
  settingsActiveSectionId: string | null;
}

const TALK_TYPE_VALUES: TalkIntakeFilters['allowedTalkTypes'] = ['flow', 'survey', 'tag', 'route'];

const SETTINGS_SCHEME_SWATCHES: Record<ColorScheme, string> = {
  goldenHour: '#cc6b1c',
  tropicalForest: '#2f7a4f',
  snowMountain: '#1f8fc4',
  beachSunset: '#e8637a',
};

const SETTINGS_SCHEME_LABEL_KEYS: Record<ColorScheme, UiTranslationKey> = {
  goldenHour: 'schemeGoldenHour',
  tropicalForest: 'schemeTropicalForest',
  snowMountain: 'schemeSnowMountain',
  beachSunset: 'schemeBeachSunset',
};

export const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: 'Chinese' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
];

export function normalizeStringList(value: unknown, fallback: string[] = []): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const normalized = raw.map((part) => String(part || '').trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
}

export function normalizeTalkFilterShape(
  value: unknown,
  fallbackLanguages: string[] = ['en'],
): TalkIntakeFilters {
  const stored = value && typeof value === 'object' ? (value as Partial<TalkIntakeFilters>) : {};
  const defaults = getTalkIntakeFilters();
  const allowedTalkTypes = Array.isArray(stored.allowedTalkTypes)
    ? stored.allowedTalkTypes.filter(
        (type): type is TalkIntakeFilters['allowedTalkTypes'][number] =>
          TALK_TYPE_VALUES.includes(type as TalkIntakeFilters['allowedTalkTypes'][number]),
      )
    : [];

  return {
    ...defaults,
    ...stored,
    allowedLanguages: normalizeStringList(stored.allowedLanguages, fallbackLanguages).map((lang) =>
      lang.toLowerCase(),
    ),
    allowedTalkTypes: allowedTalkTypes.length > 0 ? allowedTalkTypes : TALK_TYPE_VALUES,
    customBlockedTerms: normalizeCustomBlockedTerms(
      normalizeStringList(stored.customBlockedTerms, []),
    ),
    dirtyWords:
      stored.dirtyWords === undefined
        ? [...DEFAULT_DIRTY_WORDS]
        : normalizeDirtyWords(stored.dirtyWords),
  };
}

function datetimeLocalValue(value: string | undefined): string {
  if (!value) return '';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '';
  const localTimestamp = new Date(timestamp.getTime() - timestamp.getTimezoneOffset() * 60_000);
  return localTimestamp.toISOString().slice(0, 16);
}

export function renderSettingsView(user: User, deps: SettingsViewDeps): void {
  const connectivity = loadConnectivitySettings();
  const nativeHost = (
    window as unknown as {
      iinpublicNative?: { version?: string; platform?: string };
    }
  ).iinpublicNative;
  const nativeQuery = new URLSearchParams(window.location.search);
  const queryPlatform = nativeQuery.get('native_platform') || '';
  const appVersion = String(nativeHost?.version || nativeQuery.get('app_version') || 'web');
  const appPlatform = nativeHost?.platform || queryPlatform;
  const container = document.getElementById('settings-content');
  if (!container) return;
  // adoptSessionUser can now trigger this render as soon as this device's local Gun read
  // for the user record resolves (see app.ts's initializeUser) — before the rest of boot has
  // had a chance to let Gun finish syncing every field in, that local read can momentarily
  // come back missing stageName. Must not assume it's always a non-empty string here.
  const stageNameSafe = user.stageName || '';
  const currentColorScheme = getColorSchemePreference();
  const profileLanguages = normalizeStringList(user.languages, ['en']).map((lang) =>
    lang.toLowerCase(),
  );
  user.languages = profileLanguages;
  // Intake filters are persisted synchronously to localStorage on every settings change
  // (setTalkIntakeFilters, called from ui-manager's sync()), while user.talkFilters comes
  // from an async, eventually-consistent server round-trip (WebUserService.updateTalkFilters
  // queues one getUser+put per change via withPrivateDataLock) that can be caught mid-drain —
  // e.g. by a page reload — and return a partially-applied intermediate state that isn't the
  // hardcoded default shape but also isn't the true latest value (see: e2e
  // 31-intake-filters-persist regression, 2026-08-09, where this silently clobbered the
  // correct localStorage value on reload). localStorage for THIS device is never subject to
  // that race, so prefer it — but ONLY when it was actually saved for the user being rendered
  // now: a stored value tagged for a *different* user id (a device previously used by someone
  // else, or an identity swap) must not be applied to this one, so user.talkFilters wins then.
  const hasUserFilters =
    user.talkFilters &&
    typeof user.talkFilters === 'object' &&
    Object.keys(user.talkFilters).length > 0;
  const normalizedUserFilters = hasUserFilters
    ? normalizeTalkFilterShape(user.talkFilters, profileLanguages)
    : null;
  const localStorageOwnedByThisUser =
    hasStoredTalkIntakeFilters() && getTalkIntakeFiltersOwner() === user.id;
  const talkFilters = localStorageOwnedByThisUser
    ? getTalkIntakeFilters()
    : (normalizedUserFilters ?? normalizeTalkFilterShape(undefined, profileLanguages));
  user.talkFilters = talkFilters;
  setTalkIntakeFilters(talkFilters);
  setTalkIntakeFiltersOwner(user.id);
  const reputation = user.reputation || ({} as typeof user.reputation);
  const reviewCount = reputation.reviewCount ?? 0;
  const starRating = Number(reputation.starRating ?? 0);
  const friendsCount = reputation.friendsCount ?? 0;
  const matchesFound = reputation.matchesFound ?? 0;
  const likedCount = reputation.likedCount ?? 0;
  const dislikedCount = reputation.dislikedCount ?? 0;
  const ageVerified = reputation.ageVerified === true;
  const isCreditVisible = reputation.isHidden !== true;
  const home = deps.getHomeChatroomId();
  const headshot = String(user.headshot || '').trim();
  const interestNames = Array.isArray(user.interests)
    ? user.interests.map((t: Tag) => String(t?.name || '').trim()).filter(Boolean)
    : [];
  const profileAnswers = Array.isArray(user.profile) ? user.profile : [];
  const profilePreview =
    profileAnswers.length > 0
      ? profileAnswers
          .slice(0, 4)
          .map((qa) => {
            const vis = normalizeProfileAttributeVisibility(qa.visibility);
            const canonicalSupportRole =
              qa.id === 'techsupport_profile_role' &&
              qa.question === 'Role' &&
              qa.answer === 'IinPublic network support';
            const visNote =
              vis === 'public'
                ? ''
                : `<div style="font-size:0.72em;color:var(--text-tertiary);margin-top:2px;">${escapeHtml(
                    vis === 'contacts_only'
                      ? deps.t('meVisibilityContacts')
                      : deps.t('meVisibilityPrivate'),
                  )}</div>`;
            const question = canonicalSupportRole ? deps.t('meTechSupportRole') : qa.question;
            const answer = canonicalSupportRole ? deps.t('meTechSupportRoleValue') : qa.answer;
            return `<div style="padding:8px 10px;border-radius:8px;background:var(--bg-subtle);border:1px solid var(--border);"><div style="font-size:0.78em;color:var(--text-tertiary);">${escapeHtml(question)}</div>${visNote}<div style="font-size:0.92em;font-weight:600;color:var(--text-primary);margin-top:2px;">${escapeHtml(answer)}</div></div>`;
          })
          .join('')
      : `<div style="font-size:0.88em;color:var(--text-tertiary);">${escapeHtml(deps.t('meNoPublicProfile'))}</div>`;
  const locationText = deps.currentLocation
    ? `${deps.currentLocation.latitude.toFixed(3)}, ${deps.currentLocation.longitude.toFixed(3)}`
    : deps.t('settingsUnknown');
  const filteredIncoming = filterIncomingTalkClusters(
    (deps.incomingTalkClusters || []).filter((cluster: any) => cluster && cluster.identityKey),
    talkFilters,
    deps.currentLocation,
  );
  const hiddenIncomingText = deps.formatReasonCounts(filteredIncoming.hiddenByReason);
  const dirtyWordList =
    talkFilters.dirtyWords === undefined
      ? [...DEFAULT_DIRTY_WORDS]
      : normalizeDirtyWords(talkFilters.dirtyWords);
  const homeOptions = [
    ...getFlatChatroomList().map((room) => ({
      id: room.id,
      label: `${'-- '.repeat(room.level)}${room.icon} ${room.name}`,
    })),
    ...deps.customChatrooms.map((room) => ({
      id: room.id,
      label: `${room.type === 'business' ? '🏪' : '💬'} ${room.name}`,
    })),
  ];
  const uiLanguage = deps.getUiLanguage();
  const defaultTalkLanguage = getDefaultTalkLanguagePreference(uiLanguage);
  const languageOptions = LANGUAGE_OPTIONS.map((language) => ({
    ...language,
    label: languageOptionLabel(uiLanguage, language.code, language.label),
  }));
  const headshotChoices = ['🙂', '😎', '🤠', '🎾', '☕', '🌟', '🐱', '🦊'];
  // Drill-down menu: a flat list of section names is the default view; tapping one hides the
  // menu and every OTHER section, leaving just the tapped section + a back button (app-bar
  // #back-to-settings-menu) — same list-then-detail pattern as Chatrooms/Contacts. Sections
  // themselves are still rendered up front (renderSettingsSection's <details open> markup is
  // unchanged) — applySettingsSectionView() below only toggles which one is display:none, it
  // never removes/re-adds DOM, so ids stay stable across a section switch.
  const jumpMenuItems: Array<{ icon: string; label: string; target: string }> = [
    { icon: '👤', label: deps.t('profile'), target: 'settings-section-profile' },
    { icon: '🎨', label: deps.t('settingsAppearance'), target: 'settings-section-appearance' },
    { icon: '⭐', label: deps.t('credit'), target: 'settings-section-credit' },
    { icon: '🌐', label: deps.t('settingsLanguages'), target: 'settings-section-languages' },
    { icon: '🗣️', label: deps.t('settingsTalkBehavior'), target: 'settings-section-talk-behavior' },
    { icon: '📍', label: deps.t('settingsDistanceHome'), target: 'settings-section-distance-home' },
    {
      icon: '🚫',
      label: deps.t('settingsContentFilters'),
      target: 'settings-section-content-filters',
    },
    { icon: '📡', label: 'Connectivity', target: 'settings-section-connectivity' },
    { icon: '📱', label: deps.t('settingsDownloadApp'), target: 'settings-section-download-app' },
    {
      icon: '🔐',
      label: deps.t('settingsIdentityDevices'),
      target: 'settings-section-linked-devices',
    },
    { icon: '🗑️', label: deps.t('settingsEraseDevice'), target: 'settings-section-erase-device' },
    { icon: '💾', label: deps.t('settingsStorage'), target: 'settings-storage-inspector' },
    { icon: '❓', label: deps.t('settingsHelp'), target: 'settings-section-help' },
  ];
  const jumpMenuHtml = `
      <div data-testid="settings-product-promise" style="padding:2px 4px;font-size:0.92em;font-weight:650;color:var(--text-secondary);">
        ${deps.t('settingsOwnershipPromise')}
      </div>
      <div class="settings-jump-menu" id="settings-jump-menu" style="display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden;">
        ${jumpMenuItems
          .map(
            (item, index) => `
          <button type="button" class="settings-jump-menu-item" data-target="${item.target}" style="display:flex;align-items:center;gap:10px;padding:12px 16px;border:none;${index < jumpMenuItems.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}background:none;text-align:left;cursor:pointer;font:inherit;color:var(--text-primary);">
            <span aria-hidden="true" style="font-size:1.05em;flex-shrink:0;">${item.icon}</span>
            <span style="flex:1 1 auto;">${item.label}</span>
            <span aria-hidden="true" style="color:var(--text-tertiary);">›</span>
          </button>
        `,
          )
          .join('')}
      </div>
      <div id="settings-app-version" data-testid="settings-app-version" style="padding:2px 4px;text-align:center;font-size:0.78em;color:var(--text-tertiary);">
        IinPublic version ${escapeHtml(appVersion)}${appPlatform ? ` · ${escapeHtml(appPlatform)}` : ''}
      </div>
    `;
  container.innerHTML = `
      <div id="settings-menu-container" data-testid="settings-menu-container" style="display:grid;gap:14px;">
        ${jumpMenuHtml}
      </div>
      <div id="settings-detail-container" data-testid="settings-detail-container" style="display:none;">
        <div style="display:grid;gap:14px;">
        ${renderSettingsSection(
          { id: 'settings-section-profile', title: deps.t('profile') },
          `
          <div style="display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:start;">
            <div style="display:grid;gap:8px;min-width:0;">
              <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
                <span>${deps.t('settingsStageName')}</span>
                <input type="text" class="form-input" id="settings-stage-name-input" data-testid="settings-stage-name-input" value="${escapeHtml(stageNameSafe)}" minlength="3">
              </label>
              <div id="settings-stage-name-error" role="alert" style="display:none;font-size:0.82em;color:var(--danger-hover);margin-top:5px;"></div>
              ${interestNames.length > 0 ? `<div style="font-size:0.86em;color:var(--text-tertiary);">${deps.t('interestsLabel')}: ${escapeHtml(interestNames.join(', '))}</div>` : ''}
            </div>
            <div style="display:grid;gap:8px;font-size:0.9em;">
              <span>${deps.t('settingsHeadshot')}</span>
              <div class="user-avatar" style="width:72px;height:72px;font-size:1.7em;">
                ${avatarInnerHtml(headshot, stageNameSafe.charAt(0).toUpperCase() || '?', escapeHtml)}
              </div>
              <select class="form-input" id="settings-headshot-select" data-testid="settings-headshot-select">
                <option value="">${deps.t('settingsInitial')}</option>
                ${headshotChoices
                  .map(
                    (choice) =>
                      `<option value="${choice}" ${choice === headshot ? 'selected' : ''}>${choice}</option>`,
                  )
                  .join('')}
              </select>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn" type="button" id="settings-choose-photo-btn">${deps.t('settingsChoosePhoto')}</button>
                <button class="btn" type="button" id="settings-take-photo-btn">${deps.t('settingsTakePhoto')}</button>
                <button class="btn" type="button" id="settings-remove-photo-btn">${deps.t('settingsRemove')}</button>
              </div>
              <input class="visually-hidden" type="file" id="settings-photo-input" accept="image/png,image/jpeg,image/webp,image/gif">
              <input class="visually-hidden" type="file" id="settings-camera-input" accept="image/*" capture="user">
              <div style="font-size:0.78em;color:var(--text-tertiary);">${deps.t('settingsPhotoHelp')}</div>
              <div id="settings-camera-status" role="status" style="display:none;font-size:0.8em;color:var(--danger-hover);"></div>
            </div>
            <div style="display:grid;gap:10px;border-top:1px solid var(--border);padding-top:12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                <div>
                  <div style="font-weight:700;color:var(--text-primary);">${deps.t('profile')}</div>
                  <div style="font-size:0.82em;color:var(--text-tertiary);">${deps.t('meProfileVisibilityHelp')}</div>
                </div>
                <button class="btn" type="button" id="settings-edit-profile-btn" data-testid="settings-edit-profile-button">${deps.t('editProfile')}</button>
              </div>
              <div style="font-size:0.88em;color:var(--text-secondary);">
                ${deps.t('languagesLabel')}: ${escapeHtml(profileLanguages.map((code) => deps.formatTalkLanguage(code)).join(', '))}
              </div>
              <div style="display:grid;gap:8px;">${profilePreview}</div>
            </div>
          </div>
        `,
        )}
        ${renderSettingsSection(
          {
            id: 'settings-section-appearance',
            title: deps.t('settingsAppearance'),
            subtitle: deps.t('settingsAppearanceHelp'),
          },
          `
          <div id="settings-scheme-picker" style="display:grid;gap:8px;">
            ${COLOR_SCHEMES.map((scheme) => {
              const swatch = SETTINGS_SCHEME_SWATCHES[scheme];
              const checked = currentColorScheme === scheme;
              return `
                <label class="settings-scheme-option" data-scheme="${scheme}" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1.5px solid ${checked ? 'var(--accent)' : 'var(--border)'};border-radius:10px;cursor:pointer;">
                  <input type="radio" name="settings-color-scheme" class="settings-scheme-radio" value="${scheme}" ${checked ? 'checked' : ''}>
                  <span style="width:26px;height:26px;border-radius:50%;flex:none;background:${swatch};border:1px solid rgba(0,0,0,0.08);"></span>
                  <span style="font-weight:600;font-size:0.92em;">${deps.t(SETTINGS_SCHEME_LABEL_KEYS[scheme])}</span>
                </label>
              `;
            }).join('')}
          </div>
        `,
        )}
        ${renderSettingsSection(
          {
            id: 'settings-section-credit',
            title: deps.t('credit'),
            subtitle: deps.t('meCreditHelp'),
            action: `
              <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;">
                <input type="checkbox" id="settings-credit-visible" ${isCreditVisible ? 'checked' : ''}>
                <span>${deps.t('settingsCreditVisible')}</span>
              </label>
            `,
          },
          `
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${deps.t('meReviews')}</div><div style="font-size:1.15em;font-weight:700;">${reviewCount}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${deps.t('meStarRating')}</div><div style="font-size:1.15em;font-weight:700;">${starRating.toFixed(1)}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${deps.t('meFriends')}</div><div style="font-size:1.15em;font-weight:700;">${friendsCount}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${deps.t('meLiked')}</div><div style="font-size:1.15em;font-weight:700;">${likedCount}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${deps.t('meDisliked')}</div><div style="font-size:1.15em;font-weight:700;">${dislikedCount}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${deps.t('meMatches')}</div><div style="font-size:1.15em;font-weight:700;">${matchesFound}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);grid-column:span 2;"><div style="font-size:0.78em;color:var(--warning-text);">${deps.t('meAgeVerified')}</div><div style="font-size:1.15em;font-weight:700;">${ageVerified ? '18+' : deps.t('unavailable')}</div></div>
          </div>
        `,
        )}
        ${renderSettingsSection(
          { id: 'settings-section-languages', title: deps.t('settingsLanguages') },
          `
          <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
            <span>${deps.t('settingsUiLanguage')}</span>
            <select class="form-input" id="settings-ui-language" data-testid="settings-ui-language-select">
              ${languageOptions
                .filter((lang) => lang.code === 'en' || lang.code === 'zh')
                .map(
                  (lang) =>
                    `<option value="${lang.code}" ${uiLanguage === lang.code ? 'selected' : ''}>${lang.label}</option>`,
                )
                .join('')}
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${deps.t('settingsProfileLanguage')}</span>
            <select class="form-input" id="settings-profile-languages" data-testid="settings-profile-language-select">
              ${languageOptions
                .map(
                  (lang) =>
                    `<option value="${lang.code}" ${profileLanguages[0] === lang.code ? 'selected' : ''}>${lang.label}</option>`,
                )
                .join('')}
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${deps.t('settingsDefaultTalkLanguage')}</span>
            <select class="form-input" id="settings-default-talk-language" data-testid="settings-default-talk-language-select">
              ${languageOptions
                .map(
                  (lang) =>
                    `<option value="${lang.code}" ${defaultTalkLanguage === lang.code ? 'selected' : ''}>${lang.label}</option>`,
                )
                .join('')}
            </select>
          </label>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${deps.t('settingsIncomingLanguage')}</span>
            <div id="settings-filter-languages" data-testid="settings-incoming-language-select" style="display:flex;flex-wrap:wrap;gap:8px;">
              ${languageOptions
                .map(
                  (lang) => `
                  <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;padding:6px 10px;border:1px solid var(--border-strong);border-radius:999px;background:var(--surface);">
                    <input type="checkbox" class="settings-filter-language-option" value="${lang.code}" ${talkFilters.allowedLanguages.includes(lang.code) ? 'checked' : ''}>
                    <span>${lang.label}</span>
                  </label>
                `,
                )
                .join('')}
            </div>
            <div id="settings-filter-languages-count" style="font-size:0.82em;color:var(--text-tertiary);">${talkFilters.allowedLanguages.length} ${deps.t('settingsActive')}</div>
          </div>
        `,
        )}
        ${renderSettingsSection(
          { id: 'settings-section-talk-behavior', title: deps.t('settingsTalkBehavior') },
          `
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.95em;">
            <input type="checkbox" id="settings-copy-talk-autosave" ${getCopyTalkAutoSave() ? 'checked' : ''}>
            <span>${deps.t('settingsCopyTalk')}</span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.95em;margin-top:12px;">
            <input type="checkbox" id="settings-chatbot-enabled" ${getChatbotEnabled() ? 'checked' : ''}>
            <span>${deps.t('settingsChatbot')}</span>
          </label>
          <div data-testid="settings-chatbot-promise" style="font-size:0.82em;color:var(--text-tertiary);margin:2px 0 0 26px;">${deps.t('settingsChatbotHelp')}</div>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.95em;margin-top:12px;">
            <input type="checkbox" id="settings-location-auto-match-consent" ${getLocationAutoMatchConsent() ? 'checked' : ''}>
            <span>${deps.t('settingsLocationAutoMatch')}</span>
          </label>
          <div style="font-size:0.82em;color:var(--text-tertiary);margin:2px 0 0 26px;">${deps.t('settingsLocationAutoMatchNote')}</div>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.95em;margin-top:12px;">
            <input type="checkbox" id="settings-keep-old-talk-on-edit" ${getKeepOldTalkOnEdit() ? 'checked' : ''}>
            <span>${deps.t('settingsKeepOldTalkOnEdit')}</span>
          </label>
        `,
        )}
        ${renderSettingsSection(
          { id: 'settings-section-distance-home', title: deps.t('settingsDistanceHome') },
          `
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
            <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
              <span>${deps.t('settingsMinDistance')}</span>
              <input type="number" class="form-input" id="settings-min-distance" min="0" step="1" value="${talkFilters.minDistanceMiles ?? ''}">
            </label>
            <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
              <span>${deps.t('settingsMaxDistance')}</span>
              <input type="number" class="form-input" id="settings-max-distance" min="0" step="1" value="${talkFilters.maxDistanceMiles ?? ''}">
            </label>
          </div>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${deps.t('settingsHomeRoom')}</span>
            <select class="form-input" id="settings-home-room">
              ${homeOptions
                .map(
                  (room) => `
                  <option value="${escapeHtml(room.id)}" ${room.id === home ? 'selected' : ''}>${escapeHtml(room.label)}</option>
                `,
                )
                .join('')}
            </select>
          </label>
          <div style="margin-top:4px;font-size:0.82em;color:var(--text-tertiary);">${deps.t('settingsLocation')}: ${escapeHtml(locationText)}</div>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${deps.t('settingsSentAfter')}</span>
            <input type="datetime-local" class="form-input" id="settings-sent-after" value="${escapeHtml(datetimeLocalValue(talkFilters.sentAfter))}">
          </label>
        `,
        )}
        ${renderSettingsSection(
          {
            id: 'settings-section-content-filters',
            title: deps.t('settingsContentFilters'),
            subtitle: deps.t('settingsContentFiltersHelp'),
          },
          `
          <div style="font-size:0.85em;font-weight:600;color:var(--text-secondary);margin-bottom:8px;">${deps.t('settingsMessageFiltersHeading')}</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;"><input type="checkbox" id="settings-grammar-filter" ${talkFilters.requireGoodGrammar ? 'checked' : ''}> ${deps.t('settingsGrammar')}</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;"><input type="checkbox" id="settings-dirty-words-filter" ${talkFilters.blockDirtyWords ? 'checked' : ''}> ${deps.t('settingsDirtyWords')}</label>
          </div>
          <div style="font-size:0.8em;color:var(--text-tertiary);margin-top:8px;">${deps.t('settingsGrammarHelp')} ${deps.tf('settingsGrammarStrictness', { threshold: String(CONFIG.GRAMMAR_THRESHOLD) })}</div>
          <div style="font-size:0.8em;color:var(--text-tertiary);margin-top:4px;">${deps.t('settingsDirtyWordsHelp')}</div>
          <div id="settings-dirty-words-editor" style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
            <div style="font-size:0.9em;font-weight:600;margin-bottom:6px;">${deps.t('settingsDirtyWordsListLabel')}</div>
            <div id="dirty-word-chips" data-testid="dirty-word-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
              ${dirtyWordList
                .map(
                  (word) => `
                  <span class="dirty-word-chip" data-testid="dirty-word-chip" data-word="${escapeHtml(word)}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid var(--border-strong);border-radius:999px;background:var(--bg-subtle);font-size:0.85em;">
                    <span>${escapeHtml(word)}</span>
                    <button type="button" class="dirty-word-chip-remove" data-testid="dirty-word-chip-remove" data-word="${escapeHtml(word)}" aria-label="remove ${escapeHtml(word)}" style="border:none;background:none;cursor:pointer;color:var(--text-tertiary);font-size:1em;line-height:1;padding:0;">✕</button>
                  </span>
                `,
                )
                .join('')}
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <input type="text" class="form-input" id="dirty-word-add-input" data-testid="dirty-word-add-input" placeholder="${deps.t('settingsDirtyWordAddPlaceholder')}" maxlength="48" style="flex:1;min-width:140px;">
              <button type="button" class="btn" id="dirty-word-add-btn" data-testid="dirty-word-add-btn">${deps.t('settingsDirtyWordAdd')}</button>
              <button type="button" class="btn" id="dirty-word-reset-btn" data-testid="dirty-word-reset-btn">${deps.t('settingsDirtyWordReset')}</button>
            </div>
            <div id="dirty-word-error" data-testid="dirty-word-error" style="font-size:0.8em;color:var(--danger);margin-top:4px;min-height:1em;"></div>
            <div style="font-size:0.8em;color:var(--text-tertiary);margin-top:2px;">${deps.t('settingsDirtyWordsListHelp')}</div>
          </div>
          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
            <div style="font-size:0.9em;font-weight:600;margin-bottom:6px;">${deps.t('settingsAllowedTypes')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${(['tag', 'flow', 'route', 'survey'] as const)
                .map(
                  (type) => `
                  <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;padding:6px 10px;border:1px solid var(--border-strong);border-radius:999px;background:var(--surface);">
                    <input type="checkbox" class="settings-talk-filter-type" value="${type}" ${talkFilters.allowedTalkTypes.includes(type) ? 'checked' : ''}>
                    <span>${type}</span>
                  </label>
                `,
                )
                .join('')}
            </div>
          </div>
          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
            <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
              <span>${deps.t('settingsBlockedPhrases')}</span>
              <textarea class="form-input" id="settings-custom-blocked" rows="3">${escapeHtml((talkFilters.customBlockedTerms || []).join(', '))}</textarea>
            </label>
          </div>
          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
            <div style="font-size:0.9em;font-weight:600;margin-bottom:6px;">${deps.t('settingsFilteredIncomingHeading')}</div>
            <div id="settings-filtered-incoming-summary" style="font-size:0.84em;color:var(--text-tertiary);">
              ${deps.t('settingsHiddenIncoming')}: ${filteredIncoming.hiddenCount}
              ${hiddenIncomingText ? `<div>${escapeHtml(hiddenIncomingText)}</div>` : ''}
              ${!deps.currentLocation && (deps.incomingTalkClusters || []).some((c: any) => c?.latestTalk?.locationRadiusMiles != null || c?.locationRadiusMiles != null) ? `<div style="color:var(--warning-text);font-style:italic;margin-top:4px;">${escapeHtml(deps.t('filterLocationPending'))}</div>` : ''}
            </div>
          </div>
        `,
        )}
        ${renderSettingsSection(
          {
            id: 'settings-section-connectivity',
            title: 'Connectivity',
            subtitle: 'Choose routes automatically or tune data, battery, and forwarding policy.',
          },
          `<div style="display:grid;gap:12px;">
            <label>Preset
              <select id="settings-connectivity-preset" class="form-input" data-testid="settings-connectivity-preset">
                ${(['automatic', 'data-saver', 'fastest', 'local-event', 'private', 'advanced'] as ConnectivityPreset[]).map((preset) => `<option value="${preset}" ${connectivity.preset === preset ? 'selected' : ''}>${preset.replace('-', ' ')}</option>`).join('')}
              </select>
            </label>
            <div id="settings-connectivity-status" role="status">Automatic route selection · forwarding ${connectivity.forwarding.enabled ? 'on' : 'off'}</div>
            <label><input id="settings-connectivity-free-first" type="checkbox" ${connectivity.freeFirst ? 'checked' : ''}> Free routes first</label>
            <label><input id="settings-connectivity-direct-first" type="checkbox" ${connectivity.directFirst ? 'checked' : ''}> Direct routes first</label>
            <label><input id="settings-connectivity-battery-aware" type="checkbox" ${connectivity.batteryAware ? 'checked' : ''}> Battery-aware</label>
            <label>Metered network permission
              <select id="settings-connectivity-metered-permission" class="form-input">
                ${(['ask', 'allow-once', 'always-allow', 'wait-for-free'] as const).map((permission) => `<option value="${permission}" ${connectivity.meteredPermission === permission ? 'selected' : ''}>${permission.replaceAll('-', ' ')}</option>`).join('')}
              </select>
              <small>IinPublic asks before using a newly metered route. Nearby OS permission enables local discovery; denying it leaves Internet connectivity available.</small>
            </label>
            <label><input id="settings-connectivity-forwarding" type="checkbox" ${connectivity.forwarding.enabled ? 'checked' : ''}> Forward for peers</label>
            <label><input id="settings-connectivity-cellular-forwarding" type="checkbox" ${connectivity.forwarding.cellularForwarding ? 'checked' : ''}> Allow cellular forwarding</label>
            <label>Cellular byte budget <input id="settings-connectivity-cellular-budget" class="form-input" type="number" min="0" value="${connectivity.forwarding.cellularByteBudget}"></label>
            <details><summary>Advanced diagnostics</summary><div id="settings-connectivity-diagnostics" data-testid="settings-connectivity-diagnostics">Providers and verified SEA bindings appear here when active. Transport identifiers are diagnostics only.</div></details>
          </div>`,
        )}
        ${renderSettingsSection(
          {
            id: 'settings-section-download-app',
            title: deps.t('settingsDownloadApp'),
            subtitle: deps.t('settingsDownloadAppSubtitle'),
          },
          `<div id="settings-download-app-body" data-testid="settings-download-app-body" style="display:grid;gap:10px;">${renderDownloadAppSectionBody(deps.appDownloadTextDeps(), {})}</div>`,
        )}
        ${renderSettingsSection(
          {
            id: 'settings-section-linked-devices',
            title: deps.t('settingsIdentityDevices'),
            subtitle: deps.t('settingsIdentityDevicesHelp'),
            action: `<button type="button" class="btn" id="settings-linked-devices-btn" data-testid="settings-linked-devices-btn">${deps.t('settingsManage')}</button>`,
          },
          '',
        )}
        ${renderSettingsSection(
          {
            id: 'settings-section-erase-device',
            title: deps.t('settingsEraseDevice'),
            subtitle: deps.t('settingsEraseDeviceHelp'),
            action: `<button type="button" class="btn" id="settings-erase-device-btn" data-testid="settings-erase-device-btn" style="background:var(--danger);color:#fff;">${deps.t('settingsEraseDevice')}</button>`,
            danger: true,
          },
          '',
        )}
        ${renderSettingsSection(
          {
            id: 'settings-storage-inspector',
            title: deps.t('settingsStorage'),
            action: `<button type="button" class="btn" id="settings-refresh-storage-btn">${deps.t('settingsRefresh')}</button>`,
          },
          `<div id="settings-storage-inspector-body" style="font-size:0.9em;color:var(--text-tertiary);">${deps.t('settingsStorageLoading')}</div>`,
        )}
        ${renderSettingsSection(
          {
            id: 'settings-section-help',
            title: deps.t('settingsHelp'),
            subtitle: deps.t('settingsHelpSubtitle'),
            action: `<button type="button" class="btn" id="settings-replay-walkthrough-btn" data-testid="settings-replay-walkthrough-btn">${deps.t('settingsReplayWalkthrough')}</button>`,
          },
          '',
        )}
        </div>
      </div>
    `;
  // TechSupport's support-inbox is an operator inbox, not a settings section — it stays
  // permanently visible above the menu/detail split rather than gated behind a menu tap.
  // docs/TODO.md K7: an eligible (non-master) user gets the opt-in prompt, plus the same
  // inbox section once they've actually opted in.
  if (user.id === TECHSUPPORT_ROOT_USER_ID) {
    container.insertAdjacentHTML(
      'afterbegin',
      '<div id="support-delegates-section" style="margin-bottom:14px;"></div>' +
        '<div id="support-inbox-section" style="margin-bottom:14px;"></div>',
    );
  } else if (deps.techSupportDelegateEligible) {
    container.insertAdjacentHTML(
      'afterbegin',
      (deps.techSupportDelegateOptedIn
        ? '<div id="support-inbox-section" style="margin-bottom:14px;"></div>'
        : '') + '<div id="support-delegate-optin-section" style="margin-bottom:14px;"></div>',
    );
  }
  deps.bindSettingsControls();
  void deps.refreshStorageInspector();
  void deps.refreshDownloadAppSection();
  deps.renderSupportInboxSectionIfPresent();
  deps.renderSupportDelegatesSectionIfPresent();
  deps.renderSupportDelegateOptInSectionIfPresent();
  deps.applySettingsSectionView(deps.settingsActiveSectionId);
}
