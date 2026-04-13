/**
 * seed.ts — E2E test data seeding via tRPC API calls.
 *
 * Instead of directly touching the database (like integration tests do),
 * E2E seeds go through the actual API to create realistic test data.
 * This ensures the full middleware chain (auth, business isolation, etc.)
 * is exercised during seeding.
 */
import type { ApiHelper } from "./fixtures";

export interface SeededBusiness {
  id: string;
  name: string;
}

export interface SeededParty {
  id: string;
  name: string;
  type: "customer" | "supplier";
}

export interface SeededItem {
  id: string;
  name: string;
  salePrice: string;
  unit: string;
}

/**
 * Ensure the test user has at least one business.
 * Returns the first business from business.list, or creates one if none exist.
 */
export async function ensureBusiness(api: ApiHelper): Promise<SeededBusiness> {
  const businesses = await api.query<SeededBusiness[]>("business.list");
  if (businesses.length > 0) return businesses[0];

  // Create a new business via the settings flow
  const biz = await api.mutate<SeededBusiness>("business.create", {
    name: "E2E Test Business",
    gstRegistrationType: "regular",
    gstin: "27AABCE2E00R1ZM",
    phone: "9876500000",
    email: "e2e@test.hisaabo.in",
    address: "123 Test Road",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
    pincode: "400001",
    currency: "INR",
  });
  return biz;
}

/**
 * Create a party (customer) in the active business.
 */
export async function createParty(
  api: ApiHelper,
  businessId: string,
  overrides: Partial<{
    name: string;
    type: "customer" | "supplier";
    phone: string;
    gstin: string;
  }> = {},
): Promise<SeededParty> {
  return api.mutate<SeededParty>(
    "party.create",
    {
      name: overrides.name ?? "E2E Customer",
      type: overrides.type ?? "customer",
      phone: overrides.phone ?? "9123400000",
      gstin: overrides.gstin ?? "",
      state: "Maharashtra",
      stateCode: "27",
    },
    { "x-business-id": businessId },
  );
}

/**
 * Create an item (product) in the active business.
 */
export async function createItem(
  api: ApiHelper,
  businessId: string,
  overrides: Partial<{
    name: string;
    hsn: string;
    unit: string;
    salePrice: string;
    purchasePrice: string;
    taxPercent: string;
  }> = {},
): Promise<SeededItem> {
  return api.mutate<SeededItem>(
    "item.create",
    {
      name: overrides.name ?? "E2E Test Product",
      hsn: overrides.hsn ?? "5208",
      unit: overrides.unit ?? "pcs",
      itemMode: "simple",
      salePrice: overrides.salePrice ?? "500.00",
      purchasePrice: overrides.purchasePrice ?? "400.00",
      taxPercent: overrides.taxPercent ?? "18.00",
      itemType: "product",
      taxInclusive: false,
    },
    { "x-business-id": businessId },
  );
}

/**
 * Seed a complete test world: business + party + item.
 * Returns all created entities.
 */
export async function seedTestWorld(api: ApiHelper) {
  const business = await ensureBusiness(api);
  const party = await createParty(api, business.id);
  const item = await createItem(api, business.id);
  return { business, party, item };
}
