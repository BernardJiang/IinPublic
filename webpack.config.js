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
  'CHATROOM_MAX_CAPACITY',
  'CHATROOM_ENABLE_FIFO',
  'IINPUBLIC_STAGE_SEED',
  'IINPUBLIC_STAGE_ZERO_MAX_GLOBAL',
  'IINPUBLIC_PRESENCE_TTL_SECONDS',
  'IINPUBLIC_ROOM_MEMBERSHIP_TTL_SECONDS',
  'P2P_NODE_ENABLED',
  'RELAY_ONLY_HUB',
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
          }),
        ]
      : [
          new webpack.EnvironmentPlugin({
            CHATROOM_MAX_CAPACITY: process.env.CHATROOM_MAX_CAPACITY || '3',
            CHATROOM_ENABLE_FIFO: process.env.CHATROOM_ENABLE_FIFO || 'true',
            // Web client reads this in web-gun-service (AXE off for e2e only). Must be defined here
            // so the bundle does not reference bare `process` in the browser (webpack 5).
            DISABLE_HMR: process.env.DISABLE_HMR || 'false',
            IINPUBLIC_STAGE_SEED: process.env.IINPUBLIC_STAGE_SEED || '',
            IINPUBLIC_STAGE_ZERO_MAX_GLOBAL: process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL || '',
            IINPUBLIC_PRESENCE_TTL_SECONDS: process.env.IINPUBLIC_PRESENCE_TTL_SECONDS || '',
            IINPUBLIC_ROOM_MEMBERSHIP_TTL_SECONDS: process.env.IINPUBLIC_ROOM_MEMBERSHIP_TTL_SECONDS || '',
            P2P_NODE_ENABLED: process.env.P2P_NODE_ENABLED || '0',
            RELAY_ONLY_HUB: process.env.RELAY_ONLY_HUB || '0',
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
