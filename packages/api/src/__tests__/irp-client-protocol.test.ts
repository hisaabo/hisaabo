/**
 * The IRP client against a fake IRP that follows NIC's documented e-invoice protocol
 * (einv-apisandbox.nic.in, Authentication v1.04 and the sample code):
 *
 *   auth request   {"Data": base64(RSA/PKCS1v1.5(base64(JSON{UserName, Password (plain),
 *                   AppKey, ForceRefreshAccessToken}))) } with the e-invoice public key
 *   auth response  Status 1 (a NUMBER in NIC's success sample), Data{AuthToken, Sek, TokenExpiry};
 *                   Sek is AES-ECB encrypted with the AppKey
 *   later requests {"Data": base64(AES-ECB(json, SEK))}, response Data likewise
 *
 * The fake plays the IRP side with a test RSA key pair. This documents and checks the
 * shape we send; it is NOT proof against NIC's live sandbox, which needs real credentials.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { IRPClient, IRPError } from "../lib/irp-client.js";
import { resetIrpPublicKeyCache } from "../lib/irp-public-key.js";
import { pkcs1Decrypt } from "./helpers/rsa-pkcs1.js";
import type { TenantDatabase } from "../trpc.js";

const nic = generateKeyPairSync("rsa", { modulusLength: 2048 });
const nicPublicPem = nic.publicKey.export({ type: "spki", format: "pem" }).toString();
const tooSmallPublicPem = readFileSync(new URL("./fixtures/rsa-512-test-only.pub.pem", import.meta.url), "utf8");

const config = {
  id: "cfg", businessId: "b", gstin: "27AABCU9603R1ZM", clientId: "client-id", clientSecret: "client-secret",
  username: "API_user", password: "p@ss-Word 1", isSandbox: true, isEnabled: true, authToken: null, tokenExpiresAt: null,
};
const db = { update: () => ({ set: () => ({ where: async () => undefined }) }) } as unknown as TenantDatabase;

const ecb = (key: Buffer, data: Buffer, mode: "enc" | "dec") => {
  const c = (mode === "enc" ? createCipheriv : createDecipheriv)("aes-256-ecb", key, null);
  return Buffer.concat([c.update(data), c.final()]);
};

/** A fake IRP: answers /auth by decrypting the request, everything else with the SEK. */
function fakeIrp(opts: { authStatus?: number | string; reply?: (path: string, payload: unknown) => unknown } = {}) {
  const sek = randomBytes(32);
  const seen: { auth?: { body: Record<string, unknown>; credentials: Record<string, string>; headers: Record<string, string> } } = {};

  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const headers = init.headers as Record<string, string>;
    if (url.endsWith("/eivital/v1.04/auth")) {
      // What NIC does: RSA-decrypt Data, Base64-decode, read the credentials.
      const credentials = JSON.parse(
        Buffer.from(pkcs1Decrypt(nic.privateKey, Buffer.from(String(body.Data), "base64")).toString("utf8"), "base64").toString("utf8"),
      ) as Record<string, string>;
      seen.auth = { body, credentials, headers };
      const appKey = Buffer.from(credentials.AppKey, "base64");
      return Response.json({
        Status: opts.authStatus ?? 1,
        Data: {
          ClientId: "client-id", UserName: credentials.UserName, AuthToken: "AUTH-TOKEN",
          Sek: ecb(appKey, Buffer.from(sek.toString("base64"), "utf8"), "enc").toString("base64"),
          TokenExpiry: "02/04/2099 15:30:00",
        },
        ErrorDetails: null,
      });
    }
    const payload = JSON.parse(ecb(sek, Buffer.from(String(body.Data), "base64"), "dec").toString("utf8"));
    const reply = opts.reply?.(url, payload);
    if (reply && typeof reply === "object" && "ErrorDetails" in (reply as object)) return Response.json({ Status: 0, ...(reply as object) });
    return Response.json({
      Status: opts.authStatus ?? 1,
      Data: ecb(sek, Buffer.from(JSON.stringify(reply ?? {}), "utf8"), "enc").toString("base64"),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, seen };
}

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetIrpPublicKeyCache();
  vi.unstubAllGlobals();
});

