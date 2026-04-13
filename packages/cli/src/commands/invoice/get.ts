import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, termWidth, hasColor } from "../../output.js";
import { formatAmount, formatDate, formatStatus, deliveryMethodLabel } from "../../format.js";
import chalk from "chalk";

export async function invoiceGetCommand(id: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const inv = await client.invoice.get(id);

    if (opts.json) {
      outputJSON(inv);
      return;
    }

    const w = Math.min(termWidth() - 2, 68);
    const inner = w - 2;

    function line(left: string, right?: string): void {
      if (right !== undefined) {
        const pad = Math.max(1, inner - left.length - right.length - 2);
        process.stdout.write(`│ ${left}${" ".repeat(pad)}${right} │\n`);
      } else {
        const vis = left.length;
        const pad = Math.max(0, inner - vis);
        process.stdout.write(`│ ${left}${" ".repeat(pad)} │\n`);
      }
    }

    function divider(): void {
      process.stdout.write(`├${"─".repeat(inner + 2)}┤\n`);
    }

    const title = `SALE INVOICE  ${inv.invoiceNumber}`;
    const statusBadge = formatStatus(inv.status);
    // eslint-disable-next-line no-control-regex
    const topPad = Math.max(1, inner - title.length - statusBadge.replace(/\x1b\[[0-9;]*m/g, "").length);

    process.stdout.write(`\n ┌${"─".repeat(inner + 2)}┐\n`);
    process.stdout.write(`│ ${hasColor() ? chalk.bold(title) : title}${" ".repeat(topPad)}${statusBadge} │\n`);
    divider();
    line(`Party:    ${inv.partyName}`);
    line(`Date:     ${formatDate(inv.invoiceDate)}`);
    if (inv.dueDate) line(`Due:      ${formatDate(inv.dueDate)}`);
    if (inv.createdByName) line(`Created:  ${inv.createdByName}${inv.createdAt ? ` (${formatDate(inv.createdAt)})` : ""}`);
    if (inv.deliveryMethod) line(`Delivery: ${deliveryMethodLabel(inv.deliveryMethod)}`);
    divider();

    // Line items header
    process.stdout.write(`│                                                                    │\n`);
    process.stdout.write(`│   #  ${"Item".padEnd(18)} ${"Qty".padStart(5)} ${"Rate (₹)".padStart(10)} ${"Tax%".padStart(5)} ${"Amount (₹)".padStart(12)}  │\n`);
    process.stdout.write(`│  ${"──".padEnd(2)} ${"─".repeat(18)} ${"─".repeat(5)} ${"─".repeat(10)} ${"─".repeat(5)} ${"─".repeat(12)}  │\n`);

    inv.lineItems.forEach((item, i) => {
      const idx = String(i + 1).padStart(2);
      const desc = item.description.slice(0, 18).padEnd(18);
      const qty = item.quantity.padStart(5);
      const rate = formatAmount(item.unitPrice).padStart(10);
      const tax = `${item.taxPercent}%`.padStart(5);
      const amt = formatAmount(item.amount).padStart(12);
      process.stdout.write(`│   ${idx}  ${desc} ${qty} ${rate} ${tax} ${amt}   │\n`);
    });

    process.stdout.write(`│                                                                    │\n`);
    divider();

    // Totals
    const subtotal = inv.lineItems.reduce((s, i) => s + parseFloat(i.amount), 0);
    const _tax = parseFloat(inv.totalAmount) - subtotal - parseFloat(inv.roundOff ?? "0") + parseFloat(inv.invoiceDiscount ?? "0");

    line(`Subtotal:`, formatAmount(String(subtotal)).padStart(16));
    if (parseFloat(inv.invoiceDiscount ?? "0") !== 0)
      line(`Discount:`, ("-" + formatAmount(inv.invoiceDiscount)).padStart(16));
    if (inv.charges && inv.charges.length > 0) {
      inv.charges.forEach((c) => line(`${c.label}:`, formatAmount(c.amount).padStart(16)));
    }
    if (parseFloat(inv.roundOff ?? "0") !== 0)
      line(`Round Off:`, formatAmount(inv.roundOff).padStart(16));
    process.stdout.write(`│  ${"─".repeat(inner - 2)}  │\n`);
    line(`Total:`, (hasColor() ? chalk.bold(formatAmount(inv.totalAmount)) : formatAmount(inv.totalAmount)).padStart(16));
    line(`Paid:`, formatAmount(inv.amountPaid).padStart(16));
    if (inv.totalAdjusted && parseFloat(inv.totalAdjusted) > 0)
      line(`Adjusted:`, ("-" + formatAmount(inv.totalAdjusted)).padStart(16));
    const balance = inv.totalAdjusted && parseFloat(inv.totalAdjusted) > 0
      ? String(parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid) - parseFloat(inv.totalAdjusted))
      : inv.balanceDue;
    line(`Balance:`, formatAmount(balance).padStart(16));
    if (inv.status === "adjusted")
      line(`(Settled via credit note / sales return)`);


    if (inv.notes || inv.termsAndConditions) {
      divider();
      if (inv.notes) line(`Notes: ${inv.notes}`);
      if (inv.termsAndConditions) line(`Terms: ${inv.termsAndConditions}`);
    }

    process.stdout.write(` └${"─".repeat(inner + 2)}┘\n\n`);
    process.stdout.write(` Actions: [e] Edit  [p] PDF  [d] Delete  [pay] Record Payment\n\n`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Invoice not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
