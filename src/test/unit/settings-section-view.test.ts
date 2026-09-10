/** @jest-environment jsdom */

import { applySettingsSectionView, type ApplySettingsSectionViewDeps } from '../../web/ui/settings-section-view';

function deps(overrides: Partial<ApplySettingsSectionViewDeps> = {}): ApplySettingsSectionViewDeps {
  return {
    setSettingsActiveSectionId: jest.fn(),
    ...overrides,
  };
}

function buildSettingsDom(sectionIds: string[]): void {
  const sections = sectionIds.map((id) => `<div class="settings-section" id="${id}"></div>`).join('');
  document.body.innerHTML = `
    <div id="settings-menu-container"></div>
    <div id="settings-detail-container">${sections}</div>
    <button id="back-to-settings-menu"></button>`;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('applySettingsSectionView', () => {
  it('shows the menu and hides the detail/back button when sectionId is null', () => {
    buildSettingsDom(['sec-a', 'sec-b']);
    applySettingsSectionView(null, deps());
    expect(document.getElementById('settings-menu-container')!.style.display).toBe('');
    expect(document.getElementById('settings-detail-container')!.style.display).toBe('none');
    expect(document.getElementById('back-to-settings-menu')!.style.display).toBe('none');
    document.querySelectorAll('.settings-section').forEach((section) => {
      expect((section as HTMLElement).style.display).toBe('');
    });
  });

  it('shows only the target section and hides the menu when a valid sectionId is given', () => {
    buildSettingsDom(['sec-a', 'sec-b']);
    applySettingsSectionView('sec-a', deps());
    expect(document.getElementById('sec-a')!.style.display).toBe('');
    expect(document.getElementById('sec-b')!.style.display).toBe('none');
    expect(document.getElementById('settings-menu-container')!.style.display).toBe('none');
    expect(document.getElementById('settings-detail-container')!.style.display).toBe('block');
    expect(document.getElementById('back-to-settings-menu')!.style.display).toBe('inline-flex');
  });

  it('falls back to the menu and clears the remembered id when the target section does not exist', () => {
    buildSettingsDom(['sec-a']);
    const d = deps();
    applySettingsSectionView('missing-section', d);
    expect(d.setSettingsActiveSectionId).toHaveBeenCalledWith(null);
    expect(document.getElementById('settings-menu-container')!.style.display).toBe('');
    expect(document.getElementById('settings-detail-container')!.style.display).toBe('none');
  });

  it('does not throw when the menu/detail/back-button elements are absent', () => {
    document.body.innerHTML = '';
    expect(() => applySettingsSectionView(null, deps())).not.toThrow();
    expect(() => applySettingsSectionView('anything', deps())).not.toThrow();
  });
});
