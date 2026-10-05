import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { assertSafeKey, type PutOptions, type StorageDriver } from "./types.js";

/**
 * Filesystem-backed storage. Objects are written under a base directory, with
 * the storage key used directly as a relative path. Intended for self-hosted
 * deployments where a persistent volume is mounted (e.g. the ONCE image's
 * /storage).
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = "local";
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(join(this.baseDir, key));
    // Belt-and-braces: ensure the resolved path stays inside baseDir even if
    // assertSafeKey is ever loosened.
    if (full !== this.baseDir && !full.startsWith(this.baseDir + sep)) {
      throw new Error(`Resolved path escapes storage root: ${key}`);
    }
    return full;
  }

  async put(key: string, bytes: Buffer, _opts: PutOptions): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    // rm with force never throws on a missing path.
    await rm(this.pathFor(key), { force: true });
  }
}
