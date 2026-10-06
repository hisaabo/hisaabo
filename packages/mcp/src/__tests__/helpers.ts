import { z } from "zod";
import superjson from "superjson";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { HisaaboClient } from "../client.js";
import { registerTools } from "../server.js";
import type { ToolPolicy } from "../lib/policy.js";

export interface CapturedTool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  annotations: Record<string, unknown>;
  cb: (input: Record<string, unknown>) => Promise<CallToolResult>;
}

/** Minimal McpServer stand-in that records tool registrations. */
export function fakeServer() {
  const tools = new Map<string, CapturedTool>();
  const server = {
    tool(name: string, description: string, shape: z.ZodRawShape, annotations: Record<string, unknown>, cb: CapturedTool["cb"]) {
      tools.set(name, { name, description, shape, annotations, cb });
    },
    resource() {},
    prompt() {},
  };
  return { server: server as unknown as McpServer, tools };
}

export function registerWith(policy: ToolPolicy, client: HisaaboClient = throwingClient()) {
  const { server, tools } = fakeServer();
  const registry = registerTools(server, client, policy);
  return { tools, registry };
}

/** A client whose every property access fails: proves a tool never reached the API. */
export function throwingClient(): HisaaboClient {
  return new Proxy({}, {
    get(_t, prop) {
      throw new Error(`client.${String(prop)} must not be called`);
    },
  }) as HisaaboClient;
}

export interface FetchCall {
  url: URL;
  method: string;
  body: unknown;
}

/** Real HisaaboClient whose fetch is stubbed; `respond` maps tRPC path -> result. */
export function recordingClient(respond: (path: string) => unknown = () => ({})) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/api/trpc/", "");
    const body = init?.body ? superjson.deserialize(JSON.parse(String(init.body))) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });
    return new Response(JSON.stringify({ result: { data: superjson.serialize(respond(path)) } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const client = new HisaaboClient({
    apiUrl: "http://localhost:3000",
    token: "hisaabo_key_test",
    tenantId: "00000000-0000-4000-8000-000000000001",
    businessId: "00000000-0000-4000-8000-000000000002",
  });
  return { client, calls, restore: () => { globalThis.fetch = original; } };
}

export async function callTool(tool: CapturedTool, args: Record<string, unknown>) {
  const parsed = z.object(tool.shape).parse(args);
  return tool.cb(parsed);
}

export const UUID = "11111111-1111-4111-8111-111111111111";
export const writeAdmin: ToolPolicy = { mode: "admin", adminEnabled: true };
