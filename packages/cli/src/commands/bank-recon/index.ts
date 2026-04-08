import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatAmount, formatDate } from "../../format.js";

function handleError(e: unknown): never {
  if (e instanceof HisaaboApiError) {
    const err = e.hisaaboError;
    if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
    if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
  }
  fatalError(String(e instanceof Error ? e.message : e));
}

export async function bankReconImportsCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.bankRecon.importList();

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const imports = Array.isArray(result) ? result
      : Array.isArray(result?.data) ? result.data
      : [];

    console.log("\n Bank Reconciliation Imports\n");
    console.log(` ${"═".repeat(65)}\n`);

    if (imports.length === 0) {
      console.log("  No imports found.\n");
      return;
    }

    for (const imp of imports as Array<Record<string, unknown>>) {
      const id = String(imp["id"] ?? "-").slice(0, 8);
      const date = formatDate(String(imp["createdAt"] ?? imp["importDate"] ?? ""));
      const account = String(imp["accountName"] ?? imp["bankAccount"] ?? "-").padEnd(20);
      const lines = String(imp["totalLines"] ?? imp["lineCount"] ?? "-").padStart(6);
      const matched = String(imp["matchedLines"] ?? imp["matched"] ?? "-").padStart(8);
      const status = String(imp["status"] ?? "-").padEnd(10);
      console.log(`  ${id}  ${date.padEnd(13)} ${account}  Lines:${lines}  Matched:${matched}  ${status}`);
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function bankReconSummaryCommand(importId: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.bankRecon.summary(importId);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const r = result as Record<string, unknown>;
    console.log(`\n Bank Recon Summary — ${importId}\n`);
    console.log(` ${"═".repeat(55)}\n`);

    const total = String(r["totalLines"] ?? r["total"] ?? "0");
    const matched = String(r["matchedLines"] ?? r["matched"] ?? "0");
    const unmatched = String(r["unmatchedLines"] ?? r["unmatched"] ?? "0");
    const ignored = String(r["ignoredLines"] ?? r["ignored"] ?? "0");
    const openingBalance = String(r["openingBalance"] ?? "0");
    const closingBalance = String(r["closingBalance"] ?? "0");

    console.log(`  Total Lines:      ${total.padStart(8)}`);
    console.log(`  Matched:          ${matched.padStart(8)}`);
    console.log(`  Unmatched:        ${unmatched.padStart(8)}`);
    console.log(`  Ignored:          ${ignored.padStart(8)}`);
    console.log(`  Opening Balance:  ${formatAmount(openingBalance).padStart(14)}`);
    console.log(`  Closing Balance:  ${formatAmount(closingBalance).padStart(14)}`);
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function bankReconRulesCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.bankRecon.ruleList();

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const rules = Array.isArray(result) ? result
      : Array.isArray(result?.data) ? result.data
      : [];

    console.log("\n Bank Recon Rules\n");
    console.log(` ${"═".repeat(60)}\n`);

    if (rules.length === 0) {
      console.log("  No rules configured.\n");
      return;
    }

    for (const rule of rules as Array<Record<string, unknown>>) {
      const id = String(rule["id"] ?? "-").slice(0, 8);
      const name = String(rule["name"] ?? "-").padEnd(25);
      const condition = String(rule["condition"] ?? rule["matchPattern"] ?? "-").padEnd(20);
      const action = String(rule["action"] ?? "-").padEnd(12);
      console.log(`  ${id}  ${name} ${condition} ${action}`);
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}
