// Run with: node --experimental-strip-types --test packages/cli/test/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import superjson from "superjson";
import { invoiceCreateCommand } from "../src/commands/invoice/create.ts";

const GHEE = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Ghee 1L",
  unit: "pcs",
  itemMode: "simple",
  salePrice: "620.00",
  purchasePrice: "540.00",
  taxPercent: "18.00",
  taxInclusive: false,
  unitVariants: [],
  variants: [],
};
const CREATED = { id: "inv-1", invoiceNumber: "INV-00001", totalAmount: "600.00", documentType: "invoice" };

interface Call {
  path: string;
  body: unknown;
}

/**
 * Runs `invoice create` against a fake API and returns what was called and what was printed.
 * `fail` makes the named procedure answer with a tRPC FORBIDDEN error.
 */
async function run(opts: Parameters<typeof invoiceCreateCommand>[0], fail?: string) {
  const calls: Call[] = [];
  const out: string[] = [];
  const realFetch = globalThis.fetch;
  const realWrite = process.stdout.write.bind(process.stdout);
  const env = { ...process.env };
  process.env["HISAABO_TOKEN"] = "hisaabo_key_test";
  process.env["HISAABO_API_URL"] = "http://localhost:3000";
  process.env["HISAABO_TENANT_ID"] = "00000000-0000-4000-8000-000000000001";
  process.env["HISAABO_BUSINESS_ID"] = "00000000-0000-4000-8000-000000000002";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/api/trpc/", "");
    const body = init?.body ? superjson.deserialize(JSON.parse(String(init.body))) : undefined;
    calls.push({ path, body });
    if (path === fail) {
      return new Response(JSON.stringify({ error: { message: "You do not have permission", code: "FORBIDDEN" } }), { status: 403 });
    }
    const results: Record<string, unknown> = {
      "party.list": { data: [{ id: "p1", name: "Priya Textiles" }], total: 1 },
      "item.list": { data: [GHEE], total: 1 },
      "item.getById": GHEE,
      "invoice.create": CREATED,
      "item.updatePricesFromDocument": {
        documentId: "inv-1",
        updated: [{ itemId: GHEE.id, side: "sale", label: "Ghee 1L", oldPrice: "620.00", newPrice: "600.00" }],
        unchanged: [],
      },
    };
    return new Response(JSON.stringify({ result: { data: superjson.serialize(results[path]) } }), { status: 200 });
  }) as typeof fetch;
  process.stdout.write = ((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await invoiceCreateCommand({ yes: true, party: "Priya", ...opts });
  } finally {
    globalThis.fetch = realFetch;
    process.stdout.write = realWrite;
    process.env = env;
  }
  const paths = calls.map((c) => c.path);
  return { calls, paths, stdout: out.join(""), call: (p: string) => calls.find((c) => c.path === p) };
}

test("invoice create --update-item-prices: saves the bill, then updates the price from that bill", async () => {
  const r = await run({ items: ["Ghee"], qty: ["1"], rate: ["600"], updateItemPrices: true, json: true });
  assert.ok(r.paths.indexOf("invoice.create") < r.paths.indexOf("item.updatePricesFromDocument"), "the bill is saved first");
  assert.deepEqual(r.call("item.updatePricesFromDocument")!.body, {
    documentId: "inv-1",
    updates: [{ itemId: GHEE.id, side: "sale", newPrice: "600.00", priceIncludesTax: false }],
  });
  const printed = JSON.parse(r.stdout);
  assert.equal(printed.invoiceNumber, "INV-00001");
  assert.equal(printed.itemPriceUpdate.status, "updated");
  assert.equal(printed.itemPriceUpdate.updated[0].newPrice, "600.00");
});

test("without the flag the catalog is never touched", async () => {
  const r = await run({ items: ["Ghee"], qty: ["1"], rate: ["600"], json: true });
  assert.ok(r.paths.includes("invoice.create"));
  assert.ok(!r.paths.includes("item.updatePricesFromDocument"));
  assert.ok(!r.paths.includes("item.getById"));
  assert.equal(JSON.parse(r.stdout).itemPriceUpdate, undefined);
});

test("a rate defaulted from the catalog (no --rate) never proposes a price, even with the flag", async () => {
  const r = await run({ items: ["Ghee"], qty: ["1"], updateItemPrices: true, json: true });
  assert.ok(r.paths.includes("invoice.create"));
  assert.ok(!r.paths.includes("item.updatePricesFromDocument"));
  assert.equal(JSON.parse(r.stdout).itemPriceUpdate.status, "nothing_to_update");
});

test("a rate equal to the saved price is not an update", async () => {
  const r = await run({ items: ["Ghee"], qty: ["1"], rate: ["620"], updateItemPrices: true, json: true });
  assert.ok(!r.paths.includes("item.updatePricesFromDocument"));
});

test("a purchase invoice updates the purchase price", async () => {
  const r = await run({ type: "purchase", items: ["Ghee"], qty: ["1"], rate: ["560"], updateItemPrices: true, json: true });
  const update = (r.call("item.updatePricesFromDocument")!.body as { updates: Array<{ side: string; newPrice: string }> }).updates[0]!;
  assert.equal(update.side, "purchase");
  assert.equal(update.newPrice, "560.00");
});

test("a refused price update is reported, and the invoice still counts as created", async () => {
  const r = await run({ items: ["Ghee"], qty: ["1"], rate: ["600"], updateItemPrices: true, json: true }, "item.updatePricesFromDocument");
  const printed = JSON.parse(r.stdout);
  assert.equal(printed.invoiceNumber, "INV-00001");
  assert.equal(printed.itemPriceUpdate.status, "failed");
  assert.match(printed.itemPriceUpdate.message, /bill was saved, but item prices were not updated/);
});

test("the registrar exposes --update-item-prices on `invoice create`", () => {
  const src = readFileSync(new URL("../src/bin/registrars/invoice.ts", import.meta.url), "utf8");
  assert.ok(src.includes('"--update-item-prices"'));
  assert.ok(src.includes("updateItemPrices: opts.updateItemPrices"));
});
