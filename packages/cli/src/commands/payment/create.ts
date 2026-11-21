import { money, moneyStringSchema, paymentAllocationSchema } from "@hisaabo/shared";
import * as readline from "readline";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { formatINR, formatAmount, todayISO } from "../../format.js";
import { partyOptionError, resolvePartyByName } from "../../resolve-party.js";

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
  tdsAmount?: string;
  tdsSection?: string;
  tdsRate?: string;
}

async function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

/**
 * Receivable-side TDS: `--amount` is the NET cash received, `--tds-amount` what
 * the customer withheld; the allocation settles the gross (net + TDS) against
 * one invoice. Inputs are validated with the shared validators BEFORE any
 * arithmetic so a typo like "1,000" cannot silently become 0 or NaN.
 */
export function buildTdsAllocations(
  opts: Pick<CreateOpts, "invoiceId" | "tdsAmount" | "tdsSection" | "tdsRate">,
  netAmount: string,
) {
  if (opts.tdsAmount === undefined) {
    if (opts.tdsSection !== undefined || opts.tdsRate !== undefined) {
      fatalError("--tds-section and --tds-rate require --tds-amount", EXIT.USAGE);
    }
    return undefined;
  }
  if (!opts.invoiceId) {
    fatalError("--invoice-id is required when recording TDS", EXIT.USAGE);
  }
  if (!moneyStringSchema.safeParse(netAmount).success || !money.isPositive(netAmount)) {
    fatalError("--amount must be a positive amount with at most 2 decimals (e.g. 9000.00)", EXIT.USAGE);
  }
  if (!moneyStringSchema.safeParse(opts.tdsAmount).success || !money.isPositive(opts.tdsAmount)) {
    fatalError("--tds-amount must be a positive amount with at most 2 decimals (e.g. 1000.00)", EXIT.USAGE);
  }

  const allocation = {
    invoiceId: opts.invoiceId,
    amount: money.add(netAmount, opts.tdsAmount),
    tdsAmount: opts.tdsAmount,
    tdsSectionCode: opts.tdsSection,
    tdsRate: opts.tdsRate,
  };
  const parsed = paymentAllocationSchema.safeParse(allocation);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "allocation"}: ${issue.message}`)
      .join("; ");
    fatalError(`Invalid TDS options: ${problems}`, EXIT.USAGE);
  }
  return [allocation];
}

export async function paymentCreateCommand(opts: CreateOpts): Promise<void> {
  const partyOptError = partyOptionError(opts);
  if (partyOptError) fatalError(partyOptError, EXIT.USAGE);

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
    // --party <name>: resolve to an id up front, so the interactive wizard below only runs
    // when neither --party-id nor --party was given.
    if (opts.party !== undefined) {
      const resolved = await resolvePartyByName(client, opts.party);
      if (!resolved.ok) fatalError(resolved.message, resolved.reason === "not_found" ? EXIT.NOT_FOUND : EXIT.USAGE);
      partyId = resolved.party.id;
    }

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
        const { data: unpaid } = await client.invoice.list({ partyId, status: ["sent", "partial", "overdue"], limit: 20 });

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

    if (!partyId) fatalError("--party-id or --party is required", EXIT.USAGE);
    if (!amount) fatalError("--amount is required", EXIT.USAGE);
    if (!mode) mode = "cash";

    const allocations = buildTdsAllocations(opts, amount);

    const payment = await client.payment.create({
      partyId,
      amount,
      mode,
      referenceNumber,
      paymentDate,
      notes,
      invoiceId: opts.invoiceId,
      allocations,
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
