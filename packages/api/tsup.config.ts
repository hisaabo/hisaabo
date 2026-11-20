import { defineConfig } from "tsup";
import type { Options } from "tsup";

// Inline ONLY workspace packages so the production bundle doesn't depend
// on raw .ts source files that Node.js can't resolve (.js → .ts).
// Transitive deps of workspace packages (dotenv, postgres) must be
// explicitly externalized — they're not in api's package.json so tsup
// would otherwise bundle them, causing CJS→ESM issues (dotenv require('fs')).
// pg-boss is imported by @hisaabo/db's queue-schema.ts (inlined) too.
const shared: Partial<Options> = {
  format: ["esm"],
  noExternal: ["@hisaabo/db", "@hisaabo/shared"],
  external: ["dotenv", "postgres", "pg-boss"],
};

export default defineConfig([
  {
    entry: ["src/server.ts"],
    ...shared,
  },
  // Background job worker process (docs/architecture/queue.md):
  // `node packages/api/dist/worker.js`, or `command: worker` in docker.
  {
    entry: ["src/worker.ts"],
    ...shared,
  },
  {
    entry: ["src/lib/pdf-worker.ts"],
    outDir: "dist/lib",
    ...shared,
  },
  // Admin dashboard TUI — runs with plain `node` inside the container
  // (docker exec -it hisaabo-api node packages/api/dist/bin/admin.js) or
  // from an operator shell via docker compose + psql. No ORM, no extra deps.
  {
    entry: ["src/bin/admin.ts"],
    outDir: "dist/bin",
    ...shared,
  },
  // /ops operators + queue CLI (docs/architecture/queue.md §10):
  // `docker compose exec api node packages/api/dist/bin/ops.js help`
  {
    entry: ["src/bin/ops.ts"],
    outDir: "dist/bin",
    ...shared,
  },
]);
