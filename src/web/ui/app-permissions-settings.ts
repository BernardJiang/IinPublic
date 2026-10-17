/**
 * Settings → App permissions (Android). The app asks every runtime permission once, together, at
 * first launch (camera excepted: first QR scan) and never prompts by itself afterwards. This
 * section shows what Android currently allows and opens the system page to change it.
 */
import type { UiTranslationKey } from './ui-translations';

type T = (key: UiTranslationKey) => string;
type PermissionStatus = { notifications: boolean; location: boolean; nearby: boolean; camera: boolean };
type PermissionBridge = { permissionStatus?: () => string; openNearbySettings?: (kind: string) => void };

const ROWS: Array<{ key: keyof PermissionStatus; label: UiTranslationKey; help: UiTranslationKey }> = [
  { key: 'notifications', label: 'appPermissionNotifications', help: 'appPermissionNotificationsHelp' },
  { key: 'location', label: 'appPermissionLocation', help: 'appPermissionLocationHelp' },
  { key: 'nearby', label: 'appPermissionNearby', help: 'appPermissionNearbyHelp' },
  { key: 'camera', label: 'appPermissionCamera', help: 'appPermissionCameraHelp' },
];

function bridge(): PermissionBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { IinPublicNearby?: PermissionBridge }).IinPublicNearby;
}

export function hasAppPermissionsBridge(): boolean {
  return typeof bridge()?.permissionStatus === 'function';
}

export function readAppPermissionStatus(): PermissionStatus | null {
  try {
    const raw = bridge()?.permissionStatus?.();
    return raw ? JSON.parse(raw) as PermissionStatus : null;
  } catch {
    return null;
  }
}

export function renderAppPermissionRows(t: T, status: PermissionStatus | null = readAppPermissionStatus()): string {
  return ROWS.map((row) => {
    const allowed = status?.[row.key] === true;
    return `<div data-testid="app-permission-${row.key}" data-allowed="${allowed}" style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);">
      <div><div style="font-weight:600;">${t(row.label)}</div><div style="font-size:0.82em;color:var(--text-tertiary);">${t(row.help)}</div></div>
      <div style="white-space:nowrap;font-size:0.9em;color:${allowed ? 'var(--text-primary)' : 'var(--text-tertiary)'};">${allowed ? `✅ ${t('appPermissionAllowed')}` : t('appPermissionNotAllowed')}</div>
    </div>`;
  }).join('');
}

export function renderAppPermissionsBody(t: T): string {
  return `<div data-testid="settings-app-permissions">
    <div id="settings-app-permissions-list">${renderAppPermissionRows(t)}</div>
    <button type="button" class="btn" id="settings-app-permissions-open" data-testid="settings-app-permissions-open" style="margin-top:12px;">⚙️ ${t('appPermissionsOpenSystem')}</button>
  </div>`;
}

/** Opens the system page; refreshes the rows when the user comes back from it. */
export function bindAppPermissionsSettings(t: T): void {
  document.getElementById('settings-app-permissions-open')?.addEventListener('click', () => {
    bridge()?.openNearbySettings?.('app');
  });
  const refresh = (): void => {
    const list = document.getElementById('settings-app-permissions-list');
    if (!list) {
      document.removeEventListener('visibilitychange', refresh);
      return;
    }
    if (document.visibilityState === 'visible') list.innerHTML = renderAppPermissionRows(t);
  };
  document.addEventListener('visibilitychange', refresh);
}
