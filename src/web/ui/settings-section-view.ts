export type ApplySettingsSectionViewDeps = {
  setSettingsActiveSectionId: (id: string | null) => void;
};

export function applySettingsSectionView(sectionId: string | null, deps: ApplySettingsSectionViewDeps): void {
  const menu = document.getElementById('settings-menu-container');
  const detail = document.getElementById('settings-detail-container');
  const backBtn = document.getElementById('back-to-settings-menu') as HTMLElement | null;
  const sections = document.querySelectorAll<HTMLElement>('#settings-detail-container .settings-section');
  const target = sectionId ? document.getElementById(sectionId) : null;
  if (sectionId && !target) {
    // The remembered section no longer exists in this render (shouldn't happen — the same 9
    // ids are always rendered — but fall back to the menu rather than show a blank detail).
    deps.setSettingsActiveSectionId(null);
    applySettingsSectionView(null, deps);
    return;
  }
  if (target) {
    sections.forEach((section) => { section.style.display = section === target ? '' : 'none'; });
    if (menu) menu.style.display = 'none';
    if (detail) detail.style.display = 'block';
    if (backBtn) backBtn.style.display = 'inline-flex';
  } else {
    sections.forEach((section) => { section.style.display = ''; });
    if (menu) menu.style.display = '';
    if (detail) detail.style.display = 'none';
    if (backBtn) backBtn.style.display = 'none';
  }
}
