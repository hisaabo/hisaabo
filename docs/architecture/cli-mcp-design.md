# CLI and MCP Server Architecture for Hisaabo

## Overview

This document describes the design for two new packages that make Hisaabo accessible
to AI agents and terminal workflows:

- `packages/cli` — A `hisaabo` command-line tool for humans and automation scripts
- `packages/mcp` — A Model Context Protocol server for AI agents (Claude, Cursor, etc.)

Both packages are thin clients. They share a common HTTP client layer and both call
the existing tRPC API. No business logic is duplicated — all validation, authorization,
and computation stays in `packages/api`.

---

## ADR-001: Shared HTTP Client as a Standalone Package

### Status
Proposed

### Context
Both the CLI and MCP server need to:
- Hold session credentials (token + tenant + business)
- Send authenticated HTTP requests to the tRPC API
- Deserialize SuperJSON responses
- Translate tRPC error shapes into meaningful error messages

If each package has its own HTTP layer, credential handling and error translation
get duplicated. The two packages will inevitably drift.

### Decision
Introduce `packages/client` — a zero-dependency (except `@hisaabo/shared`) typed
HTTP client. It is **not** a tRPC client. It calls the tRPC HTTP endpoints directly
using `fetch`, avoiding the `@trpc/client` dependency and its React-Query coupling.

The `AppRouter` type from `@hisaabo/api` is imported as a **devDependency only**
(type-level import) so that the client package never pulls in Hono, PDFKit, Argon2,
etc. at runtime.

### Consequences
- CLI and MCP have one import: `import { HisaaboClient } from "@hisaabo/client"`.
- Adding a new API procedure means adding one method to `HisaaboClient` — one change
  propagates to both consumers.
- A third consumer (e.g., a webhook processor) gets the same client for free.
- The client package adds a build step to the monorepo pipeline.

---

## ADR-002: CLI and MCP as Separate Packages (not one package with two entry points)

### Status
Proposed

### Context
An alternative is a single `packages/cli-mcp` package that exports both a CLI binary
and an MCP server binary. This reduces the number of packages and `package.json` files.

### Decision
Keep them separate (`packages/cli` and `packages/mcp`). The reasons:

1. **Dependency footprint**: The MCP server pulls in `@modelcontextprotocol/sdk`. The
   CLI pulls in `commander` and `cli-table3`. These dependencies have no overlap and
   should not be bundled together.
2. **Distribution path**: The CLI is published as `hisaabo` on npm, installable via
   `npm install -g hisaabo`. The MCP server is published as `@hisaabo/mcp`, invoked
   via `npx`. Different publish targets.
3. **Version cadence**: A new CLI flag does not require bumping the MCP server version
   and vice versa. Independent versioning keeps changelogs clean.

### Consequences
- One more `package.json` to maintain.
- `packages/client` becomes a required dependency for both — if the client has a
  breaking change, both CLI and MCP need a release.

---

## ADR-003: Standalone MCP Server (not embedded in the API)

### Status
Proposed

### Context
The MCP server could run inside the Hono API process as an additional transport
(the tRPC server already runs multiple adapters). This would eliminate the separate
process and network hop.

### Decision
The MCP server runs as a **standalone process** that talks to the API over HTTP.
Reasons:

1. **Self-hosted deployments**: Users run Hisaabo behind Docker or a VPS. An MCP
   server embedded in the API container means Claude Desktop needs access to the API
   container's stdio — which is not how Docker deployments work. A standalone MCP
   server can run on the user's local machine, pointing at `HISAABO_API_URL`.
2. **Auth boundary**: The MCP server authenticates as a service account (session token)
   not as the API process itself. Keeping it out of the API container preserves that
   boundary.
3. **Failure isolation**: An MCP server crash does not take down the API.

### Consequences
- One extra network hop (MCP server → API) adds ~1–5ms latency per tool call.
  Acceptable for AI agent workflows.
- The MCP server does not have direct DB access — it cannot do anything the API
  does not allow, which is a security benefit.

---

## ADR-004: Auth Strategy — Session Token in Config File

### Status
Proposed

### Context
The existing API uses `session_id` cookies for browser sessions and also accepts
`Authorization: Bearer <session_id>` headers (see `context.ts` line 15–18). Sessions
live for 30 days.

