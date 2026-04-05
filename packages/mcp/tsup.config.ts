import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    __MCP_VERSION__: JSON.stringify(pkg.version),
  },
  outDir: "dist",
  clean: true,
});
