/** @jest-environment jsdom */

import { detectDownloadPlatform, renderAppDownloadBanner, type AppDownloadBannerDeps } from '../../web/ui/app-download-banner';

function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

function setMaxTouchPoints(n: number): void {
  Object.defineProperty(navigator, 'maxTouchPoints', { value: n, configurable: true });
}

function deps(overrides: Partial<AppDownloadBannerDeps> = {}): AppDownloadBannerDeps {
  return {
    apiBase: 'http://api.test',
    t: (key) => key,
    tf: (key, values) => `${key}(${JSON.stringify(values)})`,
    openDownloadAppSettingsSection: jest.fn(),
    ...overrides,
  };
}

const originalFetch = global.fetch;

beforeEach(() => {
  document.body.innerHTML = '<div class="app-container"></div>';
  sessionStorage.clear();
  setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
  setMaxTouchPoints(0);
  delete (window as unknown as { iinpublicNative?: unknown }).iinpublicNative;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ mac: 'https://dl.test/mac.dmg' }) });
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('detectDownloadPlatform', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 13)', 'android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'ios'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'mac'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
    ['SomeOtherRobot/1.0', null],
  ])('detects %s as %s', (ua, expected) => {
    setUserAgent(ua);
    expect(detectDownloadPlatform()).toBe(expected);
  });

  it('treats a touch-capable Mac UA (iPadOS 13+) as ios, not mac', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    setMaxTouchPoints(5);
    expect(detectDownloadPlatform()).toBe('ios');
  });
});

describe('renderAppDownloadBanner', () => {
  it('does not render inside the Electron shell', async () => {
    setUserAgent('iinpublic-electron/1.0 Electron/28.0.0');
    await renderAppDownloadBanner(deps());
    expect(document.getElementById('app-download-banner')).toBeNull();
  });

  it('does not render when iinpublicNative reports a platform', async () => {
    (window as unknown as { iinpublicNative?: unknown }).iinpublicNative = { platform: 'android' };
    await renderAppDownloadBanner(deps());
    expect(document.getElementById('app-download-banner')).toBeNull();
  });

  it('does not render when previously dismissed this session', async () => {
    sessionStorage.setItem('iinpublic_dismissed_app_download_banner', '1');
    await renderAppDownloadBanner(deps());
    expect(document.getElementById('app-download-banner')).toBeNull();
  });

  it('does not render when a banner is already present', async () => {
    document.querySelector('.app-container')!.innerHTML = '<div id="app-download-banner"></div>';
    const d = deps();
    await renderAppDownloadBanner(d);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renders a download link when the manifest has a URL for the detected platform', async () => {
    await renderAppDownloadBanner(deps());
    const banner = document.getElementById('app-download-banner');
    expect(banner).not.toBeNull();
    const link = banner!.querySelector('.app-download-banner-link') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://dl.test/mac.dmg');
  });

  it('renders a "see options" button when the manifest has no URL for the platform', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    await renderAppDownloadBanner(deps());
    const button = document.querySelector('.app-download-banner-see-options');
    expect(button).not.toBeNull();
  });

  it('still renders with the "see options" fallback when the downloads API is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await renderAppDownloadBanner(deps());
    expect(document.querySelector('.app-download-banner-see-options')).not.toBeNull();
  });

  it('clicking dismiss records the session flag and removes the banner', async () => {
    await renderAppDownloadBanner(deps());
    (document.querySelector('.app-download-banner-dismiss') as HTMLElement).click();
    expect(sessionStorage.getItem('iinpublic_dismissed_app_download_banner')).toBe('1');
    expect(document.getElementById('app-download-banner')).toBeNull();
  });

  it('clicking "see options" opens the download-app settings section and removes the banner', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const d = deps();
    await renderAppDownloadBanner(d);
    (document.querySelector('.app-download-banner-see-options') as HTMLElement).click();
    expect(d.openDownloadAppSettingsSection).toHaveBeenCalledTimes(1);
    expect(document.getElementById('app-download-banner')).toBeNull();
  });
});
