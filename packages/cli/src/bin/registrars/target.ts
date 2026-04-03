import { Command } from "commander";
import { targetListCommand, targetMyCommand, targetCreateCommand } from "../../commands/target/index.js";

export function registerTargetCommands(program: Command): void {
  // ── target ────────────────────────────────────────────────────────────────

  const target = program.command("target").description("Sales target management");

  target
    .command("list")
    .description("List sales targets")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await targetListCommand({ json: opts.json });
    });

  target
    .command("my")
    .description("Show my target progress")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await targetMyCommand({ json: opts.json });
    });

  target
    .command("create")
    .description("Create a new sales target")
    .option("--json", "JSON output")
    .option("--type <type>", "order_count, order_value, or item_quantity")
    .option("--period <period>", "daily, weekly, monthly, quarterly, or custom")
    .option("--value <n>", "Target value")
    .option("--start-date <date>", "Start date")
    .option("--end-date <date>", "End date")
    .option("--notes <text>", "Notes")
    .action(async (opts) => {
      await targetCreateCommand({
        json: opts.json,
        type: opts.type,
        period: opts.period,
        value: opts.value,
        startDate: opts.startDate,
        endDate: opts.endDate,
        notes: opts.notes,
      });
    });
}
