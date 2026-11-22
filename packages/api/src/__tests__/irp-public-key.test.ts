/**
 * The NIC public key comes from operator configuration (lib/irp-public-key.ts).
 *
 * The key that used to be bundled in irp-client.ts was not a valid key, so the
 * RSA step threw before any request was sent and e-invoicing never authenticated.
 * These tests would have caught that: the client is exercised with a real RSA key
 * pair generated here, and the source tree is scanned for a key literal.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { generateKeyPairSync, publicEncrypt, constants } from "node:crypto";
import { pkcs1Decrypt } from "./helpers/rsa-pkcs1.js";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IRPNotConfiguredError,
  loadIrpPublicKey,
  resetIrpPublicKeyCache,
} from "../lib/irp-public-key.js";
import { IRPClient } from "../lib/irp-client.js";
import type { TenantDatabase } from "../trpc.js";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();

function roundTrips(key: ReturnType<typeof loadIrpPublicKey>): boolean {
  const secret = Buffer.from("app-key-0123456789abcdef01234567");
  const encrypted = publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, secret);
  return pkcs1Decrypt(pair.privateKey, encrypted).equals(secret);
}

let dir: string;
beforeEach(() => {
  resetIrpPublicKeyCache();
  dir = mkdtempSync(join(tmpdir(), "irp-key-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("loadIrpPublicKey", () => {
  it("loads the configured production key from IRP_PUBLIC_KEY_PEM", () => {
    const key = loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PEM: publicPem });
    expect(key.asymmetricKeyType).toBe("rsa");
    expect(roundTrips(key)).toBe(true);
  });

  it("accepts a single-line value with literal \\n, as a .env file needs", () => {
    const oneLine = publicPem.trim().replace(/\n/g, "\\n");
    expect(oneLine).not.toContain("\n");
    expect(roundTrips(loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PEM: oneLine }))).toBe(true);
  });

  it("loads the key from a file given by IRP_PUBLIC_KEY_PATH", () => {
    const file = join(dir, "nic.pem");
    writeFileSync(file, publicPem);
    expect(roundTrips(loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PATH: file }))).toBe(true);
  });

  it("IRP_PUBLIC_KEY_PEM wins when both are set", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
    const file = join(dir, "other.pem");
    writeFileSync(file, other);
    expect(roundTrips(loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PEM: publicPem, IRP_PUBLIC_KEY_PATH: file }))).toBe(true);
  });

  it("keeps sandbox and production keys apart: one is never used for the other", () => {
    const env = { IRP_SANDBOX_PUBLIC_KEY_PEM: publicPem };
    expect(roundTrips(loadIrpPublicKey(true, env))).toBe(true);
    // production has no key of its own, and must not fall back to the sandbox one
    expect(() => loadIrpPublicKey(false, env)).toThrow(IRPNotConfiguredError);
    expect(() => loadIrpPublicKey(false, env)).toThrow(/IRP_PUBLIC_KEY_PEM or IRP_PUBLIC_KEY_PATH/);
    expect(() => loadIrpPublicKey(true, { IRP_PUBLIC_KEY_PEM: publicPem })).toThrow(/IRP_SANDBOX_PUBLIC_KEY_PEM or IRP_SANDBOX_PUBLIC_KEY_PATH/);
  });

  it("parses once and caches, and re-parses when the value changes", () => {
    const a = loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PEM: publicPem });
    expect(loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PEM: publicPem })).toBe(a);
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PEM: other })).not.toBe(a);
  });

  describe("a missing or invalid key is a clear, typed error", () => {
    const CLEAR = /^E-invoicing is not configured: the NIC public key is missing or invalid \(/;

    it("missing", () => {
      const err = (() => { try { loadIrpPublicKey(false, {}); } catch (e) { return e; } })();
      expect(err).toBeInstanceOf(IRPNotConfiguredError);
      expect((err as IRPNotConfiguredError).code).toBe("IRP_NOT_CONFIGURED");
      expect((err as Error).message).toMatch(CLEAR);
      expect((err as Error).message).toContain("IRP_PUBLIC_KEY_PEM or IRP_PUBLIC_KEY_PATH is not set");
      expect((err as Error).message).toContain("docs/DEPLOYMENT.md");
    });

    it("not PEM", () => {
      const garbage = "-----BEGIN PUBLIC KEY-----\nthis is not a key\n-----END PUBLIC KEY-----";
      expect(() => loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PEM: garbage })).toThrow(CLEAR);
      expect(() => loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PEM: garbage })).toThrow(/IRP_PUBLIC_KEY_PEM is set but is not a valid PEM/);
      expect(() => loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PEM: "hello" })).toThrow(IRPNotConfiguredError);
    });

    it("a truncated key", () => {
      const truncated = publicPem.split("\n").slice(0, 4).join("\n") + "\n-----END PUBLIC KEY-----\n";
      expect(() => loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PEM: truncated })).toThrow(IRPNotConfiguredError);
    });

    it("not an RSA key", () => {
      const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" }).toString();
      expect(() => loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PEM: ec })).toThrow(/is not an RSA key/);
    });

    it("an unreadable path", () => {
      const missing = join(dir, "nope.pem");
      expect(() => loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PATH: missing })).toThrow(CLEAR);
      expect(() => loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PATH: missing })).toThrow(/cannot be read \(ENOENT\)/);
    });

    it("an invalid file", () => {
      const file = join(dir, "bad.pem");
      writeFileSync(file, "not a key");
      expect(() => loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PATH: file })).toThrow(/is set but is not a valid PEM/);
    });

    it("never exposes key material or an opaque OpenSSL message", () => {
      const garbage = "-----BEGIN PUBLIC KEY-----\nSECRETMATERIAL123\n-----END PUBLIC KEY-----";
      const err = (() => { try { loadIrpPublicKey(false, { IRP_PUBLIC_KEY_PEM: garbage }); } catch (e) { return e; } })() as Error;
      expect(err.message).not.toContain("SECRETMATERIAL123");
      expect(err.message).not.toMatch(/DECODER|error:[0-9A-F]{8}/i);
    });
  });
});

describe("IRPClient.authenticate uses the configured key", () => {
  const config = {
    id: "cfg", businessId: "b", gstin: "27AABCU9603R1ZM", clientId: "c", clientSecret: "s",
    username: "u", password: "p", isSandbox: true, isEnabled: true, authToken: null, tokenExpiresAt: null,
  };
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetIrpPublicKeyCache();
  });

  it("reaches the network with a valid configured key (the bundled key never got this far)", async () => {
    process.env.IRP_SANDBOX_PUBLIC_KEY_PEM = publicPem;
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new IRPClient(config, {} as TenantDatabase).authenticate()).rejects.toMatchObject({
      code: "AUTH_HTTP_ERROR",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails with the clear not-configured error, before any request, when there is no key", async () => {
    delete process.env.IRP_SANDBOX_PUBLIC_KEY_PEM;
    delete process.env.IRP_SANDBOX_PUBLIC_KEY_PATH;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(new IRPClient(config, {} as TenantDatabase).authenticate()).rejects.toBeInstanceOf(IRPNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("no NIC key is bundled in the source", () => {
  // A key literal in source is what hid the original bug: it was not a valid key and
  // nothing ever parsed it. Keys are configuration (IRP_PUBLIC_KEY_PEM / _PATH).
  const ROOTS = ["packages", "apps"].map((r) => new URL(`../../../../${r}/`, import.meta.url).pathname);
  const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".astro", ".expo", "target", "__tests__", "test", "tests", "coverage"]);

  function* sourceFiles(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const path = join(dir, name);
      const st = statSync(path);
      if (st.isDirectory()) yield* sourceFiles(path);
      else if (/\.(ts|tsx|js|mjs|cjs|json|ya?ml|pem|crt|cer|key)$/.test(name) && st.size < 2_000_000) yield path;
    }
  }

  it("contains no PEM block outside the tests", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        if (/-----BEGIN [A-Z ]*(PUBLIC KEY|PRIVATE KEY|CERTIFICATE)-----/.test(readFileSync(file, "utf8"))) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
