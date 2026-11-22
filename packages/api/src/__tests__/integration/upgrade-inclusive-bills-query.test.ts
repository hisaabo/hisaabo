/**
 * The read-only "bills made from items priced including tax" query in docs/UPGRADING.md is
 * executable: this runs the query printed there against bills made the OLD way (the saved
 * inclusive price used as the taxable rate) and the NEW way, and checks which lines it lists.
 *
 * Atta  ₹118.00 incl. 18%, Steel ₹118.00 tax-exclusive 18%, Pack ₹118.00 incl. 18% with a "box" unit ₹590.00 incl. 18%.
 *
 *   old bill  2 x Atta @118.00 (18%)      taxable 236.00, GST 42.48, line 278.48   should be 2 x 118.00 = 236.00  -> overcharge 42.48
 *   old bill  1 x Atta @118.00, 10% off   taxable 106.20, GST 19.12 [19.116], line 125.32  should 106.20          -> overcharge 19.12
 *   old bill  1 x box @590.00 (18%)       taxable 590.00, GST 106.20, line 696.20  should 590.00                  -> overcharge 106.20
 *   NOT listed: Atta billed at the converted 100.00; Steel @118.00 (a tax-exclusive item); a cancelled bill; an online-store order.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { getTenantTestDb } from "../helpers/test-db.js";
import { useGoldenDb, createGoldenWorld, addParty, type GoldenWorld } from "./golden/golden-helpers.js";

useGoldenDb();

const UPGRADING = fileURLToPath(new URL("../../../../../docs/UPGRADING.md", import.meta.url));

function inclusiveBillsQuery(): string {
  const md = readFileSync(UPGRADING, "utf8");
  const marker = md.indexOf("<!-- inclusive-bills-query -->");
  expect(marker).toBeGreaterThan(-1);
  const open = md.indexOf("```sql", marker);
  const close = md.indexOf("```", open + 6);
  return md.slice(open + 6, close).trim();
}

describe("docs/UPGRADING.md: bills made from items priced including tax", () => {
  let w: GoldenWorld;
  const numbers: Record<string, string> = {};

  beforeAll(async () => {
    w = await createGoldenWorld();
    const customer = (await addParty(w, "customer", "MH")).id;
    const mk = (name: string, extra: Record<string, unknown>) =>
      w.caller.item.create({
        name, itemType: "product", itemMode: "simple", unit: "pcs", salePrice: "118.00", taxPercent: "18", stockQuantity: "100", ...extra,
      } as never);
    const atta = await mk("Atta", { taxInclusive: true });
    const steel = await mk("Steel", { taxInclusive: false });
    const pack = await mk("Pack", {
      taxInclusive: true, itemMode: "alt_units", unitVariants: [{ unit: "box", conversionFactor: 5, salePrice: "590.00" }],
    });

    const bill = async (key: string, line: Record<string, unknown>, after?: (id: string) => Promise<unknown>) => {
      const inv = await w.caller.invoice.create({
        partyId: customer, type: "sale", invoiceDate: "2025-06-10T10:00:00.000Z",
        lineItems: [{ itemName: "x", quantity: "1", taxPercent: "18", discountPercent: "0", ...line }],
      } as never);
      numbers[key] = inv.invoiceNumber;
      await after?.(inv.id);
    };

    await bill("old-atta", { itemId: atta.id, quantity: "2", unitPrice: "118.00" });
    await bill("old-atta-disc", { itemId: atta.id, unitPrice: "118.00", discountPercent: "10" });
    await bill("old-box", { itemId: pack.id, unitPrice: "590.00", selectedUnit: "box", conversionFactor: "5" });
    await bill("new-atta", { itemId: atta.id, unitPrice: "100.00" }); // the converted rate
    await bill("steel", { itemId: steel.id, unitPrice: "118.00" }); // tax-exclusive item
    await bill("cancelled", { itemId: atta.id, unitPrice: "118.00" }, (id) => w.caller.invoice.updateStatus({ id, status: "cancelled" }));
    await bill("store", { itemId: atta.id, unitPrice: "118.00" }, async (id) => {
      await getTenantTestDb().execute(sql`UPDATE invoices SET source = 'online_store' WHERE id = ${id}`);
    });
  });

  it("lists exactly the lines billed at the saved inclusive price, with what they should have totalled", async () => {
    const rows = (await getTenantTestDb().execute(sql.raw(inclusiveBillsQuery()))) as unknown as Array<Record<string, string>>;
    const byNumber = new Map(rows.map((r) => [r.invoice_number, r]));
    expect([...byNumber.keys()].sort()).toEqual([numbers["old-atta"], numbers["old-atta-disc"], numbers["old-box"]].sort());

    expect(byNumber.get(numbers["old-atta"]!)).toMatchObject({ item: "Atta", billed_rate: "118.00", line_total: "278.48", should_total: "236.00", overcharge: "42.48" });
    expect(byNumber.get(numbers["old-atta-disc"]!)).toMatchObject({ item: "Atta", line_total: "125.32", should_total: "106.20", overcharge: "19.12" });
    expect(byNumber.get(numbers["old-box"]!)).toMatchObject({ item: "Pack", billed_rate: "590.00", line_total: "696.20", should_total: "590.00", overcharge: "106.20" });
  });

  it("is read-only: it is a single SELECT", () => {
    const q = inclusiveBillsQuery();
    expect(q.trimStart().toUpperCase().startsWith("SELECT")).toBe(true);
    expect(q).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
  });
});
