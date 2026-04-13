/**
 * seed.ts — E2E test data seeding via tRPC API calls.
 *
 * Instead of directly touching the database (like integration tests do),
 * E2E seeds go through the actual API to create realistic test data.
 * This ensures the full middleware chain (auth, business isolation, etc.)
 * is exercised during seeding.
 */
import fs from "fs";
import path from "path";

// ── Shared API interface ─────────────────────────────────────────

/** Common interface for ApiHelper (browser-based) and SeedApi (fetch-based). */
export interface ApiClient {
  mutate<T = unknown>(procedure: string, input: unknown, headers?: Record<string, string>): Promise<T>;
  query<T = unknown>(procedure: string, input?: unknown, headers?: Record<string, string>): Promise<T>;
}

// ── Global seed ──────────────────────────────────────────────────

export interface GlobalSeed {
  businessId: string;
  partyId: string;
  itemId: string;
  partyName: string;
  itemName: string;
}

const SEED_FILE = path.join(__dirname, "../.auth/seed.json");
const STORAGE_STATE_FILE = path.join(__dirname, "../.auth/user.json");

/**
 * Load pre-seeded IDs written by global-setup.
 * Available after the setup project runs.
 */
export function loadSeed(): GlobalSeed {
  return JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"));
}

// ── Lightweight API for beforeAll seeding ────────────────────────

/**
 * Lightweight tRPC API client that reads auth cookies from the
 * storageState file and uses native fetch — no browser needed.
 * Use in beforeAll blocks instead of spinning up a browser context.
 */
export class SeedApi implements ApiClient {
  private cookies: string;
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.API_URL ?? "http://localhost:3000";
    const storageState = JSON.parse(fs.readFileSync(STORAGE_STATE_FILE, "utf-8"));
    this.cookies = storageState.cookies
      .map((c: { name: string; value: string }) => `${c.name}=${c.value}`)
      .join("; ");
  }

  async mutate<T = unknown>(
    procedure: string,
    input: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/trpc/${procedure}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "hisaabo",
        Cookie: this.cookies,
        ...headers,
      },
      body: JSON.stringify({ json: input }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`tRPC ${procedure} failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    return data.result?.data?.json ?? data.result?.data ?? data;
  }

  async query<T = unknown>(
    procedure: string,
    input?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const inputParam = input
      ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : "";
    const res = await fetch(`${this.baseUrl}/api/trpc/${procedure}${inputParam}`, {
      headers: {
        "X-Requested-With": "hisaabo",
        Cookie: this.cookies,
        ...headers,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`tRPC ${procedure} query failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    return data.result?.data?.json ?? data.result?.data ?? data;
  }
}

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
export async function ensureBusiness(api: ApiClient): Promise<SeededBusiness> {
  const businesses = await api.query<SeededBusiness[]>("business.list");
  if (businesses.length > 0) return businesses[0];

  const biz = await api.mutate<SeededBusiness>("business.create", {
    name: "E2E Test Business",
    gstRegistrationType: "regular",
    gstin: "27AABCU9603R1ZM",
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
  api: ApiClient,
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
  api: ApiClient,
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
  api: ApiClient,
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
  api: ApiClient,
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
export async function seedTestWorld(api: ApiClient) {
  const business = await ensureBusiness(api);
  const party = await createParty(api, business.id);
  const item = await createItem(api, business.id);
  return { business, party, item };
}

/**
 * Seed a test world with an invoice in a specific status.
 */
export async function seedWorldWithInvoice(
  api: ApiClient,
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
  api: ApiClient,
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
  api: ApiClient,
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
