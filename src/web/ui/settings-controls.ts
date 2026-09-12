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
  saveConnectivitySettings,
  type ConnectivityPreset,
} from './connectivity-settings';
import {
  setChatbotEnabled,
  setColorSchemePreference,
  setCopyTalkAutoSave,
  setDefaultTalkLanguagePreference,
  setKeepOldTalkOnEdit,
  setLocationAutoMatchConsent,
  setUiLanguagePreference,
  type ColorScheme,
} from './ui-settings-storage';
import {
  setTalkIntakeFilters,
  setTalkIntakeFiltersOwner,
  filterIncomingTalkClusters,
} from './talk-intake-filters';
import { normalizeCustomBlockedTerms, normalizeDirtyWords } from '../../shared/talk-intake-filters';
import { bindDirtyWordEditor } from './dirty-word-editor';
import { avatarInnerHtml } from './profile-avatar';
import type { UiTranslationKey } from './ui-translations';

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
  showWalkthrough: () => void;
  onStageNameChange: ((userId: string, newStageName: string) => Promise<void>) | undefined;
  onProfileChange: ((userId: string, updates: ProfileUpdates) => Promise<void>) | undefined;
  showEditProfileDialog: (user: User) => void;
  refreshStorageInspector: () => Promise<void>;
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

  const persistConnectivity = (): void => {
    const preset = (
      document.getElementById('settings-connectivity-preset') as HTMLSelectElement | null
    )?.value as ConnectivityPreset | undefined;
    if (!preset) return;
    const value = applyConnectivityPreset(preset);
    value.preset = preset;
    value.freeFirst = !!(
      document.getElementById('settings-connectivity-free-first') as HTMLInputElement | null
    )?.checked;
    value.directFirst = !!(
      document.getElementById('settings-connectivity-direct-first') as HTMLInputElement | null
    )?.checked;
    value.batteryAware = !!(
      document.getElementById('settings-connectivity-battery-aware') as HTMLInputElement | null
    )?.checked;
    value.meteredPermission = ((
      document.getElementById(
        'settings-connectivity-metered-permission',
      ) as HTMLSelectElement | null
    )?.value || 'ask') as typeof value.meteredPermission;
    value.forwarding.enabled = !!(
      document.getElementById('settings-connectivity-forwarding') as HTMLInputElement | null
    )?.checked;
    value.forwarding.cellularForwarding = !!(
      document.getElementById(
        'settings-connectivity-cellular-forwarding',
      ) as HTMLInputElement | null
    )?.checked;
    value.forwarding.cellularByteBudget = Math.max(
      0,
      Number(
        (
          document.getElementById(
            'settings-connectivity-cellular-budget',
          ) as HTMLInputElement | null
        )?.value || 0,
      ),
    );
    saveConnectivitySettings(value);
    deps.emit('connectivitySettingsChanged', value);
  };
  document
    .querySelectorAll('#settings-section-connectivity input, #settings-section-connectivity select')
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
    const minDistanceEl = document.getElementById(
      'settings-min-distance',
    ) as HTMLInputElement | null;
    const maxDistanceEl = document.getElementById(
      'settings-max-distance',
    ) as HTMLInputElement | null;
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
    if (minDistanceEl?.value) nextFilters.minDistanceMiles = Number(minDistanceEl.value);
    if (maxDistanceEl?.value) nextFilters.maxDistanceMiles = Number(maxDistanceEl.value);
    if (sentAfterEl?.value) nextFilters.sentAfter = new Date(sentAfterEl.value).toISOString();
    if (
      typeof nextFilters.minDistanceMiles === 'number' &&
      typeof nextFilters.maxDistanceMiles === 'number' &&
      nextFilters.minDistanceMiles > nextFilters.maxDistanceMiles
    ) {
      deps.showNotification(deps.t('settingsDistanceInvalid'), 'error');
      if (deps.currentUser?.talkFilters) {
        if (minDistanceEl)
          minDistanceEl.value = String(deps.currentUser.talkFilters.minDistanceMiles ?? '');
        if (maxDistanceEl)
          maxDistanceEl.value = String(deps.currentUser.talkFilters.maxDistanceMiles ?? '');
      }
      return;
    }
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
    'settings-min-distance',
    'settings-max-distance',
    'settings-sent-after',
    'settings-grammar-filter',
    'settings-dirty-words-filter',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', sync);
  });
  document.querySelectorAll('.settings-filter-language-option').forEach((el) => {
    el.addEventListener('change', sync);
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
  document.getElementById('settings-home-room')?.addEventListener('change', (event) => {
    deps.emit('setHomeChatroom', {
      chatroomId: (event.currentTarget as HTMLSelectElement).value,
    });
  });
  document.getElementById('settings-copy-talk-autosave')?.addEventListener('change', (event) => {
    setCopyTalkAutoSave((event.currentTarget as HTMLInputElement).checked);
  });
  document.getElementById('settings-chatbot-enabled')?.addEventListener('change', (event) => {
    setChatbotEnabled((event.currentTarget as HTMLInputElement).checked);
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
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      deps.showNotification(deps.t('settingsPhotoInvalidType'), 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      deps.showNotification(deps.t('settingsPhotoTooLarge'), 'error');
      return;
    }
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.addEventListener('load', () => resolve(String(reader.result || '')));
      reader.addEventListener('error', () =>
        reject(reader.error || new Error(deps.t('settingsPhotoReadFailed'))),
      );
      reader.readAsDataURL(file);
    });
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
      canvas.width = 512;
      canvas.height = 512;
      canvas.getContext('2d')?.drawImage(video, sx, sy, size, size, 0, 0, 512, 512);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      stopAndClose();
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
