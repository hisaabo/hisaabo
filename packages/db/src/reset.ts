/**
 * Drops all tables and recreates the database schema.
 * Usage: pnpm db:reset (runs this script then drizzle-kit push)
 */
import { config } from "dotenv";
config({ path: "../../.env" });

import postgres from "postgres";

const connectionString = process.env.DATABASE_URL!;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

async function reset() {
  console.log("Dropping all tables...");

  // Drop all tables in the public schema
  await sql.unsafe(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      -- Drop all tables
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
      -- Drop all custom types/enums
      FOR r IN (SELECT typname FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typtype = 'e') LOOP
        EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
      END LOOP;
    END $$;
  `);

  console.log("Database cleared. Schema will be recreated by drizzle-kit push.");
  await sql.end();
}

reset().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
