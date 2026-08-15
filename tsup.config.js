const packageJson = require("./package.json");

// npm 依赖保持 external；workspace 包（@bili-nexus/*）打包进产物
const external = Object.keys(packageJson.dependencies || []).filter((d) => !d.startsWith("@bili-nexus/"));

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
  noExternal: ["@bili-nexus/core", "@bili-nexus/qq-bot"],
};
