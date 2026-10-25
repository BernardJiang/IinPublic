import { clearEncounterLocation, getEncounterLocation, setEncounterLocation } from '../services/encounter-location';
import { bindAppPermissionsSettings } from './app-permissions-settings';
import { bindQuietPlaces } from './location-settings';
import { setDistanceUnit } from './distance-units';
import { showEncounterLocationPicker } from './encounter-location-picker';
import {
  type GPSCoordinate,
  type QuestionAnswer,
  type Tag,
  type TalkIntakeFilters,
  type User,
} from '../../shared/types';
import { escapeHtml } from './ui-formatters';
import {
  applyConnectivityPreset,
  loadConnectivitySettings,
  saveConnectivitySettings,
  type ConnectivityPreset,
} from './connectivity-settings';
import {
  setAutoAnswerScope,
  setNearbySetting,
  setChatbotEnabled,
  setColorSchemePreference,
  setCopyTalkAutoSave,
  setDefaultTalkLanguagePreference,
  setKeepOldTalkOnEdit,
  setLocationAutoMatchConsent,
  setMatchCollectionEnabled,
  setUiLanguagePreference,
  type ColorScheme,
  type AutoAnswerScope,
} from './ui-settings-storage';
import { applyAutoAnswerScopeToStoredPreferences } from './answer-preference-mutations';
import {
  setTalkIntakeFilters,
  setTalkIntakeFiltersOwner,
  filterIncomingTalkClusters,
} from './talk-intake-filters';
import { normalizeCustomBlockedTerms, normalizeDirtyWords } from '../../shared/talk-intake-filters';
import { bindDirtyWordEditor } from './dirty-word-editor';
import { avatarInnerHtml } from './profile-avatar';
import { ProfilePhotoError, shrinkProfilePhoto } from './profile-photo';
import type { UiTranslationKey } from './ui-translations';
import { setContactsCap } from '../services/contacts-prune';

interface ProfileUpdates {
  headshot?: string;
  languages: string[];
  profile: QuestionAnswer[];
  interests: Tag[];
}

export interface SettingsControlsDeps {
  currentUser: User | undefined;
  incomingTalkClusters: any[];
  currentLocation: GPSCoordinate | undefined;
  t: (key: UiTranslationKey) => string;
  showNotification: (message: string, type: 'error') => void;
  emit: (event: string, payload: unknown) => void;
  setSettingsActiveSectionId: (sectionId: string) => void;
  applySettingsSectionView: (sectionId: string) => void;
  clearHiddenMessageToasts: () => void;
  rerenderOpenConversation: () => void;
  formatReasonCounts: (counts: Record<string, number>) => string;
  applyShellTranslations: () => void;
  renderSettingsView: (user: User) => void;
  displayTalksList: () => void;
  openLinkedDevicesDialog: () => Promise<void>;
  openEraseDeviceDialog: () => void;
  showActionableGuide: () => void;
  showWalkthrough: () => void;
  onStageNameChange: ((userId: string, newStageName: string) => Promise<void>) | undefined;
  onProfileChange: ((userId: string, updates: ProfileUpdates) => Promise<void>) | undefined;
  showEditProfileDialog: (user: User) => void;
  refreshStorageInspector: () => Promise<void>;
  refreshDownloadAppSection: () => Promise<void>;
}

/** Map the Talk audience radio onto the two stored switches. */
export function talkAudienceFilters(value: string | undefined): Pick<TalkIntakeFilters, 'contactsOnlyTalks' | 'residentsOnlyTalks'> {
  return { contactsOnlyTalks: value === 'contacts', residentsOnlyTalks: value === 'residents' };
}

