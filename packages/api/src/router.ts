import { router } from "./trpc.js";
import { authRouter } from "./routers/auth.js";
import { tenantRouter } from "./routers/tenant.js";
import { businessRouter } from "./routers/business.js";
import { partyRouter } from "./routers/party.js";
import { itemRouter } from "./routers/item.js";
import { invoiceRouter } from "./routers/invoice.js";
import { paymentRouter } from "./routers/payment.js";
import { expenseRouter } from "./routers/expense.js";
import { dashboardRouter } from "./routers/dashboard.js";
import { gstRouter } from "./routers/gst.js";
import {
  quotationRouter,
  creditNoteRouter,
  debitNoteRouter,
  deliveryChallanRouter,
  proformaRouter,
  salesReturnRouter,
  purchaseReturnRouter,
  documentRouter,
} from "./routers/document.js";
import { bankAccountRouter } from "./routers/bankAccount.js";
import { importRouter } from "./routers/import/index.js";
import { storeRouter } from "./routers/store.js";
import { targetRouter } from "./routers/target.js";
import { reportsRouter } from "./routers/reports.js";
import { shipmentRouter } from "./routers/shipment.js";
import { apiKeyRouter } from "./routers/apiKey.js";
import { recurringInvoiceRouter } from "./routers/recurringInvoice.js";
import { accountRouter } from "./routers/account.js";
import { hsnRouter } from "./routers/hsn.js";
import { journalRouter } from "./routers/journal.js";
import { itcRouter } from "./routers/itc.js";
import { eInvoiceRouter } from "./routers/eInvoice.js";
import { ewayBillRouter } from "./routers/ewayBill.js";
import { bankReconRouter } from "./routers/bankRecon.js";
import { gstr2bRouter } from "./routers/gstr2b.js";
import { systemRouter } from "./routers/system.js";
import { selfExportRouter } from "./routers/selfExport.js";
import { selfImportRouter } from "./routers/selfImport.js";

export const appRouter = router({
  auth: authRouter,
  tenant: tenantRouter,
  business: businessRouter,
  party: partyRouter,
  item: itemRouter,
  invoice: invoiceRouter,
  payment: paymentRouter,
  expense: expenseRouter,
  dashboard: dashboardRouter,
  gst: gstRouter,
  quotation: quotationRouter,
  creditNote: creditNoteRouter,
  debitNote: debitNoteRouter,
  deliveryChallan: deliveryChallanRouter,
  proforma: proformaRouter,
  salesReturn: salesReturnRouter,
  purchaseReturn: purchaseReturnRouter,
  document: documentRouter,
  bankAccount: bankAccountRouter,
  import: importRouter,
  store: storeRouter,
  target: targetRouter,
  reports: reportsRouter,
  shipment: shipmentRouter,
  apiKey: apiKeyRouter,
  recurringInvoice: recurringInvoiceRouter,
  account: accountRouter,
  hsn: hsnRouter,
  journal: journalRouter,
  itc: itcRouter,
  eInvoice: eInvoiceRouter,
  ewayBill: ewayBillRouter,
  bankRecon: bankReconRouter,
  gstr2b: gstr2bRouter,
  system: systemRouter,
  selfExport: selfExportRouter,
  selfImport: selfImportRouter,
});

export type AppRouter = typeof appRouter;
