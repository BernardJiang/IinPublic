import type { UiTranslationKey } from './ui-translations';

/** The 3 platforms IinPublic actually ships native apps for (Electron desktop,
 * `platforms/desktop`, covers Mac + Windows; `android/` is a real Gradle project) — matches
 * `GET /api/downloads`'s manifest keys (downloads-routes.ts). */
export type AppDownloadPlatformKey = 'mac' | 'windows' | 'android';

export const DOWNLOAD_APP_PLATFORMS: Array<{ key: AppDownloadPlatformKey; label: string }> = [
  { key: 'mac', label: 'macOS' },
  { key: 'windows', label: 'Windows' },
  { key: 'android', label: 'Android' },
];

export interface AppDownloadTextDeps {
  text: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, params: Record<string, string>) => string;
  escapeHtml: (value: string) => string;
}

/** Fetches the same manifest the app-download banner uses. Never throws — an offline/unreachable
 * API just leaves every platform in the "Coming soon" state below. */
export async function fetchDownloadManifest(
  apiBase: string,
): Promise<Record<string, string | null>> {
  if (!apiBase) return {};
  try {
    const res = await fetch(`${apiBase}/api/downloads`, { cache: 'no-store' });
    if (res.ok) return (await res.json()) as Record<string, string | null>;
  } catch {
    // Offline/unreachable API — caller renders every platform as "Coming soon".
  }
  return {};
}

/** One row of Settings > "Download the app" — a real link once the manifest has a URL for this
 * platform, "Coming soon" otherwise (never "unavailable"/network-flavored wording; the app
 * itself is real, only this build's publication status varies per platform). */
function renderDownloadAppRow(deps: AppDownloadTextDeps, key: AppDownloadPlatformKey, label: string, url: string | null): string {
  return `
    <div class="settings-download-app-row" data-testid="settings-download-app-row-${key}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;">
      <span style="font-weight:600;">${deps.escapeHtml(label)}</span>
      ${url
        ? `<a class="btn" href="${deps.escapeHtml(url)}" download data-testid="settings-download-app-link-${key}">${deps.escapeHtml(deps.tf('appDownloadBannerGetApp', { platform: label }))}</a>`
        : `<span style="font-size:0.85em;color:var(--text-tertiary);" data-testid="settings-download-app-soon-${key}">${deps.escapeHtml(deps.text('settingsDownloadAppComingSoon'))}</span>`}
    </div>
  `;
}

/** Renders every platform row from a `fetchDownloadManifest` result (or `{}` for the initial,
 * pre-fetch placeholder — every platform starts as "Coming soon" until the real fetch resolves). */
export function renderDownloadAppSectionBody(
  deps: AppDownloadTextDeps,
  manifest: Record<string, string | null>,
): string {
  return DOWNLOAD_APP_PLATFORMS.map(({ key, label }) => renderDownloadAppRow(deps, key, label, manifest[key] || null)).join('');
}
