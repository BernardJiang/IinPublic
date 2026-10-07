/** @jest-environment jsdom */

import type { User } from '../../shared/types';
import { bindSettingsControls, type SettingsControlsDeps } from '../../web/ui/settings-controls';
import {
  normalizeStringList,
  normalizeTalkFilterShape,
  renderSettingsView,
  type SettingsViewDeps,
} from '../../web/ui/settings-view';
import { uiText } from '../../web/ui/ui-translations';
import { getAutoAnswerScope, getNearbyBluetoothEnabled, getNearbyWifiDirectEnabled, NEARBY_SETTINGS_EVENT } from '../../web/ui/ui-settings-storage';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'settings-user',
    stageName: 'Settings User',
    profile: [],
    reputation: {
      questionsAnswered: 0,
      talksSent: 0,
      matchesFound: 0,
      friendsCount: 0,
      mutualFriendsCount: 0,
      likedCount: 0,
      dislikedCount: 0,
      starRating: 0,
      reviewCount: 0,
      ageVerified: false,
      ageVerificationVotes: 0,
      blockCount: 0,
      isHidden: false,
    },
    location: { region: 'test', chatrooms: [] },
    languages: ['en'],
    interests: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastActive: new Date('2026-09-12T00:00:00.000Z'),
    ...overrides,
  };
}

function viewDeps(overrides: Partial<SettingsViewDeps> = {}): SettingsViewDeps {
  const t: SettingsViewDeps['t'] = (key) => uiText('en', key);
  return {
    currentLocation: undefined,
    incomingTalkClusters: [],
    customChatrooms: [],
    getHomeChatroomId: () => 'global',
    formatReasonCounts: () => '',
    getUiLanguage: () => 'en',
    formatTalkLanguage: (code) => code,
    t,
    tf: (key) => t(key),
    appDownloadTextDeps: () => ({ text: t, tf: (key) => t(key), escapeHtml: (value) => value }),
    techSupportDelegateEligible: false,
    techSupportDelegateOptedIn: false,
    bindSettingsControls: jest.fn(),
    refreshStorageInspector: jest.fn(async () => undefined),
    refreshDownloadAppSection: jest.fn(async () => undefined),
    renderSupportInboxSectionIfPresent: jest.fn(),
    renderSupportDelegatesSectionIfPresent: jest.fn(),
    renderSupportDelegateOptInSectionIfPresent: jest.fn(),
    renderTechSupportRecoveryBannerIfPresent: jest.fn(),
    applySettingsSectionView: jest.fn(),
    settingsActiveSectionId: null,
    ...overrides,
  };
}

