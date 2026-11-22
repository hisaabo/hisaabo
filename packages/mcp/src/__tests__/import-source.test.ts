import { describe, it, expect, afterEach } from "vitest";
import { registerWith, callTool, recordingClient, writeAdmin } from "./helpers.js";

/**
 * The import tools default `source` to the server's "hisaabo" adapter. They used
 * to default to "excel", which has no server adapter, so every call with the
 * default failed with "Unknown import source".
 */

let restore: (() => void) | undefined;
afterEach(() => restore?.());

function setup() {
  const rec = recordingClient(() => ({ created: 0, skipped: 0, total: 0 }));
  restore = rec.restore;
  const { tools } = registerWith(writeAdmin, rec.client);
  return { ...rec, tools };
}

describe("import tools: default source", () => {
  it.each([
    ["import_parties", { parties: [{ name: "Acme" }] }, "import.importParties"],
    ["import_items", { items: [{ name: "Widget" }] }, "import.importItems"],
    ["import_invoices", { invoices: [{ invoice_number: "INV-1", invoice_date: "2026-04-01", party_name: "Acme", total_amount: "100.00" }] }, "import.importInvoices"],
    ["import_payments", { payments: [{ party_name: "Acme", amount: "10.00", payment_date: "2026-04-01" }] }, "import.importPayments"],
  ])("%s sends source=hisaabo unless told otherwise", async (tool, args, path) => {
    const { tools, calls } = setup();
    // Import tools are destructive-tier, so they need the confirm handshake.
    await callTool(tools.get(tool)!, { ...(args as Record<string, unknown>), confirm: true });
    expect(calls[0].url.pathname.endsWith(path)).toBe(true);
    expect((calls[0].body as { source: string }).source).toBe("hisaabo");
  });

  it("an explicit source is passed through unchanged", async () => {
    const { tools, calls } = setup();
    await callTool(tools.get("import_parties")!, { source: "mybillbook", parties: [{ name: "Acme" }], confirm: true });
    expect((calls[0].body as { source: string }).source).toBe("mybillbook");
  });

  it("no tool description advertises the unsupported 'tally'/'excel' sources", () => {
    const { tools } = setup();
    for (const name of ["import_parties", "import_items", "import_invoices", "import_payments"]) {
      const tool = tools.get(name)!;
      const shape = JSON.stringify(Object.values(tool.shape).map((s) => (s as { description?: string }).description));
      expect(shape).not.toMatch(/'excel'|'tally'/);
      expect(tool.description).not.toMatch(/'excel'|'tally'/);
    }
  });
});