function configured() {
  process.env.IRP_SANDBOX_PUBLIC_KEY_PEM = nicPublicPem;
}

describe("authentication request", () => {
  it("sends a single Data field: the Base64 credentials JSON, RSA-encrypted with the configured key", async () => {
    configured();
    const { seen } = fakeIrp();
    await new IRPClient(config, db).authenticate();

    expect(Object.keys(seen.auth!.body)).toEqual(["Data"]);
    expect(typeof seen.auth!.body.Data).toBe("string");
    expect(seen.auth!.credentials).toMatchObject({
      UserName: "API_user",
      ForceRefreshAccessToken: false,
    });
    expect(Buffer.from(seen.auth!.credentials.AppKey, "base64")).toHaveLength(32);
  });

  it("sends the password as is (not hashed)", async () => {
    configured();
    const { seen } = fakeIrp();
    await new IRPClient(config, db).authenticate();
    expect(seen.auth!.credentials.Password).toBe("p@ss-Word 1");
  });

  it("identifies the client with the documented headers", async () => {
    configured();
    const { seen } = fakeIrp();
    await new IRPClient(config, db).authenticate();
    expect(seen.auth!.headers).toMatchObject({ client_id: "client-id", client_secret: "client-secret", Gstin: "27AABCU9603R1ZM" });
  });

  it("a key that cannot encrypt the request (too small) is reported as a key problem", async () => {
    // A committed, public-key-only 512-bit fixture rather than a key generated here: the
    // test only needs encryption to be refused, never a decryption, so no private half.
    process.env.IRP_SANDBOX_PUBLIC_KEY_PEM = tooSmallPublicPem;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(new IRPClient(config, db).authenticate()).rejects.toThrow(/NIC public key is missing or invalid .*2048 bits/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("responses", () => {
  it("treats the numeric Status 1 that NIC documents as success (and so the string \"1\")", async () => {
    for (const status of [1, "1"]) {
      configured();
      fakeIrp({ authStatus: status, reply: () => ({ Irn: "I".repeat(64), CancelDate: "2026-04-02 11:00:00" }) });
      const result = await new IRPClient(config, db).cancelIRN("I".repeat(64), "2", "typo");
      expect(result.irn).toBe("I".repeat(64));
      expect(result.cancelDate.toISOString()).toBe("2026-04-02T05:30:00.000Z");
      resetIrpPublicKeyCache();
    }
  });

  it("encrypts later requests with the SEK from the sign-in, and the cancel payload has the documented fields", async () => {
    configured();
    let sent: unknown;
    fakeIrp({ reply: (_url, payload) => { sent = payload; return { Irn: "I".repeat(64), CancelDate: "2026-04-02 11:00:00" }; } });
    await new IRPClient(config, db).cancelIRN("I".repeat(64), "2", "typo");
    expect(sent).toEqual({ Irn: "I".repeat(64), CnlRsn: "2", CnlRem: "typo" });
  });

  it("surfaces an IRP failure (Status 0) with its error code and message", async () => {
    configured();
    fakeIrp({ reply: () => ({ ErrorDetails: [{ ErrorCode: "2150", ErrorMessage: "Duplicate IRN" }] }) });
    const err = await new IRPClient(config, db).cancelIRN("I".repeat(64), "1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IRPError);
    expect((err as IRPError).code).toBe("2150");
    expect((err as IRPError).message).toBe("Duplicate IRN");
  });

  it("rejected credentials (Status 0 at sign-in) are an authentication failure", async () => {
    configured();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ Status: 0, Data: null, ErrorDetails: [{ ErrorCode: "1005", ErrorMessage: "Invalid Login Details" }] })));
    const err = await new IRPClient(config, db).authenticate().catch((e: unknown) => e);
    expect((err as IRPError).code).toBe("AUTH_FAILED");
    expect((err as IRPError).message).toBe("Invalid Login Details");
  });
});
