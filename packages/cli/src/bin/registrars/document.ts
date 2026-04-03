import { Command } from "commander";
import type { DocTypeConfig } from "../../commands/document/factory.js";

const DOC_TYPES: DocTypeConfig[] = [
  {
    cmd: "quotation",
    label: "Quotation",
    nsKey: "quotation",
    statuses: ["draft", "sent", "accepted", "rejected", "expired", "cancelled"],
  },
  {
    cmd: "credit-note",
    label: "Credit Note",
    nsKey: "creditNote",
    statuses: ["draft", "confirmed", "cancelled"],
  },
  {
    cmd: "debit-note",
    label: "Debit Note",
    nsKey: "debitNote",
    statuses: ["draft", "confirmed", "cancelled"],
  },
  {
    cmd: "delivery-challan",
    label: "Delivery Challan",
    nsKey: "deliveryChallan",
    statuses: ["draft", "dispatched", "delivered", "cancelled"],
  },
  {
    cmd: "proforma",
    label: "Proforma Invoice",
    nsKey: "proforma",
    statuses: ["draft", "sent", "accepted", "rejected", "expired", "converted", "cancelled"],
  },
  {
    cmd: "sales-return",
    label: "Sales Return",
    nsKey: "salesReturn",
    statuses: ["draft", "confirmed", "cancelled"],
  },
  {
    cmd: "purchase-return",
    label: "Purchase Return",
    nsKey: "purchaseReturn",
    statuses: ["draft", "confirmed", "cancelled"],
  },
];

export function registerDocumentCommands(program: Command): void {
  for (const dt of DOC_TYPES) {
    const parent = program.command(dt.cmd).description(`${dt.label} management`);

    parent
      .command("list")
      .description(`List ${dt.label.toLowerCase()}s`)
      .option("--json", "JSON output")
      .option("--format <format>", "Output format: table, tsv, csv, ids")
      .option("--status <status>", `Filter by status: ${dt.statuses.join(", ")}`)
      .option("--party <search>", "Filter by party name")
      .option("--from <date>", "Start date (YYYY-MM-DD)")
      .option("--to <date>", "End date (YYYY-MM-DD)")
      .option("--this-month", "Current month")
      .option("--this-fy", "Current financial year")
      .option("--page <n>", "Page number", parseInt)
      .option("--limit <n>", "Items per page", parseInt)
      .action(async (opts) => {
        const { docListCommand } = await import("../../commands/document/factory.js");
        await docListCommand(dt, opts);
      });

    parent
      .command("get <id>")
      .description(`Get ${dt.label.toLowerCase()} details`)
      .option("--json", "JSON output")
      .action(async (id, opts) => {
        const { docGetCommand } = await import("../../commands/document/factory.js");
        await docGetCommand(dt, id, opts);
      });

    parent
      .command("create")
      .description(`Create a new ${dt.label.toLowerCase()}`)
      .option("--json", "JSON output")
      .option("--party-id <id>", "Party UUID")
      .option("--party <name>", "Party search name")
      .option("--date <date>", "Document date (YYYY-MM-DD)")
      .option("--due-date <date>", "Due date (YYYY-MM-DD)")
      .option("--item <desc>", "Item description (repeatable)", (v, a: string[]) => [...a, v], [] as string[])
      .option("--qty <n>", "Quantity per item (repeatable)", (v, a: string[]) => [...a, v], [] as string[])
      .option("--rate <n>", "Rate per item (repeatable)", (v, a: string[]) => [...a, v], [] as string[])
      .option("--notes <text>", "Notes")
      .option("--discount <pct>", "Discount percent")
      .option("-y, --yes", "Skip confirmation")
      .action(async (opts) => {
        const { docCreateCommand } = await import("../../commands/document/factory.js");
        await docCreateCommand(dt, opts);
      });

    parent
      .command("update-status <id> <status>")
      .description(`Update ${dt.label.toLowerCase()} status (${dt.statuses.join(", ")})`)
      .option("--json", "JSON output")
      .action(async (id, status, opts) => {
        const { docStatusCommand } = await import("../../commands/document/factory.js");
        await docStatusCommand(dt, id, status, opts);
      });

    parent
      .command("delete <id>")
      .description(`Delete a ${dt.label.toLowerCase()}`)
      .option("-y, --yes", "Skip confirmation")
      .option("--json", "JSON output")
      .action(async (id, opts) => {
        const { docDeleteCommand } = await import("../../commands/document/factory.js");
        await docDeleteCommand(dt, id, opts);
      });
  }

  // ── document convert ──────────────────────────────────────────────────────

  program
    .command("document")
    .description("Document conversion operations")
    .command("convert")
    .description("Convert one document type to another")
    .requiredOption("--from-type <type>", "Source type (quotation, proforma, delivery-challan, etc.)")
    .requiredOption("--from-id <id>", "Source document ID")
    .requiredOption("--to-type <type>", "Target type (invoice, credit-note, etc.)")
    .option("--json", "JSON output")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts) => {
      const { HisaaboClient, HisaaboApiError } = await import("../../client.js");
      const { requireAuth } = await import("../../config.js");
      const { fatalError, outputJSON, success, EXIT } = await import("../../output.js");

      const cfg = requireAuth();
      const client = new HisaaboClient(cfg);

      if (!opts.yes && process.stdin.isTTY) {
        const readline = await import("readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(
            `  Convert ${opts.fromType} ${opts.fromId} → ${opts.toType}? (y/N): `,
            resolve,
          );
        });
        rl.close();
        if (answer.trim().toLowerCase() !== "y") {
          console.log("  Cancelled.");
          process.exit(EXIT.SUCCESS);
        }
      }

      try {
        const result = await client.document.convert({
          fromType: opts.fromType,
          fromId: opts.fromId,
          toType: opts.toType,
        });

        if (opts.json) {
          outputJSON(result);
          return;
        }

        const newId = result.id ?? result.documentId ?? "(unknown)";
        const newNum = result.documentNumber ?? result.number ?? newId;
        success(`Converted: ${opts.fromType} → ${opts.toType}  ${newNum}`);
        console.log(`  New ID:  ${newId}\n`);

      } catch (e) {
        if (e instanceof HisaaboApiError) {
          const err = e.hisaaboError;
          if (err.code === "not_found") fatalError(`Source document not found: ${opts.fromId}`, EXIT.NOT_FOUND);
          if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
          if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
          if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
          if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
        }
        fatalError(String(e instanceof Error ? e.message : e));
      }
    });
}
