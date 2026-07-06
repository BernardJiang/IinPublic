// IinPublic desktop (Electron) main process.
//
// Responsibilities:
//   1. Boot the embedded local node (the same src/server code, compiled to
//      dist/server/node-app/embedded-node.js) IN-PROCESS so Gun runs as a real
//      Node peer with on-device radisk persistence.
//   2. Once the local node is listening on 127.0.0.1:<port>, load the prebuilt
//      web SPA from that origin so the renderer reuses 100% of the browser UI
//      and its Gun client auto-points at the local node.
//
// The local node dials the public hub upstream for discovery only.

const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { autoUpdater } = require('electron-updater');

const LOCAL_PORT = parseInt(process.env.IINPUBLIC_LOCAL_PORT || '8088', 10);
const HUB_GUN_URL = process.env.IINPUBLIC_HUB_GUN_URL || 'https://www.iinpublic.com/gun';
const USER_DATA_DIR = String(process.env.IINPUBLIC_USER_DATA_DIR || '').trim();

if (USER_DATA_DIR) {
  app.setPath('userData', path.resolve(USER_DATA_DIR));
}

// In a packaged build extraResources land under process.resourcesPath/app.
// In `npm start` (dev) we point at the repo's dist/ two levels up.
const isPackaged = app.isPackaged;
const appRoot = isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.resolve(__dirname, '..', '..');

const embeddedEntry = path.join(appRoot, 'dist', 'server', 'node-app', 'embedded-node.js');
const webRoot = path.join(appRoot, 'dist', 'web');
const publicRoot = path.join(appRoot, 'public');
const dataDir = path.join(app.getPath('userData'), 'node-data');

function platformId() {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'linux': return 'ubuntu';
    case 'darwin': return 'macos';
    default: return 'unknown';
  }
}

async function startEmbeddedNode() {
  fs.mkdirSync(dataDir, { recursive: true });

  // Inject host-specific config via env before requiring the compiled entry.
  process.env.IINPUBLIC_EMBEDDED_NODE = '1';
  process.env.IINPUBLIC_PLATFORM = platformId();
  process.env.IINPUBLIC_LOCAL_PORT = String(LOCAL_PORT);
  process.env.PORT = String(LOCAL_PORT);
  process.env.IINPUBLIC_HUB_GUN_URL = HUB_GUN_URL;
  process.env.IINPUBLIC_WEB_ROOT = webRoot;
  process.env.IINPUBLIC_PUBLIC_ROOT = publicRoot;
  process.env.IINPUBLIC_DATA_DIR = dataDir;
  process.env.IINPUBLIC_LOOPBACK_ONLY = '1';

  if (!fs.existsSync(embeddedEntry)) {
    throw new Error(
      `Embedded node not built at ${embeddedEntry}. ` +
        `Run "npm run build:web && npm run build:server" at the repo root first.`,
    );
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { startEmbeddedNode: start } = require(embeddedEntry);
  await start({
    defaults: {
      enabled: true,
      platform: platformId(),
      localPort: LOCAL_PORT,
      hubGunPeers: [HUB_GUN_URL],
      webRoot,
      dataDir,
      loopbackOnly: true,
    },
  });
}

function waitForPort(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error('Local node did not open port in time'));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'IinPublic',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links in the system browser, keep app links in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${LOCAL_PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  await waitForPort(LOCAL_PORT);
  await win.loadURL(`http://127.0.0.1:${LOCAL_PORT}/`);
  return win;
}

// electron-updater autoupdate.
//
// "Ship UI + node together; never let dist/web and dist/server drift across
// an update" (docs/TODO.md S3). The Electron app bundles dist/web AND
// dist/server as extraResources of the SAME packaged installer (see the
// `build.extraResources` block in package.json) — there is no separate
// channel that could update one without the other, so a normal autoupdate
// already replaces both atomically as one unit by construction.
//
// `nsis.differentialPackage` is explicitly disabled (full-package updates
// only) rather than relying on delta-patch updates: differential updates
// patch the installed files in place, which is a more complex code path to
// fully trust for correctness across the whole extraResources tree (node_modules
// included). Forcing a full-package download on every update is simpler to
// reason about and guarantees dist/web and dist/server always come from the
// exact same release artifact — worth the extra download size for this app.
//
// `scripts/stamp-build-id.js` + `warnIfBuildIdsDrifted()` (src/server/bootstrap/
// http-bootstrap.ts) are the runtime safety net in case packaging assumptions
// above are ever violated (corrupted artifact, manual tinkering, etc).
function setupAutoUpdater(win) {
  if (!app.isPackaged) {
    // electron-updater requires a packaged app (reads app-update.yml from the
    // installed resources dir); it's a no-op / would just error in `npm start`.
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const log = (...args) => {
    // eslint-disable-next-line no-console
    console.log('[desktop:autoupdate]', ...args);
  };

  autoUpdater.on('checking-for-update', () => log('checking for update...'));
  autoUpdater.on('update-not-available', () => log('no update available'));
  autoUpdater.on('error', (err) => log('error', err == null ? err : err.message || err));
  autoUpdater.on('update-available', (info) => log('update available', info && info.version));
  autoUpdater.on('download-progress', (p) => log(`downloading: ${Math.round(p.percent || 0)}%`));

  autoUpdater.on('update-downloaded', async (info) => {
    log('update downloaded', info && info.version);
    const result = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'IinPublic update ready',
      message: `Version ${info && info.version ? info.version : ''} has been downloaded.`,
      detail: 'Restart now to apply the update (the local peer node restarts with it).',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  // Check on launch, then periodically — desktop sessions can stay open for
  // a long time, and the embedded node should not run a stale build forever.
  autoUpdater.checkForUpdates().catch((err) => log('initial check failed', err));
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => log('periodic check failed', err));
  }, 4 * 60 * 60 * 1000); // every 4 hours
}

app.whenReady().then(async () => {
  try {
    await startEmbeddedNode();
    const win = await createWindow();
    setupAutoUpdater(win);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[desktop] startup failed', err);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // The local node lives in this process; quitting stops it (intended:
  // desktop node is foreground-scoped to the app session).
  if (process.platform !== 'darwin') app.quit();
});