Options considered:
1. Reuse the browser cookie mechanism (can't work in non-browser contexts)
2. Issue a separate API key type (requires new DB column, new auth path in the API)
3. Use the existing `Bearer` token path with a stored session ID

### Decision
Use option 3: `hisaabo login` calls `auth.login` over tRPC, receives the session ID
from the response body (not from a cookie), and stores it in `~/.hisaabo/config.json`.
Subsequent CLI and MCP calls set `Authorization: Bearer <session_id>`.

The API already supports Bearer auth in `createContext`. No API changes are needed.

To get the session ID from the login response without relying on `Set-Cookie`, the
login procedure needs a **one-line change**: return `{ sessionId }` in the response
body when a `x-client-type: cli` header is present. This is the only required API
modification.

### Consequences
- Session tokens expire after 30 days. The CLI can detect a 401 and prompt
  `hisaabo login` again.
- Config file contains a credential. File permissions must be `0600` (enforced by
  the CLI on write).
- No refresh token mechanism — user must re-login after expiry. Acceptable for
  developer tooling.
- The MCP server reads the token from an environment variable
  (`HISAABO_TOKEN`), not the config file, so it works in CI and containerized
  agent setups without a home directory.

---

## ADR-005: Pagination Strategy for MCP Tool Responses

### Status
Proposed

### Context
AI agents that call `invoice_list` without constraints could receive hundreds of
records. Large tool responses:
- Consume the agent's context window rapidly
- Increase latency
- Often contain more data than the agent needs for its current task

### Decision
All MCP list tools enforce a **hard cap of 25 records** per call. The tools accept
an optional `page` parameter (default: 1). The response always includes:
```json
{
  "data": [...],
  "total": 142,
  "page": 1,
  "limit": 25,
  "hasMore": true
}
```

The `hasMore` field is a hint to the agent that it should paginate if it needs more
records. The agent can call the tool again with `page: 2`.

This cap is lower than the API's max of 100. The API remains unchanged — the MCP
server simply passes `limit: 25` down.

### Consequences
- An agent that needs all 142 invoices must make 6 calls. This is intentional —
  an agent that needs all records should use the CSV export tool instead.
- The 25-record cap is a constant in the MCP server. Operators can override it via
  `HISAABO_MCP_PAGE_SIZE` env var (max 50).

---

## ADR-006: Error Contract for AI Agents

### Status
Proposed

### Context
tRPC errors have a shape that is meaningful to TypeScript clients but not to AI
agents. The MCP SDK expects tool calls to either succeed with a result or fail with
a string message. Raw tRPC error JSON in a failure message would confuse agents.

### Decision
The MCP server's tool executor catches all errors and normalizes them:

```typescript
type ToolError =
  | { code: "unauthorized"; message: string }          // 401 — needs login
  | { code: "forbidden"; message: string }             // 403 — no permission
  | { code: "not_found"; resource: string; id: string }// 404
  | { code: "validation_failed"; fields: Record<string, string[]> } // 400
  | { code: "api_error"; message: string }             // 5xx
```

The error is returned as the tool's `content` array with `isError: true`.
The `message` field in each error type is a plain English sentence that an agent
can include in its response to the user without transformation.

Zod validation errors from `@hisaabo/shared` (which the CLI also uses before
sending) are translated to `validation_failed` with a per-field message map.

### Consequences
- The CLI has separate error handling (colored terminal output), but can share
  the error type definitions.
- Internal 500 errors from the API are collapsed to `{ code: "api_error", message:
  "The API encountered an error. Check server logs." }`. Stack traces are never
  surfaced to the agent.

---

## Directory Structure

```
hisaabo/
  packages/
    shared/           (existing — Zod validators + TypeScript types)
    db/               (existing — Drizzle schema)
    api/              (existing — Hono + tRPC server)
    client/           (NEW — shared HTTP client)
      src/
        index.ts            — re-exports
        client.ts           — HisaaboClient class
        types.ts            — response shapes, error types
        procedures/
          auth.ts           — login, logout, whoami
          business.ts       — list, get, setActive
          invoice.ts        — list, create, get, updateStatus, pdf
          party.ts          — list, create, get, ledger
          item.ts           — list, create, get, adjustStock
          payment.ts        — list, create
          expense.ts        — list, create
          dashboard.ts      — summary
          gst.ts            — gstr1, gstr3b
      package.json
      tsconfig.json
      tsup.config.ts
    cli/              (NEW — hisaabo CLI binary)
      src/
        index.ts            — entry point, program setup
        config.ts           — read/write ~/.hisaabo/config.json
        commands/
          auth.ts           — login, logout, whoami
          business.ts       — list, use
          invoice.ts        — list, create, get, pdf, send
          party.ts          — list, create, ledger
          item.ts           — list, create, adjust-stock
          payment.ts        — create, list
          dashboard.ts      — summary
          export.ts         — invoices csv, gstr1
        lib/
          output.ts         — table/JSON/CSV formatters, color helpers
          prompt.ts         — inquirer-based interactive prompts
          errors.ts         — translate API errors to terminal output
      package.json
      tsconfig.json
      tsup.config.ts
    mcp/              (NEW — MCP server)
      src/
        index.ts            — entry point, MCP server init
        server.ts           — tool + resource registration
        tools/
          invoice.ts        — invoice_list, invoice_create, invoice_get,
                              invoice_update_status
          party.ts          — party_list, party_create, party_get
          item.ts           — item_list, item_create, item_adjust_stock
          payment.ts        — payment_create, payment_list
          dashboard.ts      — dashboard_summary
          gst.ts            — gst_report
        resources/
          index.ts          — resource URI router
          business.ts       — business://current
          parties.ts        — parties://customers, parties://suppliers
          items.ts          — items://inventory
          invoices.ts       — invoices://recent
          dashboard.ts      — dashboard://summary
        lib/
          errors.ts         — normalize tRPC errors to MCP error contract
          pagination.ts     — bounded pagination helpers
      package.json
      tsconfig.json
      tsup.config.ts
```

---

## `packages/client` — The Shared HTTP Client

### `package.json`

```json
{
  "name": "@hisaabo/client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hisaabo/shared": "workspace:*",
    "superjson": "^2.2.0"
  },
  "devDependencies": {
    "@hisaabo/api": "workspace:*",
    "tsup": "^8.3.0",
    "typescript": "^5.7.0"
  }
}
```

Note: `@hisaabo/api` is a devDependency only. Its `AppRouter` type is imported with
`import type` — it is erased at compile time and never appears in the runtime bundle.

### `src/client.ts` — skeleton

```typescript
import superjson from "superjson";
import type { AppRouter } from "@hisaabo/api";
import type { inferRouterOutputs, inferRouterInputs } from "@trpc/server";

// tRPC input/output inference from the router type — no runtime dependency on @trpc/server.
// These are pure TypeScript type utilities.
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;

export interface ClientConfig {
  apiUrl: string;       // e.g. "https://api.hisaabo.in" or "http://localhost:3000"
  token: string;        // session ID used as Bearer token
  tenantId: string;     // x-tenant-id header (maps to ctx.tenantId in the API)
  businessId: string;   // x-business-id header (maps to ctx.businessId in the API)
}

export class HisaaboClient {
  constructor(private config: ClientConfig) {}

  /**
   * Call a tRPC query procedure.
   *
   * path    — dot-separated procedure path, e.g. "invoice.list"
   * input   — procedure input, serialized via SuperJSON
   *
   * The tRPC HTTP adapter accepts GET requests for queries with the input
   * encoded as a URL search param: ?input=<superjson-encoded-input>
   */
  async query<T>(path: string, input?: unknown): Promise<T> {
    const url = new URL(`${this.config.apiUrl}/api/trpc/${path}`);
    if (input !== undefined) {
      url.searchParams.set("input", JSON.stringify(superjson.serialize(input)));
    }
    const res = await fetch(url, { headers: this.buildHeaders() });
    return this.unwrap<T>(res);
  }

  /**
   * Call a tRPC mutation procedure.
   *
   * Mutations use POST with a JSON body: { "0": { json: <superjson-value> } }
   * (tRPC batch format — single-item batch for consistency with the web client)
   */
  async mutate<T>(path: string, input: unknown): Promise<T> {
    const res = await fetch(`${this.config.apiUrl}/api/trpc/${path}`, {
      method: "POST",
      headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(superjson.serialize(input)),
    });
    return this.unwrap<T>(res);
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Authorization": `Bearer ${this.config.token}`,
      "x-business-id": this.config.businessId,
      "x-tenant-id": this.config.tenantId,
      "x-client-type": "cli",   // triggers session-ID-in-body on login
    };
  }

  private async unwrap<T>(res: Response): Promise<T> {
    // Parse tRPC envelope: { result: { data: { json: T, meta: ... } } } | { error: ... }
    // SuperJSON deserialization handles Date objects, BigInt, etc.
    const body = await res.json();
    if (!res.ok || body.error) {
      throw normalizeTrpcError(body.error ?? { message: "Unknown error", code: res.status });
    }
    return superjson.deserialize(body.result.data) as T;
  }

  // ── Procedure namespaces ─────────────────────────────────────
  // Each sub-module adds methods via a factory. Example:
  //   get invoice() { return invoiceProcedures(this); }
  // This keeps the client tree-shakeable and mirrors the router structure.
}

/**
 * Translate a raw tRPC error envelope into a structured HisaaboError.
 * This is the only place in the codebase that knows about tRPC error shapes.
 */
export function normalizeTrpcError(raw: unknown): HisaaboError {
  // ... maps UNAUTHORIZED → { code: "unauthorized" }, BAD_REQUEST + zodError → { code: "validation_failed" }, etc.
}

export type HisaaboError =
  | { code: "unauthorized"; message: string }
  | { code: "forbidden"; message: string }
  | { code: "not_found"; resource: string }
  | { code: "validation_failed"; fields: Record<string, string[]> }
  | { code: "api_error"; message: string };
```

### `src/procedures/invoice.ts` — skeleton

```typescript
import type { HisaaboClient, RouterOutputs, RouterInputs } from "../client.js";

export type InvoiceList = RouterOutputs["invoice"]["list"];
export type InvoiceCreate = RouterInputs["invoice"]["create"];

export function invoiceProcedures(client: HisaaboClient) {
  return {
    list(input: RouterInputs["invoice"]["list"]) {
      return client.query<InvoiceList>("invoice.list", input);
    },
    create(input: InvoiceCreate) {
      return client.mutate<RouterOutputs["invoice"]["create"]>("invoice.create", input);
    },
    get(id: string) {
      return client.query<RouterOutputs["invoice"]["get"]>("invoice.get", { id });
    },
    updateStatus(id: string, status: RouterInputs["invoice"]["updateStatus"]["status"]) {
      return client.mutate<RouterOutputs["invoice"]["updateStatus"]>(
        "invoice.updateStatus", { id, status }
      );
    },
    pdf(id: string, format: "a4" | "thermal") {
      // PDF endpoint is a plain GET on the Hono router, not tRPC
      return client.fetchBinary(
        `/api/invoice/${id}/pdf?format=${format}`,
        "application/pdf"
      );
    },
  };
}
```

---

## `packages/cli` — The CLI Tool

### `package.json`

```json
{
  "name": "@hisaabo/cli",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "bin": {
    "hisaabo": "./dist/index.js"
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --minify",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hisaabo/client": "workspace:*",
    "@hisaabo/shared": "workspace:*",
    "commander": "^12.0.0",
    "inquirer": "^10.0.0",
    "cli-table3": "^0.6.5",
    "chalk": "^5.3.0",
    "ora": "^8.0.0"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

### `src/config.ts` — skeleton

```typescript
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".hisaabo");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export interface HisaaboConfig {
  apiUrl: string;
  token: string;
  tenantId: string;
  businessId: string;
  // Human-readable labels — stored for `hisaabo whoami` display only
  userEmail: string;
  businessName: string;
}

