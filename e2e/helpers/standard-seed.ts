/**
 * standard-seed.ts — the entities every worker stack is seeded with.
 *
 * These are the values the single shared global-setup used to create (business
 * "E2E Test Business", party "E2E Standard Customer", item "E2E Standard
 * Product", owner "E2E Test User"). global-setup.ts seeds each worker's fresh
 * database with them and then reads the state back through the API to prove it
 * is exactly this on every worker.
 */
export const STANDARD_USER_NAME = "E2E Test User";
export const STANDARD_PASSWORD = "Test@1234!";

export const STANDARD_BUSINESS = {
  name: "E2E Test Business",
  gstRegistrationType: "regular",
  gstin: "27AABCU9603R1ZM",
  pan: "AAACE0000A",
  phone: "9876500000",
  address: "123 Test Road",
  city: "Mumbai",
  state: "Maharashtra",
  stateCode: "27",
  pincode: "400001",
  currency: "INR",
} as const;

export const STANDARD_PARTY = {
  name: "E2E Standard Customer",
  type: "customer",
  phone: "9123400000",
  gstin: "",
  state: "Maharashtra",
  stateCode: "27",
} as const;

export const STANDARD_ITEM = {
  name: "E2E Standard Product",
  hsn: "5208",
  unit: "pcs",
  itemMode: "simple",
  salePrice: "500.00",
  purchasePrice: "400.00",
  taxPercent: "18.00",
  itemType: "product",
  taxInclusive: false,
} as const;
