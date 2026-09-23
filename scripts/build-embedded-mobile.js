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
 *   - node_modules/gun/*.js  — needed twice over, not just once:
 *                               (1) express.static('/node_modules/gun') serves these directly to
 *                               the browser/WebView's own Web Worker (public/worker.js does
 *                               importScripts('/node_modules/gun/gun.js') and .../sea.js) — a
 *                               static-file HTTP response, not a Node require(), so bundling the
 *                               *server's* code could never eliminate it on its own; and
 *                               (2) `gun`/`gun/sea` are deliberately left OUT of this bundle
 *                               (`external:` below) and required normally by the server's own
 *                               process at runtime — bundling them broke `SEA.verify` outright
 *                               (found live 2026-09-23: esbuild's CJS interop for `gun/sea`'s
 *                               default export silently produced an object with no `.verify`
 *                               method, so every delegate-grant/recovery-anchor/FAQ-bundle
 *                               signature check failed unconditionally on Android — the identical
 *                               plain tsc build, requiring the same module normally, verified
 *                               correctly). `platforms/mobile/nodejs-project/package.json` keeps
 *                               "gun" as its one real dependency for exactly this now-dual reason,
 *                               and its `node_modules/gun` sits well within plain Node resolution's
 *                               upward walk from this bundle's own on-device location.
 *
 * Verified safe to bundle everything else: the only bare (non-bundled)
 * require() calls esbuild leaves in the output are `aws-sdk` (Gun's optional
 * rs3.js S3 adapter, gated behind `opt.s3`/AWS_S3_BUCKET — never reached),
 * `bufferutil`/`utf-8-validate` (ws's optional native perf accelerators,
 * already wrapped in their own try/catch with a pure-JS fallback), and the
 * deliberately-external `gun`/`gun/sea` described above. The first three are
 * guarded by a try/catch in the ORIGINAL source, which is exactly the
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
    // Real bug found live 2026-09-23 (Huawei phone, every TechSupport delegate-grant/recovery-
    // anchor/FAQ-bundle verification silently failing): esbuild's CJS bundling of `gun/sea`
    // breaks its default-export interop — the bundled call site sees
    // `import_sea.default.verify is not a function` even though `gun/sea`'s own module.exports
    // has a real `.verify` function, and the plain (non-bundled) tsc build of this exact same
    // code, requiring `gun/sea` normally, verifies correctly. `gun` never needed bundling in the
    // first place: `node_modules/gun` is already staged as a real on-device dependency (see this
    // file's header comment — the browser Worker serves it as static files), sitting at
    // `nodejs-project/node_modules/gun` a few directories above this bundle's own
    // `dist/server/node-app/embedded-node.js` — well within plain Node module resolution's normal
    // upward walk. Externalizing leaves an ordinary `require('gun')`/`require('gun/sea')` in the
    // output instead of esbuild's interop-wrapped inline copy, matching the tsc build's (working)
    // behavior exactly.
    external: ['gun', 'gun/sea'],
  });

  const bytes = Buffer.byteLength(require('fs').readFileSync(outfile));
  console.log(
    `[build-embedded-mobile] wrote ${path.relative(repoRoot, outfile)} ` +
      `(${(bytes / 1024 / 1024).toFixed(2)} MiB, single file — requires node_modules/gun to be staged alongside it at runtime, same as the browser Worker's static assets)`,
  );

  // Fail loudly if a NEW unresolved bare import shows up that isn't one of the
  // already-audited ones — anything else is a real missing dependency, not a
  // safe-to-ignore optional path, and should stop the build rather than
  // silently ship a broken embedded node. `gun`/`gun/sea` are deliberately
  // external (see the `external:` option above) — expected, not a gap.
  const expectedExternal = new Set(['aws-sdk', 'bufferutil', 'utf-8-validate', 'gun', 'gun/sea']);
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

  // Boots the bundle we just wrote and runs a real signed grant through its actual HTTP route —
  // catches a broken bundling step (like the 2026-09-23 gun/sea interop regression this file's
  // header comment describes) that a clean esbuild exit code alone would never surface. Skips
  // gracefully (does not fail the build) when no real signing key is configured locally; see that
  // script's own header comment.
  const { execFileSync } = require('child_process');
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'verify-embedded-mobile-bundle.js')], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } catch {
    console.error('[build-embedded-mobile] FAIL: the just-built bundle did not pass its post-build smoke test (see output above).');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[build-embedded-mobile] failed:', err);
  process.exitCode = 1;
});
