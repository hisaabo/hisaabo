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

async function bankAccountIdForImport(client: HisaaboClient, importId: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, total, limit } = await client.bankRecon.importList({ page, limit: 100 });
    const hit = data.find((i) => i.id === importId);
    if (hit) return hit.bankAccountId;
    if (page * limit >= total) return null;
  }
}

export async function bankReconImportsCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.bankRecon.importList({});

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const imports = result.data;

    console.log("\n Bank Reconciliation Imports\n");
    console.log(` ${"═".repeat(65)}\n`);

    if (imports.length === 0) {
      console.log("  No imports found.\n");
      return;
    }

    for (const imp of imports) {
      const id = imp.id.slice(0, 8);
      const date = formatDate(imp.createdAt);
      const account = imp.fileName.padEnd(20);
      const lines = String(imp.totalLines).padStart(6);
      const matched = String(imp.matchedLines).padStart(8);
      const status = imp.status.padEnd(10);
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
    // The summary is keyed by bank account, so resolve it from the import first.
    const bankAccountId = await bankAccountIdForImport(client, importId);
    if (!bankAccountId) fatalError(`Import not found: ${importId}`, EXIT.NOT_FOUND);
    const result = await client.bankRecon.summary({ bankAccountId, importId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n Bank Recon Summary — ${importId}\n`);
    console.log(` ${"═".repeat(55)}\n`);

    const imp = result.import;
    console.log(`  Account:            ${result.accountName}`);
    console.log(`  Total Lines:        ${String(imp?.totalLines ?? 0).padStart(8)}`);
    console.log(`  Matched:            ${String(imp?.matchedLines ?? 0).padStart(8)}`);
    console.log(`  Unmatched:          ${String(imp?.unmatchedLines ?? 0).padStart(8)}`);
    console.log(`  Book Balance:       ${formatAmount(result.bookBalance).padStart(14)}`);
    console.log(`  Statement Balance:  ${formatAmount(result.statementBalance ?? "0").padStart(14)}`);
    console.log(`  Difference:         ${formatAmount(result.difference ?? "0").padStart(14)}`);
    console.log(`  Unmatched Debits:   ${formatAmount(result.unmatchedDebits).padStart(14)}`);
    console.log(`  Unmatched Credits:  ${formatAmount(result.unmatchedCredits).padStart(14)}`);
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

    const rules = result;

    console.log("\n Bank Recon Rules\n");
    console.log(` ${"═".repeat(60)}\n`);

    if (rules.length === 0) {
      console.log("  No rules configured.\n");
      return;
    }

    for (const rule of rules) {
      const id = rule.id.slice(0, 8);
      const name = `${rule.matchField} ${rule.matchType}`.padEnd(25);
      const condition = rule.matchValue.padEnd(20);
      const action = rule.action.padEnd(12);
      console.log(`  ${id}  ${name} ${condition} ${action}`);
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}
