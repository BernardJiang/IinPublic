#!/usr/bin/env node

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { firefox } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostConfig = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'matrix', 'hosts.json'), 'utf8'),
).macos;
const firefoxConfig = hostConfig?.browsers?.firefox;
const executablePath = process.env.MACOS_FIREFOX_EXECUTABLE || firefoxConfig?.executablePath;
const channel = firefoxConfig?.channel || 'moz-firefox';
const required = process.env.MACOS_FIREFOX_REQUIRED === '1';
const preflightOnly = process.argv.includes('--preflight');
const nativeMode = process.argv.includes('--native');

function skipOrFail(message) {
  const prefix = required ? 'FAIL' : 'SKIP';
  console.error(`[macos-firefox-e2e] ${prefix}: ${message}; no tests started.`);
  process.exit(required ? 1 : 0);
}

if (process.platform !== 'darwin') {
  skipOrFail(`the configured worker requires macOS, but this host is ${process.platform}`);
}
if (!executablePath || !fs.existsSync(executablePath)) {
  skipOrFail(`Firefox is unavailable at ${executablePath || '(no configured path)'}`);
}

const versionProbe = spawnSync(executablePath, ['--version'], {
  cwd: repoRoot,
  encoding: 'utf8',
  timeout: 10_000,
});
if (versionProbe.error || versionProbe.status !== 0) {
  skipOrFail(
    `Firefox version probe failed (${versionProbe.error?.message || versionProbe.stderr.trim() || `exit ${versionProbe.status}`})`,
  );
}

let browser;
try {
  // A version string alone does not prove the installed release can be automated. Playwright's
  // `moz-firefox` channel uses Firefox's WebDriver BiDi endpoint, unlike the bundled `firefox`
  // project, which uses the patched Juggler protocol.
  browser = await firefox.launch({
    channel,
    executablePath,
    headless: true,
    timeout: 15_000,
  });
  const page = await browser.newPage();
  await page.goto('data:text/html,<title>iinpublic-firefox-preflight</title>');
  if ((await page.title()) !== 'iinpublic-firefox-preflight') {
    throw new Error('WebDriver BiDi page probe returned an unexpected title');
  }
  console.log(
    `[macos-firefox-e2e] available: ${versionProbe.stdout.trim()} (${hostConfig.host}, WebDriver BiDi ${browser.version()})`,
  );
} catch (error) {
  await browser?.close().catch(() => {});
  skipOrFail(`Firefox WebDriver BiDi preflight failed (${error instanceof Error ? error.message : String(error)})`);
}
await browser.close();

if (preflightOnly) {
  console.log('[macos-firefox-e2e] preflight passed; no tests started.');
  process.exit(0);
}

const build = spawnSync('npm', ['run', nativeMode ? 'build:embedded' : 'build:server'], {
  cwd: repoRoot,
  stdio: 'inherit',
  timeout: 5 * 60_000,
});
if (build.error || build.status !== 0) {
  console.error(`[macos-firefox-e2e] server build failed: ${build.error?.message || `exit ${build.status}`}`);
  process.exit(build.status || 1);
}

const playwrightCli = path.join(repoRoot, 'node_modules', 'playwright', 'cli.js');
const testArgs = nativeMode
  ? [
      playwrightCli,
      'test',
      '--config=tests/e2e/native-app/playwright.config.ts',
      'tests/e2e/native-app/02-browser-and-desktop-app-presence.spec.ts',
    ]
  : [
      playwrightCli,
      'test',
      'tests/e2e/platform-smoke',
      'tests/e2e/browser-matrix/02-macos-installed-firefox-talk.spec.ts',
      '--project=macos-firefox',
      '--project=macos-firefox-mixed',
    ];
const result = spawnSync(
  process.execPath,
  testArgs,
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DISABLE_HMR: 'true',
      E2E_GUN_MEMORY_ONLY: '1',
      E2E_MACOS_FIREFOX: '1',
      MACOS_FIREFOX_EXECUTABLE: executablePath,
      ...(nativeMode ? { NATIVE_APP_E2E_BROWSER: 'macos-firefox' } : {}),
      PW_WORKERS: '1',
    },
    timeout: 15 * 60_000,
  },
);
if (result.error) {
  console.error(`[macos-firefox-e2e] test runner failed: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(
    `[macos-firefox-e2e] tests failed: ${result.signal ? `signal ${result.signal}` : `exit ${result.status}`}`,
  );
}
process.exit(result.status ?? 1);
