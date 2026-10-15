import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repoRoot, 'dist', 'device-tests');
await mkdir(outputDirectory, { recursive: true });

await Promise.all([
  build({
    entryPoints: [path.join(repoRoot, 'src/test/support/portable-core-webview-entry.ts')],
    outfile: path.join(outputDirectory, 'portable-core-webview.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome101'],
    sourcemap: true,
    logLevel: 'warning',
  }),
  build({
    entryPoints: [path.join(repoRoot, 'src/test/support/portable-core-node-entry.ts')],
    outfile: path.join(outputDirectory, 'portable-core-node.cjs'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: ['node18'],
    sourcemap: true,
    logLevel: 'warning',
  }),
]);

process.stdout.write(`[android-core] built portable bundles in ${path.relative(repoRoot, outputDirectory)}\n`);
