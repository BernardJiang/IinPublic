const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  entry: './src/web/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist/web'),
    filename: 'bundle.js',
    clean: true
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@web': path.resolve(__dirname, 'src/web')
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/web/index.html',
      title: 'IinPublic'
    }),
    // Ignore Gun.js dynamic requires to suppress webpack warnings
    new webpack.IgnorePlugin({
      resourceRegExp: /^(ws|bufferutil|utf-8-validate|supports-color)$/,
      contextRegExp: /gun/
    }),
    new webpack.ContextReplacementPlugin(
      /gun/,
      path.resolve(__dirname, 'node_modules/gun'),
      {}
    )
  ],
  ignoreWarnings: [
    // Suppress Gun.js dynamic require warnings
    {
      module: /gun/,
      message: /Critical dependency: the request of a dependency is an expression/
    }
  ],
  devServer: {
    static: './dist/web',
    port: 3001,
    hot: true,
    open: true,
    historyApiFallback: true
  },
  devtool: 'source-map'
};