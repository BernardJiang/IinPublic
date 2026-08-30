#!/usr/bin/env node
/**
 * Bundles the embedded-node entry point into ONE self-contained CommonJS file
 * for nodejs-mobile (Android/iOS), instead of shipping the whole unbundled
 * `dist/server` tree + a separate `npm install` of its runtime deps
 * (express, gun, socket.io, helmet, cors, bonjour-service, uuid, and every
 * one of their transitive dependencies).
 *
 * Why this exists: on Android, `NodeBridge.unpackIfNeeded` copies the staged
 * nodejs-project out of read-only APK assets into the app's writable sandbox
 * ONE FILE AT A TIME via the Android AssetManager (see
 * android/app/src/main/java/com/iinpublic/app/NodeBridge.kt). The unbundled
 * tree is 1000+ small files once every transitive node_modules dependency is
 * counted; MainActivity's own comment already documents this costing
 * "30-45 seconds" on first launch / after every app update. Collapsing the
 * server's own require() graph into a single file removes nearly all of that
 * file count, and also removes the per-launch cost of Node's CommonJS
 * resolver walking many small files on the mobile filesystem to satisfy
 * require() calls on every cold start (not just first launch).
 *
 * What still ships as loose files (unaffected by this script):
 *   - dist/web/**            — the web SPA, served as static files, never
 *                               executed by Node; already a webpack bundle.
 *   - node_modules/gun/*.js  — express.static('/node_modules/gun') serves
 *                               these directly to the browser/WebView's own
 *                               Web Worker (public/worker.js does
 *                               importScripts('/node_modules/gun/gun.js') and
 *                               .../sea.js) — this is a static-file HTTP
 *                               response, not a Node require(), so bundling
 *                               the *server's* code can never eliminate it.
 *                               platforms/mobile/nodejs-project/package.json
 *                               keeps "gun" as its one real dependency for
 *                               exactly this reason.
 *
 * Verified safe to bundle everything else: the only bare (non-bundled)
 * require() calls esbuild leaves in the output are `aws-sdk` (Gun's optional
 * rs3.js S3 adapter, gated behind `opt.s3`/AWS_S3_BUCKET — never reached) and
 * `bufferutil`/`utf-8-validate` (ws's optional native perf accelerators,
 * already wrapped in their own try/catch with a pure-JS fallback). All three
 * are guarded by a try/catch in the ORIGINAL source, which is exactly the
 * pattern esbuild requires before it will leave a require() unresolved
 * instead of failing the build — see the `[ignored-dynamic-import]` esbuild
 * diagnostic. None of the three are shipped, and none need to be.
 *
 * Output lands at dist/embedded-mobile/server/node-app/embedded-node.js —
 * the same relative path under `dist/` that
 * platforms/mobile/nodejs-project/main.js already resolves
 * (`path.join(distRoot, 'server', 'node-app', 'embedded-node.js')`), so
 * main.js needed no changes; only what android/app/build.gradle's
 * stageNodeDist task copies into assets/ changed (dist/embedded-mobile
 * instead of the full dist/server tree for the server half).
 */
const path = require('path');
const esbuild = require('esbuild');

const repoRoot = path.resolve(__dirname, '..');
const entry = path.join(repoRoot, 'src', 'node-app', 'embedded-node.ts');
const outfile = path.join(repoRoot, 'dist', 'embedded-mobile', 'server', 'node-app', 'embedded-node.js');

async function main() {
  const result = await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    // nodejs-mobile v18.20.4 is the on-device runtime (see platforms/mobile/README.md).
    target: 'node18',
    format: 'cjs',
    sourcemap: true,
    logLevel: 'info',
    metafile: true,
  });

  const bytes = Buffer.byteLength(require('fs').readFileSync(outfile));
  console.log(
    `[build-embedded-mobile] wrote ${path.relative(repoRoot, outfile)} ` +
      `(${(bytes / 1024 / 1024).toFixed(2)} MiB, single file — no node_modules required at runtime except node_modules/gun's static browser assets)`,
  );

  // Fail loudly if a NEW unresolved bare import shows up that isn't one of the
  // three already-audited, guarded ones — anything else is a real missing
  // dependency, not a safe-to-ignore optional path, and should stop the build
  // rather than silently ship a broken embedded node.
  const expectedExternal = new Set(['aws-sdk', 'bufferutil', 'utf-8-validate']);
  const builtins = new Set(require('module').builtinModules);
  const isNodeBuiltin = (name) => builtins.has(name) || builtins.has(name.replace(/^node:/, ''));
  const seen = new Set();
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imp of output.imports || []) {
      if (imp.external && !isNodeBuiltin(imp.path)) seen.add(imp.path);
    }
  }
  const unexpected = [...seen].filter((name) => !expectedExternal.has(name));
  if (unexpected.length > 0) {
    console.error(
      `[build-embedded-mobile] FAIL: unexpected unresolved import(s) in the bundle: ${unexpected.join(', ')}. ` +
        'These were not present when this bundling was last audited (see this script\'s header comment) — ' +
        'either a new dependency needs installing, or this list needs updating after re-verifying the new ' +
        'import is genuinely optional/guarded.',
    );
    process.exitCode = 1;
    return;
  }
  console.log(`[build-embedded-mobile] verified unresolved imports match the audited list: ${[...seen].join(', ') || '(none)'}`);
}

main().catch((err) => {
  console.error('[build-embedded-mobile] failed:', err);
  process.exitCode = 1;
});