export function readConfig(): HisaaboConfig | null {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as HisaaboConfig;
  } catch {
    return null;
  }
}

export function writeConfig(config: HisaaboConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  // Enforce 0600 — file contains a session credential
  chmodSync(CONFIG_PATH, 0o600);
}

export function requireConfig(): HisaaboConfig {
  const cfg = readConfig();
  if (!cfg) {
    throw new Error("Not logged in. Run: hisaabo login");
  }
  return cfg;
}

export function clearConfig(): void {
  try { writeFileSync(CONFIG_PATH, "{}", { mode: 0o600 }); } catch { /* ignore */ }
}
```

### `src/index.ts` — skeleton

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth.js";
import { registerBusinessCommands } from "./commands/business.js";
import { registerInvoiceCommands } from "./commands/invoice.js";
import { registerPartyCommands } from "./commands/party.js";
import { registerItemCommands } from "./commands/item.js";
import { registerPaymentCommands } from "./commands/payment.js";
import { registerDashboardCommands } from "./commands/dashboard.js";
import { registerExportCommands } from "./commands/export.js";

const program = new Command()
  .name("hisaabo")
  .description("Hisaabo CLI — manage invoices, parties, and items from the terminal")
  .version("0.1.0");

registerAuthCommands(program);
registerBusinessCommands(program);
registerInvoiceCommands(program);
registerPartyCommands(program);
registerItemCommands(program);
registerPaymentCommands(program);
registerDashboardCommands(program);
registerExportCommands(program);

program.parseAsync(process.argv).catch((err) => {
  // Top-level error handler: prints a clean message, exits non-zero
  printError(err);
  process.exit(1);
});
```

