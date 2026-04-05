import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default defineConfig({
  entry: ["src/bin/hisaabo.ts"],
  format: ["esm"],
  target: "node20",
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
  outDir: "dist/bin",
  clean: true,
});
