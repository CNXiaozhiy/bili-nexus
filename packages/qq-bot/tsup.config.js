const packageJson = require("./package.json");

const external = Object.keys(packageJson.dependencies || []);

module.exports = {
  entry: {
    index: "src/index.ts",
  },
  outDir: "dist",
  format: ["cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  splitting: false,
  platform: "node",
  target: "node16",
  external,
};
