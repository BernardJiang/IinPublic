// Runs the portable Jest bundle (scripts/build-portable-core-test-bundle.mjs) in host Node and
// headless Chromium, and writes the expected test ids to dist/device-tests/portable-jest-ids.json.
// native-app/34 fails a phone whose WebView or embedded Node reports a different id set, so a
// missing file or test is a failure, not a quiet reduction in coverage.

import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repoRoot, 'dist', 'device-tests');
const require = createRequire(import.meta.url);

const ids = (report) => report.reports.flatMap((file) => file.results.map((result) => `${file.file} › ${result.id}`));

function summarize(runtime, report) {
  process.stdout.write(`[portable-jest] ${runtime}: ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped in ${report.files} files (${(report.durationMs / 1000).toFixed(1)} s)\n`);
  for (const file of report.reports) {
    for (const result of file.results.filter((entry) => !entry.passed)) {
      process.stdout.write(`  FAIL ${file.file} › ${result.id}: ${result.error}\n`);
    }
  }
}

const nodeReport = await require(path.join(outputDirectory, 'portable-jest-node.cjs')).runPortableJest();
summarize('host Node', nodeReport);

const browser = await chromium.launch({ headless: true });
let chromiumReport;
try {
  const page = await browser.newPage();
  // A localhost origin is a secure context (crypto.subtle), like the app's http://127.0.0.1:8088.
  await page.route('http://localhost/portable-jest', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>portable jest</title>' }));
  await page.goto('http://localhost/portable-jest');
  await page.addScriptTag({ path: path.join(outputDirectory, 'portable-jest-webview.js') });
  chromiumReport = await page.evaluate(() => window.__iinpublicPortableJest.run());
} finally {
  await browser.close();
}
summarize('headless Chromium', chromiumReport);

const expected = ids(nodeReport);
const sameIds = JSON.stringify(expected) === JSON.stringify(ids(chromiumReport));
if (!sameIds) process.stdout.write('[portable-jest] host Node and Chromium report different test ids\n');
await writeFile(path.join(outputDirectory, 'portable-jest-ids.json'), `${JSON.stringify({ files: nodeReport.files, total: expected.length, ids: expected }, null, 1)}\n`);
if (nodeReport.failed || chromiumReport.failed || !sameIds) process.exitCode = 1;
