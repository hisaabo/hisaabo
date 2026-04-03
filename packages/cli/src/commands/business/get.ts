import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, hasColor } from "../../output.js";
import chalk from "chalk";

export async function businessGetCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const biz = await client.business.get();

    if (opts.json) {
      outputJSON(biz);
      return;
    }

    const sep = "─".repeat(52);
    const line = (label: string, value: string | null | undefined) => {
      if (!value) return;
      const lbl = hasColor() ? chalk.dim(label.padEnd(24)) : label.padEnd(24);
      process.stdout.write(`  ${lbl}${value}\n`);
    };

    process.stdout.write("\n");
    if (hasColor()) {
      process.stdout.write("  " + chalk.bold(biz.name ?? "") + "\n");
      process.stdout.write("  " + chalk.dim(sep) + "\n");
    } else {
      process.stdout.write(`  ${biz.name ?? ""}\n`);
      process.stdout.write("  " + sep + "\n");
    }

    line("GSTIN", biz.gstin);
    line("GST Type", biz.gstRegistrationType);
    line("Phone", biz.phone);
    line("Email", biz.email);
    line("Address", biz.address);
    line("City", biz.city);
    line("State", biz.state);
    line("Pincode", biz.pincode);
    line("Financial Year Start", biz.financialYearStart ? `Month ${biz.financialYearStart}` : undefined);
    line("Currency", biz.currency);
    line("ID", biz.id);

    process.stdout.write("\n");
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
