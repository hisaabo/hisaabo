import { authEndpoints } from "./auth";
import { businessEndpoints } from "./business";
import { partyEndpoints } from "./party";
import { itemEndpoints } from "./item";
import { invoiceEndpoints } from "./invoice";
import { paymentEndpoints } from "./payment";
import type { EndpointGroup } from "./types";

export const allEndpointGroups: EndpointGroup[] = [
  authEndpoints,
  businessEndpoints,
  partyEndpoints,
  itemEndpoints,
  invoiceEndpoints,
  paymentEndpoints,
];

export * from "./types";
export { authEndpoints, businessEndpoints, partyEndpoints, itemEndpoints, invoiceEndpoints, paymentEndpoints };

// Flat map of all endpoints by ID for quick lookup
export const endpointById = new Map(
  allEndpointGroups.flatMap((g) => g.endpoints.map((e) => [e.id, e]))
);

// Flat map of groups by id
export const groupById = new Map(allEndpointGroups.map((g) => [g.id, g]));
