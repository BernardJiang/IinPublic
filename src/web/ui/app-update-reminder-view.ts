import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';
import { isNewerVersion } from '../../shared/semver-compare';
import { readNativeHostInfo } from './native-host-info';
import { renderUpdateAvailableBadge } from './notification-badges';

/**
 * docs/TODO.md OPEN-33: a sideloaded Android APK (not Play Store) has no update channel at all —
 * this is a reminder only, never a silent self-update. Compares `GET /api/downloads`'s published
 * `version` against this device's own running version (the `?app_version=` query param
 * MainActivity.kt already appends — the same value settings-view.ts reads for the "IinPublic
 * version" line) and, when the server's is newer, shows a dismissible banner linking straight to
 * the APK. Deliberately Android-only for now: the web build always serves its current version on
 * load (nothing to remind), and desktop's own in-app electron-updater (OPEN-33's other half)
 * already covers Mac/Windows without needing this banner too.
 */

export type AppUpdateReminderDeps = {
  apiBase: string;
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, values: Record<string, string | number>) => string;
};

const DISMISSED_VERSION_STORAGE_KEY = 'iinpublic_update_reminder_dismissed_version';

/** Pure — no DOM, no fetch — so the actual "should this banner show" decision is unit-testable
 * without a browser environment. `dismissedVersion` is whatever version the operator already
 * dismissed a reminder for (or null); a reminder for that SAME version stays dismissed, but a
 * still-newer version published afterward reminds again. */
export function shouldShowUpdateReminder(
  serverVersion: string | null | undefined,
  runningVersion: string,
  dismissedVersion: string | null,
): boolean {
  if (!serverVersion) return false;
  if (!isNewerVersion(serverVersion, runningVersion)) return false;
  if (dismissedVersion && !isNewerVersion(serverVersion, dismissedVersion)) return false;
  return true;
}

function readDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeDismissedVersion(version: string): void {
  try {
    localStorage.setItem(DISMISSED_VERSION_STORAGE_KEY, version);
  } catch {
    /* localStorage unavailable/full — the banner just reappears next launch, harmless */
  }
}

export async function renderAppUpdateReminderBanner(deps: AppUpdateReminderDeps): Promise<void> {
  const { version: runningVersion, platform: nativePlatform } = readNativeHostInfo();
  if (nativePlatform !== 'android') return; // desktop has its own in-app updater; web is always current
  if (!deps.apiBase) return;
  const shell = document.querySelector('.app-container');
  if (!shell || document.getElementById('app-update-reminder-banner')) return;

  let manifest: { version?: string; android?: string | null } = {};
  try {
    const res = await fetch(`${deps.apiBase}/api/downloads`, { cache: 'no-store' });
    if (res.ok) manifest = await res.json();
  } catch {
    return; // offline/unreachable — no reminder this launch, not an error state to show
  }

  if (!shouldShowUpdateReminder(manifest.version, runningVersion, readDismissedVersion())) return;
  const downloadUrl = manifest.android || null;
  if (!downloadUrl) return; // server knows a newer version exists but hasn't published the APK yet

  const serverVersion = manifest.version as string;
  const banner = document.createElement('div');
  banner.id = 'app-update-reminder-banner';
  banner.className = 'app-download-banner';
  banner.setAttribute('data-testid', 'app-update-reminder-banner');
  banner.innerHTML = `
    <span class="app-download-banner-text">${escapeHtml(deps.tf('appUpdateReminderText', { version: serverVersion }))}</span>
    <a class="app-download-banner-link" href="${escapeHtml(downloadUrl)}" download data-testid="app-update-reminder-link">${escapeHtml(deps.t('appUpdateReminderGetUpdate'))}</a>
    <button type="button" class="app-download-banner-dismiss" aria-label="${escapeHtml(deps.t('appDownloadBannerDismiss'))}" data-testid="app-update-reminder-dismiss">×</button>`;
  banner.querySelector('.app-download-banner-dismiss')?.addEventListener('click', () => {
    writeDismissedVersion(serverVersion);
    banner.remove();
    renderUpdateAvailableBadge(false);
  });
  shell.prepend(banner);
  renderUpdateAvailableBadge(true);
}
