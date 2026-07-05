// nodejs-mobile entry — runs inside the Android/iOS app sandbox.
//
// nodejs-mobile starts this file in an embedded Node runtime. It boots the
// SAME embedded local node used on desktop (the compiled src/server), so Gun
// runs as a real on-device peer that dials the hub for discovery only. The
// native WebView then loads the web SPA from http://127.0.0.1:<port>.
//
// The `rn-bridge` / `cordova-bridge` channel (when present) lets native code
// pass the app's writable data dir and platform id in, and lets the node
// signal "ready" so the WebView delays loading until the port is open.

'use strict';

const path = require('path');

let bridge = null;
try {
  // nodejs-mobile-react-native exposes 'rn-bridge'; the raw nodejs-mobile
  // Cordova/AAR variant exposes 'cordova-bridge'. Either is optional.
  // eslint-disable-next-line import/no-unresolved, global-require
  bridge = require('rn-bridge');
} catch (_) {
  try {
    // eslint-disable-next-line import/no-unresolved, global-require
    bridge = require('cordova-bridge');
  } catch (_2) {
    bridge = null;
  }
}

function platformId() {
  if (process.env.IINPUBLIC_PLATFORM) return process.env.IINPUBLIC_PLATFORM;
  // nodejs-mobile reports 'android'/'ios' via NODEJS_MOBILE_PLATFORM when set.
  return process.env.NODEJS_MOBILE_PLATFORM || 'unknown';
}

async function boot(opts) {
  const platform = platformId();
  const localPort = parseInt(process.env.IINPUBLIC_LOCAL_PORT || '8088', 10);
  const hub = process.env.IINPUBLIC_HUB_GUN_URL || 'https://www.iinpublic.com/gun';

  // Native passes the app sandbox dir; fall back to alongside this script.
  const dataDir =
    (opts && opts.dataDir) ||
    process.env.IINPUBLIC_DATA_DIR ||
    path.join(__dirname, 'node-data');

  // The compiled server + web bundles are copied into this project at build
  // time (see platforms/mobile/README.md). dist/ sits next to this file.
  const distRoot = path.join(__dirname, 'dist');
  const embeddedEntry = path.join(distRoot, 'server', 'node-app', 'embedded-node.js');
  const webRoot = path.join(distRoot, 'web');
  const publicRoot = path.join(__dirname, 'public');

  process.env.IINPUBLIC_EMBEDDED_NODE = '1';
  process.env.IINPUBLIC_PLATFORM = platform;
  process.env.IINPUBLIC_LOCAL_PORT = String(localPort);
  process.env.PORT = String(localPort);
  process.env.IINPUBLIC_HUB_GUN_URL = hub;
  process.env.IINPUBLIC_WEB_ROOT = webRoot;
  process.env.IINPUBLIC_PUBLIC_ROOT = publicRoot;
  process.env.IINPUBLIC_DATA_DIR = dataDir;
  process.env.IINPUBLIC_LOOPBACK_ONLY = '1';

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { startEmbeddedNode } = require(embeddedEntry);
  await startEmbeddedNode({
    defaults: {
      enabled: true,
      platform,
      localPort,
      hubGunPeers: [hub],
      webRoot,
      dataDir,
      loopbackOnly: true,
    },
  });

  if (bridge && bridge.channel) {
    bridge.channel.send(JSON.stringify({ type: 'node-ready', port: localPort }));
  }
}

if (bridge && bridge.channel) {
  bridge.channel.on('message', (msg) => {
    let parsed = {};
    try { parsed = JSON.parse(msg); } catch (_) { parsed = {}; }
    if (parsed.type === 'start') {
      boot(parsed).catch((err) => {
        bridge.channel.send(JSON.stringify({ type: 'node-error', error: String(err) }));
      });
    }
  });
  // Tell native we are alive and waiting for the start payload (data dir).
  bridge.channel.send(JSON.stringify({ type: 'node-loaded' }));
} else {
  // No bridge (e.g. local `node main.js` smoke test): boot immediately.
  boot({}).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[nodejs-mobile] boot failed', err);
    process.exit(1);
  });
}
