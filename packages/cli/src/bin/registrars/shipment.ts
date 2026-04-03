import { Command } from "commander";
import {
  shipmentListCommand, shipmentGetCommand, shipmentCreateCommand, shipmentUpdateCommand,
} from "../../commands/shipment/index.js";

export function registerShipmentCommands(program: Command): void {
  // ── shipment ──────────────────────────────────────────────────────────────

  const shipment = program.command("shipment").description("Shipment tracking");

  shipment
    .command("list")
    .description("List shipments")
    .option("--json", "JSON output")
    .option("--status <status>", "Filter by status")
    .option("--invoice-id <id>", "Filter by invoice")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .action(async (opts) => {
      await shipmentListCommand({
        json: opts.json,
        status: opts.status,
        invoiceId: opts.invoiceId,
        page: opts.page,
        limit: opts.limit,
      });
    });

  shipment
    .command("get <id>")
    .description("Get shipment details")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await shipmentGetCommand(id, { json: opts.json });
    });

  shipment
    .command("create")
    .description("Create a new shipment")
    .option("--json", "JSON output")
    .option("--invoice-id <id>", "Invoice ID")
    .option("--party-id <id>", "Party ID")
    .option("--carrier <name>", "Carrier name")
    .option("--tracking <number>", "Tracking number")
    .option("--mode <mode>", "Shipping mode")
    .option("--date <date>", "Shipment date")
    .action(async (opts) => {
      await shipmentCreateCommand({
        json: opts.json,
        invoiceId: opts.invoiceId,
        partyId: opts.partyId,
        carrier: opts.carrier,
        tracking: opts.tracking,
        mode: opts.mode,
        date: opts.date,
      });
    });

  shipment
    .command("update <id>")
    .description("Update shipment status or tracking")
    .option("--json", "JSON output")
    .option("--status <status>", "New status")
    .option("--tracking <number>", "Tracking number")
    .option("--carrier <name>", "Carrier")
    .action(async (id, opts) => {
      await shipmentUpdateCommand(id, {
        json: opts.json,
        status: opts.status,
        tracking: opts.tracking,
        carrier: opts.carrier,
      });
    });
}
