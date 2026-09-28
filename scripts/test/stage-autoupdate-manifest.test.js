'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stage-autoupdate-test-'));
}

async function loadModule() {
  return import(path.join(__dirname, '..', 'stage-autoupdate-manifest.mjs'));
}

test('filesReferencedByManifest collects path + every files[].url, de-duplicated', async () => {
  const { filesReferencedByManifest } = await loadModule();
  const manifest = {
    path: 'IinPublic-Setup-1.0.57.exe',
    files: [
      { url: 'IinPublic-Setup-1.0.57.exe', sha512: 'x' },
      { url: 'IinPublic-1.0.57-win.zip', sha512: 'y' },
    ],
  };
  assert.deepEqual(
    filesReferencedByManifest(manifest).sort(),
    ['IinPublic-1.0.57-win.zip', 'IinPublic-Setup-1.0.57.exe'].sort(),
  );
});

test('filesReferencedByManifest tolerates a missing/malformed manifest without throwing', async () => {
  const { filesReferencedByManifest } = await loadModule();
  assert.deepEqual(filesReferencedByManifest(null), []);
  assert.deepEqual(filesReferencedByManifest({}), []);
  assert.deepEqual(filesReferencedByManifest({ files: 'not-an-array' }), []);
});

test('isSafeManifestFilename rejects directory traversal and path separators', async () => {
  const { isSafeManifestFilename } = await loadModule();
  assert.equal(isSafeManifestFilename('IinPublic-1.0.57.dmg'), true);
  assert.equal(isSafeManifestFilename('../../etc/passwd'), false);
  assert.equal(isSafeManifestFilename('sub/dir.exe'), false);
  assert.equal(isSafeManifestFilename('sub\\dir.exe'), false);
  assert.equal(isSafeManifestFilename(''), false);
});

test('stageAutoupdateManifest copies the manifest + every referenced file to the downloads dir', async () => {
  const { stageAutoupdateManifest } = await loadModule();
  const distDir = tmpDir();
  const downloadsDir = tmpDir();
  const manifestObj = {
    version: '1.0.57',
    path: 'IinPublic-1.0.57-arm64.dmg',
    files: [{ url: 'IinPublic-1.0.57-arm64.dmg', sha512: 'x' }],
  };
  fs.writeFileSync(path.join(distDir, 'latest-mac.yml'), yaml.dump(manifestObj));
  fs.writeFileSync(path.join(distDir, 'IinPublic-1.0.57-arm64.dmg'), 'fake-dmg-bytes');

  const result = stageAutoupdateManifest({ platform: 'mac', desktopDistDir: distDir, downloadsDir });

  assert.deepEqual(result, { manifestName: 'latest-mac.yml', stagedFiles: ['IinPublic-1.0.57-arm64.dmg'] });
  assert.equal(fs.readFileSync(path.join(downloadsDir, 'latest-mac.yml'), 'utf8'), yaml.dump(manifestObj));
  assert.equal(fs.readFileSync(path.join(downloadsDir, 'IinPublic-1.0.57-arm64.dmg'), 'utf8'), 'fake-dmg-bytes');
});

test('stageAutoupdateManifest throws (does not silently stage a broken auto-update) when the manifest references a file that does not exist — the real bug found in this repo\'s own stale dist/ output', async () => {
  const { stageAutoupdateManifest } = await loadModule();
  const distDir = tmpDir();
  const downloadsDir = tmpDir();
  fs.writeFileSync(
    path.join(distDir, 'latest.yml'),
    yaml.dump({ version: '1.0.57', path: 'IinPublic-Setup-1.0.57.exe', files: [{ url: 'IinPublic-Setup-1.0.57.exe' }] }),
  );
  // Deliberately do NOT create IinPublic-Setup-1.0.57.exe on disk.
  assert.throws(
    () => stageAutoupdateManifest({ platform: 'windows', desktopDistDir: distDir, downloadsDir }),
    /references IinPublic-Setup-1\.0\.57\.exe, but it's missing/,
  );
});

test('stageAutoupdateManifest throws for a manifest missing entirely', async () => {
  const { stageAutoupdateManifest } = await loadModule();
  const distDir = tmpDir();
  const downloadsDir = tmpDir();
  assert.throws(
    () => stageAutoupdateManifest({ platform: 'linux', desktopDistDir: distDir, downloadsDir }),
    /not found/,
  );
});

test('stageAutoupdateManifest throws for an unknown platform', async () => {
  const { stageAutoupdateManifest } = await loadModule();
  assert.throws(
    () => stageAutoupdateManifest({ platform: 'bogus', desktopDistDir: tmpDir(), downloadsDir: tmpDir() }),
    /Unknown platform/,
  );
});
