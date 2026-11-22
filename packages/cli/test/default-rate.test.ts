// Run with: node --experimental-strip-types --test packages/cli/test/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import superjson from "superjson";
import { defaultBillRate, savedPriceFor } from "../src/default-rate.ts";
import { invoiceCreateCommand } from "../src/commands/invoice/create.ts";
import { docCreateCommand, type DocTypeConfig } from "../src/commands/document/factory.ts";

// Sale price 620.00, purchase price 540.00 (both tax-exclusive), 12% GST.
const GHEE = {
  id: "22222222-2222-4222-8222-222222222222", name: "Ghee 1L", unit: "pcs", itemMode: "simple",
  salePrice: "620.00", purchasePrice: "540.00", taxPercent: "12.00", taxInclusive: false, unitVariants: [], variants: [],
};
// Sale price 118.00 INCLUDING 18% GST (bill rate 100.00); purchase price 90.00 (tax-exclusive).
const ATTA = { ...GHEE, id: "33333333-3333-4333-8333-333333333333", name: "Atta 5kg", salePrice: "118.00", purchasePrice: "90.00", taxPercent: "18.00", taxInclusive: true };

// ── defaultBillRate: pure ────────────────────────────────────────────────────────────────────────
test("a sale-side bill starts from the SALE price, a purchase-side bill from the PURCHASE price", () => {
  assert.equal(defaultBillRate(GHEE, "sale"), "620.00");
  assert.equal(defaultBillRate(GHEE, "purchase"), "540.00"); // used to be 620.00, the sale price
});

test("a purchase price is tax-exclusive and never converted, even for an item whose sale price includes GST", () => {
  assert.equal(defaultBillRate(ATTA, "sale"), "100.00"); // 11800p x 100 / 118 = 10000p
  assert.equal(defaultBillRate(ATTA, "purchase"), "90.00");
});

test("there is no fallback to the other side's price: no purchase price means no default", () => {
  const noPurchase = { ...GHEE, purchasePrice: null };
  assert.equal(savedPriceFor(noPurchase, "purchase"), null);
  assert.equal(defaultBillRate(noPurchase, "purchase"), "");
  const noSale = { ...GHEE, salePrice: null };
  assert.equal(savedPriceFor(noSale, "sale"), null);
  assert.equal(defaultBillRate(noSale, "sale"), "");
  assert.equal(savedPriceFor({ ...GHEE, purchasePrice: "" }, "purchase"), null);
});

// ── the commands, against a fake API ─────────────────────────────────────────────────────────────
interface Call { path: string; body: unknown }

async function withFakeApi<T>(listed: unknown[], created: Record<string, unknown>, fn: (calls: Call[]) => Promise<T>) {
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  const realWrite = process.stdout.write.bind(process.stdout);
  const env = { ...process.env };
  process.env["HISAABO_TOKEN"] = "hisaabo_key_test";
  process.env["HISAABO_API_URL"] = "http://localhost:3000";
  process.env["HISAABO_TENANT_ID"] = "00000000-0000-4000-8000-000000000001";
  process.env["HISAABO_BUSINESS_ID"] = "00000000-0000-4000-8000-000000000002";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace("/api/trpc/", "");
    calls.push({ path, body: init?.body ? superjson.deserialize(JSON.parse(String(init.body))) : undefined });
    const results: Record<string, unknown> = {
      "party.list": { data: [{ id: "p1", name: "Priya Textiles" }], total: 1 },
      "item.list": { data: listed, total: listed.length },
      ...created,
    };
    return new Response(JSON.stringify({ result: { data: superjson.serialize(results[path]) } }), { status: 200 });
  }) as typeof fetch;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    process.stdout.write = realWrite;
    process.env = env;
  }
}

const sentLine = (calls: Call[], path: string) =>
  (calls.find((c) => c.path === path)!.body as { lineItems: Array<{ unitPrice: string; taxPercent: string }> }).lineItems[0]!;
const CREATED = { id: "d1", invoiceNumber: "X-00001", totalAmount: "1.00", documentType: "invoice" };

