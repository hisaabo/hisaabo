/**
 * Migration CLI entry point.
 *
 * This file is intentionally tiny — it exists solely to invoke main() from
 * migrate.ts. Keeping the invocation separate means that importing migrate.ts
 * for its named exports (migrateSingleTenantDb, etc.) never triggers the
 * migration runner as a side effect.
 *
 * Invoked via:
 *   - pnpm --filter @hisaabo/db migrate         (dev / CI, via tsx)
 *   - node packages/db/dist/migrate.mjs         (Docker runtime, esbuild bundle)
 */

import { main, log } from "./migrate.js";

main().catch((err) => {
  log("error", "Unhandled migration error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
