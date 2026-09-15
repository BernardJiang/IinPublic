#!/usr/bin/env node

// Build the minimal production dependency tree bundled with the Electron shell.
// This is intentionally Node-based so the same packaging command works on macOS,
// Linux, and a PowerShell-only Windows worker.

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stageDir = path.join(rootDir, 'platforms', 'desktop', '.prod-deps-staging');
const runtimePackages = [
  '@noble/curves',
  '@noble/hashes',
  'bonjour-service',
  'cors',
  'express',
  'gun',
  'helmet',
  'socket.io',
  'uuid',
];
const rootPackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const dependencies = Object.fromEntries(
  runtimePackages.map((name) => {
    const version = rootPackage.dependencies?.[name];
    if (!version) throw new Error(`Root package.json does not declare runtime dependency ${name}`);
    return [name, version];
  }),
);

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });
fs.writeFileSync(
  path.join(stageDir, 'package.json'),
  `${JSON.stringify({
    name: 'iinpublic-desktop-runtime-deps',
    version: '0.0.0',
    private: true,
    dependencies,
  }, null, 2)}\n`,
);

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is missing; run this script through npm');

console.log(`[stage-desktop-prod-deps] npm install (runtime-only) in ${stageDir}`);
const install = spawnSync(
  process.execPath,
  [npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'],
  { cwd: stageDir, stdio: 'inherit' },
);
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status ?? 1);

const radixPatch = spawnSync(
  process.execPath,
  [path.join(rootDir, 'scripts', 'patch-gun-radix.js'), stageDir],
  { cwd: rootDir, stdio: 'inherit' },
);
if (radixPatch.error) throw radixPatch.error;
if (radixPatch.status !== 0) process.exit(radixPatch.status ?? 1);

console.log('[stage-desktop-prod-deps] done');
