import { authEndpoints } from "./auth";
import { businessEndpoints } from "./business";
import { partyEndpoints } from "./party";
import { itemEndpoints } from "./item";
import { invoiceEndpoints } from "./invoice";
import { paymentEndpoints } from "./payment";
import { expenseEndpoints } from "./expense";
import { dashboardEndpoints } from "./dashboard";
import { targetEndpoints } from "./target";
import { reportsEndpoints } from "./reports";
import { shipmentEndpoints } from "./shipment";
import { tenantEndpoints } from "./tenant";
import { gstEndpoints } from "./gst";
import { hsnEndpoints } from "./hsn";
import { itcEndpoints } from "./itc";
import { eInvoiceEndpoints } from "./eInvoice";
import { ewayBillEndpoints } from "./ewayBill";
import { gstr2bEndpoints } from "./gstr2b";
import { bankAccountEndpoints } from "./bankAccount";
import { bankReconEndpoints } from "./bankRecon";
import { journalEndpoints } from "./journal";
import { accountEndpoints } from "./account";
import { storeEndpoints } from "./store";
import { recurringInvoiceEndpoints } from "./recurringInvoice";
import { apiKeyEndpoints } from "./apiKey";
import { importEndpoints } from "./import";
import type { EndpointGroup, EndpointSection } from "./types";

// ---------------------------------------------------------------------------
// Sections — logical grouping for sidebar and overview
// ---------------------------------------------------------------------------

export const allSections: EndpointSection[] = [
  {
    id: "foundation",
    title: "Foundation",
    groups: [authEndpoints, tenantEndpoints, businessEndpoints, apiKeyEndpoints],
  },
  {
    id: "commerce",
    title: "Commerce",
    groups: [
      partyEndpoints,
      itemEndpoints,
      invoiceEndpoints,
      paymentEndpoints,
      expenseEndpoints,
      shipmentEndpoints,
      recurringInvoiceEndpoints,
      storeEndpoints,
    ],
  },
  {
    id: "banking",
    title: "Banking",
    groups: [bankAccountEndpoints, bankReconEndpoints],
  },
  {
    id: "gst-tax",
    title: "GST & Compliance",
    groups: [
      gstEndpoints,
      gstr2bEndpoints,
      eInvoiceEndpoints,
      ewayBillEndpoints,
      itcEndpoints,
      hsnEndpoints,
    ],
  },
  {
    id: "accounting",
    title: "Accounting",
    groups: [accountEndpoints, journalEndpoints],
  },
  {
    id: "analytics",
    title: "Analytics",
    groups: [dashboardEndpoints, reportsEndpoints, targetEndpoints],
  },
  {
    id: "data",
    title: "Data",
    groups: [importEndpoints],
  },
];

// ---------------------------------------------------------------------------
// Flat arrays (backwards compat)
// ---------------------------------------------------------------------------

export const allEndpointGroups: EndpointGroup[] = allSections.flatMap((s) => s.groups);

export * from "./types";
export {
  authEndpoints,
  businessEndpoints,
  partyEndpoints,
  itemEndpoints,
  invoiceEndpoints,
  paymentEndpoints,
  expenseEndpoints,
  dashboardEndpoints,
  targetEndpoints,
  reportsEndpoints,
  shipmentEndpoints,
  tenantEndpoints,
  gstEndpoints,
  hsnEndpoints,
  itcEndpoints,
  eInvoiceEndpoints,
  ewayBillEndpoints,
  gstr2bEndpoints,
  bankAccountEndpoints,
  bankReconEndpoints,
  journalEndpoints,
  accountEndpoints,
  storeEndpoints,
  recurringInvoiceEndpoints,
  apiKeyEndpoints,
  importEndpoints,
};

// Flat map of all endpoints by ID for quick lookup
export const endpointById = new Map(
  allEndpointGroups.flatMap((g) => g.endpoints.map((e) => [e.id, e]))
);

// Flat map of groups by id
export const groupById = new Map(allEndpointGroups.map((g) => [g.id, g]));
