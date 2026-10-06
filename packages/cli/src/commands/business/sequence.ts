import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, success, outputJSON, EXIT } from "../../output.js";

interface BusinessSequenceOpts {
  type?: string;
  nextNumber?: string;
  json?: boolean;
}

const DOCUMENT_TYPES = ["invoice", "payment", "quotation", "credit_note", "delivery_challan", "proforma"] as const;

function isDocumentType(v: string | undefined): v is (typeof DOCUMENT_TYPES)[number] {
  return v !== undefined && (DOCUMENT_TYPES as readonly string[]).includes(v);
}

export async function businessSequenceCommand(opts: BusinessSequenceOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  // "sale" was the previous spelling of the invoice counter
  const documentType = opts.type === "sale" ? "invoice" : opts.type;
  if (!isDocumentType(documentType)) {
    fatalError(`--type must be one of: ${DOCUMENT_TYPES.join(", ")}.`, EXIT.USAGE);
  }
  if (opts.nextNumber === undefined || !/^\d+$/.test(opts.nextNumber) || parseInt(opts.nextNumber, 10) < 1) {
    fatalError("--next-number must be a positive integer.", EXIT.USAGE);
  }
  const newNumber = parseInt(opts.nextNumber, 10);

  try {
    const result = await client.business.updateSequenceNumber({ documentType, newNumber });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`${documentType} sequence updated: next number → ${newNumber}.`);
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "validation_failed") {
        const msgs = Object.entries(err.fields)
          .map(([f, ms]) => `  ${f}: ${ms.join(", ")}`)
          .join("\n");
        fatalError(`Validation failed:\n${msgs}`, EXIT.VALIDATION);
      }
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
