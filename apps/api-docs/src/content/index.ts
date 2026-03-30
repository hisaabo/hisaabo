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
import type { EndpointGroup } from "./types";

export const allEndpointGroups: EndpointGroup[] = [
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
];

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
};

// Flat map of all endpoints by ID for quick lookup
export const endpointById = new Map(
  allEndpointGroups.flatMap((g) => g.endpoints.map((e) => [e.id, e]))
);

// Flat map of groups by id
export const groupById = new Map(allEndpointGroups.map((g) => [g.id, g]));
