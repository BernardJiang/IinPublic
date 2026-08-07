// electron-builder afterPack hook.
//
// macOS only: electron-builder's own ad-hoc signing (when no "Developer ID
// Application" cert is configured) doesn't deep-resign Electron's bundled
// Framework/Helper binaries thoroughly enough — they can retain stale
// signature metadata referencing Electron's own upstream (real, once-
// notarized-by-GitHub) notarization ticket. If Apple has since revoked that
// ticket (which does happen), `spctl` on the WHOLE .app reports "notarization
// indicates this code has been revoked" — a harsher verdict than the normal
// "rejected: unidentified developer" every unsigned indie app gets, and one
// that gets the app auto-quarantined/moved to Trash rather than just
// blocked-with-a-bypass. A full `codesign --force --deep --sign -` after
// packaging creates one fresh, internally-consistent ad-hoc signature across
// the whole bundle with no reference to Electron's original ticket, which
// flips the verdict back to the normal unsigned-app "rejected" state
// (right-click → Open still works, same as any other unsigned Mac app).
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  console.log(`[afterPack] deep ad-hoc re-signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