### `src/commands/invoice.ts` — skeleton

```typescript
import type { Command } from "commander";
import { requireConfig } from "../config.js";
import { buildClient } from "../lib/client-factory.js";
import { printTable, printJson } from "../lib/output.js";

export function registerInvoiceCommands(program: Command) {
  const cmd = program.command("invoice").description("Invoice management");

  cmd
    .command("list")
    .description("List invoices")
    .option("--status <status>", "Filter by status (draft|sent|paid|partial|overdue|cancelled)")
    .option("--from <date>", "Start date (ISO 8601)")
    .option("--to <date>", "End date (ISO 8601)")
    .option("--party <id>", "Filter by party ID")
    .option("--json", "Output raw JSON")
    .option("--page <n>", "Page number", "1")
    .action(async (opts) => {
      const client = buildClient(requireConfig());
      const result = await client.invoice.list({
        status: opts.status,
        fromDate: opts.from,
        toDate: opts.to,
        partyId: opts.party,
        page: parseInt(opts.page, 10),
        limit: 20,
      });
      if (opts.json) return printJson(result);
      printTable(result.data, ["invoiceNumber", "partyName", "totalAmount", "status", "invoiceDate"]);
      if (result.total > result.data.length) {
        console.log(`Showing ${result.data.length} of ${result.total}. Use --page to paginate.`);
      }
    });

  cmd
    .command("create")
    .description("Create an invoice")
    .requiredOption("--party <id>", "Party ID (UUID)")
    .option("--items <items>", "Line items: 'Name:qty@price,Name2:qty@price'")
    .option("--notes <text>", "Invoice notes")
    .option("--due <date>", "Due date (ISO 8601)")
    .option("--interactive", "Prompt for each field interactively")
    .action(async (opts) => {
      // parseItems() parses "Spinach:7.3kg@65" → { description, quantity, unit, unitPrice }
      // If --interactive, falls back to inquirer prompts
    });

  cmd
    .command("get <id>")
    .description("Show invoice details")
    .option("--json", "Output raw JSON")
    .action(async (id, opts) => { /* ... */ });

  cmd
    .command("pdf <id>")
    .description("Download invoice as PDF")
    .option("--format <fmt>", "a4 or thermal", "a4")
    .option("--output <path>", "Output file path (default: ./<invoiceNumber>.pdf)")
    .action(async (id, opts) => { /* writes PDF bytes to file */ });

  cmd
    .command("send <id>")
    .description("Mark invoice as sent")
    .action(async (id) => { /* updateStatus(id, 'sent') */ });
}
```

