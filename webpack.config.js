const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

// LAN HTTPS: if a self-signed dev cert exists (certs/dev-*.pem, from
// scripts/gen-dev-cert.sh), serve the dev UI over https so other devices load
// in a secure context (required by Gun.js SEA / WebCrypto). Falls back to http.
// Override paths with TLS_KEY_PATH / TLS_CERT_PATH.
const devKeyPath = process.env.TLS_KEY_PATH || path.resolve(__dirname, 'certs/dev-key.pem');
const devCertPath = process.env.TLS_CERT_PATH || path.resolve(__dirname, 'certs/dev-cert.pem');
// E2E mode (DISABLE_HMR=true) always serves plain http: every Playwright helper
// targets http://127.0.0.1:<port> (tests/e2e/helpers/ports.ts), and an https dev
// server from a leftover certs/dev-*.pem makes WebKit fail page.goto with
// "The network connection was lost" (Chromium-run suites dodge it only because
// test:all serves the static bundle over http). TLS remains for LAN dev.
const devTlsEnabled =
  process.env.DISABLE_HMR !== 'true' && fs.existsSync(devKeyPath) && fs.existsSync(devCertPath);

// Env vars baked into the bundle (DefinePlugin/EnvironmentPlugin/HtmlWebpackPlugin
// below). The filesystem cache must be keyed on them: a cached build made under one
// set of values would otherwise be served for another (e.g. an E2E DISABLE_HMR=true
// bundle reused for a dev build).
const BUNDLED_ENV_KEYS = [
  'DISABLE_HMR',
  'TEST_ALL_PORT_OFFSET',
  'CHATROOM_MAX_CAPACITY',
  'CHATROOM_ENABLE_FIFO',
  'IINPUBLIC_STAGE_SEED',
  'IINPUBLIC_STAGE_ZERO_MAX_GLOBAL',
  'IINPUBLIC_PRESENCE_TTL_SECONDS',
  'IINPUBLIC_ROOM_MEMBERSHIP_TTL_SECONDS',
  'P2P_NODE_ENABLED',
  'RELAY_ONLY_HUB',
  // Content-node (IPFS) libp2p bootstrap/relay multiaddr(s) — lets the browser node dial a
  // reachable circuit relay so two browsers can peer for P2P media (dev:multi sets this).
  'IINPUBLIC_P2P_BOOTSTRAP_PEERS',
  'IINPUBLIC_MESH_SYNC_MODE',
  // TODO §S Item 7: ledger E2E enable + checkpoint/retention overrides (see app.ts's
  // isLedgerDisabledForRun, web-ledger-service.ts, gun-message-store.ts). Missing these
  // here was itself a real bug found while writing the Item 7 E2E spec: without them in
  // the cache key, the filesystem cache served a stale bundle built under a *different*
  // value for these vars, silently ignoring a changed retention window between runs.
  'IINPUBLIC_E2E_ENABLE_LEDGER',
  'IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL',
  'IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW',
  'IINPUBLIC_E2E_MESSAGE_CHECKPOINT_INTERVAL',
  'IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW',
  // TODO §J: how long the sender waits for a device-handoff ack before giving up
  // (app.ts's handoffAckTimeoutMs) — shrunk for E2E so a real send→ack round trip
  // doesn't wait the full production timeout.
  'IINPUBLIC_E2E_HANDOFF_ACK_TIMEOUT_MS',
];

