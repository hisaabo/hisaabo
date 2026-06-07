/**
 * Pluggable object storage for user-uploaded binary assets (currently item
 * images). Two drivers ship in-tree:
 *
 *   - "local": writes to a directory on disk. Zero-config default so a
 *     self-hosted instance works out of the box (point STORAGE_LOCAL_DIR at a
 *     persistent volume such as the ONCE image's /storage mount).
 *   - "s3": any S3-compatible bucket (Cloudflare R2, AWS S3, MinIO). Signed
 *     with native SigV4 — no SDK dependency.
 *
 * The bytes never live in Postgres; only the storage key + metadata do (see
 * the item_images table). The serving layer reads the bytes back through this
 * interface and streams them with the MIME type recorded in the DB row, so the
 * driver does not need to remember content types itself.
 */
export interface PutOptions {
  /** MIME type stored as object metadata (used by S3; ignored by local). */
  contentType: string;
}

export interface StorageDriver {
  /** Human-readable driver name, for logging/health output. */
  readonly name: string;
  /** Store bytes under `key`, overwriting any existing object. */
  put(key: string, bytes: Buffer, opts: PutOptions): Promise<void>;
  /** Fetch bytes for `key`, or null if the object does not exist. */
  get(key: string): Promise<Buffer | null>;
  /** Remove the object at `key`. Must not throw if it is already gone. */
  delete(key: string): Promise<void>;
}

/**
 * Reject keys that could escape the storage root (path traversal) or are
 * otherwise malformed. Keys are always app-generated, so this is defence in
 * depth rather than a primary control.
 */
export function assertSafeKey(key: string): void {
  if (
    !key ||
    key.length > 1024 ||
    key.startsWith("/") ||
    key.includes("..") ||
    key.includes("\0") ||
    key.includes("\\")
  ) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
  }
}
