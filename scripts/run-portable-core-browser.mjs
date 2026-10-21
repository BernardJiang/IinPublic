import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(repoRoot, 'dist', 'device-tests', 'portable-core-webview.js');
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.addScriptTag({ path: bundlePath });
  const report = await page.evaluate(() => globalThis.__iinpublicPortableCoreTests.run());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failed > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