function controlsDeps(overrides: Partial<SettingsControlsDeps> = {}): SettingsControlsDeps {
  return {
    currentUser: makeUser(),
    incomingTalkClusters: [],
    currentLocation: undefined,
    t: (key) => uiText('en', key),
    showNotification: jest.fn(),
    emit: jest.fn(),
    setSettingsActiveSectionId: jest.fn(),
    applySettingsSectionView: jest.fn(),
    clearHiddenMessageToasts: jest.fn(),
    rerenderOpenConversation: jest.fn(),
    formatReasonCounts: () => '',
    applyShellTranslations: jest.fn(),
    renderSettingsView: jest.fn(),
    displayTalksList: jest.fn(),
    openLinkedDevicesDialog: jest.fn(async () => undefined),
    openEraseDeviceDialog: jest.fn(),
    showActionableGuide: jest.fn(),
    showWalkthrough: jest.fn(),
    onStageNameChange: undefined,
    onProfileChange: undefined,
    showEditProfileDialog: jest.fn(),
    refreshStorageInspector: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe('settings view extraction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it('normalizes legacy lists and rejects unsupported talk types', () => {
    expect(normalizeStringList(' en, zh ')).toEqual(['en', 'zh']);
    expect(normalizeStringList([], ['en'])).toEqual(['en']);
    expect(
      normalizeTalkFilterShape({
        allowedLanguages: ['ZH'],
        allowedTalkTypes: ['flow', 'bogus'],
        customBlockedTerms: ['  NOPE  '],
        dirtyWords: [],
      }),
    ).toEqual(
      expect.objectContaining({
        allowedLanguages: ['zh'],
        allowedTalkTypes: ['flow'],
        customBlockedTerms: ['nope'],
        dirtyWords: [],
      }),
    );
  });

  it('renders the complete settings shell and runs the existing post-render lifecycle', () => {
    document.body.innerHTML = '<div id="settings-content"></div>';
    const deps = viewDeps({ settingsActiveSectionId: 'settings-section-languages' });
    const user = makeUser({ stageName: '<Settings>', languages: ['EN', 'zh'] });

    renderSettingsView(user, deps);

    expect(document.querySelector('#settings-jump-menu')).not.toBeNull();
    expect(document.querySelector('#settings-section-languages')).not.toBeNull();
    expect(document.querySelector('#settings-start-guide-btn')).not.toBeNull();
    expect(document.querySelector('#settings-replay-walkthrough-btn')).not.toBeNull();
    expect(document.querySelector<HTMLSelectElement>('#settings-auto-answer-scope')?.value).toBe('whenever');
    expect(document.querySelector<HTMLInputElement>('#settings-stage-name-input')?.value).toBe(
      '<Settings>',
    );
    expect(document.querySelector('script')).toBeNull();
    expect(user.languages).toEqual(['en', 'zh']);
    expect(deps.bindSettingsControls).toHaveBeenCalledTimes(1);
    expect(deps.refreshStorageInspector).toHaveBeenCalledTimes(1);
    expect(deps.refreshDownloadAppSection).toHaveBeenCalledTimes(1);
    expect(deps.applySettingsSectionView).toHaveBeenCalledWith('settings-section-languages');
  });

  it('shows contacts-only Talk exchange off by default and checked when enabled', () => {
    document.body.innerHTML = '<div id="settings-content"></div>';
    renderSettingsView(makeUser(), viewDeps());
    expect(
      document.querySelector<HTMLInputElement>('#settings-contacts-only-talks')?.checked,
    ).toBe(false);

    document.body.innerHTML = '<div id="settings-content"></div>';
    renderSettingsView(
      makeUser({
        id: 'settings-user-enabled',
        talkFilters: {
          ...normalizeTalkFilterShape(undefined),
          contactsOnlyTalks: true,
        },
      }),
      viewDeps(),
    );
    expect(
      document.querySelector<HTMLInputElement>('#settings-contacts-only-talks')?.checked,
    ).toBe(true);
  });

  it('does nothing when the settings root is absent', () => {
    const deps = viewDeps();
    renderSettingsView(makeUser(), deps);
    expect(deps.bindSettingsControls).not.toHaveBeenCalled();
  });

  describe('app version line', () => {
    // Real bug found live 2026-09-24: a plain browser session showed the literal word "web"
    // instead of an actual version number — process.env.IINPUBLIC_APP_VERSION (webpack.config.js's
    // DefinePlugin, baked in from package.json) didn't exist yet. Jest never runs webpack, so
    // these tests set/clear the env var directly to exercise the same fallback chain the built
    // bundle goes through.
    const originalEnv = process.env.IINPUBLIC_APP_VERSION;
    afterEach(() => {
      if (originalEnv === undefined) delete process.env.IINPUBLIC_APP_VERSION;
      else process.env.IINPUBLIC_APP_VERSION = originalEnv;
    });

    it('shows the build-time package version for a plain web session, labeled "web"', () => {
      process.env.IINPUBLIC_APP_VERSION = '1.0.51';
      document.body.innerHTML = '<div id="settings-content"></div>';
      renderSettingsView(makeUser(), viewDeps());
      expect(document.getElementById('settings-app-version')?.textContent).toContain('1.0.51');
      expect(document.getElementById('settings-app-version')?.textContent).toContain('web');
    });

    it('falls back to the literal "web" only when no build-time version was ever injected', () => {
      delete process.env.IINPUBLIC_APP_VERSION;
      document.body.innerHTML = '<div id="settings-content"></div>';
      renderSettingsView(makeUser(), viewDeps());
      expect(document.getElementById('settings-app-version')?.textContent).toContain('web');
    });

    it('prefers a native shell\'s own reported version and platform over the build-time web version', () => {
      process.env.IINPUBLIC_APP_VERSION = '1.0.51';
      (window as unknown as { iinpublicNative?: { version?: string; platform?: string } }).iinpublicNative = {
        version: '1.0.51-android',
        platform: 'android',
      };
      try {
        document.body.innerHTML = '<div id="settings-content"></div>';
        renderSettingsView(makeUser(), viewDeps());
        const text = document.getElementById('settings-app-version')?.textContent || '';
        expect(text).toContain('1.0.51-android');
        expect(text).toContain('android');
      } finally {
        delete (window as unknown as { iinpublicNative?: unknown }).iinpublicNative;
      }
    });
  });

  it('routes drill-down selection through the manager-owned state callback', () => {
    document.body.innerHTML = `
      <div id="settings-jump-menu">
        <button class="settings-jump-menu-item" data-target="settings-section-profile">Profile</button>
      </div>`;
    const deps = controlsDeps();
    bindSettingsControls(deps);

    document.querySelector<HTMLButtonElement>('.settings-jump-menu-item')?.click();

    expect(deps.setSettingsActiveSectionId).toHaveBeenCalledWith('settings-section-profile');
    expect(deps.applySettingsSectionView).toHaveBeenCalledWith('settings-section-profile');
  });

  it('shows the nearby switches only in the Android app, both on by default', () => {
    document.body.innerHTML = '<div id="settings-content"></div>';
    renderSettingsView(makeUser(), viewDeps());
    expect(document.querySelector('#settings-section-nearby')).toBeNull();

    (window as unknown as { IinPublicNearby?: unknown }).IinPublicNearby = { startLanDiscovery: () => undefined };
    try {
      document.body.innerHTML = '<div id="settings-content"></div>';
      renderSettingsView(makeUser(), viewDeps());
      expect(document.querySelector('#settings-section-nearby')).not.toBeNull();
      expect(document.querySelector<HTMLInputElement>('#settings-nearby-wifi-direct')?.checked).toBe(true);
      expect(document.querySelector<HTMLInputElement>('#settings-nearby-bluetooth')?.checked).toBe(true);
      expect(document.querySelector('#settings-nearby-status')).not.toBeNull();
    } finally {
      delete (window as unknown as { IinPublicNearby?: unknown }).IinPublicNearby;
    }
  });

  it('turning a nearby switch off persists it and notifies the app', () => {
    document.body.innerHTML = `
      <input type="checkbox" id="settings-nearby-wifi-direct" checked>
      <input type="checkbox" id="settings-nearby-bluetooth" checked>`;
    bindSettingsControls(controlsDeps());
    const changed = jest.fn();
    window.addEventListener(NEARBY_SETTINGS_EVENT, changed);
    const bluetooth = document.getElementById('settings-nearby-bluetooth') as HTMLInputElement;
    bluetooth.checked = false;
    bluetooth.dispatchEvent(new Event('change', { bubbles: true }));
    window.removeEventListener(NEARBY_SETTINGS_EVENT, changed);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(getNearbyBluetoothEnabled()).toBe(false);
    expect(getNearbyWifiDirectEnabled()).toBe(true);
  });

  it('stores one Auto scope for all answers', () => {
    document.body.innerHTML = `
      <select id="settings-auto-answer-scope">
        <option value="same-context">Same context</option>
        <option value="whenever">Whenever offered</option>
      </select>`;
    bindSettingsControls(controlsDeps());

    const select = document.getElementById('settings-auto-answer-scope') as HTMLSelectElement;
    select.value = 'whenever';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(getAutoAnswerScope()).toBe('whenever');
  });

  it('persists and emits the contacts-only Talk exchange preference', () => {
    document.body.innerHTML = `
      <input type="checkbox" id="settings-contacts-only-talks">
      <input type="checkbox" id="settings-grammar-filter">
      <input type="checkbox" id="settings-dirty-words-filter">
    `;
    const user = makeUser();
    const deps = controlsDeps({ currentUser: user });
    bindSettingsControls(deps);

    const checkbox = document.getElementById('settings-contacts-only-talks') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    expect(user.talkFilters?.contactsOnlyTalks).toBe(true);
    expect(deps.emit).toHaveBeenCalledWith(
      'updateTalkFilters',
      expect.objectContaining({ contactsOnlyTalks: true }),
    );
  });

  it('keeps the actionable guide and reference tour as separate Help actions', () => {
    document.body.innerHTML = `
      <button id="settings-start-guide-btn">Start</button>
      <button id="settings-replay-walkthrough-btn">How it works</button>`;
    const deps = controlsDeps();
    bindSettingsControls(deps);

    document.getElementById('settings-start-guide-btn')?.click();
    document.getElementById('settings-replay-walkthrough-btn')?.click();

    expect(deps.showActionableGuide).toHaveBeenCalledTimes(1);
    expect(deps.showWalkthrough).toHaveBeenCalledTimes(1);
  });

  it('preserves stage-name validation without calling the persistence hook', () => {
    document.body.innerHTML = `
      <input id="settings-stage-name-input" value="ab">
      <div id="settings-stage-name-error"></div>`;
    const onStageNameChange = jest.fn(async () => undefined);
    const deps = controlsDeps({ onStageNameChange });
    bindSettingsControls(deps);

    document
      .querySelector<HTMLInputElement>('#settings-stage-name-input')
      ?.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onStageNameChange).not.toHaveBeenCalled();
    expect(deps.showNotification).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(document.querySelector<HTMLInputElement>('#settings-stage-name-input')?.value).toBe(
      'Settings User',
    );
  });
});
