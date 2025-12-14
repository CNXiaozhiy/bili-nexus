const path = require("path");
const nodeExternals = require("webpack-node-externals");
const TsconfigPathsPlugin = require("tsconfig-paths-webpack-plugin");

module.exports = {
  target: "node",
  devtool: "source-map",
  entry: "./src/app.ts",
  externals: [nodeExternals()], // In order to ignore all modules in the node_modules folder
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
    plugins: [new TsconfigPathsPlugin({ configFile: "./tsconfig.json" })],
  },
  output: {
    filename: "app.js",
    path: path.resolve(__dirname, "dist"),
  },
};
