(function () {
  // Start a shared browser/Electron/Android timeline before the deferred application bundle is
  // downloaded or evaluated. Keep this external: the production CSP deliberately blocks inline
  // scripts in every native shell.
  var at = performance.now();
  window.__iinpublicStartupMetrics = { version: 1, host: {}, phases: { htmlParsed: at } };
  try {
    performance.mark('iinpublic:htmlParsed', { startTime: at });
  } catch (error) {
    try { performance.mark('iinpublic:htmlParsed'); } catch (ignored) {}
  }

  // Apply the saved scheme before first paint. Mirrors ui-settings-storage.ts's accepted values.
  try {
    var scheme = localStorage.getItem('iinpublic_color_scheme');
    if (
      scheme === 'goldenHour' ||
      scheme === 'tropicalForest' ||
      scheme === 'snowMountain' ||
      scheme === 'beachSunset'
    ) {
      document.documentElement.setAttribute('data-color-scheme', scheme);
    }
  } catch (error) {}
})();
