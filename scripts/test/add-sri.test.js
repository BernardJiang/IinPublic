'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { sriHashFor, patchScriptTag } = require('../add-sri');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'add-sri-test-'));
}

test('sriHashFor matches an independently computed sha384/base64 digest of the same bytes', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'a.js');
  fs.writeFileSync(file, 'console.log(1);');
  const expected = `sha384-${crypto.createHash('sha384').update('console.log(1);').digest('base64')}`;
  assert.equal(sriHashFor(file), expected);
});

test('patchScriptTag adds integrity + crossorigin to a matching local script tag', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'bundle.js'), 'console.log(1);');
  const html = '<head><script defer="defer" src="bundle.js"></script></head>';
  const patched = patchScriptTag(html, 'bundle.js', dir);
  assert.match(patched, /integrity="sha384-[A-Za-z0-9+/]+=*"/);
  assert.match(patched, /crossorigin="anonymous"/);
  assert.match(patched, /defer="defer"/); // pre-existing attributes are preserved
  assert.equal(patched, patched.replace(/\s+/g, ' ')); // still one tag, nothing duplicated
});

test('patchScriptTag is idempotent — a second pass leaves an already-patched tag unchanged', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'bundle.js'), 'console.log(1);');
  const html = '<script src="bundle.js"></script>';
  const once = patchScriptTag(html, 'bundle.js', dir);
  const twice = patchScriptTag(once, 'bundle.js', dir);
  assert.equal(once, twice);
});

test('patchScriptTag produces a DIFFERENT hash when the file content changes (the actual security property)', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'bundle.js');
  fs.writeFileSync(file, 'console.log(1);');
  const html = '<script src="bundle.js"></script>';
  const before = patchScriptTag(html, 'bundle.js', dir);
  fs.writeFileSync(file, 'console.log(2); // tampered');
  const after = patchScriptTag(html, 'bundle.js', dir);
  assert.notEqual(before, after);
});

test('patchScriptTag throws when the referenced file is missing (fail loud, not silent)', () => {
  const dir = tmpDir();
  const html = '<script src="missing.js"></script>';
  assert.throws(() => patchScriptTag(html, 'missing.js', dir), /missing from/);
});

test('patchScriptTag throws when the src is not present in the html at all', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'bundle.js'), 'x');
  assert.throws(() => patchScriptTag('<script src="other.js"></script>', 'bundle.js', dir), /expected to find/);
});
