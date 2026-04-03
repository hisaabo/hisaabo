import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatINR, formatDate } from "../../format.js";

export async function paymentGetCommand(id: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const payment = await client.payment.getById(id);
    if (!payment) {
      fatalError(`Payment not found: ${id}`, EXIT.NOT_FOUND);
    }

    if (opts.json) {
      outputJSON(payment);
      return;
    }

    const p = payment!;
    const sep = "─".repeat(48);

    console.log(`\n  Payment: ${p.paymentNumber}`);
    console.log(`  ${sep}`);
    console.log(`  Party       : ${p.partyName}`);
    console.log(`  Date        : ${formatDate(p.paymentDate)}`);
    console.log(`  Amount      : ${formatINR(p.amount)}`);
    if (parseFloat(p.discount) > 0) {
      console.log(`  Discount    : ${formatINR(p.discount)}`);
    }
    console.log(`  Mode        : ${p.mode}`);
    console.log(`  Reference   : ${p.referenceNumber ?? "-"}`);
    console.log(`  Notes       : ${p.notes ?? "-"}`);
    console.log(`  Bank Acct   : ${p.bankAccountId ?? "-"}`);

    if (p.linkedInvoices && p.linkedInvoices.length > 0) {
      console.log(`\n  Linked Invoices:`);
      console.log(`  ${"─".repeat(65)}`);
      for (const inv of p.linkedInvoices) {
        const paid = formatINR(inv.amountPaid);
        const total = formatINR(inv.totalAmount);
        const applied = formatINR(inv.amount);
        console.log(`   ${inv.invoiceNumber.padEnd(14)} ${formatDate(inv.invoiceDate).padEnd(14)} Total: ${total.padStart(11)}  Applied: ${applied.padStart(11)}  [${inv.status.toUpperCase()}]`);
      }
    }

    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Payment not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
