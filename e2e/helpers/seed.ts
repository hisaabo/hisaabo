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

export interface SeededInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  totalAmount: string;
  amountPaid: string;
}

/**
 * Ensure the test user has at least one business.
 * Returns the first business from business.list, or creates one if none exist.
 */
export async function ensureBusiness(api: ApiHelper): Promise<SeededBusiness> {
  const businesses = await api.query<SeededBusiness[]>("business.list");
  if (businesses.length > 0) return businesses[0];

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
 * Create a sale invoice with one line item via the API.
 */
export async function createInvoice(
  api: ApiHelper,
  businessId: string,
  partyId: string,
  itemId: string,
  overrides: Partial<{
    type: "sale" | "purchase";
    quantity: string;
    unitPrice: string;
    taxPercent: string;
  }> = {},
): Promise<SeededInvoice> {
  const qty = overrides.quantity ?? "2";
  const price = overrides.unitPrice ?? "500.00";
  const tax = overrides.taxPercent ?? "18.00";

  return api.mutate<SeededInvoice>(
    "invoice.create",
    {
      type: overrides.type ?? "sale",
      partyId,
      invoiceDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      lineItems: [
        {
          itemId,
          itemName: "Test Product",
          quantity: qty,
          unitPrice: price,
          taxPercent: tax,
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
      invoiceDiscount: "0",
      invoiceDiscountType: "amount",
      additionalCharges: "0",
      roundOff: "0",
    },
    { "x-business-id": businessId },
  );
}

/**
 * Update an invoice's status via the API.
 */
export async function updateInvoiceStatus(
  api: ApiHelper,
  businessId: string,
  invoiceId: string,
  status: string,
): Promise<void> {
  await api.mutate(
    "invoice.updateStatus",
    { id: invoiceId, status },
    { "x-business-id": businessId },
  );
}

/**
 * Seed a complete test world: business + party + item.
 */
export async function seedTestWorld(api: ApiHelper) {
  const business = await ensureBusiness(api);
  const party = await createParty(api, business.id);
  const item = await createItem(api, business.id);
  return { business, party, item };
}

/**
 * Seed a test world with an invoice in a specific status.
 */
export async function seedWorldWithInvoice(
  api: ApiHelper,
  invoiceStatus?: string,
) {
  const { business, party, item } = await seedTestWorld(api);
  const invoice = await createInvoice(api, business.id, party.id, item.id);
  if (invoiceStatus && invoiceStatus !== "draft") {
    await updateInvoiceStatus(api, business.id, invoice.id, invoiceStatus);
  }
  return { business, party, item, invoice };
}

export interface SeededExpense {
  id: string;
  category: string;
  amount: string;
}

/**
 * Create an expense in the active business.
 */
export async function createExpense(
  api: ApiHelper,
  businessId: string,
  overrides: Partial<{
    category: string;
    description: string;
    amount: string;
    mode: string;
    expenseDate: string;
    referenceNumber: string;
  }> = {},
): Promise<SeededExpense> {
  return api.mutate<SeededExpense>(
    "expense.create",
    {
      category: overrides.category ?? "Office Supplies",
      description: overrides.description ?? "E2E test expense",
      amount: overrides.amount ?? "500.00",
      mode: overrides.mode ?? "cash",
      expenseDate: overrides.expenseDate ?? new Date().toISOString(),
      referenceNumber: overrides.referenceNumber ?? "",
    },
    { "x-business-id": businessId },
  );
}

// ── Invite & role helpers ──────────────────────────────────────

export interface InviteResult {
  token: string;
}

/**
 * Send an invitation to an email address with a specific role.
 * Returns the raw invite token.
 */
export async function sendInvite(
  api: ApiHelper,
  email: string,
  role: "admin" | "seller_manager" | "seller" | "accountant",
): Promise<InviteResult> {
  return api.mutate<InviteResult>("tenant.inviteMember", { email, role });
}

/**
 * Register a new user via the auth.register tRPC endpoint.
 * Returns the session token set via cookie header.
 */
export async function registerUser(
  baseUrl: string,
  data: { email: string; password: string; name: string },
): Promise<{ sessionToken: string }> {
  const res = await fetch(`${baseUrl}/api/trpc/auth.register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "hisaabo",
    },
    body: JSON.stringify({
      json: {
        email: data.email,
        password: data.password,
        confirmPassword: data.password,
        name: data.name,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`auth.register failed (${res.status}): ${text}`);
  }
  // Extract session cookie from Set-Cookie header
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const sessionCookie = setCookies.find((c) => c.startsWith("session="));
  const sessionToken = sessionCookie?.split("=")[1]?.split(";")[0] ?? "";
  return { sessionToken };
}

/**
 * Accept an invitation via direct API call using a session token.
 */
export async function acceptInvite(
  baseUrl: string,
  token: string,
  sessionCookie: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/trpc/tenant.acceptInvitation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "hisaabo",
      Cookie: `session=${sessionCookie}`,
    },
    body: JSON.stringify({ json: { token } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`acceptInvitation failed (${res.status}): ${text}`);
  }
}
