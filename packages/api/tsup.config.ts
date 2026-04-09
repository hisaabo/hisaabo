import { defineConfig } from "tsup";
import type { Options } from "tsup";

// Inline ONLY workspace packages so the production bundle doesn't depend
// on raw .ts source files that Node.js can't resolve (.js → .ts).
// Transitive deps of workspace packages (dotenv, postgres) must be
// explicitly externalized — they're not in api's package.json so tsup
// would otherwise bundle them, causing CJS→ESM issues (dotenv require('fs')).
const shared: Partial<Options> = {
  format: ["esm"],
  noExternal: ["@hisaabo/db", "@hisaabo/shared"],
  external: ["dotenv", "postgres"],
};

export default defineConfig([
  {
    entry: ["src/server.ts"],
    ...shared,
  },
  {
    entry: ["src/lib/pdf-worker.ts"],
    outDir: "dist/lib",
    ...shared,
  },
]);
