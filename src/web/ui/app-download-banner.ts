import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

export type DownloadPlatform = 'mac' | 'windows' | 'linux' | 'android' | 'ios';

export function detectDownloadPlatform(): DownloadPlatform | null {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Win(dows)?(NT)?/i.test(ua)) return 'windows';
  // iPadOS 13+ reports as Mac Safari but exposes touch points.
  if (/Mac/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return null;
}

export type AppDownloadBannerDeps = {
  apiBase: string;
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, values: Record<string, string | number>) => string;
  openDownloadAppSettingsSection: () => void;
};

/**
 * §19.2: a plain browser tab pointed at the relay hub is a first-class client, not just an
 * app-download landing page — but we still want to point desktop-capable visitors at the
 * native app when one exists. Skipped entirely inside the packaged Electron shell, which
 * reports 'Electron' in its UA.
 */
export async function renderAppDownloadBanner(deps: AppDownloadBannerDeps): Promise<void> {
  const nativeHost = (window as unknown as {
    iinpublicNative?: { version?: string; platform?: string };
  }).iinpublicNative;
  const nativePlatform = new URLSearchParams(window.location.search).get('native_platform');
  // Electron identifies itself through both its preload bridge and UA. Mobile shells use a
  // query marker because their UI is served by the embedded loopback node inside a WebView.
  // Neither is a web-version visitor and neither should be invited to download itself.
  if (nativeHost?.platform || nativePlatform || /Electron/i.test(navigator.userAgent || '')) return;
  if (sessionStorage.getItem('iinpublic_dismissed_app_download_banner')) return;
  const shell = document.querySelector('.app-container');
  if (!shell || document.getElementById('app-download-banner')) return;

  const platform = detectDownloadPlatform();
  let downloadUrl: string | null = null;
  if (platform && deps.apiBase) {
    try {
      const res = await fetch(`${deps.apiBase}/api/downloads`, { cache: 'no-store' });
      if (res.ok) {
        const manifest = (await res.json()) as Record<string, string | null>;
        downloadUrl = manifest[platform] || null;
      }
    } catch {
      // Offline/unreachable API — banner still renders with the "unavailable" state below.
    }
  }

  const platformLabel = platform === 'mac'
    ? 'Mac'
    : platform === 'windows'
      ? 'Windows'
      : platform === 'linux'
        ? 'Linux'
        : platform === 'android'
          ? 'Android'
          : platform === 'ios'
            ? 'iPhone/iPad'
            : '';
  const banner = document.createElement('div');
  banner.id = 'app-download-banner';
  banner.className = 'app-download-banner';
  // No dead-end "not available" copy — IinPublic really does ship native Mac/Windows/Android
  // apps (this build just isn't published for the visitor's platform yet); route them to the
  // Settings "Download the app" section instead, where every platform's real status shows.
  banner.innerHTML = `
    <span class="app-download-banner-text">${escapeHtml(deps.t('appDownloadBannerText'))}</span>
    ${downloadUrl
      ? `<a class="app-download-banner-link" href="${escapeHtml(downloadUrl)}" download>${escapeHtml(deps.tf('appDownloadBannerGetApp', { platform: platformLabel }))}</a>`
      : `<button type="button" class="app-download-banner-link app-download-banner-see-options" data-action="see-options">${escapeHtml(deps.t('appDownloadBannerSeeOptions'))}</button>`}
    <button type="button" class="app-download-banner-dismiss" aria-label="${escapeHtml(deps.t('appDownloadBannerDismiss'))}">×</button>`;
  // The settings nav click handler always resets settingsActiveSectionId to null before its
  // own synchronous render, so the drill-down below has to happen AFTER that click resolves.
  banner.querySelector('[data-action="see-options"]')?.addEventListener('click', () => {
    banner.remove();
    (document.querySelector('.nav-btn[data-view="settings"]') as HTMLElement | null)?.click();
    deps.openDownloadAppSettingsSection();
  });
  banner.querySelector('.app-download-banner-dismiss')?.addEventListener('click', () => {
    sessionStorage.setItem('iinpublic_dismissed_app_download_banner', '1');
    banner.remove();
  });
  shell.prepend(banner);
}
