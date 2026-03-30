import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin/hisaabo.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist/bin",
  bundle: true,
  external: [
    "react",
    "ink",
    "@inkjs/ui",
  ],
  banner: {
    js: "#!/usr/bin/env node",
  },
  clean: true,
  sourcemap: true,
});