### Output modes

The CLI supports two output modes controlled by `--json`:
- Default: colored table via `cli-table3` + `chalk`, human-readable
- `--json`: raw JSON to stdout, suitable for `jq` piping and shell scripts

This is a deliberate non-negotiable. AI agents that invoke the CLI subprocess
(rather than the MCP server) can use `--json` for machine-readable output.

---

## `packages/mcp` — The MCP Server

### `package.json`

```json
{
  "name": "@hisaabo/mcp",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "bin": {
    "hisaabo-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hisaabo/client": "workspace:*",
    "@hisaabo/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

### `src/index.ts` — skeleton

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HisaaboClient } from "@hisaabo/client";
import { registerTools } from "./server.js";

// All config comes from environment variables — no file system dependency.
// This makes the MCP server work cleanly in Docker, CI, and Claude Desktop.
const config = {
  apiUrl: process.env.HISAABO_API_URL ?? "http://localhost:3000",
  token: requireEnv("HISAABO_TOKEN"),
  tenantId: requireEnv("HISAABO_TENANT_ID"),
  businessId: requireEnv("HISAABO_BUSINESS_ID"),
};

const client = new HisaaboClient(config);
const server = new McpServer({ name: "hisaabo", version: "0.1.0" });
registerTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Required environment variable ${name} is not set`);
  return val;
}
```

### `src/server.ts` — tool + resource registration skeleton

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HisaaboClient } from "@hisaabo/client";
import { registerInvoiceTools } from "./tools/invoice.js";
import { registerPartyTools } from "./tools/party.js";
import { registerItemTools } from "./tools/item.js";
import { registerPaymentTools } from "./tools/payment.js";
import { registerDashboardTools } from "./tools/dashboard.js";
import { registerGstTools } from "./tools/gst.js";
import { registerResources } from "./resources/index.js";

export function registerTools(server: McpServer, client: HisaaboClient) {
  registerInvoiceTools(server, client);
  registerPartyTools(server, client);
  registerItemTools(server, client);
  registerPaymentTools(server, client);
  registerDashboardTools(server, client);
  registerGstTools(server, client);
  registerResources(server, client);
}
```

### MCP Tool Definitions

The MCP SDK uses Zod schemas for input validation. The schemas below are derived
from `@hisaabo/shared` validators, constrained further for MCP consumption.

#### `src/tools/invoice.ts`

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "@hisaabo/client";
import { MAX_PAGE_SIZE } from "../lib/pagination.js";
import { wrapTool } from "../lib/errors.js";

