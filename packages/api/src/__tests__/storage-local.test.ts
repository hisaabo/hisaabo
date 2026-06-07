/**
 * LocalStorageDriver + assertSafeKey unit tests.
 *
 * The local driver is the default object-storage backend (self-hosted, zero
 * config). These tests pin the round-trip behaviour the serving routes rely on
 * (get returns null for a missing object, delete is idempotent) and — more
 * importantly — the path-traversal guard: a malformed storage key must never
 * let reads/writes escape the storage root.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageDriver } from "../lib/storage/local-driver.js";
import { assertSafeKey } from "../lib/storage/types.js";

let baseDir: string;
let driver: LocalStorageDriver;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "hisaabo-storage-"));
  driver = new LocalStorageDriver(baseDir);
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("LocalStorageDriver round-trip", () => {
  it("puts then gets the exact bytes back", async () => {
    const bytes = Buffer.from("hello-image-bytes");
    await driver.put("items/abc/one", bytes, { contentType: "image/png" });
    const got = await driver.get("items/abc/one");
    expect(got).not.toBeNull();
    expect(Buffer.compare(got!, bytes)).toBe(0);
  });

  it("creates nested directories for the key", async () => {
    await driver.put("items/x/y/z", Buffer.from("nested"), { contentType: "image/webp" });
    const onDisk = await readFile(join(baseDir, "items/x/y/z"));
    expect(onDisk.toString()).toBe("nested");
  });

  it("returns null for a missing object instead of throwing", async () => {
    expect(await driver.get("items/does/not/exist")).toBeNull();
  });

  it("delete is idempotent (no throw on a missing object)", async () => {
    await driver.put("k", Buffer.from("v"), { contentType: "image/jpeg" });
    await driver.delete("k");
    await expect(driver.delete("k")).resolves.toBeUndefined();
    expect(await driver.get("k")).toBeNull();
  });
});

describe("path-traversal protection", () => {
  it("assertSafeKey rejects traversal, absolute, backslash, and null-byte keys", () => {
    for (const bad of ["../escape", "a/../../escape", "/abs", "a\\b", "a\0b", ""]) {
      expect(() => assertSafeKey(bad)).toThrow();
    }
  });

  it("the driver refuses to read/write outside its root", async () => {
    await expect(driver.put("../escape", Buffer.from("x"), { contentType: "image/png" })).rejects.toThrow();
    await expect(driver.get("../../etc/passwd")).rejects.toThrow();
  });
});
