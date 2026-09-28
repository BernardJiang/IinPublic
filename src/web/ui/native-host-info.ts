/**
 * Reads the native-shell identity a packaged app (mobile WebView, Electron) exposes to the web
 * bundle it's hosting — either through `window.iinpublicNative` (a real preload-injected bridge
 * object) or the `?native_platform=`/`?app_version=` query params `MainActivity.kt` appends to
 * its loopback URL. Both channels carry the same two fields; this is the one place that reads
 * either, so `settings-view.ts` (the "IinPublic version" line), `app-download-banner.ts`, and
 * `app-update-reminder-view.ts` all agree on exactly what "native" and "this device's version"
 * mean instead of each re-deriving it slightly differently.
 */

export type NativeHostInfo = {
  version: string;
  platform: string;
};

/** `platform` is `'web'` and `version` falls back to the build-time baked-in app version
 * (`process.env.IINPUBLIC_APP_VERSION`, webpack's `DefinePlugin`) when nothing native answers —
 * every real build has that; the literal `'web'` version fallback only ever fires outside webpack. */
export function readNativeHostInfo(): NativeHostInfo {
  const nativeHost = (
    window as unknown as { iinpublicNative?: { version?: string; platform?: string } }
  ).iinpublicNative;
  const query = new URLSearchParams(window.location.search);
  const version = String(nativeHost?.version || query.get('app_version') || process.env.IINPUBLIC_APP_VERSION || 'web');
  const platform = nativeHost?.platform || query.get('native_platform') || 'web';
  return { version, platform };
}
