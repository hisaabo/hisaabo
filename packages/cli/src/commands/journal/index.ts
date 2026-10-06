import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatDate, apiFrom, apiTo } from "../../format.js";
import { confirmOrExit } from "../../safety.js";

interface JournalOpts {
  json?: boolean;
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
      fromDate: apiFrom(opts.from),
      toDate: apiTo(opts.to),
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const entries = result;

    console.log(`\n Journal Entries\n`);
    console.log(` ${"═".repeat(70)}\n`);

    if (entries.length === 0) {
      console.log("  No journal entries found.\n");
      return;
    }

    for (const entry of entries) {
      const date = formatDate(entry.entryDate);
      const number = entry.entryNumber;
      const narration = (entry.narration ?? "").slice(0, 40);
      const status = (entry.isVoided ? "voided" : "posted").padEnd(8);
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

    if (!result) fatalError(`Journal entry not found: ${id}`, EXIT.NOT_FOUND);
    console.log(`\n Journal Entry — ${result.entryNumber}\n`);
    console.log(` ${"═".repeat(60)}\n`);
    console.log(`  Date:       ${formatDate(result.entryDate)}`);
    console.log(`  Narration:  ${result.narration ?? "-"}`);
    console.log(`  Status:     ${result.isVoided ? "voided" : "posted"}`);
    console.log();

    console.log("  Lines:\n");
    for (const line of result.lines) {
      const account = line.accountName.padEnd(28);
      console.log(`    ${account}  Dr: ${line.debit.padStart(12)}  Cr: ${line.credit.padStart(12)}`);
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function journalVoidCommand(id: string, opts: { json?: boolean; yes?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  await confirmOrExit(`Void journal entry ${id}?`, opts);

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

    const templates = result;

    console.log(`\n Journal Templates\n`);
    console.log(` ${"═".repeat(50)}\n`);

    if (templates.length === 0) {
      console.log("  No templates found.\n");
      return;
    }

    for (const t of templates) {
      const id = t.id.slice(0, 8);
      const name = t.name.padEnd(30);
      console.log(`  ${id}  ${name}`);
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}
