import { describe, it, expect } from "vitest";
import { registerWith, callTool, recordingClient, writeAdmin, UUID } from "./helpers.js";

// Cancelling an IRN also cancels the invoice (0.10.1). The agent must be told so
// before it asks the user to confirm.
describe("einvoice_cancel", () => {
  it("describes that the invoice is cancelled too, and that a new invoice may be needed", () => {
    const { tools } = registerWith(writeAdmin);
    const description = tools.get("einvoice_cancel")!.description;
    expect(description).toMatch(/also cancel the invoice itself/);
    expect(description).toMatch(/stock and returns are adjusted/);
    expect(description).toMatch(/new invoice must be issued/);
    expect(description).toMatch(/payments are allocated/);
  });

  it("puts the invoice cancellation in the confirmation prompt and does not call the API without confirm", async () => {
    const { tools } = registerWith(writeAdmin);
    const result = await callTool(tools.get("einvoice_cancel")!, { invoice_id: UUID });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/also cancel the invoice itself/);
    expect(text).toMatch(/Nothing was changed/);
  });

  it("calls eInvoice.cancel once confirmed", async () => {
    const { client, calls, restore } = recordingClient(() => ({ id: UUID, status: "cancelled", eInvoiceStatus: "cancelled" }));
    try {
      const { tools } = registerWith(writeAdmin, client);
      const result = await callTool(tools.get("einvoice_cancel")!, { invoice_id: UUID, cancel_reason: "2", confirm: true });
      expect(result.isError).toBeFalsy();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.method).toBe("POST");
      expect(calls[0]!.url.pathname).toMatch(/eInvoice\.cancel$/);
      expect(calls[0]!.body).toMatchObject({ invoiceId: UUID, cancelReason: "2" });
    } finally {
      restore();
    }
  });
});
