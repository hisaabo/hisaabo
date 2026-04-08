import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatDate } from "../../format.js";

function handleError(e: unknown): never {
  if (e instanceof HisaaboApiError) {
    const err = e.hisaaboError;
    if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
    if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
  }
  fatalError(String(e instanceof Error ? e.message : e));
}

export async function ewbDashboardCommand(opts: { json?: boolean; from?: string; to?: string }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.ewayBill.dashboard({ fromDate: opts.from, toDate: opts.to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const r = result as Record<string, unknown>;
    console.log("\n E-Way Bill Dashboard\n");
    console.log(` ${"═".repeat(50)}\n`);

    const generated = String(r["totalGenerated"] ?? r["generated"] ?? "0");
    const cancelled = String(r["totalCancelled"] ?? r["cancelled"] ?? "0");
    const expired = String(r["totalExpired"] ?? r["expired"] ?? "0");
    const active = String(r["active"] ?? "0");

    console.log(`  Generated:  ${generated.padStart(8)}`);
    console.log(`  Active:     ${active.padStart(8)}`);
    console.log(`  Cancelled:  ${cancelled.padStart(8)}`);
    console.log(`  Expired:    ${expired.padStart(8)}`);
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function ewbGenerateCommand(invoiceId: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.ewayBill.generate({ invoiceId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const r = result as Record<string, unknown>;
    const ewbNo = String(r["eWayBillNo"] ?? r["ewbNumber"] ?? r["ewbNo"] ?? "-");
    const validUpto = String(r["validUpto"] ?? r["validTill"] ?? "-");
    console.log(`  E-Way Bill generated.\n`);
    console.log(`  EWB No:      ${ewbNo}`);
    console.log(`  Valid Upto:  ${validUpto}`);
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function ewbExpiringCommand(opts: { json?: boolean; days?: number }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.ewayBill.expiringList({ withinDays: opts.days ?? 3 });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const bills = Array.isArray(result) ? result
      : Array.isArray(result?.data) ? result.data
      : [];

    console.log(`\n Expiring E-Way Bills (within ${opts.days ?? 3} days)\n`);
    console.log(` ${"═".repeat(65)}\n`);

    if (bills.length === 0) {
      console.log("  No expiring e-way bills.\n");
      return;
    }

    for (const bill of bills as Array<Record<string, unknown>>) {
      const ewbNo = String(bill["eWayBillNo"] ?? bill["ewbNumber"] ?? "-").padEnd(14);
      const invoiceNo = String(bill["invoiceNumber"] ?? bill["invoice"] ?? "-").padEnd(14);
      const party = String(bill["partyName"] ?? bill["party"] ?? "-").padEnd(22);
      const validUpto = formatDate(String(bill["validUpto"] ?? bill["validTill"] ?? ""));
      console.log(`  ${ewbNo} ${invoiceNo} ${party} Expires: ${validUpto}`);
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}
