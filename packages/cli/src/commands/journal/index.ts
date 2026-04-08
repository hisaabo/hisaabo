import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatDate } from "../../format.js";

interface JournalOpts {
  json?: boolean;
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
}

function handleError(e: unknown): never {
  if (e instanceof HisaaboApiError) {
    const err = e.hisaaboError;
    if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
    if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
  }
  fatalError(String(e instanceof Error ? e.message : e));
}

export async function journalListCommand(opts: JournalOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.journal.list({
      page: opts.page ?? 1,
      limit: opts.limit ?? 25,
      fromDate: opts.from,
      toDate: opts.to,
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const entries = Array.isArray(result) ? result
      : Array.isArray(result?.data) ? result.data
      : [];

    console.log(`\n Journal Entries\n`);
    console.log(` ${"═".repeat(70)}\n`);

    if (entries.length === 0) {
      console.log("  No journal entries found.\n");
      return;
    }

    for (const entry of entries as Array<Record<string, unknown>>) {
      const date = formatDate(String(entry["date"] ?? entry["journalDate"] ?? ""));
      const number = String(entry["number"] ?? entry["voucherNumber"] ?? "-");
      const narration = String(entry["narration"] ?? entry["description"] ?? "").slice(0, 40);
      const status = String(entry["status"] ?? "").padEnd(8);
      console.log(`  ${date.padEnd(13)} ${number.padEnd(14)} ${status} ${narration}`);
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function journalGetCommand(id: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.journal.getById(id);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const r = result as Record<string, unknown>;
    console.log(`\n Journal Entry — ${String(r["number"] ?? r["voucherNumber"] ?? id)}\n`);
    console.log(` ${"═".repeat(60)}\n`);
    console.log(`  Date:       ${formatDate(String(r["date"] ?? r["journalDate"] ?? ""))}`);
    console.log(`  Narration:  ${String(r["narration"] ?? r["description"] ?? "-")}`);
    console.log(`  Status:     ${String(r["status"] ?? "-")}`);
    console.log();

    const lines = r["lines"] ?? r["entries"] ?? r["lineItems"];
    if (lines && Array.isArray(lines)) {
      console.log("  Lines:\n");
      for (const line of lines as Array<Record<string, unknown>>) {
        const account = String(line["accountName"] ?? line["account"] ?? "-").padEnd(28);
        const debit = String(line["debit"] ?? "0");
        const credit = String(line["credit"] ?? "0");
        console.log(`    ${account}  Dr: ${debit.padStart(12)}  Cr: ${credit.padStart(12)}`);
      }
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function journalVoidCommand(id: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.journal.void(id);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`  Journal entry ${id} voided.\n`);

  } catch (e) {
    handleError(e);
  }
}

export async function journalTemplatesCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.journal.templateList();

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const templates = Array.isArray(result) ? result
      : Array.isArray(result?.data) ? result.data
      : [];

    console.log(`\n Journal Templates\n`);
    console.log(` ${"═".repeat(50)}\n`);

    if (templates.length === 0) {
      console.log("  No templates found.\n");
      return;
    }

    for (const t of templates as Array<Record<string, unknown>>) {
      const id = String(t["id"] ?? "-").slice(0, 8);
      const name = String(t["name"] ?? "-").padEnd(30);
      console.log(`  ${id}  ${name}`);
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}
