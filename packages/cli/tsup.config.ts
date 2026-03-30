import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin/hisaabo.ts"],
  format: ["esm"],
  target: "node20",
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: ["react", "ink", "@inkjs/ui"],
  outDir: "dist/bin",
  clean: true,
});