export function bindSettingsControls(deps: SettingsControlsDeps): void {
  document.getElementById('settings-jump-menu')?.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest(
      '.settings-jump-menu-item',
    ) as HTMLElement | null;
    const sectionId = target?.dataset.target;
    if (!sectionId) return;
    deps.setSettingsActiveSectionId(sectionId);
    deps.applySettingsSectionView(sectionId);
    // Let the selected detail paint before its optional I/O and local-storage inspection begin.
    // In particular, getBrowserStorageSnapshot has synchronous work before its first await.
    if (sectionId === 'settings-storage-inspector') {
      window.setTimeout(() => { void deps.refreshStorageInspector(); }, 0);
    }
    if (sectionId === 'settings-section-download-app') {
      window.setTimeout(() => { void deps.refreshDownloadAppSection(); }, 0);
    }
  });

  document.getElementById('settings-scheme-picker')?.addEventListener('change', (event) => {
    const radio = event.target as HTMLInputElement;
    if (!radio.classList.contains('settings-scheme-radio')) return;
    const scheme = radio.value as ColorScheme;
    setColorSchemePreference(scheme);
    // Applies instantly via the [data-color-scheme] attribute (main.css tokens do the
    // rest) — no full re-render needed, just move the selected-option border highlight.
    document.querySelectorAll<HTMLElement>('.settings-scheme-option').forEach((label) => {
      label.style.borderColor = label.dataset.scheme === scheme ? 'var(--accent)' : 'var(--border)';
    });
  });

  const policyControlIds = new Set([
    'settings-nearby-privacy-mode',
    'settings-connectivity-free-first',
    'settings-connectivity-direct-first',
    'settings-connectivity-battery-aware',
    'settings-connectivity-wifi-forwarding',
    'settings-connectivity-identity-reveal',
    'settings-connectivity-metered-permission',
    'settings-connectivity-forwarding',
    'settings-connectivity-cellular-forwarding',
    'settings-connectivity-cellular-budget',
  ]);
  const updateConnectivityForm = (value: ReturnType<typeof loadConnectivitySettings>): void => {
    const setChecked = (id: string, checked: boolean): void => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (input) input.checked = checked;
    };
    const setValue = (id: string, next: string): void => {
      const input = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
      if (input) input.value = next;
    };
    setValue('settings-connectivity-preset', value.preset);
    setChecked('settings-connectivity-free-first', value.freeFirst);
    setChecked('settings-connectivity-direct-first', value.directFirst);
    setChecked('settings-connectivity-battery-aware', value.batteryAware);
    setValue('settings-nearby-mode', value.nearbyMode);
    setValue('settings-nearby-privacy-mode', value.nearbyPrivacyMode);
    setChecked('settings-connectivity-wifi-forwarding', value.wifiOnlyForwarding);
    setValue('settings-connectivity-identity-reveal', value.identityReveal);
    setValue('settings-connectivity-metered-permission', value.meteredPermission);
    setChecked('settings-connectivity-forwarding', value.forwarding.enabled);
    setChecked('settings-connectivity-cellular-forwarding', value.forwarding.cellularForwarding);
    setValue('settings-connectivity-cellular-budget', String(value.forwarding.cellularByteBudget));
    const status = document.getElementById('settings-connectivity-status');
    if (status) status.textContent = `${value.preset.replaceAll('-', ' ')} route selection · forwarding ${value.forwarding.enabled ? 'on' : 'off'}`;
  };
  const persistConnectivity = (event: Event): void => {
    const changed = event.target as HTMLInputElement | HTMLSelectElement | null;
    const current = loadConnectivitySettings();
    const checked = (id: string, fallback: boolean): boolean =>
      (document.getElementById(id) as HTMLInputElement | null)?.checked ?? fallback;
    const selectedPreset = (
      document.getElementById('settings-connectivity-preset') as HTMLSelectElement | null
    )?.value as ConnectivityPreset | undefined;
    if (!selectedPreset) return;
    if (changed?.id === 'settings-connectivity-preset') {
      const presetValue = applyConnectivityPreset(selectedPreset, current);
      updateConnectivityForm(presetValue);
      saveConnectivitySettings(presetValue);
      deps.emit('connectivitySettingsChanged', presetValue);
      return;
    }
    const value = { ...current, forwarding: { ...current.forwarding } };
    value.freeFirst = checked('settings-connectivity-free-first', current.freeFirst);
    value.directFirst = checked('settings-connectivity-direct-first', current.directFirst);
    value.batteryAware = checked('settings-connectivity-battery-aware', current.batteryAware);
    value.nearbyMode = ((
      document.getElementById('settings-nearby-mode') as HTMLSelectElement | null
    )?.value || current.nearbyMode) as typeof value.nearbyMode;
    value.nearbyPrivacyMode = ((
      document.getElementById('settings-nearby-privacy-mode') as HTMLSelectElement | null
    )?.value || current.nearbyPrivacyMode) as typeof value.nearbyPrivacyMode;
    const previousSource = current.locationSource;
    value.locationSource = ((
      document.querySelector('input[name="settings-location-source"]:checked') as HTMLInputElement | null
    )?.value || previousSource) === 'traveler' ? 'traveler' : 'resident';
    value.wifiOnlyForwarding = checked('settings-connectivity-wifi-forwarding', current.wifiOnlyForwarding);
    value.forwarding.wifiForwarding = value.wifiOnlyForwarding;
    value.identityReveal = ((
      document.getElementById('settings-connectivity-identity-reveal') as HTMLSelectElement | null
    )?.value || current.identityReveal) as typeof value.identityReveal;
    value.meteredPermission = ((
      document.getElementById(
        'settings-connectivity-metered-permission',
      ) as HTMLSelectElement | null
    )?.value || current.meteredPermission) as typeof value.meteredPermission;
    value.forwarding.enabled = checked('settings-connectivity-forwarding', current.forwarding.enabled);
    value.forwarding.cellularForwarding = checked(
      'settings-connectivity-cellular-forwarding',
      current.forwarding.cellularForwarding,
    );
    value.forwarding.cellularByteBudget = Math.max(
      0,
      Number(
        (
          document.getElementById(
            'settings-connectivity-cellular-budget',
          ) as HTMLInputElement | null
        )?.value || current.forwarding.cellularByteBudget,
      ),
    );
    if (changed?.id && policyControlIds.has(changed.id)) value.preset = 'advanced';
    updateConnectivityForm(value);
    saveConnectivitySettings(value);
    deps.emit('connectivitySettingsChanged', value);
    if (value.locationSource !== previousSource) {
      // Resident ↔ Traveler: re-read GPS or the chosen point, and show the matching controls.
      deps.emit('requestLocationUpdate', undefined);
      if (deps.currentUser) deps.renderSettingsView(deps.currentUser);
    }
  };
  bindAppPermissionsSettings(deps.t);
  document.getElementById('settings-use-my-location')?.addEventListener('click', () => {
    deps.emit('requestLocationPermission', undefined);
  });
  document
    .querySelectorAll('#settings-section-connectivity input, #settings-section-connectivity select, #settings-nearby-mode, #settings-nearby-privacy-mode, input[name="settings-location-source"]')
    .forEach((element) => {
      element.addEventListener('change', persistConnectivity);
    });

  const selectedValues = (id: string): string[] => {
    const el = document.getElementById(id) as HTMLSelectElement | HTMLInputElement | null;
    if (!el) return [];
    if (el instanceof HTMLSelectElement && el.multiple) {
      return Array.from(el.selectedOptions)
        .map((option) => option.value.trim().toLowerCase())
        .filter(Boolean);
    }
    return String(el.value || '')
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
  };

  const sync = () => {
    const filterLanguages = Array.from(
      document.querySelectorAll<HTMLInputElement>('.settings-filter-language-option'),
    )
      .filter((el) => el.checked)
      .map((el) => el.value.trim().toLowerCase())
      .filter(Boolean);
    const profileLanguages = selectedValues('settings-profile-languages');
    const sentAfterEl = document.getElementById('settings-sent-after') as HTMLInputElement | null;
    const customBlockedEl = document.getElementById(
      'settings-custom-blocked',
    ) as HTMLTextAreaElement | null;
    const typeEls = Array.from(
      document.querySelectorAll('.settings-talk-filter-type'),
    ) as HTMLInputElement[];
    const dirtyWordEls = Array.from(
      document.querySelectorAll<HTMLElement>('#dirty-word-chips .dirty-word-chip'),
    );
    const nextFilters: TalkIntakeFilters = {
      // Talk audience: everyone in the room, Residents only, or Contacts only.
      ...talkAudienceFilters(
        (document.querySelector('input[name="settings-talk-audience"]:checked') as HTMLInputElement | null)?.value,
      ),
      allowedLanguages: filterLanguages,
      requireGoodGrammar: !!(
        document.getElementById('settings-grammar-filter') as HTMLInputElement | null
      )?.checked,
      blockDirtyWords: !!(
        document.getElementById('settings-dirty-words-filter') as HTMLInputElement | null
      )?.checked,
      allowedTalkTypes: typeEls.filter((el) => el.checked).map((el) => el.value as any),
      customBlockedTerms: normalizeCustomBlockedTerms(
        (customBlockedEl?.value || '')
          .split(/[\n,]+/)
          .map((part) => part.trim())
          .filter(Boolean),
      ),
      dirtyWords: normalizeDirtyWords(dirtyWordEls.map((el) => el.getAttribute('data-word') || '')),
    };
    if (nextFilters.allowedLanguages.length === 0) nextFilters.allowedLanguages = ['en'];
    if (nextFilters.allowedTalkTypes.length === 0)
      nextFilters.allowedTalkTypes = ['flow', 'survey', 'tag', 'route'];
    if (sentAfterEl?.value) nextFilters.sentAfter = new Date(sentAfterEl.value).toISOString();
    setTalkIntakeFilters(nextFilters);
    if (deps.currentUser) setTalkIntakeFiltersOwner(deps.currentUser.id);
    // Message filters changed: re-render any open conversation so toggling a
    // filter off reveals previously hidden messages (and on reveals fresh
    // toasts can fire if re-enabled later). (redesign §9.1)
    if (deps.currentUser) deps.currentUser.talkFilters = nextFilters;
    deps.clearHiddenMessageToasts();
    deps.rerenderOpenConversation();
    const langCount = document.getElementById('settings-filter-languages-count');
    if (langCount)
      langCount.textContent = `${nextFilters.allowedLanguages.length} ${deps.t('settingsActive')}`;
    const filteredIncomingSummary = document.getElementById('settings-filtered-incoming-summary');
    if (filteredIncomingSummary) {
      const filteredIncoming = filterIncomingTalkClusters(
        (deps.incomingTalkClusters || []).filter((cluster: any) => cluster && cluster.identityKey),
        nextFilters,
        deps.currentLocation,
      );
      const reasonText = deps.formatReasonCounts(filteredIncoming.hiddenByReason);
      filteredIncomingSummary.innerHTML = `${deps.t('settingsHiddenIncoming')}: ${filteredIncoming.hiddenCount}${reasonText ? `<div>${escapeHtml(reasonText)}</div>` : ''}`;
    }
    if (deps.currentUser) {
      const nextProfileLanguages = profileLanguages.length > 0 ? profileLanguages : ['en'];
      const profileLanguageChanged =
        nextProfileLanguages.join(',') !== (deps.currentUser.languages || []).join(',');
      deps.currentUser.languages = nextProfileLanguages;
      deps.currentUser.talkFilters = nextFilters;
      if (profileLanguageChanged) {
        deps.applyShellTranslations();
        deps.renderSettingsView(deps.currentUser);
        void deps.onProfileChange?.(deps.currentUser.id, {
          ...(deps.currentUser.headshot ? { headshot: deps.currentUser.headshot } : {}),
          languages: nextProfileLanguages,
          profile: deps.currentUser.profile || [],
          interests: deps.currentUser.interests || [],
        });
      }
    }
    deps.emit('updateTalkFilters', nextFilters);
    if (document.getElementById('talks-view')?.classList.contains('active'))
      deps.displayTalksList();
  };
  [
    'settings-profile-languages',
    'settings-sent-after',
    'settings-grammar-filter',
    'settings-dirty-words-filter',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', sync);
  });
  document.querySelectorAll('.settings-filter-language-option, input[name="settings-talk-audience"]').forEach((el) => {
    el.addEventListener('change', sync);
  });
  bindQuietPlaces({ t: deps.t, rerender: () => { if (deps.currentUser) deps.renderSettingsView(deps.currentUser); } });
  document.getElementById('settings-distance-unit')?.addEventListener('change', (event) => {
    setDistanceUnit((event.currentTarget as HTMLSelectElement).value === 'mi' ? 'mi' : 'km');
    if (deps.currentUser) deps.renderSettingsView(deps.currentUser);
  });
  document.querySelectorAll('.settings-talk-filter-type').forEach((el) => {
    el.addEventListener('change', sync);
  });
  document.getElementById('settings-ui-language')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value === 'zh' ? 'zh' : 'en';
    setUiLanguagePreference(value);
    deps.applyShellTranslations();
    if (deps.currentUser) deps.renderSettingsView(deps.currentUser);
  });
  document.getElementById('settings-default-talk-language')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value === 'zh' ? 'zh' : 'en';
    setDefaultTalkLanguagePreference(value);
  });
  document.getElementById('settings-custom-blocked')?.addEventListener('input', sync);
  bindDirtyWordEditor({ onChange: sync, t: deps.t });
  document.getElementById('settings-linked-devices-btn')?.addEventListener('click', () => {
    void deps.openLinkedDevicesDialog();
  });
  document
    .getElementById('settings-erase-device-btn')
    ?.addEventListener('click', () => deps.openEraseDeviceDialog());
  document
    .getElementById('settings-replay-walkthrough-btn')
    ?.addEventListener('click', () => deps.showWalkthrough());
  document
    .getElementById('settings-start-guide-btn')
    ?.addEventListener('click', () => deps.showActionableGuide());
  document.getElementById('settings-copy-talk-autosave')?.addEventListener('change', (event) => {
    setCopyTalkAutoSave((event.currentTarget as HTMLInputElement).checked);
  });
  document.getElementById('settings-match-collection-enabled')?.addEventListener('change', (event) => {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    setMatchCollectionEnabled(enabled);
    deps.emit('matchCollectionSettingChanged', { enabled });
  });
  document.getElementById('settings-encounter-location-set')?.addEventListener('click', () => {
    const current = getEncounterLocation();
    showEncounterLocationPicker({
      t: deps.t,
      initial: current ? { latitude: current.latitude, longitude: current.longitude } : null,
      onConfirm: (point) => {
        // The app listens for the change and re-resolves the shared Nearby room at this point.
        setEncounterLocation(point.latitude, point.longitude);
        if (deps.currentUser) deps.renderSettingsView(deps.currentUser);
      },
    });
  });
  document.getElementById('settings-encounter-location-clear')?.addEventListener('click', () => {
    clearEncounterLocation();
    if (deps.currentUser) deps.renderSettingsView(deps.currentUser);
  });
  for (const kind of ['cellular', 'lan', 'wifi-direct', 'bluetooth'] as const) {
    document.getElementById(`settings-nearby-${kind}`)?.addEventListener('change', (event) => {
      setNearbySetting(kind, (event.currentTarget as HTMLInputElement).checked);
    });
  }
  document.getElementById('settings-contacts-cap')?.addEventListener('change', (event) => {
    setContactsCap(Number((event.currentTarget as HTMLSelectElement).value));
    deps.emit('contactsCapChanged', undefined);
  });
  document.getElementById('settings-chatbot-enabled')?.addEventListener('change', (event) => {
    setChatbotEnabled((event.currentTarget as HTMLInputElement).checked);
  });
  document.getElementById('settings-auto-answer-scope')?.addEventListener('change', (event) => {
    const scope = (event.currentTarget as HTMLSelectElement).value as AutoAnswerScope;
    setAutoAnswerScope(scope);
    applyAutoAnswerScopeToStoredPreferences(scope);
  });
  document
    .getElementById('settings-location-auto-match-consent')
    ?.addEventListener('change', (event) => {
      setLocationAutoMatchConsent((event.currentTarget as HTMLInputElement).checked);
    });
  document.getElementById('settings-keep-old-talk-on-edit')?.addEventListener('change', (event) => {
    setKeepOldTalkOnEdit((event.currentTarget as HTMLInputElement).checked);
  });
  document
    .getElementById('settings-stage-name-input')
    ?.addEventListener('change', async (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const errorText = document.getElementById('settings-stage-name-error') as HTMLElement | null;
      const showStageNameError = (message: string): void => {
        if (errorText) {
          errorText.textContent = message;
          errorText.style.display = message ? 'block' : 'none';
        }
      };
      const next = input.value.trim();
      if (!deps.currentUser || next === deps.currentUser.stageName) return;
      showStageNameError('');
      if (next.length < 3) {
        const message = deps.t('settingsStageNameTooShort');
        showStageNameError(message);
        deps.showNotification(message, 'error');
        input.value = deps.currentUser.stageName;
        return;
      }
      try {
        await deps.onStageNameChange?.(deps.currentUser.id, next);
      } catch (error) {
        input.value = deps.currentUser.stageName;
        const message =
          error instanceof Error && /reserved/i.test(error.message)
            ? deps.t('settingsStageNameReserved')
            : deps.t('settingsStageNameUpdateFailed');
        showStageNameError(message);
        deps.showNotification(message, 'error');
      }
    });
  document.getElementById('settings-headshot-select')?.addEventListener('change', async (event) => {
    if (!deps.currentUser) return;
    const headshot = (event.currentTarget as HTMLSelectElement).value.trim();
    await deps.onProfileChange?.(deps.currentUser.id, {
      ...(headshot ? { headshot } : {}),
      languages: deps.currentUser.languages || ['en'],
      profile: deps.currentUser.profile || [],
      interests: deps.currentUser.interests || [],
    });
  });
  const saveHeadshot = async (headshot?: string): Promise<void> => {
    if (!deps.currentUser) return;
    await deps.onProfileChange?.(deps.currentUser.id, {
      ...(headshot ? { headshot } : {}),
      languages: deps.currentUser.languages || ['en'],
      profile: deps.currentUser.profile || [],
      interests: deps.currentUser.interests || [],
    });
  };
  const showCameraStatus = (message: string): void => {
    const status = document.getElementById('settings-camera-status') as HTMLElement | null;
    if (!status) return;
    status.textContent = message;
    status.style.display = message ? 'block' : 'none';
  };
  const confirmPhoto = async (dataUrl: string): Promise<boolean> => {
    document.getElementById('settings-photo-preview-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'settings-photo-preview-modal';
    modal.dataset.testid = 'settings-photo-preview-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:420px;">
          <div class="modal-header">
            <h2 class="modal-title">${deps.t('settingsPhotoPreviewTitle')}</h2>
            <p>${deps.t('settingsPhotoPreviewHelp')}</p>
          </div>
          <div class="user-avatar" style="width:160px;height:160px;margin:12px auto;font-size:2em;">
            ${avatarInnerHtml(dataUrl, deps.currentUser?.stageName.charAt(0).toUpperCase() || '?', escapeHtml)}
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" data-testid="settings-photo-preview-cancel">${deps.t('settingsPhotoPreviewCancel')}</button>
            <button type="button" class="btn primary-btn" data-testid="settings-photo-preview-confirm">${deps.t('settingsPhotoPreviewSave')}</button>
          </div>
        </div>
      `;
    document.body.appendChild(modal);
    return new Promise<boolean>((resolve) => {
      const finish = (confirmed: boolean): void => {
        modal.remove();
        resolve(confirmed);
      };
      modal
        .querySelector('[data-testid="settings-photo-preview-confirm"]')
        ?.addEventListener('click', () => finish(true));
      modal
        .querySelector('[data-testid="settings-photo-preview-cancel"]')
        ?.addEventListener('click', () => finish(false));
      modal.addEventListener('click', (event) => {
        if (event.target === modal) finish(false);
      });
    });
  };
  const readPhoto = async (file?: File): Promise<void> => {
    if (!file) return;
    // No size or format gate here: modern cameras produce 8-15 MB originals, and refusing them just
    // turns users away. Whatever image the device can decode is centre-cropped and shrunk to a small
    // square JPEG (profile-photo.ts); only a file the device cannot read as an image is rejected.
    let dataUrl: string;
    try {
      dataUrl = await shrinkProfilePhoto(file);
    } catch (error) {
      const tooLarge = error instanceof ProfilePhotoError && error.code === 'too-large-source';
      deps.showNotification(deps.t(tooLarge ? 'settingsPhotoTooLarge' : 'settingsPhotoInvalidType'), 'error');
      return;
    }
    showCameraStatus('');
    if (await confirmPhoto(dataUrl)) await saveHeadshot(dataUrl);
  };
  const takePhoto = async (): Promise<void> => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      const message = deps.t('settingsCameraUnavailable');
      showCameraStatus(message);
      deps.showNotification(message, 'error');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
    } catch {
      const message = deps.t('settingsCameraDenied');
      showCameraStatus(message);
      deps.showNotification(message, 'error');
      return;
    }
    document.getElementById('settings-camera-capture-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'settings-camera-capture-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:480px;">
          <div class="modal-header">
            <h2 class="modal-title">${deps.t('settingsCameraCaptureTitle')}</h2>
            <p>${deps.t('settingsCameraCaptureHelp')}</p>
          </div>
          <video id="settings-camera-preview-video" autoplay muted playsinline style="display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:14px;background:var(--text-primary);"></video>
          <div class="modal-actions">
            <button type="button" class="btn" data-testid="settings-camera-cancel">${deps.t('settingsPhotoPreviewCancel')}</button>
            <button type="button" class="btn primary-btn" data-testid="settings-camera-capture" disabled>${deps.t('settingsCameraCapture')}</button>
          </div>
        </div>
      `;
    document.body.appendChild(modal);
    const video = modal.querySelector('#settings-camera-preview-video') as HTMLVideoElement | null;
    const capture = modal.querySelector(
      '[data-testid="settings-camera-capture"]',
    ) as HTMLButtonElement | null;
    const stopAndClose = (): void => {
      stream.getTracks().forEach((track) => track.stop());
      modal.remove();
    };
    if (video) {
      video.srcObject = stream;
      video.addEventListener(
        'loadedmetadata',
        () => {
          if (capture) capture.disabled = false;
        },
        { once: true },
      );
      void video.play().catch(() => undefined);
    }
    modal
      .querySelector('[data-testid="settings-camera-cancel"]')
      ?.addEventListener('click', stopAndClose);
    capture?.addEventListener('click', async () => {
      if (!video || video.videoWidth < 1 || video.videoHeight < 1) return;
      const size = Math.min(video.videoWidth, video.videoHeight);
      const sx = Math.max(0, (video.videoWidth - size) / 2);
      const sy = Math.max(0, (video.videoHeight - size) / 2);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d')?.drawImage(video, sx, sy, size, size, 0, 0, size, size);
      stopAndClose();
      // Same shrink pipeline as a chosen file, so a camera frame also lands inside the small Gun budget.
      const frame = await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92));
      let dataUrl: string;
      try {
        if (!frame) throw new ProfilePhotoError('unreadable');
        dataUrl = await shrinkProfilePhoto(frame);
      } catch {
        deps.showNotification(deps.t('settingsPhotoReadFailed'), 'error');
        return;
      }
      showCameraStatus('');
      if (await confirmPhoto(dataUrl)) await saveHeadshot(dataUrl);
    });
  };
  const photoInput = document.getElementById('settings-photo-input') as HTMLInputElement | null;
  const cameraInput = document.getElementById('settings-camera-input') as HTMLInputElement | null;
  document
    .getElementById('settings-choose-photo-btn')
    ?.addEventListener('click', () => photoInput?.click());
  document
    .getElementById('settings-take-photo-btn')
    ?.addEventListener('click', () => void takePhoto());
  photoInput?.addEventListener('change', () => void readPhoto(photoInput.files?.[0]));
  cameraInput?.addEventListener('change', () => void readPhoto(cameraInput.files?.[0]));
  document
    .getElementById('settings-remove-photo-btn')
    ?.addEventListener('click', () => void saveHeadshot());
  document.getElementById('settings-edit-profile-btn')?.addEventListener('click', () => {
    if (deps.currentUser) deps.showEditProfileDialog(deps.currentUser);
  });
  document.getElementById('settings-credit-visible')?.addEventListener('change', (event) => {
    const visible = (event.currentTarget as HTMLInputElement).checked;
    if (deps.currentUser?.reputation) deps.currentUser.reputation.isHidden = !visible;
    deps.emit('setCreditVisibility', { visible });
  });
  document.getElementById('settings-refresh-storage-btn')?.addEventListener('click', () => {
    void deps.refreshStorageInspector();
  });
}
