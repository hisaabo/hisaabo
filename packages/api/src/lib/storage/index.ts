import { join } from "node:path";
import { logger } from "../logger.js";
import { LocalStorageDriver } from "./local-driver.js";
import { S3StorageDriver } from "./s3-driver.js";
import type { StorageDriver } from "./types.js";

export type { StorageDriver, PutOptions } from "./types.js";

let cached: StorageDriver | null = null;

/**
 * Resolve the configured storage driver (memoized).
 *
 * Selection:
 *   STORAGE_DRIVER=s3    → S3/R2 (requires STORAGE_S3_* vars)
 *   STORAGE_DRIVER=local → local disk (default)
 *
 * Local base dir: STORAGE_LOCAL_DIR, else ./.storage/objects relative to cwd.
 * For the ONCE/self-hosted image, set STORAGE_LOCAL_DIR=/storage/objects so it
 * lands on the persistent volume.
 */
export function getStorage(): StorageDriver {
  if (cached) return cached;
  cached = buildStorage();
  logger.info({ driver: cached.name }, "Object storage initialized");
  return cached;
}

function buildStorage(): StorageDriver {
  const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();

  if (driver === "s3") {
    const endpoint = requireEnv("STORAGE_S3_ENDPOINT");
    const bucket = requireEnv("STORAGE_S3_BUCKET");
    const accessKeyId = requireEnv("STORAGE_S3_ACCESS_KEY_ID");
    const secretAccessKey = requireEnv("STORAGE_S3_SECRET_ACCESS_KEY");
    const region = process.env.STORAGE_S3_REGION ?? "auto";
    return new S3StorageDriver({ endpoint, bucket, accessKeyId, secretAccessKey, region });
  }

  if (driver !== "local") {
    logger.warn({ driver }, "Unknown STORAGE_DRIVER, falling back to local disk");
  }

  const baseDir =
    process.env.STORAGE_LOCAL_DIR ?? join(process.cwd(), ".storage", "objects");
  return new LocalStorageDriver(baseDir);
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `STORAGE_DRIVER=s3 requires ${key}. Set it or switch STORAGE_DRIVER to "local".`,
    );
  }
  return value;
}

/** Test-only: reset the memoized driver so env changes take effect. */
export function __resetStorageForTests(): void {
  cached = null;
}
