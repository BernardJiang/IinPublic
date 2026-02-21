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
    }),
    // Ignore Gun.js dynamic requires to suppress webpack warnings
    new webpack.IgnorePlugin({
      resourceRegExp: /^(ws|bufferutil|utf-8-validate|supports-color)$/,
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
    static: './dist/web',
    port: 3001,
    hot: process.env.DISABLE_HMR !== 'true',
    liveReload: process.env.DISABLE_HMR !== 'true',
    watchFiles: process.env.DISABLE_HMR === 'true' ? [] : undefined,
    open: process.env.DISABLE_HMR !== 'true', // Don't auto-open browser during e2e tests
    historyApiFallback: true,
    // Disable all watching for E2E tests
    ...(process.env.DISABLE_HMR === 'true' && {
      client: {
        webSocketURL: 'ws://127.0.0.1:3001/ws',
      },
    }),
  },
  ...(process.env.DISABLE_HMR === 'true' && {
    watch: false,
    watchOptions: {
      ignored: '**/*',
    },
  }),
  devtool: 'source-map',
};
