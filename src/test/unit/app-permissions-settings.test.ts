import {
  hasAppPermissionsBridge,
  readAppPermissionStatus,
  renderAppPermissionRows,
} from '../../web/ui/app-permissions-settings';
import { uiText, type UiTranslationKey } from '../../web/ui/ui-translations';

const t = (key: UiTranslationKey): string => uiText('en', key);

describe('Settings → App permissions', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('is shown only when the native shell reports permission status', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(hasAppPermissionsBridge()).toBe(false);
    (globalThis as { window?: unknown }).window = { IinPublicNearby: { permissionStatus: () => '{}' } };
    expect(hasAppPermissionsBridge()).toBe(true);
  });

  it('shows each permission as Android currently reports it', () => {
    (globalThis as { window?: unknown }).window = {
      IinPublicNearby: { permissionStatus: () => JSON.stringify({ notifications: true, location: false, nearby: true, camera: false }) },
    };
    const html = renderAppPermissionRows(t, readAppPermissionStatus());
    expect(html).toContain('data-testid="app-permission-notifications" data-allowed="true"');
    expect(html).toContain('data-testid="app-permission-location" data-allowed="false"');
    expect(html).toContain('data-testid="app-permission-nearby" data-allowed="true"');
    expect(html).toContain('data-testid="app-permission-camera" data-allowed="false"');
    expect(html).toContain('Not allowed');
  });

  it('treats an unreadable status as not allowed rather than failing', () => {
    (globalThis as { window?: unknown }).window = { IinPublicNearby: { permissionStatus: () => 'not json' } };
    expect(readAppPermissionStatus()).toBeNull();
    expect(renderAppPermissionRows(t, null)).not.toContain('data-allowed="true"');
  });
});
