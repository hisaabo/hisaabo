import { HisaaboClient, HisaaboApiError, type TdsSectionRow } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, type ColumnDef,
} from "../../output.js";
import { formatDate } from "../../format.js";

interface ListOpts {
  json?: boolean;
  format?: string;
  includeInactive?: boolean;
}

/**
 * List the TDS sections a customer receipt may use (`payment create --tds-section <code>`).
 * Read-only: a business that has no stored sections yet shows the registry defaults.
 */
export async function tdsSectionListCommand(opts: ListOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const sections = await client.tdsSection.list({ includeInactive: opts.includeInactive ?? false });

    if (opts.json) {
      outputJSON(sections);
      return;
    }

    const cols: ColumnDef<TdsSectionRow>[] = [
      { key: "sectionCode", header: "Code", width: 8 },
      { key: "sectionLabel", header: "Section", width: 70 },
      { key: "effectiveFrom", header: "Effective from", width: 15, format: (v) => formatDate(v as Date | null) },
      { key: "status", header: "Status", width: 9 },
      { key: "version", header: "Ver", align: "right", width: 4 },
    ];

    if (opts.format === "tsv") outputTSV(sections, cols);
    else if (opts.format === "csv") outputCSV(sections, cols);
    else {
      console.log(`\n  TDS sections  (${sections.length})\n`);
      outputTable(sections, cols);
      console.log();
    }
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