module.exports = {
  entry: './src/web/index.ts',
  // Persistent build cache: `test:all` rebuilds the dev bundle on every run; with the
  // filesystem cache an unchanged (or lightly changed) tree rebuilds in seconds instead
  // of a full ts-loader pass. Safe because `version` covers every env var whose value is
  // compiled into the bundle, and buildDependencies invalidates on config edits.
  cache: {
    type: 'filesystem',
    version: BUNDLED_ENV_KEYS.map((k) => `${k}=${process.env[k] || ''}`).join('&'),
    buildDependencies: { config: [__filename] },
  },
  output: {
    path: path.resolve(__dirname, 'dist/web'),
    filename: 'bundle.js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@web': path.resolve(__dirname, 'src/web'),
      'node:stream': 'stream-browserify',
    },
    fallback: {
      stream: require.resolve('stream-browserify'),
      // @libp2p/mdns uses multicast-dns which requires dgram and os (Node.js only).
      // The import is conditional on !browserLike at runtime so these paths never
      // execute in the browser; empty stubs keep the bundle from erroring.
      dgram: false,
      os: false,
      net: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: 'tsconfig.webpack.json',
            },
          },
        ],
        exclude: [/node_modules/, /src\/examples/, /archived-tests/],
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, '');
    }),
    new HtmlWebpackPlugin({
      template: './src/web/index.html',
      title: 'IinPublic',
      favicon: './public/favicon.ico',
      templateParameters: {
        stageSeed: process.env.IINPUBLIC_STAGE_SEED || '',
      },
    }),
    // E2E web (`DISABLE_HMR=true`): fixed relaxed capacity/FIFO so Gun map quirks don't FIFO-evict one browser
    // to another region while the peer stays in Global — broadcast then targets the wrong chatroom's talks path.
    ...(process.env.DISABLE_HMR === 'true'
      ? [
          new webpack.DefinePlugin({
            'process.env.DISABLE_HMR': JSON.stringify('true'),
            'process.env.TEST_ALL_PORT_OFFSET': JSON.stringify(
              process.env.TEST_ALL_PORT_OFFSET || '',
            ),
            'process.env.CHATROOM_MAX_CAPACITY': JSON.stringify(
              process.env.CHATROOM_MAX_CAPACITY || '50',
            ),
            'process.env.CHATROOM_ENABLE_FIFO': JSON.stringify(
              process.env.CHATROOM_ENABLE_FIFO !== undefined
                ? process.env.CHATROOM_ENABLE_FIFO
                : 'false',
            ),
            'process.env.IINPUBLIC_STAGE_SEED': JSON.stringify(
              process.env.IINPUBLIC_STAGE_SEED || '',
            ),
            'process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL': JSON.stringify(
              process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL || '',
            ),
            'process.env.IINPUBLIC_PRESENCE_TTL_SECONDS': JSON.stringify(
              process.env.IINPUBLIC_PRESENCE_TTL_SECONDS || '',
            ),
            'process.env.IINPUBLIC_ROOM_MEMBERSHIP_TTL_SECONDS': JSON.stringify(
              process.env.IINPUBLIC_ROOM_MEMBERSHIP_TTL_SECONDS || '',
            ),
            'process.env.P2P_NODE_ENABLED': JSON.stringify(
              process.env.P2P_NODE_ENABLED || '0',
            ),
            'process.env.RELAY_ONLY_HUB': JSON.stringify(
              process.env.RELAY_ONLY_HUB || '0',
            ),
            'process.env.IINPUBLIC_P2P_BOOTSTRAP_PEERS': JSON.stringify(
              process.env.IINPUBLIC_P2P_BOOTSTRAP_PEERS || '',
            ),
            'process.env.IINPUBLIC_MESH_SYNC_MODE': JSON.stringify(process.env.IINPUBLIC_MESH_SYNC_MODE || 'auto'),
            // TODO §S Item 7: the ledger (Phase E+F) is disabled for the whole DISABLE_HMR=true
            // E2E run by default (see app.ts's isLedgerDisabledForRun) — this narrowly
            // re-enables it for the one spec that needs it (checkpoint/prune/delta-sync E2E
            // proof), without changing behavior for every other E2E spec.
            'process.env.IINPUBLIC_E2E_ENABLE_LEDGER': JSON.stringify(
              process.env.IINPUBLIC_E2E_ENABLE_LEDGER || '',
            ),
            // TODO §S Item 7: let the pruning E2E spec shrink the checkpoint/retention
            // constants so it can cross them without hundreds of slow sequential real Gun
            // round trips at production scale — unset, these fall back to the real
            // production values (see web-ledger-service.ts / gun-message-store.ts).
            'process.env.IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL': JSON.stringify(
              process.env.IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL || '',
            ),
            'process.env.IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW': JSON.stringify(
              process.env.IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW || '',
            ),
            'process.env.IINPUBLIC_E2E_MESSAGE_CHECKPOINT_INTERVAL': JSON.stringify(
              process.env.IINPUBLIC_E2E_MESSAGE_CHECKPOINT_INTERVAL || '',
            ),
            'process.env.IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW': JSON.stringify(
              process.env.IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW || '',
            ),
            'process.env.IINPUBLIC_E2E_HANDOFF_ACK_TIMEOUT_MS': JSON.stringify(
              process.env.IINPUBLIC_E2E_HANDOFF_ACK_TIMEOUT_MS || '',
            ),
          }),
        ]
      : [
          new webpack.EnvironmentPlugin({
            CHATROOM_MAX_CAPACITY: process.env.CHATROOM_MAX_CAPACITY || '3',
            CHATROOM_ENABLE_FIFO: process.env.CHATROOM_ENABLE_FIFO || 'true',
            // Web client reads this in web-gun-service (AXE off for e2e only). Must be defined here
            // so the bundle does not reference bare `process` in the browser (webpack 5).
            DISABLE_HMR: process.env.DISABLE_HMR || 'false',
            TEST_ALL_PORT_OFFSET: process.env.TEST_ALL_PORT_OFFSET || '',
            IINPUBLIC_STAGE_SEED: process.env.IINPUBLIC_STAGE_SEED || '',
            IINPUBLIC_STAGE_ZERO_MAX_GLOBAL: process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL || '',
            IINPUBLIC_PRESENCE_TTL_SECONDS: process.env.IINPUBLIC_PRESENCE_TTL_SECONDS || '',
            IINPUBLIC_ROOM_MEMBERSHIP_TTL_SECONDS: process.env.IINPUBLIC_ROOM_MEMBERSHIP_TTL_SECONDS || '',
            P2P_NODE_ENABLED: process.env.P2P_NODE_ENABLED || '0',
            RELAY_ONLY_HUB: process.env.RELAY_ONLY_HUB || '0',
            IINPUBLIC_P2P_BOOTSTRAP_PEERS: process.env.IINPUBLIC_P2P_BOOTSTRAP_PEERS || '',
            IINPUBLIC_MESH_SYNC_MODE: process.env.IINPUBLIC_MESH_SYNC_MODE || 'auto',
            // TODO §S1 bugfix: web-ledger-service.ts/gun-message-store.ts read these four
            // directly (`process.env.IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL` etc., no
            // dynamic key) at module load, unconditionally — not just in the DISABLE_HMR=true
            // DefinePlugin branch above. Missing them here left the raw `process.env.X`
            // expression unresolved in an ordinary `npm run dev` bundle, which would throw
            // "process is not defined" the moment the module loaded (no `process` global
            // exists in either browser bundle) — same failure mode the DefinePlugin branch's
            // own copy of these keys was already written to avoid.
            IINPUBLIC_E2E_ENABLE_LEDGER: process.env.IINPUBLIC_E2E_ENABLE_LEDGER || '',
            IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL: process.env.IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL || '',
            IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW: process.env.IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW || '',
            IINPUBLIC_E2E_MESSAGE_CHECKPOINT_INTERVAL: process.env.IINPUBLIC_E2E_MESSAGE_CHECKPOINT_INTERVAL || '',
            IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW: process.env.IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW || '',
            IINPUBLIC_E2E_HANDOFF_ACK_TIMEOUT_MS: process.env.IINPUBLIC_E2E_HANDOFF_ACK_TIMEOUT_MS || '',
          }),
        ]),
    // Ignore Gun.js dynamic requires that are Node.js-only and must not be
    // bundled for the browser.  gun/sea.js requires 'crypto' and
    // '@peculiar/webcrypto' in a try-catch at startup — it falls back to the
    // browser's native WebCrypto API when these modules are absent, so
    // silencing them here is safe and avoids spurious webpack warnings.
    new webpack.IgnorePlugin({
      resourceRegExp: /^(ws|bufferutil|utf-8-validate|supports-color|@peculiar\/webcrypto|crypto)$/,
      contextRegExp: /gun/,
    }),
    new webpack.ContextReplacementPlugin(/gun/, path.resolve(__dirname, 'node_modules/gun'), {}),
  ],
  ignoreWarnings: [
    // Suppress Gun.js dynamic require warnings
    {
      module: /gun/,
      message: /Critical dependency: the request of a dependency is an expression/,
    },
  ],
  devServer: {
    static: [
      // NOTE: dist/web is intentionally omitted — webpack-dev-server already
      // serves webpack output from the in-memory filesystem via devMiddleware.
      // Including it here would make chokidar watch the output directory and
      // trigger live-reloads whenever webpack writes there, causing an
      // infinite refresh loop.

      // Serve public/ so worker.js is available at /worker.js
      { directory: path.resolve(__dirname, 'public'), publicPath: '/' },
      // Serve gun files so the Web Worker can importScripts('/node_modules/gun/…')
      // watch: false — this is a large static dependency; no need to watch it.
      { directory: path.resolve(__dirname, 'node_modules/gun'), publicPath: '/node_modules/gun', watch: false },
    ],
    // Port defaults to 3001; overridable via PORT env var or `-- --port NNNN` CLI flag so
    // parallel Playwright workers can each run their own dev-server on 3001+N.
    port: Number(process.env.PORT) || 3001,
    // LAN development smoke tests and real phones/notebooks may load the dev UI
    // through http(s)://<dev-host>:3001 rather than localhost.
    allowedHosts: 'all',
    // Serve over HTTPS when a self-signed dev cert is present (see top of file).
    ...(devTlsEnabled && {
      server: {
        type: 'https',
        options: {
          key: fs.readFileSync(devKeyPath),
          cert: fs.readFileSync(devCertPath),
        },
      },
    }),
    hot: process.env.DISABLE_HMR !== 'true',
    liveReload: process.env.DISABLE_HMR !== 'true',
    watchFiles: process.env.DISABLE_HMR === 'true' ? [] : undefined,
    // Don't auto-open during e2e; and don't auto-open in dev:multi (launch-browsers.js
    // opens the labelled windows itself — webpack's own tab would add a stray, unlabelled
    // "Adam" user).
    open: process.env.DISABLE_HMR !== 'true' && process.env.IINPUBLIC_STAGE_SEED !== 'multi',
    historyApiFallback: true,
    // Disable all watching for E2E tests. Omit the hardcoded webSocketURL: the default
    // (same origin as the page) is correct for every worker's port.
    ...(process.env.DISABLE_HMR === 'true' && {
      client: false,
    }),
  },
  ...(process.env.DISABLE_HMR === 'true' && {
    watch: false,
  }),
  performance: {
    maxAssetSize: 600 * 1024,
    maxEntrypointSize: 600 * 1024,
  },
  // watchOptions: always set for dev mode to ignore runtime-written directories
  // (radata/ — Gun.js server storage, logs/ — server logging, dist/ — build output,
  //  test-storage/ and user_data/ — test/browser profile data).
  // In E2E mode (DISABLE_HMR=true) we additionally ignore everything to prevent
  // any accidental watch-triggered recompile during tests.
  watchOptions: process.env.DISABLE_HMR === 'true'
    ? { ignored: '**/*' }
    : {
        ignored: ['**/node_modules', '**/radata', '**/logs', '**/dist', '**/.git', '**/test-storage', '**/user_data'],
        aggregateTimeout: 300,
      },
  devtool: 'source-map',
};
