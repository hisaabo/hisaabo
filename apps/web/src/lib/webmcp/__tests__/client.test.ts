/**
 * The pinned WebMCP client: the business id is fixed when the registration is
 * created, whatever the app's module-level "current business" says later.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import superjson from "superjson";
import { setBusinessId } from "@/lib/trpc";
import { createWebMcpClient, webMcpRequestHeaders } from "../client";

afterEach(() => {
  vi.unstubAllGlobals();
  setBusinessId(null);
});

function stubFetch() {
  const fetchMock = vi.fn(
    async (_url: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify({ result: { data: superjson.serialize({ id: "p-1" }) } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("webMcpRequestHeaders", () => {
  it("carries the CSRF header, the pinned business and the agent marker, and no other identity", () => {
    expect(webMcpRequestHeaders("biz-1")).toEqual({
      "X-Requested-With": "hisaabo",
      "x-business-id": "biz-1",
      "x-hisaabo-agent": "webmcp",
    });
  });

  it("never reuses x-hisaabo-client, which has auth meaning", () => {
    expect(Object.keys(webMcpRequestHeaders("biz-1")).map((k) => k.toLowerCase())).not.toContain("x-hisaabo-client");
  });
});

describe("createWebMcpClient", () => {
  it("sends the business it was created for, not the business the app shows now", async () => {
    const fetchMock = stubFetch();
    setBusinessId("biz-A");
    const client = createWebMcpClient("biz-A");

    // The user switches business after the registration was created...
    setBusinessId("biz-B");
    await client.party.create.mutate({ type: "customer", name: "Acme" });

    // ...but the request still goes to the business the tool was offered for.
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("x-business-id")).toBe("biz-A");
    expect(headers.get("x-requested-with")).toBe("hisaabo");
  });

  it("marks every request, read or write, as agent-originated", async () => {
    const fetchMock = stubFetch();
    const client = createWebMcpClient("biz-A");
    await client.party.getById.query({ id: "11111111-1111-4111-8111-111111111111" });
    await client.party.create.mutate({ type: "customer", name: "Acme" });
    for (const call of fetchMock.mock.calls) {
      const headers = new Headers(call[1]?.headers);
      expect(headers.get("x-hisaabo-agent")).toBe("webmcp");
      expect(headers.get("x-hisaabo-client")).toBeNull();
    }
  });

  it("uses the cookie session and never batches", async () => {
    const fetchMock = stubFetch();
    const client = createWebMcpClient("biz-A");
    await Promise.all([
      client.party.getById.query({ id: "11111111-1111-4111-8111-111111111111" }),
      client.party.getStats.query({ id: "11111111-1111-4111-8111-111111111111" }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.credentials).toBe("include");
      expect(String(call[0])).not.toContain("batch=1");
    }
  });

  it("gives two registrations independent business ids", async () => {
    const fetchMock = stubFetch();
    const a = createWebMcpClient("biz-A");
    const b = createWebMcpClient("biz-B");
    await a.party.create.mutate({ type: "customer", name: "One" });
    await b.party.create.mutate({ type: "customer", name: "Two" });
    const ids = fetchMock.mock.calls.map((c) => new Headers(c[1]?.headers).get("x-business-id"));
    expect(ids).toEqual(["biz-A", "biz-B"]);
  });
});
