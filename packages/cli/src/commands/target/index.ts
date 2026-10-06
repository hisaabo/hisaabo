import { HisaaboClient, HisaaboApiError, type TargetRow } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, EXIT, success, type ColumnDef,
} from "../../output.js";
import { formatDate, formatAmount, toApiDateTime } from "../../format.js";

const targetTypes = ["order_count", "order_value", "item_quantity"] as const;
const targetPeriodTypes = ["daily", "weekly", "monthly", "quarterly", "custom"] as const;

function isTargetType(v: string | undefined): v is (typeof targetTypes)[number] {
  return v !== undefined && (targetTypes as readonly string[]).includes(v);
}

function isPeriodType(v: string): v is (typeof targetPeriodTypes)[number] {
  return (targetPeriodTypes as readonly string[]).includes(v);
}

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
      { key: "targetType", header: "Type", width: 14 },
      { key: "periodType", header: "Period", width: 12 },
      { key: "targetValue", header: "Target", align: "right", width: 12, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "periodStart", header: "Start", width: 13, format: (v) => formatDate(v as Date | null) },
      { key: "periodEnd", header: "End", width: 13, format: (v) => formatDate(v as Date | null) },
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
      const pct = Math.round(t.progress.percentage);
      const filled = Math.max(0, Math.min(20, Math.floor(pct / 5)));
      const bar = "█".repeat(filled) + "░".repeat(20 - filled);
      console.log(`  ${t.targetType} (${t.periodType})`);
      console.log(`  Target: ${formatAmount(t.targetValue)}  Current: ${formatAmount(t.progress.current)}  ${pct}%`);
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
  userId?: string;
}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.type) fatalError("--type is required (order_count/order_value/item_quantity)", EXIT.USAGE);
  if (!opts.value) fatalError("--value is required", EXIT.USAGE);
  if (!opts.startDate) fatalError("--start-date is required", EXIT.USAGE);
  if (!opts.endDate) fatalError("--end-date is required", EXIT.USAGE);
  if (!isTargetType(opts.type)) fatalError(`--type must be one of: ${targetTypes.join(", ")}`, EXIT.USAGE);
  const period = opts.period ?? "monthly";
  if (!isPeriodType(period)) fatalError(`--period must be one of: ${targetPeriodTypes.join(", ")}`, EXIT.USAGE);

  try {
    // Targets belong to a user; default to the signed-in one.
    const userId = opts.userId ?? (await client.auth.me()).id;
    const target = await client.target.create({
      userId,
      targetType: opts.type,
      periodType: period,
      targetValue: opts.value,
      periodStart: toApiDateTime(opts.startDate, "start"),
      periodEnd: toApiDateTime(opts.endDate, "end"),
      notes: opts.notes,
    });

    if (opts.json) {
      outputJSON(target);
      return;
    }

    success(`Target created: ${target.targetType} ${target.periodType} ${formatAmount(target.targetValue)}`);

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
