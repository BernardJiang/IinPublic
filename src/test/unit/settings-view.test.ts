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

  it('does nothing when the settings root is absent', () => {
    const deps = viewDeps();
    renderSettingsView(makeUser(), deps);
    expect(deps.bindSettingsControls).not.toHaveBeenCalled();
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
