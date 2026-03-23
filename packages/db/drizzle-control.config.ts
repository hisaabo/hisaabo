import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
config({ path: "../../.env" });

export default defineConfig({
  schema: "./src/control-schema.ts",
  out: "./drizzle-control",
  dialect: "postgresql",
  dbCredentials: { url: process.env.CONTROL_DATABASE_URL || process.env.DATABASE_URL! },
  verbose: true,
  strict: true,
});
