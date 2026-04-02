// Trigger adapter registrations before any procedure runs
import "./adapters/index.js";

import { router } from "../../trpc.js";
import { importParties } from "./procedures/import-parties.js";
import { importItems } from "./procedures/import-items.js";
import { importInvoices } from "./procedures/import-invoices.js";
import { importPayments, reconcileDirectPayments } from "./procedures/import-payments.js";
import { importTransfers } from "./procedures/import-transfers.js";

export const importRouter = router({
  importParties,
  importItems,
  importInvoices,
  importPayments,
  reconcileDirectPayments,
  importTransfers,
});
