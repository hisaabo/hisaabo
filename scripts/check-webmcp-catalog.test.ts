// Run: node --experimental-strip-types --test scripts/check-webmcp-catalog.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { checkWebMcpCatalog, evaluateWebMcpCatalog, extractWebMcpToolNames } from "./check-webmcp-catalog.ts";

const base = {
  webTools: ["hisaabo_context", "party_list"],
  browserOnly: ["hisaabo_context"],
  catalog: { party_list: { webmcp: "exposed" }, party_delete: { webmcp: "excluded:destructive" } },
  mcpTools: ["party_list", "party_delete"],
};

test("a consistent catalog passes", () => {
  assert.deepEqual(evaluateWebMcpCatalog(base), { errors: [], warnings: [] });
});

test("fails on a WebMCP tool that is missing from the catalog", () => {
  const { errors } = evaluateWebMcpCatalog({ ...base, webTools: [...base.webTools, "party_create"] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"party_create" is not in .*webmcpCatalog/);
});

test("fails on a catalog entry without a status", () => {
  const catalog = { ...base.catalog, party_get: {} };
  const { errors } = evaluateWebMcpCatalog({ ...base, catalog, mcpTools: [...base.mcpTools, "party_get"] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"party_get" has no valid status/);
});

test("fails on an invalid status string and an undefined entry", () => {
  const catalog = { ...base.catalog, party_get: { webmcp: "maybe" }, party_update: undefined };
  const { errors } = evaluateWebMcpCatalog({ ...base, catalog, mcpTools: [...base.mcpTools, "party_get", "party_update"] });
  assert.equal(errors.length, 2);
  for (const e of errors) assert.match(e, /no valid status/);
});

test("fails when an implemented tool is not marked exposed", () => {
  const catalog = { ...base.catalog, party_list: { webmcp: "planned" } };
  const { errors } = evaluateWebMcpCatalog({ ...base, catalog });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /implemented in the browser but the catalog says "planned"/);
});

test("fails when a catalog entry is exposed but nothing implements it", () => {
  const catalog = { ...base.catalog, party_get: { webmcp: "exposed" } };
  const { errors } = evaluateWebMcpCatalog({ ...base, catalog, mcpTools: [...base.mcpTools, "party_get"] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"party_get" is "exposed" but .* has no such tool/);
});

test("fails when the catalog and TOOL_META disagree", () => {
  const extra = evaluateWebMcpCatalog({ ...base, mcpTools: ["party_list"] });
  assert.ok(extra.errors.some((e) => /"party_delete" does not match any tool/.test(e)));
  const missing = evaluateWebMcpCatalog({ ...base, mcpTools: [...base.mcpTools, "invoice_list"] });
  assert.ok(missing.errors.some((e) => /MCP tool "invoice_list" has no WebMCP catalog entry/.test(e)));
});

test("a browser-only tool must not also be an MCP tool", () => {
  const { errors } = evaluateWebMcpCatalog({ ...base, mcpTools: [...base.mcpTools, "hisaabo_context"], catalog: { ...base.catalog, hisaabo_context: { webmcp: "excluded:x" } } });
  assert.ok(errors.some((e) => /browser-only but is also an MCP tool/.test(e)));
});

test("extracts tool-definition names and ignores schema properties", () => {
  const src = `
const a: WebMcpToolDefinition = {
  name: "invoice_list",
  title: "List invoices",
  inputSchema: objectSchema({ name: { type: "string" }, itemName: { type: "string" } }),
};
const b = {
  name: "party_get",
  description: "x",
};`;
  assert.deepEqual(extractWebMcpToolNames(src), ["invoice_list", "party_get"]);
});

test("the repository's own catalog is consistent with the web tools", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { errors } = await checkWebMcpCatalog(root);
  assert.deepEqual(errors, []);
});
