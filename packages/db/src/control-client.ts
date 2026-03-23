import { config } from "dotenv";
config({ path: "../../.env" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as controlSchema from "./control-schema.js";

const controlUrl = process.env.CONTROL_DATABASE_URL || process.env.DATABASE_URL!;

if (!controlUrl) {
  throw new Error("DATABASE_URL or CONTROL_DATABASE_URL is required");
}

const controlClient = postgres(controlUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const controlDb = drizzle(controlClient, { schema: controlSchema });
export type ControlDatabase = typeof controlDb;
