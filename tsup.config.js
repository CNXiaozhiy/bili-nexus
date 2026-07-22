const packageJson = require("./package.json");

const external = Object.keys(packageJson.dependencies || []);

module.exports = {
  entry: {
    app: "src/app.ts",
  },
  outDir: "dist",
  format: ["cjs"],
  dts: false,
  sourcemap: true,
  clean: true,
  minify: false,
  splitting: false,
  platform: "node",
  target: "node16",
  external: [
    ...external,
    "esbuild", // 消除警告
  ],
};
