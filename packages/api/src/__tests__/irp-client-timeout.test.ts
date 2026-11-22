/**
 * IRP client: every request has a hard timeout, timeouts/network failures surface
 * as retryable IRPErrors, and isIRNCancelled() lets a caller find out whether the
 * IRP acted on a request whose answer was lost.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { IRPClient, IRPError, IRP_REQUEST_TIMEOUT_MS } from "../lib/irp-client.js";
import type { TenantDatabase } from "../trpc.js";

const config = {
  id: "cfg", gstin: "27AABCU9603R1ZM", clientId: "c", clientSecret: "s",
  username: "u", password: "p", isSandbox: true,
  authToken: "token", tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
} as unknown as ConstructorParameters<typeof IRPClient>[0];

/** A client that is already authenticated, so the next request goes straight to callApi. */
function authedClient(): IRPClient {
  const client = new IRPClient(config, {} as TenantDatabase);
  (client as unknown as { sek: Buffer }).sek = Buffer.alloc(32, 1);
  return client;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("IRP request timeout", () => {
  it("gives every request a timeout signal", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authedClient().cancelIRN("irn", "1")).rejects.toBeInstanceOf(IRPError);

    expect(timeoutSpy).toHaveBeenCalledWith(IRP_REQUEST_TIMEOUT_MS);
    expect(fetchMock.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns a request that never answers into a retryable IRPError", async () => {
    // A fetch that only ends when its signal fires, with the timeout shortened for the test.
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        if (init.signal!.aborted) reject(init.signal!.reason);
      }));

    const err = await authedClient().cancelIRN("irn", "1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IRPError);
    expect((err as IRPError).code).toBe("RETRYABLE");
    expect((err as IRPError).isRetryable).toBe(true);
    expect((err as IRPError).message).toMatch(/did not answer within 30 seconds/);
  });

  it("turns a network failure into a retryable IRPError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const err = await authedClient().cancelIRN("irn", "1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IRPError);
    expect((err as IRPError).isRetryable).toBe(true);
    expect((err as IRPError).message).toMatch(/network error: fetch failed/);
  });
});

describe("isIRNCancelled", () => {
  it("is true only when the IRP reports the IRN as cancelled (CNL)", async () => {
    const client = authedClient();
    const details = vi.spyOn(client, "getIRNDetails");
    details.mockResolvedValueOnce({ Status: "CNL" } as never);
    expect(await client.isIRNCancelled("irn")).toBe(true);
    details.mockResolvedValueOnce({ Status: "ACT" } as never);
    expect(await client.isIRNCancelled("irn")).toBe(false);
    details.mockResolvedValueOnce({} as never);
    expect(await client.isIRNCancelled("irn")).toBe(false);
  });

  it("is false when the IRP cannot be asked", async () => {
    const client = authedClient();
    vi.spyOn(client, "getIRNDetails").mockRejectedValueOnce(new IRPError("down", "RETRYABLE", 503));
    expect(await client.isIRNCancelled("irn")).toBe(false);
  });
});