export function registerInvoiceTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "invoice_list",
    "List invoices for the active business. Returns up to 25 invoices per page.",
    {
      status: z.enum(["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"])
        .optional()
        .describe("Filter by invoice status"),
      type: z.enum(["sale", "purchase"])
        .optional()
        .describe("sale = customer invoices, purchase = supplier bills"),
      from_date: z.string().datetime().optional()
        .describe("Start of date range (ISO 8601)"),
      to_date: z.string().datetime().optional()
        .describe("End of date range (ISO 8601)"),
      party_id: z.string().uuid().optional()
        .describe("Filter by specific party UUID"),
      search: z.string().max(200).optional()
        .describe("Search invoice number or party name"),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination (default: 1)"),
    },
    wrapTool(async (input) => {
      const result = await client.invoice.list({
        status: input.status,
        type: input.type,
        fromDate: input.from_date,
        toDate: input.to_date,
        partyId: input.party_id,
        search: input.search,
        page: input.page,
        limit: MAX_PAGE_SIZE,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ ...result, hasMore: result.total > input.page * MAX_PAGE_SIZE }) }],
      };
    })
  );

  server.tool(
    "invoice_create",
    "Create a new invoice or bill. Returns the created invoice with its assigned number.",
    {
      party_id: z.string().uuid().describe("UUID of the customer or supplier"),
      type: z.enum(["sale", "purchase"]).describe("sale for customer invoice, purchase for supplier bill"),
      line_items: z.array(z.object({
        description: z.string().min(1).max(500).describe("Item description or name"),
        quantity: z.string().regex(/^\d+(\.\d{1,3})?$/).describe("Quantity as decimal string, e.g. '7.300'"),
        unit_price: z.string().regex(/^\d+(\.\d{1,2})?$/).describe("Price per unit as decimal string, e.g. '65.00'"),
        tax_percent: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0").describe("GST/tax percentage, e.g. '18.00'"),
        item_id: z.string().uuid().optional().describe("Link to inventory item UUID (optional)"),
      })).min(1).describe("At least one line item is required"),
      invoice_date: z.string().datetime().optional().describe("Invoice date (ISO 8601, defaults to today)"),
      due_date: z.string().datetime().optional().describe("Payment due date (ISO 8601)"),
      notes: z.string().max(2000).optional().describe("Notes visible on the invoice"),
    },
    wrapTool(async (input) => {
      const invoice = await client.invoice.create({
        partyId: input.party_id,
        type: input.type,
        invoiceDate: input.invoice_date,
        dueDate: input.due_date,
        notes: input.notes,
        lineItems: input.line_items.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unit_price,
          taxPercent: li.tax_percent,
          itemId: li.item_id,
          discountPercent: "0",
        })),
      });
      return { content: [{ type: "text", text: JSON.stringify(invoice) }] };
    })
  );

  server.tool(
    "invoice_get",
    "Get full details of a single invoice including line items, payments received, and balance due.",
    { invoice_id: z.string().uuid().describe("Invoice UUID") },
    wrapTool(async (input) => {
      const invoice = await client.invoice.get(input.invoice_id);
      return { content: [{ type: "text", text: JSON.stringify(invoice) }] };
    })
  );

  server.tool(
    "invoice_update_status",
    "Change the status of an invoice (e.g. mark as sent, cancel).",
    {
      invoice_id: z.string().uuid().describe("Invoice UUID"),
      status: z.enum(["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"])
        .describe("New status for the invoice"),
    },
    wrapTool(async (input) => {
      const result = await client.invoice.updateStatus(input.invoice_id, input.status);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    })
  );
}
```

#### `src/tools/party.ts` — summary (full structure mirrors invoice.ts)

```typescript
// Tools registered:
//
// party_list      — list parties with type/search filter, paginated
// party_create    — create customer or supplier, returns created party
// party_get       — get party details including outstanding balance
//
// party_get includes the "balance" field (receivable/payable) which the
// API computes server-side. The MCP server does not compute balances itself.
```

#### `src/tools/item.ts` — summary

```typescript
// Tools registered:
//
// item_list         — list items, supports --low-stock filter
//                     (items where stockQuantity < lowStockAlert)
// item_create       — create a new inventory item
// item_adjust_stock — adjust stock quantity with a reason note
//                     Input: { item_id, adjustment, reason }
//                     adjustment is a signed decimal string: "+50" or "-3.5"
//                     The API records a stock movement entry for audit.
```

#### `src/tools/payment.ts` — summary

```typescript
// Tools registered:
//
// payment_create  — record a payment received from a customer or made to a supplier
//                   Can optionally link to a specific invoice (invoice_id)
//                   or leave unlinked (applied to party balance)
// payment_list    — list payments for a party or date range
```

#### `src/tools/dashboard.ts`

```typescript
// Tools registered:
//
// dashboard_summary — returns DashboardSummary (totalSales, receivable, payable,
//                     cashInHand, recentInvoices).
//                     Accepts optional period: "this-month" | "last-month" | "this-year" | "all"
//                     which maps to fromDate/toDate before calling the API.
```

#### `src/tools/gst.ts`

```typescript
// Tools registered:
//
// gst_report — generate GSTR1 or GSTR3B summary data
//              Input: { report_type: "gstr1" | "gstr3b", month: 1..12, year: 2024..2030 }
//              Returns JSON summary (not PDF). PDF generation is out of scope for MCP
//              because AI agents cannot consume binary content in tool responses.
```

### MCP Resource Definitions

Resources are read-only snapshots that agents can load into context. They differ
from tools: resources are fetched on demand by the agent host (e.g. Claude Desktop)
and placed into the agent's context window, whereas tools are called when the agent
chooses to act.

```typescript
// src/resources/index.ts

