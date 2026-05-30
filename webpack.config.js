const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  entry: './src/web/index.ts',
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
            'process.env.P2P_DIRECT_CHAT_ENABLED': JSON.stringify(
              process.env.P2P_DIRECT_CHAT_ENABLED || '0',
            ),
            'process.env.P2P_NODE_ENABLED': JSON.stringify(
              process.env.P2P_NODE_ENABLED || '0',
            ),
            'process.env.P0_DIRECT_TALK_DELIVERY': JSON.stringify(
              process.env.P0_DIRECT_TALK_DELIVERY || '0',
            ),
            'process.env.RELAY_ONLY_HUB': JSON.stringify(
              process.env.RELAY_ONLY_HUB || '0',
            ),
            'process.env.STAR_SERVER_PERSISTENCE': JSON.stringify(
              process.env.STAR_SERVER_PERSISTENCE || 'durable',
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
            P2P_DIRECT_CHAT_ENABLED: process.env.P2P_DIRECT_CHAT_ENABLED || '0',
            P2P_NODE_ENABLED: process.env.P2P_NODE_ENABLED || '0',
            P0_DIRECT_TALK_DELIVERY: process.env.P0_DIRECT_TALK_DELIVERY || '0',
            RELAY_ONLY_HUB: process.env.RELAY_ONLY_HUB || '0',
            STAR_SERVER_PERSISTENCE: process.env.STAR_SERVER_PERSISTENCE || 'durable',
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
    hot: process.env.DISABLE_HMR !== 'true',
    liveReload: process.env.DISABLE_HMR !== 'true',
    watchFiles: process.env.DISABLE_HMR === 'true' ? [] : undefined,
    open: process.env.DISABLE_HMR !== 'true', // Don't auto-open browser during e2e tests
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
