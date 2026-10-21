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
import { getEncounterLocation, setEncounterLocation } from '../../web/services/encounter-location';
import { getAutoAnswerScope, getNearbyBluetoothEnabled, getNearbyProviderEnabled, getNearbyWifiDirectEnabled, NEARBY_SETTINGS_EVENT } from '../../web/ui/ui-settings-storage';
import { loadConnectivitySettings } from '../../web/ui/connectivity-settings';

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

// Tests that simulate a GPS-less website set this; never leak it into the next test.
afterEach(() => { delete (window as any).__test_location; });

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
    const deps = viewDeps({
      settingsActiveSectionId: 'settings-section-languages',
      currentLocation: { latitude: 32.7157, longitude: -117.1611, accuracy: 20, timestamp: new Date() },
    });
    const user = makeUser({ stageName: '<Settings>', languages: ['EN', 'zh'] });

    renderSettingsView(user, deps);

    expect(document.querySelector('#settings-jump-menu')).not.toBeNull();
    const menuItems = Array.from(
      document.querySelectorAll<HTMLElement>('.settings-jump-menu-item'),
      (item) => item.dataset.target,
    );
    expect(menuItems).toEqual([
      'settings-section-profile',
      'settings-section-appearance',
      'settings-section-languages',
      'settings-section-talk-behavior',
      'settings-section-content-filters',
      'settings-section-distance-home',
      'settings-section-credit',
      'settings-section-linked-devices',
      'settings-section-connectivity',
      'settings-section-download-app',
      'settings-storage-inspector',
      'settings-section-erase-device',
      'settings-section-support-delegate',
      'settings-section-help',
    ]);
    expect(Array.from(document.querySelectorAll('.settings-jump-menu-group-label'), (label) => label.textContent)).toEqual([
      'Personalization',
      'Talks & discovery',
      'Identity & trust',
      'App & data',
      'Support',
    ]);
    expect(document.querySelector('#settings-section-languages')).not.toBeNull();
    expect(document.querySelector('#settings-start-guide-btn')).not.toBeNull();
    expect(document.querySelector('#settings-replay-walkthrough-btn')).not.toBeNull();
    expect(document.querySelector<HTMLSelectElement>('#settings-auto-answer-scope')?.value).toBe('whenever');
    const nearbyPrivacy = document.querySelector<HTMLSelectElement>('#settings-nearby-privacy-mode');
    // Area size only: "Location off" became Traveler and "Contacts only" a Talk audience.
    expect(Array.from(nearbyPrivacy?.options ?? [], (option) => option.value)).toEqual([
      'close-nearby',
      'neighborhood',
      'citywide',
      'regional',
    ]);
    expect(nearbyPrivacy?.textContent).not.toContain('Radio nearby');
    expect(document.querySelector('[data-testid="settings-location-source"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="settings-quiet-places"]')).not.toBeNull();
    expect(document.querySelector('#settings-min-distance')).toBeNull();
    expect(document.querySelector('#settings-section-distance-home')?.textContent).toContain(
      'exact GPS stays on this device',
    );
    expect(document.querySelector('#settings-section-distance-home')?.textContent).not.toContain(
      '32.',
    );
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

  it('shows the Talk audience as Everyone by default and Contacts only when enabled', () => {
    const checked = () => document.querySelector<HTMLInputElement>('input[name="settings-talk-audience"]:checked')?.value;
    document.body.innerHTML = '<div id="settings-content"></div>';
    renderSettingsView(makeUser(), viewDeps());
    expect(checked()).toBe('everyone');

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
    expect(checked()).toBe('contacts');
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

  it('applies presets to visible controls and marks manual policy edits as Advanced', () => {
    document.body.innerHTML = '<div id="settings-content"></div>';
    renderSettingsView(makeUser(), viewDeps());
    const emit = jest.fn();
    bindSettingsControls(controlsDeps({ emit }));

    const preset = document.getElementById('settings-connectivity-preset') as HTMLSelectElement;
    preset.value = 'fastest';
    preset.dispatchEvent(new Event('change', { bubbles: true }));

    expect(loadConnectivitySettings()).toEqual(expect.objectContaining({
      preset: 'fastest',
      freeFirst: false,
      directFirst: true,
      batteryAware: false,
    }));
    expect(document.querySelector<HTMLInputElement>('#settings-connectivity-free-first')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#settings-connectivity-battery-aware')?.checked).toBe(false);
    expect(emit).toHaveBeenLastCalledWith(
      'connectivitySettingsChanged',
      expect.objectContaining({ preset: 'fastest', batteryAware: false }),
    );

    const freeFirst = document.getElementById('settings-connectivity-free-first') as HTMLInputElement;
    freeFirst.checked = true;
    freeFirst.dispatchEvent(new Event('change', { bubbles: true }));
    expect(loadConnectivitySettings()).toEqual(expect.objectContaining({ preset: 'advanced', freeFirst: true }));
    expect(preset.value).toBe('advanced');

    const wifiForwarding = document.getElementById('settings-connectivity-wifi-forwarding') as HTMLInputElement;
    wifiForwarding.checked = false;
    wifiForwarding.dispatchEvent(new Event('change', { bubbles: true }));
    expect(loadConnectivitySettings()).toEqual(expect.objectContaining({
      preset: 'advanced',
      wifiOnlyForwarding: false,
      forwarding: expect.objectContaining({ wifiForwarding: false }),
    }));
  });

  it('shows the four discovery provider switches only in the Android app, all on by default', () => {
    document.body.innerHTML = '<div id="settings-content"></div>';
    renderSettingsView(makeUser(), viewDeps());
    expect(document.querySelector('#settings-section-nearby')).toBeNull();

    (window as unknown as { IinPublicNearby?: unknown }).IinPublicNearby = { startLanDiscovery: () => undefined };
    try {
      document.body.innerHTML = '<div id="settings-content"></div>';
      renderSettingsView(makeUser(), viewDeps());
      expect(document.querySelector('#settings-section-nearby')).not.toBeNull();
      for (const kind of ['cellular', 'lan', 'wifi-direct', 'bluetooth']) {
        expect(document.querySelector<HTMLInputElement>(`#settings-nearby-${kind}`)?.checked).toBe(true);
        expect(document.querySelector(`[data-testid="settings-nearby-${kind}-state"]`)?.getAttribute('data-availability')).toBe('on');
      }
      expect(document.querySelector('#settings-nearby-status')).not.toBeNull();
    } finally {
      delete (window as unknown as { IinPublicNearby?: unknown }).IinPublicNearby;
    }
  });

  it('shows unavailable and permission states per provider without disabling the others', () => {
    (window as unknown as { IinPublicNearby?: unknown }).IinPublicNearby = {
      startLanDiscovery: () => undefined,
      nearbyReadiness: () => JSON.stringify({ permission: true, bluetoothPermission: false, wifiEnabled: true, bluetoothEnabled: true, wifiDirect: true, joinByCredential: true, ble: true }),
    };
    try {
      document.body.innerHTML = '<div id="settings-content"></div>';
      renderSettingsView(makeUser(), viewDeps());
      const state = (kind: string) => document.querySelector(`[data-testid="settings-nearby-${kind}-state"]`)?.getAttribute('data-availability');
      expect(state('bluetooth')).toBe('permission-denied');
      expect(state('wifi-direct')).toBe('on');
      expect(state('lan')).toBe('on');

      (window as unknown as { IinPublicNearby: { nearbyReadiness: () => string } }).IinPublicNearby.nearbyReadiness = () =>
        JSON.stringify({ permission: true, wifiEnabled: true, wifiDirect: true, joinByCredential: false, ble: true });
      document.body.innerHTML = '<div id="settings-content"></div>';
      renderSettingsView(makeUser(), viewDeps());
      expect(state('wifi-direct')).toBe('unsupported');
      expect(document.querySelector<HTMLInputElement>('#settings-nearby-wifi-direct')?.disabled).toBe(true);
      expect(state('lan')).toBe('on');
      expect(document.querySelector<HTMLInputElement>('#settings-nearby-lan')?.disabled).toBe(false);
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

  it('the Cellular and LAN switches persist independently', () => {
    document.body.innerHTML = `
      <input type="checkbox" id="settings-nearby-cellular" checked>
      <input type="checkbox" id="settings-nearby-lan" checked>`;
    bindSettingsControls(controlsDeps());
    const internet = document.getElementById('settings-nearby-cellular') as HTMLInputElement;
    internet.checked = false;
    internet.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getNearbyProviderEnabled('cellular')).toBe(false);
    expect(getNearbyProviderEnabled('lan')).toBe(true);
    internet.checked = true;
    internet.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getNearbyProviderEnabled('cellular')).toBe(true);
  });

  it('website: shows the encounter location without echoing the coordinate, and clears it', () => {
    // Without a test location the website has no GPS, so it is always a Traveler at a chosen point.
    (window as any).__test_location = 'none';
    localStorage.removeItem('iinpublic_encounter_location_v1');
    document.body.innerHTML = '<div id="settings-content"></div>';
    renderSettingsView(makeUser(), viewDeps());
    const status = () => document.querySelector('[data-testid="settings-encounter-location-status"]');
    expect(status()?.getAttribute('data-set')).toBe('false');
    expect(document.querySelector('#settings-encounter-location-set')).not.toBeNull();
    expect(document.querySelector('#settings-encounter-location-clear')).toBeNull();

    setEncounterLocation(51.50135, -0.14189);
    const rerender = jest.fn(() => {
      document.body.innerHTML = '<div id="settings-content"></div>';
      renderSettingsView(makeUser(), viewDeps());
      bindSettingsControls(controlsDeps({ renderSettingsView: rerender }));
    });
    rerender();
    expect(status()?.getAttribute('data-set')).toBe('true');
    expect(document.querySelector('[data-testid="settings-encounter-location"]')?.textContent).not.toContain('51.50');
    (document.querySelector('#settings-encounter-location-clear') as HTMLButtonElement).click();
    expect(getEncounterLocation()).toBeNull();
    expect(status()?.getAttribute('data-set')).toBe('false');

    (document.querySelector('#settings-encounter-location-set') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="encounter-location-modal"]')).not.toBeNull();
    document.querySelector('[data-testid="encounter-location-modal"]')?.remove();
  });

  it('phone app: no encounter-location block (confirmed blurred GPS instead)', () => {
    const previous = window.location.href;
    window.history.replaceState(null, '', '/?native_platform=android');
    try {
      document.body.innerHTML = '<div id="settings-content"></div>';
      renderSettingsView(makeUser(), viewDeps());
      expect(document.querySelector('[data-testid="settings-encounter-location"]')).toBeNull();
    } finally {
      window.history.replaceState(null, '', previous);
    }
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

  it('persists and emits the Talk audience (Residents only, then Contacts only)', () => {
    document.body.innerHTML = `
      <input type="radio" name="settings-talk-audience" value="everyone" checked>
      <input type="radio" name="settings-talk-audience" value="residents">
      <input type="radio" name="settings-talk-audience" value="contacts">
      <input type="checkbox" id="settings-grammar-filter">
      <input type="checkbox" id="settings-dirty-words-filter">
    `;
    const user = makeUser();
    const deps = controlsDeps({ currentUser: user });
    bindSettingsControls(deps);
    const choose = (value: string) => {
      const radio = document.querySelector(`input[name="settings-talk-audience"][value="${value}"]`) as HTMLInputElement;
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    };

    choose('residents');
    expect(user.talkFilters).toEqual(expect.objectContaining({ residentsOnlyTalks: true, contactsOnlyTalks: false }));
    choose('contacts');
    expect(user.talkFilters).toEqual(expect.objectContaining({ residentsOnlyTalks: false, contactsOnlyTalks: true }));
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