export function registerResources(server: McpServer, client: HisaaboClient) {

  // business://current — current business profile
  server.resource(
    "business_current",
    new ResourceTemplate("business://current", { list: undefined }),
    async () => {
      const biz = await client.business.get();
      return { contents: [{ uri: "business://current", text: JSON.stringify(biz), mimeType: "application/json" }] };
    }
  );

  // parties://customers — top 50 customers by name
  server.resource(
    "parties_customers",
    new ResourceTemplate("parties://customers", { list: undefined }),
    async () => {
      const result = await client.party.list({ type: "customer", limit: 50 });
      return { contents: [{ uri: "parties://customers", text: JSON.stringify(result.data), mimeType: "application/json" }] };
    }
  );

  // parties://suppliers
  // items://inventory — all items with current stock
  // invoices://recent — last 10 invoices
  // dashboard://summary — same as dashboard_summary tool but as a resource
}
```

### `src/lib/errors.ts` — the error normalization wrapper

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HisaaboError } from "@hisaabo/client";

type ToolHandler<T> = (input: T) => Promise<CallToolResult>;

/**
 * Wraps a tool handler in error normalization.
 *
 * Successful calls pass through unchanged.
 * HisaaboError values are returned as { isError: true, content: [{ type: "text", text: ... }] }.
 * Unexpected errors are collapsed to a generic api_error message.
 */
export function wrapTool<T>(handler: ToolHandler<T>): ToolHandler<T> {
  return async (input: T) => {
    try {
      return await handler(input);
    } catch (err) {
      const hisaaboErr = toHisaaboError(err);
      return {
        isError: true,
        content: [{ type: "text", text: formatError(hisaaboErr) }],
      };
    }
  };
}

function formatError(err: HisaaboError): string {
  switch (err.code) {
    case "unauthorized":
      return `Authentication required. Check that HISAABO_TOKEN is set and not expired.`;
    case "forbidden":
      return `Permission denied: ${err.message}`;
    case "not_found":
      return `Not found: ${err.resource}`;
    case "validation_failed":
      return `Validation failed:\n${Object.entries(err.fields).map(([f, msgs]) => `  ${f}: ${msgs.join(", ")}`).join("\n")}`;
    case "api_error":
      return `API error: ${err.message}`;
  }
}
```

---

## Auth Flow Walkthrough

### Initial login (CLI)

```
$ hisaabo login
Email: user@example.com
Password: ••••••••

-> POST /api/trpc/auth.login
   Body: { email, password }
   Header: x-client-type: cli

<- { sessionId: "abc123", user: { id, email, name }, tenantId: "...", businesses: [...] }

Prompts: "Select active business:" (if multiple)

Writes ~/.hisaabo/config.json (mode 0600):
{
  "apiUrl": "https://api.hisaabo.in",
  "token": "abc123",
  "tenantId": "...",
  "businessId": "...",
  "userEmail": "user@example.com",
  "businessName": "My Shop"
}

Logged in as user@example.com — My Shop
```

The `x-client-type: cli` header triggers a one-line addition in the auth router's
`login` procedure: return `sessionId` in the response body in addition to setting
the cookie. This is the only required change to the existing API.

### MCP server startup

```
npx @hisaabo/mcp
# env: HISAABO_TOKEN, HISAABO_TENANT_ID, HISAABO_BUSINESS_ID, HISAABO_API_URL

All requests set: Authorization: Bearer $HISAABO_TOKEN
                  x-business-id: $HISAABO_BUSINESS_ID
                  x-tenant-id: $HISAABO_TENANT_ID
```

