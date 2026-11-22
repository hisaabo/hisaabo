/**
 * Input builder for `bankRecon.confirmMapping`.
 *
 * `skipDuplicates` is a required argument and always sent. The server default is
 * off (a 0.10.0 client that never sends the flag must keep importing every
 * line), so the "skip lines already imported" behaviour of this client is
 * whatever the checkbox says, never an implicit default.
 */

/** Column mapping as held by the upload form: select values are strings, "" = not mapped. */
export interface BankMappingFields {
  date: string;
  narration: string;
  debit: string;
  credit: string;
  amount: string;
  type: string;
  reference: string;
  balance: string;
  dateFormat: string;
  skipRows: string;
}

const mapInt = (v: string): number | undefined => (v !== "" ? parseInt(v, 10) : undefined);

export function buildConfirmMappingInput(args: {
  importId: string;
  csvContent: string;
  templateId?: string;
  skipDuplicates: boolean;
  mapping: BankMappingFields;
}) {
  const { mapping } = args;
  return {
    importId: args.importId,
    csvContent: args.csvContent,
    templateId: args.templateId || undefined,
    skipDuplicates: args.skipDuplicates,
    columnMapping: {
      date: parseInt(mapping.date, 10),
      narration: parseInt(mapping.narration, 10),
      debit: mapInt(mapping.debit),
      credit: mapInt(mapping.credit),
      amount: mapInt(mapping.amount),
      type: mapInt(mapping.type),
      reference: mapInt(mapping.reference),
      balance: mapInt(mapping.balance),
      dateFormat: mapping.dateFormat,
      skipRows: parseInt(mapping.skipRows, 10),
    },
  };
}
