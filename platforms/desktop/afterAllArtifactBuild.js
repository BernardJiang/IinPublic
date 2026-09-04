// electron-builder afterAllArtifactBuild hook.
//
// macOS only: electron-builder's `dmg.icon` config sets the icon shown for the *mounted
// volume* (what appears in Finder's sidebar / on the Desktop once the .dmg is opened) — it
// does not touch the .dmg *file's* own Finder icon, which uses a completely different,
// older mechanism (a custom icon resource in the file's resource fork, flagged via the
// classic Finder "has custom icon" bit). Without this, the .dmg file itself shows the
// generic macOS disk-image icon in Finder even though the app inside it, and the mounted
// volume, both correctly show the real app icon. Verified manually before automating this:
// GetFileInfo's `attributes` string flips 'c' -> 'C' (the has-custom-icon Finder flag) once
// this runs, confirming Finder actually picks it up — `mdls`'s kMDItemFSHasCustomIcon can lag
// behind (Spotlight metadata, not the live Finder flag) and isn't a reliable check here.
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

exports.default = async function afterAllArtifactBuild(context) {
  if (process.platform !== 'darwin') return [];
  const dmgPaths = (context.artifactPaths || []).filter((p) => p.toLowerCase().endsWith('.dmg'));
  if (dmgPaths.length === 0) return [];

  const iconIcns = path.join(__dirname, 'resources', 'icon.icns');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-dmg-icon-'));
  const tmpIcns = path.join(tmpDir, 'icon.icns');
  const tmpRsrc = path.join(tmpDir, 'icon.rsrc');
  try {
    fs.copyFileSync(iconIcns, tmpIcns);
    // `sips -i` embeds the icns as its own "icon of itself" resource — required before DeRez
    // can extract a usable icns resource to append to the target file.
    execFileSync('sips', ['-i', tmpIcns], { stdio: 'inherit' });
    const rsrc = execFileSync('DeRez', ['-only', 'icns', tmpIcns], { encoding: 'utf8' });
    fs.writeFileSync(tmpRsrc, rsrc);
    for (const dmgPath of dmgPaths) {
      console.log(`[afterAllArtifactBuild] setting custom Finder icon on ${dmgPath}`);
      execFileSync('Rez', ['-append', tmpRsrc, '-o', dmgPath], { stdio: 'inherit' });
      execFileSync('SetFile', ['-a', 'C', dmgPath], { stdio: 'inherit' });
    }
  } catch (err) {
    // Best-effort cosmetic step — never fail the whole build over a Finder icon.
    console.warn('[afterAllArtifactBuild] could not set custom DMG Finder icon (non-fatal):', err);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return [];
};