test("invoice create --type purchase, no --rate: the line starts at the PURCHASE price 540.00, not the sale price", async () => {
  await withFakeApi([GHEE], { "invoice.create": CREATED }, async (calls) => {
    await invoiceCreateCommand({ yes: true, party: "Priya", type: "purchase", items: ["Ghee"], qty: ["2"], json: true });
    assert.equal(sentLine(calls, "invoice.create").unitPrice, "540.00");
  });
});

test("invoice create (sale), no --rate: the SALE price 620.00; an inclusive sale price is converted, 118.00 -> 100.00", async () => {
  await withFakeApi([GHEE], { "invoice.create": CREATED }, async (calls) => {
    await invoiceCreateCommand({ yes: true, party: "Priya", items: ["Ghee"], qty: ["1"], json: true });
    assert.equal(sentLine(calls, "invoice.create").unitPrice, "620.00");
  });
  await withFakeApi([ATTA], { "invoice.create": CREATED }, async (calls) => {
    await invoiceCreateCommand({ yes: true, party: "Priya", items: ["Atta"], qty: ["1"], json: true });
    assert.equal(sentLine(calls, "invoice.create").unitPrice, "100.00");
  });
});

test("invoice create --type purchase for an inclusive-flagged item: the purchase price 90.00 is used as it is", async () => {
  await withFakeApi([ATTA], { "invoice.create": CREATED }, async (calls) => {
    await invoiceCreateCommand({ yes: true, party: "Priya", type: "purchase", items: ["Atta"], qty: ["1"], json: true });
    assert.equal(sentLine(calls, "invoice.create").unitPrice, "90.00");
  });
});

test("a typed --rate is always sent as typed, on either side", async () => {
  await withFakeApi([GHEE], { "invoice.create": CREATED }, async (calls) => {
    await invoiceCreateCommand({ yes: true, party: "Priya", type: "purchase", items: ["Ghee"], qty: ["1"], rate: ["500"], json: true });
    assert.equal(sentLine(calls, "invoice.create").unitPrice, "500");
  });
});

// ── the other documents: the side follows --type, a purchase return defaults to purchase ───────────
const doc = (cmd: string, nsKey: DocTypeConfig["nsKey"]): DocTypeConfig => ({ cmd, label: cmd, nsKey, statuses: [] });

test("debit note --type purchase, credit note, purchase return: the side picks the default price", async () => {
  await withFakeApi([GHEE], { "debitNote.create": CREATED }, async (calls) => {
    await docCreateCommand(doc("debit-note", "debitNote"), { yes: true, party: "Priya", type: "purchase", item: ["Ghee"], qty: ["1"], json: true });
    assert.equal(sentLine(calls, "debitNote.create").unitPrice, "540.00");
  });
  await withFakeApi([GHEE], { "creditNote.create": CREATED }, async (calls) => {
    await docCreateCommand(doc("credit-note", "creditNote"), { yes: true, party: "Priya", item: ["Ghee"], qty: ["1"], json: true });
    assert.equal(sentLine(calls, "creditNote.create").unitPrice, "620.00");
  });
  await withFakeApi([GHEE], { "purchaseReturn.create": CREATED }, async (calls) => {
    // no --type: a purchase return goes back to a supplier, so it is purchase-side
    await docCreateCommand(doc("purchase-return", "purchaseReturn"), { yes: true, party: "Priya", item: ["Ghee"], qty: ["1"], json: true });
    assert.equal(sentLine(calls, "purchaseReturn.create").unitPrice, "540.00");
  });
});

test("quotation of an inclusive item: 118.00 incl. 18% starts at 100.00; the purchase side stays 90.00", async () => {
  await withFakeApi([ATTA], { "quotation.create": CREATED }, async (calls) => {
    await docCreateCommand(doc("quotation", "quotation"), { yes: true, party: "Priya", item: ["Atta"], qty: ["1"], json: true });
    assert.equal(sentLine(calls, "quotation.create").unitPrice, "100.00");
  });
  await withFakeApi([ATTA], { "debitNote.create": CREATED }, async (calls) => {
    await docCreateCommand(doc("debit-note", "debitNote"), { yes: true, party: "Priya", type: "purchase", item: ["Atta"], qty: ["1"], json: true });
    assert.equal(sentLine(calls, "debitNote.create").unitPrice, "90.00");
  });
});
