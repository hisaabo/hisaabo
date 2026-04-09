import { defineConfig } from "tsup";

// Inline workspace packages so the production bundle doesn't depend
// on raw .ts source files that Node.js can't resolve (.js → .ts).
const noExternal = ["@hisaabo/db", "@hisaabo/shared"];

export default defineConfig([
  {
    entry: ["src/server.ts"],
    format: ["esm"],
    noExternal,
  },
  {
    entry: ["src/lib/pdf-worker.ts"],
    outDir: "dist/lib",
    format: ["esm"],
    noExternal,
  },
]);
