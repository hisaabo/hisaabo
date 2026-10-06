import { Command } from "commander";
import * as readline from "readline";
import { setConfig, requireAuth } from "../../config.js";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { fatalError, success, EXIT, outputJSON } from "../../output.js";

export function registerBusinessCommands(program: Command): void {
  // ── business (alias) ──────────────────────────────────────────────────────

  const business = program.command("business").description("Business management");

  business
    .command("list")
    .description("List all businesses")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const cfg = requireAuth();
      const client = new HisaaboClient(cfg);
      try {
        const businesses = await client.business.list();
        if (opts.json) { outputJSON(businesses); return; }
        businesses.forEach((b, i) => {
          const active = b.id === cfg.businessId ? " [active]" : "";
          console.log(`  ${i + 1}  ${b.name.padEnd(30)} ${(b.gstin ?? "-").padEnd(18)} ${b.gstRegistrationType}${active}`);
        });
        console.log();
      } catch (e) {
        fatalError(String(e instanceof Error ? e.message : e));
      }
    });

  business
    .command("get")
    .description("Show current business details")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { businessGetCommand } = await import("../../commands/business/get.js");
      await businessGetCommand(opts);
    });

  business
    .command("update")
    .description("Update business settings")
    .option("--name <name>", "Business name")
    .option("--gstin <gstin>", "GSTIN")
    .option("--address <address>", "Address")
    .option("--state <state>", "State")
    .option("--phone <phone>", "Phone number")
    .option("--email <email>", "Email address")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { businessUpdateCommand } = await import("../../commands/business/update.js");
      await businessUpdateCommand(opts);
    });

  business
    .command("sequence")
    .description("Set the next document number (cannot go backwards)")
    .requiredOption("--type <type>", "Document type: invoice, payment, quotation, credit_note, delivery_challan, proforma")
    .requiredOption("--next-number <n>", "Next sequence number")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { businessSequenceCommand } = await import("../../commands/business/sequence.js");
      await businessSequenceCommand(opts);
    });

  business
    .command("audit-trail")
    .description("View audit log for this business")
    .option("--page <n>", "Page number", "1")
    .option("--limit <n>", "Results per page", "25")
    .option("--json", "JSON output")
    .option("--format <fmt>", "Output format: table, tsv, csv")
    .action(async (opts) => {
      const { businessAuditTrailCommand } = await import("../../commands/business/audit-trail.js");
      await businessAuditTrailCommand(opts);
    });

  business
    .command("export")
    .description("Export all business data")
    .option("--yes", "Skip confirmation prompt")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { businessExportCommand } = await import("../../commands/business/export.js");
      await businessExportCommand(opts);
    });

  business
    .command("switch")
    .description("Switch active business")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const cfg = requireAuth();
      const client = new HisaaboClient(cfg);
      try {
        const businesses = await client.business.list();
        if (opts.json) { outputJSON(businesses); return; }
        businesses.forEach((b, i) => {
          const active = b.id === cfg.businessId ? " [active]" : "";
          console.log(`  ${i + 1}  ${b.name.padEnd(28)}${active}`);
        });
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((res) => rl.question("\n  Select: ", res));
        rl.close();
        const idx = parseInt(answer.trim(), 10) - 1;
        const selected = businesses[Math.max(0, Math.min(idx, businesses.length - 1))];
        if (!selected) fatalError("Invalid selection.", EXIT.USAGE);
        setConfig({ businessId: selected.id, businessName: selected.name });
        success(`Switched to: ${selected.name}`);
      } catch (e) {
        if (e instanceof HisaaboApiError) {
          if (e.hisaaboError.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
        }
        fatalError(String(e instanceof Error ? e.message : e));
      }
    });
}
