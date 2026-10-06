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

export async function ewbDashboardCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.ewayBill.dashboard({});

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log("\n E-Way Bill Dashboard\n");
    console.log(` ${"═".repeat(50)}\n`);

    const generated = String(result.summary["generated"] ?? 0);
    const cancelled = String(result.summary["cancelled"] ?? 0);
    const expired = String(result.summary["expired"] ?? 0);
    const active = String(result.summary["active"] ?? 0);

    console.log(`  Generated:  ${generated.padStart(8)}`);
    console.log(`  Active:     ${active.padStart(8)}`);
    console.log(`  Cancelled:  ${cancelled.padStart(8)}`);
    console.log(`  Expired:    ${expired.padStart(8)}`);
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function ewbGenerateCommand(
  invoiceId: string,
  opts: { json?: boolean; vehicle: string; distance: number },
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.ewayBill.generate({ invoiceId, vehicleNumber: opts.vehicle, distance: opts.distance });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const ewbNo = result.ewbNumber ?? "-";
    const validUpto = formatDate(result.validUpto);
    console.log(`  E-Way Bill generated.\n`);
    console.log(`  EWB No:      ${ewbNo}`);
    console.log(`  Valid Upto:  ${validUpto}`);
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function ewbExpiringCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.ewayBill.expiringList();

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const bills = result;

    console.log(`\n Expiring E-Way Bills (within 24 hours)\n`);
    console.log(` ${"═".repeat(65)}\n`);

    if (bills.length === 0) {
      console.log("  No expiring e-way bills.\n");
      return;
    }

    for (const bill of bills) {
      const ewbNo = (bill.ewbNumber ?? "-").padEnd(14);
      const invoiceNo = (bill.invoiceNumber ?? "-").padEnd(14);
      const party = (bill.partyName ?? "-").padEnd(22);
      const validUpto = formatDate(bill.validUpto);
      console.log(`  ${ewbNo} ${invoiceNo} ${party} Expires: ${validUpto}`);
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}