The MCP server validates env vars at startup and exits with a clear error message
if any are missing. It does not attempt a lazy login.

---

## Claude Desktop Configuration

```json
{
  "mcpServers": {
    "hisaabo": {
      "command": "npx",
      "args": ["@hisaabo/mcp"],
      "env": {
        "HISAABO_API_URL": "http://localhost:3000",
        "HISAABO_TOKEN": "<session-id-from-hisaabo-login>",
        "HISAABO_TENANT_ID": "<tenant-id>",
        "HISAABO_BUSINESS_ID": "<business-id>"
      }
    }
  }
}
```

The `hisaabo whoami --json` command outputs the tenant ID, business ID, and token
in a machine-readable format to make config setup easy:

```bash
$ hisaabo whoami --json
{
  "email": "user@example.com",
  "businessName": "My Shop",
  "businessId": "550e8400-e29b-41d4-a716-446655440000",
  "tenantId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "token": "abc123...",
  "apiUrl": "http://localhost:3000"
}
```

---

## Build Pipeline Changes

### `turbo.json` additions

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    }
  }
}
```

No changes needed — the existing `build` task already uses `^build` (build
dependencies first). `packages/client` will build before `packages/cli` and
`packages/mcp` because both declare it as a workspace dependency.

### Build order (resolved by Turborepo)

```
packages/shared  →  packages/client  →  packages/cli
                                     →  packages/mcp
packages/db      →  packages/api
```

---

## Key Design Trade-offs

### Why not use `@trpc/client` in the shared client?

`@trpc/client` requires `@tanstack/react-query` as a peer dependency in the React
integration. The vanilla `@trpc/client` (without React) is usable, but it pulls in
SuperJSON coupling and forces a specific link adapter pattern that adds abstraction
without benefit in this context.

The HTTP wire format of tRPC is stable and simple. Calling it directly with `fetch`
keeps the client bundle minimal (~2KB) and removes one version-lock dependency.
The trade-off is: if tRPC changes its HTTP wire format in a major version, the
`packages/client` unwrap logic needs updating. That's acceptable — it is isolated
to one file.

### Why not call tRPC procedures directly (server-side caller)?

The `createCallerFactory` pattern in `packages/api` would let the CLI call
procedures without HTTP. This would be lower latency and remove network overhead.

The reason not to do this: it would require the CLI to have `packages/db` and
`packages/api` as dependencies, pulling in Drizzle, PostgreSQL drivers, Argon2,
and PDFKit into a CLI binary. The resulting binary would be hundreds of megabytes.
The HTTP client approach produces a CLI binary under 5MB.

### Why SuperJSON and not plain JSON?

The tRPC server is configured with `transformer: superjson`. Queries sent without
SuperJSON encoding return a 400. The shared client therefore must use SuperJSON
for request serialization and response deserialization. This is a constraint of
the existing API, not a choice.

### Pagination cap at 25 for MCP vs 20 for the CLI

The CLI defaults to 20 (a comfortable terminal screen page). The MCP server uses 25
because AI agents process the full result set and 25 gives slightly more context per
tool call while still keeping responses bounded. Both are well below the API's max of
100. Neither cap is visible to end users as a hard limit — they can paginate further.

---

## API Changes Required

Only one change to `packages/api` is needed to support this design:

**`packages/api/src/routers/auth.ts` — login procedure**

When `x-client-type: cli` header is present in the request, include the `sessionId`
in the JSON response body. The cookie is still set as usual (for browser clients).
This allows the CLI to extract the session token without parsing cookies.

All other API behavior is unchanged. No new endpoints, no new DB tables, no new
auth paths.

---

## File Reference Summary

| Path | Purpose |
|------|---------|
| `packages/client/src/client.ts` | `HisaaboClient` class, `normalizeTrpcError` |
| `packages/client/src/procedures/` | Typed wrappers for each router namespace |
| `packages/cli/src/config.ts` | Read/write `~/.hisaabo/config.json` |
| `packages/cli/src/index.ts` | CLI entry point, `commander` program |
| `packages/cli/src/commands/` | One file per top-level command group |
| `packages/cli/src/lib/output.ts` | Table + JSON output formatters |
| `packages/mcp/src/index.ts` | MCP server entry point, env var validation |
| `packages/mcp/src/server.ts` | Tool + resource registration aggregator |
| `packages/mcp/src/tools/` | One file per tool group |
| `packages/mcp/src/resources/` | MCP resource handlers |
| `packages/mcp/src/lib/errors.ts` | `wrapTool` error normalization |
| `packages/mcp/src/lib/pagination.ts` | `MAX_PAGE_SIZE` constant, page helpers |
