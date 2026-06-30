#!/usr/bin/env node
/**
 * Minimal static file server for E2E (replaces `webpack serve` / `npx serve`).
 *
 * Why this exists: the E2E web server used to be `npm run dev:web:e2e` (webpack serve),
 * which recompiles the ~12s bundle on *every* boot. The full `test:all` run boots web
 * servers many times (once per Playwright phase × per worker), so that recompile cost
 * dominated wall-clock time while never showing up on the Playwright speedboard.
 *
 * This server serves the already-built `dist/web/` bundle (built once up front by
 * run-test-all.sh) and boots in well under a second. The browser still derives its Gun
 * hub port from window.location.port (webPort - 3001 + 8080), so serving on 3001+idx
 * keeps each worker pointed at its own Gun server — see web-gun-service.deriveGunHubUrl.
 *
 * IMPORTANT — it must mirror webpack devServer.static (see webpack.config.js):
 *   - dist/web/              served at /            (webpack output / SPA shell)
 *   - public/                served at /            (provides /worker.js)
 *   - node_modules/gun/      served at /node_modules/gun  (worker importScripts gun.js/sea.js)
 *   - historyApiFallback     → unknown extensionless routes fall back to index.html
 * Missing the public/ and gun mounts is what makes `new Worker('/worker.js')` fail to load.
 *
 * Usage: node scripts/e2e-static-web.mjs <port>
 *        PORT env is honoured if <port> arg is omitted.
 */
import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const port = Number(process.argv[2] || process.env.PORT || 3001);

const DIST_WEB = path.join(PROJECT_ROOT, 'dist', 'web');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const GUN_DIR = path.join(PROJECT_ROOT, 'node_modules', 'gun');
const GUN_PREFIX = '/node_modules/gun/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function statFile(p) {
  return fs.stat(p).catch(() => null);
}

/** Resolve a request path to an on-disk file, mirroring webpack's static mounts. */
async function resolve(urlPath) {
  // Gun dependency mount: /node_modules/gun/* → node_modules/gun/*
  if (urlPath.startsWith(GUN_PREFIX)) {
    const rel = urlPath.slice(GUN_PREFIX.length);
    const fp = path.join(GUN_DIR, rel);
    if (!fp.startsWith(GUN_DIR)) return null; // traversal guard
    const st = await statFile(fp);
    return st?.isFile() ? fp : null;
  }

  // dist/web (webpack output) takes precedence, then public/.
  for (const base of [DIST_WEB, PUBLIC_DIR]) {
    let fp = path.join(base, urlPath);
    if (!fp.startsWith(base)) continue; // traversal guard
    let st = await statFile(fp);
    if (st?.isDirectory()) {
      fp = path.join(fp, 'index.html');
      st = await statFile(fp);
    }
    if (st?.isFile()) return fp;
  }

  // historyApiFallback: extensionless routes serve the SPA shell.
  if (!path.extname(urlPath)) {
    const index = path.join(DIST_WEB, 'index.html');
    if ((await statFile(index))?.isFile()) return index;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const rawPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const urlPath = path.posix.normalize(rawPath);
    const filePath = await resolve(urlPath);
    if (!filePath) return send(res, 404, 'Not found');

    const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    send(res, 500, `static server error: ${err?.message || err}`);
  }
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[e2e-static-web] serving dist/web + public + gun on http://127.0.0.1:${port}`);
});
