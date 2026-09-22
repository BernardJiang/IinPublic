'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  sha256File,
  walkFiles,
  formatManifest,
  generateManifestForDir,
  parseManifest,
} = require('../lib/sha256sums');
const { verifyLocalDir } = require('../verify-release-checksums');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sha256sums-test-'));
}

test('sha256File matches an independently computed Node crypto digest of the same bytes', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'a.txt');
  const content = 'hello world';
  fs.writeFileSync(file, content);
  const expected = crypto.createHash('sha256').update(content).digest('hex');
  assert.equal(sha256File(file), expected);
  assert.equal(sha256File(file).length, 64);
});

test('walkFiles recurses into subdirectories and skips directories themselves', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'top.txt'), 'top');
  fs.writeFileSync(path.join(dir, 'sub', 'nested.txt'), 'nested');
  const files = walkFiles(dir).map((f) => path.relative(dir, f)).sort();
  assert.deepEqual(files, [path.join('sub', 'nested.txt'), 'top.txt'].sort());
});

test('walkFiles returns an empty list for a missing directory instead of throwing', () => {
  assert.deepEqual(walkFiles(path.join(tmpDir(), 'does-not-exist')), []);
});

test('formatManifest is sorted and sha256sum -c compatible (two spaces between hash and path)', () => {
  const text = formatManifest([
    { hash: 'b'.repeat(64), relPath: 'b.txt' },
    { hash: 'a'.repeat(64), relPath: 'a.txt' },
  ]);
  assert.equal(text, `${'a'.repeat(64)}  a.txt\n${'b'.repeat(64)}  b.txt\n`);
});

test('formatManifest of an empty list is an empty string', () => {
  assert.equal(formatManifest([]), '');
});

test('generateManifestForDir writes a manifest covering every file except itself, and parseManifest round-trips it', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'one.txt'), '1');
  fs.mkdirSync(path.join(dir, 'nested'));
  fs.writeFileSync(path.join(dir, 'nested', 'two.txt'), '2');

  const written = generateManifestForDir(dir, 'SHA256SUMS');
  assert.equal(written.length, 2);

  const manifestText = fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8');
  const parsed = parseManifest(manifestText);
  assert.equal(parsed.length, 2);
  assert.deepEqual(
    parsed.map((e) => e.relPath).sort(),
    ['nested/two.txt', 'one.txt'],
  );

  // Regenerating must not hash the manifest file itself into its own contents.
  const regenerated = generateManifestForDir(dir, 'SHA256SUMS');
  assert.equal(regenerated.length, 2);
});

test('parseManifest rejects a malformed line rather than silently skipping it', () => {
  assert.throws(() => parseManifest('not-a-valid-line'), /Malformed SHA256SUMS line/);
});

test('verifyLocalDir reports OK when every hash matches', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  generateManifestForDir(dir, 'SHA256SUMS');
  const result = await verifyLocalDir(dir);
  assert.equal(result.checked, 1);
  assert.deepEqual(result.failures, []);
});

test('verifyLocalDir catches a tampered file (mismatch) and a deleted file (missing)', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
  generateManifestForDir(dir, 'SHA256SUMS');

  fs.writeFileSync(path.join(dir, 'a.txt'), 'tampered'); // same name, different bytes
  fs.rmSync(path.join(dir, 'b.txt'));

  const result = await verifyLocalDir(dir);
  assert.equal(result.checked, 2);
  assert.equal(result.failures.length, 2);
  assert.ok(result.failures.some((line) => line.startsWith('MISMATCH a.txt')));
  assert.ok(result.failures.some((line) => line.startsWith('MISSING  b.txt')));
});

test('verifyLocalDir accepts an explicit --manifest path distinct from the target directory', async () => {
  const dir = tmpDir();
  const manifestDir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'known-good');
  const savedManifestPath = path.join(manifestDir, 'known-good-SHA256SUMS');
  fs.writeFileSync(savedManifestPath, formatManifest([{ hash: sha256File(path.join(dir, 'a.txt')), relPath: 'a.txt' }]));

  const result = await verifyLocalDir(dir, savedManifestPath);
  assert.deepEqual(result.failures, []);

  // Now drift the live file relative to the saved known-good manifest.
  fs.writeFileSync(path.join(dir, 'a.txt'), 'drifted');
  const drifted = await verifyLocalDir(dir, savedManifestPath);
  assert.equal(drifted.failures.length, 1);
});
