import { HisaaboClient, HisaaboApiError, type TargetRow, type TargetWithProgress } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, EXIT, success, type ColumnDef,
} from "../../output.js";
import { formatDate, formatAmount } from "../../format.js";

export async function targetListCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const targets = await client.target.list({});

    if (opts.json) {
      outputJSON(targets);
      return;
    }

    console.log("\n Sales Targets\n");

    const cols: ColumnDef<TargetRow>[] = [
      { key: "id", header: "ID", width: 10, format: (v) => String(v ?? "").slice(0, 8) + "..." },
      { key: "type", header: "Type", width: 14 },
      { key: "period", header: "Period", width: 12 },
      { key: "targetValue", header: "Target", align: "right", width: 12, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "startDate", header: "Start", width: 13, format: (v) => formatDate(String(v ?? "")) },
      { key: "endDate", header: "End", width: 13, format: (v) => formatDate(v ? String(v) : null) },
    ];

    outputTable(targets, cols);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function targetMyCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const targets = await client.target.myTargets();

    if (opts.json) {
      outputJSON(targets);
      return;
    }

    console.log("\n My Targets\n");
    console.log(" " + "═".repeat(60) + "\n");

    targets.forEach((t) => {
      const pct = Math.round(t.percentComplete);
      const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
      console.log(`  ${t.type} (${t.period})`);
      console.log(`  Target: ${formatAmount(t.targetValue)}  Current: ${formatAmount(t.currentValue)}  ${pct}%`);
      console.log(`  [${bar}]\n`);
    });

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function targetCreateCommand(opts: {
  json?: boolean;
  type?: string;
  period?: string;
  value?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.type) fatalError("--type is required (order_count/order_value/item_quantity)", EXIT.USAGE);
  if (!opts.value) fatalError("--value is required", EXIT.USAGE);
  if (!opts.startDate) fatalError("--start-date is required", EXIT.USAGE);

  try {
    const target = await client.target.create({
      type: opts.type as "order_count" | "order_value" | "item_quantity",
      period: (opts.period ?? "monthly") as "daily" | "weekly" | "monthly" | "quarterly" | "custom",
      targetValue: opts.value,
      startDate: opts.startDate,
      endDate: opts.endDate,
      notes: opts.notes,
    });

    if (opts.json) {
      outputJSON(target);
      return;
    }

    success(`Target created: ${target.type} ${target.period} ${formatAmount(target.targetValue)}`);

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
