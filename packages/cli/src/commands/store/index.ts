import { HisaaboClient, HisaaboApiError, type StoreOrderSummary } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, paginationFooter, EXIT, type ColumnDef,
} from "../../output.js";
import { formatDate, formatAmount, formatStatus } from "../../format.js";

const ORDER_STATUSES = ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"] as const;

export async function storeSettingsCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const settings = await client.store.getSettings();

    if (opts.json) {
      outputJSON(settings);
      return;
    }

    console.log("\n  Store Settings\n  " + "─".repeat(35));
    console.log(`  Enabled:  ${settings.storeEnabled ? "Yes" : "No"}`);
    if (settings.storeSlug) console.log(`  Slug:     ${settings.storeSlug}`);
    if (settings.storeTagline) console.log(`  Tagline:  ${settings.storeTagline}`);
    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function storeOrdersCommand(opts: {
  json?: boolean;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    if (opts.status !== undefined && !(ORDER_STATUSES as readonly string[]).includes(opts.status)) {
      fatalError(`--status must be one of: ${ORDER_STATUSES.join(", ")}`, EXIT.USAGE);
    }
    const result = await client.store.listOrders({
      status: opts.status as (typeof ORDER_STATUSES)[number] | undefined,
      page,
      limit,
    });

    if (opts.json) {
      outputJSON({ data: result.data, pagination: { page: result.page, limit: result.limit, total: result.total } });
      return;
    }

    console.log(`\n Store Orders  ${result.total} total\n`);

    const cols: ColumnDef<StoreOrderSummary>[] = [
      { key: "orderNumber", header: "#", width: 12 },
      { key: "customerName", header: "Customer", width: 20 },
      { key: "createdAt", header: "Date", width: 13, format: (v) => formatDate(v as Date | null) },
      { key: "totalAmount", header: "Amount (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "status", header: "Status", width: 10, format: (v) => formatStatus(String(v ?? "")) },
    ];

    outputTable(result.data, cols);
    paginationFooter(result.page, result.limit, result.total);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
