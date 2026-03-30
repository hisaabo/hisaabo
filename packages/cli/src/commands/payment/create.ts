import * as readline from "readline";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { formatINR, formatAmount, todayISO } from "../../format.js";

interface CreateOpts {
  json?: boolean;
  partyId?: string;
  party?: string;
  amount?: string;
  mode?: string;
  invoiceId?: string;
  reference?: string;
  date?: string;
  notes?: string;
  yes?: boolean;
}

async function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

export async function paymentCreateCommand(opts: CreateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const isNonInteractive = !process.stdin.isTTY || opts.yes;

  let partyId = opts.partyId;
  let amount = opts.amount;
  let mode = opts.mode as "cash" | "bank" | "upi" | "cheque" | "other" | undefined;
  let referenceNumber = opts.reference;
  let paymentDate = opts.date ?? todayISO();
  let notes = opts.notes;

  try {
    if (!isNonInteractive) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log("\n  Record Payment\n  " + "─".repeat(30) + "\n");

      if (!partyId) {
        const search = await prompt(rl, "  Select Party:\n  > Search: ");
        const parties = await client.party.list({ search: search.trim(), limit: 5 });
        if (parties.data.length === 0) { rl.close(); fatalError("No parties found.", EXIT.NOT_FOUND); }

        parties.data.forEach((p, i) => {
          const bal = parseFloat(p.balance);
          const balStr = `Balance: ${formatINR(p.balance)} ${bal >= 0 ? "receivable" : "payable"}`;
          console.log(`    ${i + 1}  ${p.name.padEnd(20)} ${balStr}`);
        });

        const choice = await prompt(rl, "\n  Party [1]: ");
        const idx = parseInt(choice.trim() || "1", 10) - 1;
        const selected = parties.data[Math.max(0, Math.min(idx, parties.data.length - 1))];
        if (!selected) { rl.close(); fatalError("Invalid selection.", EXIT.USAGE); }
        partyId = selected.id;
        console.log(`\n  Party: ${selected.name}\n`);

        // Show unpaid invoices
        const invoices = await client.invoice.list({ partyId, status: "sent", limit: 10 });
        const partial = await client.invoice.list({ partyId, status: "partial", limit: 10 });
        const unpaid = [...invoices.data, ...partial.data];

        if (unpaid.length > 0) {
          console.log("  Unpaid Invoices:");
          console.log("  " + "─".repeat(65));
          unpaid.forEach((inv, i) => {
            console.log(`   ${i + 1}  ${inv.invoiceNumber.padEnd(12)} ${inv.totalAmount.padStart(12)} due  ${inv.status}`);
          });
          console.log();
        }

        if (!amount) {
          const amtStr = await prompt(rl, "  Amount: ");
          amount = amtStr.trim();
        }

        const modeStr = await prompt(rl, "  Mode (cash/bank/upi/cheque/other) [upi]: ");
        mode = (modeStr.trim() || "upi") as typeof mode;

        const refStr = await prompt(rl, "  Reference Number: ");
        if (refStr.trim()) referenceNumber = refStr.trim();

        const dateStr = await prompt(rl, `  Payment Date [${todayISO()}]: `);
        if (dateStr.trim()) paymentDate = dateStr.trim();

        const notesStr = await prompt(rl, "  Notes: ");
        if (notesStr.trim()) notes = notesStr.trim();

        console.log(`\n  Total Payment: ${formatAmount(amount ?? "0")}`);
        const confirm = await prompt(rl, "\n  Record this payment? (y/n) [y]: ");
        rl.close();

        if (confirm.trim().toLowerCase() === "n") {
          console.log("  Cancelled.");
          process.exit(0);
        }
      } else {
        rl.close();
      }
    }

    if (!partyId) fatalError("--party-id is required", EXIT.USAGE);
    if (!amount) fatalError("--amount is required", EXIT.USAGE);
    if (!mode) mode = "cash";

    const payment = await client.payment.create({
      partyId,
      amount,
      mode,
      referenceNumber,
      paymentDate,
      notes,
      invoiceId: opts.invoiceId,
    });

    if (opts.json) {
      outputJSON(payment);
      return;
    }

    success(`Recorded: ${payment.paymentNumber} for ${formatINR(payment.amount)}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
