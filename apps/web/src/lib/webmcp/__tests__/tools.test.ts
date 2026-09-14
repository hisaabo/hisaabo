/**
 * Catalog-wide contract tests plus per-tool execute() mapping.
 *
 * The catalog is data an autonomous browser agent reads and acts on, so the
 * invariants below are load-bearing rather than cosmetic: a tool whose
 * annotations lie about being read-only, or whose schema forgets
 * `additionalProperties: false`, is a safety bug, not a style nit.
 *
 * `execute()` is exercised against a fake tRPC client so the tests assert the
 * exact input handed to the API — no network, no react-query.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  webMcpTools,
  appTools,
  dashboardTools,
  invoiceTools,
  partyTools,
  itemTools,
  paymentTools,
  expenseTools,
} from "../tools";
import { resolvePeriod } from "../tools/dashboard";
import { indianFinancialYear } from "../tools/app";
import type { WebMcpToolContext, WebMcpToolDefinition } from "../types";

const NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;

function tool(name: string): WebMcpToolDefinition {
  const found = webMcpTools.find((t) => t.name === name);
  if (!found) throw new Error(`No such tool in the catalog: ${name}`);
  return found;
}

/**
 * Fake tRPC client: one `vi.fn()` per procedure the catalog is allowed to call.
 * Anything a tool reaches for that is not here throws, which is what keeps the
 * catalog inside the parity-approved procedure set.
 */
function makeClient() {
  return {
    dashboard: { summary: { query: vi.fn().mockResolvedValue({ totalSales: "1000.00" }) } },
    invoice: {
      list: { query: vi.fn().mockResolvedValue({ data: [], total: 60, page: 2, limit: 25 }) },
      getById: { query: vi.fn().mockResolvedValue({ id: "inv-1" }) },
      create: { mutate: vi.fn().mockResolvedValue({ id: "inv-1", invoiceNumber: "INV-0001" }) },
      updateStatus: { mutate: vi.fn().mockResolvedValue({ id: "inv-1", status: "sent" }) },
    },
    party: {
      list: { query: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 25 }) },
      getById: { query: vi.fn().mockResolvedValue({ id: "p-1", name: "Acme", balance: "100.00" }) },
      getStats: { query: vi.fn().mockResolvedValue({ invoiceCount: 12, paymentCount: 9 }) },
      create: { mutate: vi.fn().mockResolvedValue({ id: "p-1" }) },
    },
    item: {
      list: { query: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 25 }) },
      getById: { query: vi.fn().mockResolvedValue({ id: "i-1" }) },
      create: { mutate: vi.fn().mockResolvedValue({ id: "i-1" }) },
    },
    payment: {
      list: { query: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 25 }) },
      unpaidInvoices: { query: vi.fn().mockResolvedValue([{ id: "inv-1", balance: "500.00" }]) },
      create: { mutate: vi.fn().mockResolvedValue({ id: "pay-1" }) },
    },
    expense: {
      list: { query: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 25 }) },
      categories: { query: vi.fn().mockResolvedValue(["Rent", "Travel"]) },
      create: { mutate: vi.fn().mockResolvedValue({ id: "exp-1" }) },
    },
  };
}

type FakeClient = ReturnType<typeof makeClient>;

function makeCtx(client: FakeClient, overrides: Partial<WebMcpToolContext> = {}) {
  const navigate = vi.fn();
  const invalidate = vi.fn();
  const ctx = {
    client: client as unknown as WebMcpToolContext["client"],
    role: "owner",
    businessId: "biz-1",
    businessName: "Sharma Traders",
    userName: "Asha",
    pathname: "/invoices",
    navigate,
    invalidate,
    ...overrides,
  } as WebMcpToolContext;
  return { ctx, navigate, invalidate };
}

const UUID_A = "3f1c2b90-4d2e-4a1b-9c77-0b2e9d5a1f44";
const UUID_B = "8a2d6f01-9c3e-4b52-8d10-6f4a7c2e1b33";

// ── Catalog-wide contract ──────────────────────────────────────

describe("WebMCP catalog — shape every tool must satisfy", () => {
  it("exposes the per-domain arrays and nothing else in webMcpTools", () => {
    const domains = [
      ...appTools,
      ...dashboardTools,
      ...invoiceTools,
      ...partyTools,
      ...itemTools,
      ...paymentTools,
      ...expenseTools,
    ];
    expect(webMcpTools).toHaveLength(domains.length);
    expect(webMcpTools.map((t) => t.name)).toEqual(domains.map((t) => t.name));
  });

  it("starts with orientation tools so the agent can find its bearings first", () => {
    expect(webMcpTools[0].name).toBe("hisaabo_context");
    expect(webMcpTools[1].name).toBe("app_navigate");
  });

  it("gives every tool a unique, spec-legal, snake_case name of at most 40 chars", () => {
    const names = webMcpTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(NAME_RE);
      expect(name.length).toBeLessThanOrEqual(40);
      expect(name).toBe(name.toLowerCase());
    }
  });

  it.each(webMcpTools.map((t) => [t.name, t] as const))(
    "%s has a substantive description",
    (_name, t) => {
      expect(t.description.trim().length).toBeGreaterThan(80);
      // First sentence should say what it does, not just name itself.
      expect(t.description.split(". ")[0].length).toBeGreaterThan(20);
    },
  );

  it.each(webMcpTools.map((t) => [t.name, t] as const))(
    "%s has a closed object inputSchema",
    (_name, t) => {
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.properties).toBeDefined();
      expect(Array.isArray(t.inputSchema.required)).toBe(true);
      expect(t.inputSchema.additionalProperties).toBe(false);
      // Every required key must actually be declared.
      for (const key of t.inputSchema.required ?? []) {
        expect(Object.keys(t.inputSchema.properties ?? {})).toContain(key);
      }
    },
  );

  it.each(webMcpTools.map((t) => [t.name, t] as const))(
    "%s is exactly one of read-only or consequential",
    (_name, t) => {
      const flags = [t.annotations.readOnlyHint, t.annotations.consequentialHint].filter(Boolean);
      expect(flags).toHaveLength(1);
    },
  );

  it("gates every write tool behind a create/update permission", () => {
    const writes = webMcpTools.filter((t) => t.annotations.consequentialHint);
    expect(writes.map((t) => t.name)).toEqual([
      "invoice_create",
      "invoice_update_status",
      "party_create",
      "item_create",
      "payment_create",
      "expense_create",
    ]);
    for (const t of writes) {
      expect(t.requires, `${t.name} must declare requires`).toBeDefined();
      expect(["create", "update"]).toContain(t.requires?.action);
      expect(t.requires?.resource.length).toBeGreaterThan(0);
    }
  });

  it("marks every non-write tool read-only, and every networked read as untrusted content", () => {
    for (const t of webMcpTools.filter((x) => !x.annotations.consequentialHint)) {
      expect(t.annotations.readOnlyHint).toBe(true);
      // The two local tools touch no third-party data; everything else does.
      const isLocal = t.name === "hisaabo_context" || t.name === "app_navigate";
      expect(t.annotations.untrustedContentHint ?? false).toBe(!isLocal);
      if (!isLocal) expect(t.requires?.action).toBe("read");
    }
  });

  it("ships no delete, settings, team or PDF tools", () => {
    for (const name of webMcpTools.map((t) => t.name)) {
      expect(name).not.toMatch(/delete|remove|pdf|download|settings|team|tenant|invite/);
    }
  });
});

// ── app tools ──────────────────────────────────────────────────

describe("hisaabo_context — local orientation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports the signed-in user, business and page without any network call", async () => {
    vi.setSystemTime(new Date(2026, 8, 14, 10, 0, 0)); // 14 Sep 2026, local
    const client = makeClient();
    const { ctx } = makeCtx(client);

    const out = (await tool("hisaabo_context").execute({}, ctx)) as Record<string, unknown>;

    expect(out.userName).toBe("Asha");
    expect(out.role).toBe("owner");
    expect(out.businessId).toBe("biz-1");
    expect(out.businessName).toBe("Sharma Traders");
    expect(out.currentPage).toBe("invoices");
    expect(out.todayIso).toBe("2026-09-14");
    expect(out.indianFinancialYear).toBe("2026-27");
    expect(out.currency).toBe("INR");
    expect(out.moneyFormat).toContain("1500.00");
    expect(Array.isArray(out.tips)).toBe(true);
    expect((out.tips as string[]).join(" ")).toContain("party_list");

    const procedures = Object.values(client).flatMap((router) =>
      Object.values(router as Record<string, { query?: unknown; mutate?: unknown }>),
    );
    expect(procedures.length).toBeGreaterThan(0);
    for (const proc of procedures) {
      expect(proc.query ?? proc.mutate).not.toHaveBeenCalled();
    }
  });

  it("falls back to the raw path for a screen outside the nav map", async () => {
    vi.setSystemTime(new Date(2026, 8, 14));
    const { ctx } = makeCtx(makeClient(), { pathname: "/pos" });
    const out = (await tool("hisaabo_context").execute({}, ctx)) as Record<string, unknown>;
    expect(out.currentPage).toBe("/pos");
  });

  it("rolls the Indian financial year on 1 April, not 1 January", () => {
    expect(indianFinancialYear(new Date(2026, 2, 31))).toBe("2025-26"); // 31 Mar 2026
    expect(indianFinancialYear(new Date(2026, 3, 1))).toBe("2026-27"); // 1 Apr 2026
    expect(indianFinancialYear(new Date(2026, 11, 31))).toBe("2026-27");
    expect(indianFinancialYear(new Date(2027, 0, 1))).toBe("2026-27");
    expect(indianFinancialYear(new Date(2099, 3, 1))).toBe("2099-00");
  });
});

describe("app_navigate — deep links into the SPA", () => {
  it("navigates to a page with no search params", async () => {
    const { ctx, navigate } = makeCtx(makeClient());
    const out = (await tool("app_navigate").execute({ page: "parties" }, ctx)) as Record<string, unknown>;
    expect(navigate).toHaveBeenCalledWith("/parties", undefined);
    expect(out.navigatedTo).toBe("/parties");
    expect(out.openedId).toBeNull();
  });

  it("maps 'dashboard' to the root route", async () => {
    const { ctx, navigate } = makeCtx(makeClient());
    await tool("app_navigate").execute({ page: "dashboard" }, ctx);
    expect(navigate).toHaveBeenCalledWith("/", undefined);
  });

  it("passes id as a search param for routes that accept one", async () => {
    const { ctx, navigate } = makeCtx(makeClient());
    const out = (await tool("app_navigate").execute({ page: "invoices", id: UUID_A }, ctx)) as Record<string, unknown>;
    expect(navigate).toHaveBeenCalledWith("/invoices", { id: UUID_A });
    expect(out).toEqual({ navigatedTo: "/invoices", page: "invoices", openedId: UUID_A });
  });

  it("refuses an id for a route whose validateSearch would reject it", async () => {
    const { ctx, navigate } = makeCtx(makeClient());
    await expect(tool("app_navigate").execute({ page: "items", id: UUID_A }, ctx)).rejects.toThrow(
      /cannot open a single record/,
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("rejects an unknown page instead of navigating somewhere arbitrary", async () => {
    const { ctx, navigate } = makeCtx(makeClient());
    await expect(tool("app_navigate").execute({ page: "admin" }, ctx)).rejects.toThrow(/Unknown page/);
    expect(navigate).not.toHaveBeenCalled();
  });
});

// ── dashboard ──────────────────────────────────────────────────

describe("dashboard_summary — named periods resolve to date ranges", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("turns 'this-month' into the first and last day of the current month", () => {
    vi.setSystemTime(new Date(2026, 8, 14, 13, 45)); // 14 Sep 2026
    const { fromDate, toDate } = resolvePeriod("this-month");

    const from = new Date(fromDate!);
    const to = new Date(toDate!);
    expect(from.getFullYear()).toBe(2026);
    expect(from.getMonth()).toBe(8);
    expect(from.getDate()).toBe(1);
    expect(from.getHours()).toBe(0);
    expect(to.getMonth()).toBe(8);
    expect(to.getDate()).toBe(30); // September has 30 days
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
  });

  it("handles 'last-month' across a year boundary", () => {
    vi.setSystemTime(new Date(2026, 0, 9)); // 9 Jan 2026
    const { fromDate, toDate } = resolvePeriod("last-month");
    const from = new Date(fromDate!);
    const to = new Date(toDate!);
    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2025, 11, 1]);
    expect([to.getFullYear(), to.getMonth(), to.getDate()]).toEqual([2025, 11, 31]);
  });

  it("anchors 'this-fy' to 1 April of the financial year in progress", () => {
    vi.setSystemTime(new Date(2026, 1, 20)); // 20 Feb 2026 → FY 2025-26
    const feb = resolvePeriod("this-fy");
    expect([new Date(feb.fromDate!).getFullYear(), new Date(feb.fromDate!).getMonth()]).toEqual([2025, 3]);
    expect(feb.toDate).toBeUndefined();

    vi.setSystemTime(new Date(2026, 5, 20)); // 20 Jun 2026 → FY 2026-27
    const jun = resolvePeriod("this-fy");
    expect([new Date(jun.fromDate!).getFullYear(), new Date(jun.fromDate!).getMonth()]).toEqual([2026, 3]);
  });

  it("covers the calendar quarter and year", () => {
    vi.setSystemTime(new Date(2026, 7, 5)); // 5 Aug 2026 → Q3 (Jul–Sep)
    const q = resolvePeriod("this-quarter");
    expect([new Date(q.fromDate!).getMonth(), new Date(q.fromDate!).getDate()]).toEqual([6, 1]);
    expect([new Date(q.toDate!).getMonth(), new Date(q.toDate!).getDate()]).toEqual([8, 30]);

    const y = resolvePeriod("this-year");
    expect([new Date(y.fromDate!).getMonth(), new Date(y.fromDate!).getDate()]).toEqual([0, 1]);
    expect([new Date(y.toDate!).getMonth(), new Date(y.toDate!).getDate()]).toEqual([11, 31]);
  });

  it("sends no range at all for 'all', which the API reads as all-time", async () => {
    expect(resolvePeriod("all")).toEqual({});
    const client = makeClient();
    const { ctx } = makeCtx(client);
    await tool("dashboard_summary").execute({ period: "all" }, ctx);
    expect(client.dashboard.summary.query).toHaveBeenCalledWith(undefined);
  });

  it("defaults to this-fy and echoes the resolved window back to the agent", async () => {
    vi.setSystemTime(new Date(2026, 8, 14));
    const client = makeClient();
    const { ctx } = makeCtx(client);

    const out = (await tool("dashboard_summary").execute({}, ctx)) as Record<string, unknown>;

    const arg = client.dashboard.summary.query.mock.calls[0][0] as { fromDate: string };
    expect(new Date(arg.fromDate).getMonth()).toBe(3);
    expect(out.period).toBe("this-fy");
    expect(out.totalSales).toBe("1000.00");
    expect(out.currency).toBe("INR");
  });
});

// ── invoices ───────────────────────────────────────────────────

describe("invoice tools", () => {
  let client: FakeClient;
  let ctx: WebMcpToolContext;

  beforeEach(() => {
    client = makeClient();
    ctx = makeCtx(client).ctx;
  });

  it("invoice_list caps the page size at 25 and forwards page and filters", async () => {
    const out = (await tool("invoice_list").execute(
      {
        type: "sale",
        status: ["sent", "partial"],
        partyId: UUID_A,
        search: "acme",
        sortBy: "amount",
        sortDir: "asc",
        page: 2,
      },
      ctx,
    )) as Record<string, unknown>;

    expect(client.invoice.list.query).toHaveBeenCalledWith({
      type: "sale",
      documentType: "invoice",
      status: ["sent", "partial"],
      partyId: UUID_A,
      fromDate: undefined,
      toDate: undefined,
      search: "acme",
      sortBy: "amount",
      sortDir: "asc",
      page: 2,
      limit: 25,
    });
    // total 60 over pages of 25 → page 2 is not the last.
    expect(out.hasMore).toBe(true);
  });

  it("invoice_list ignores an over-large page size the agent tries to smuggle in", async () => {
    await tool("invoice_list").execute({ limit: 500, page: 0 }, ctx);
    const arg = client.invoice.list.query.mock.calls[0][0] as { limit: number; page: number };
    expect(arg.limit).toBe(25);
    expect(arg.page).toBe(1);
    expect(arg).not.toHaveProperty("500");
  });

  it("invoice_list drops junk enum values rather than forwarding them", async () => {
    await tool("invoice_list").execute({ type: "refund", status: ["sent", "bogus"], sortBy: "colour" }, ctx);
    const arg = client.invoice.list.query.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.type).toBeUndefined();
    expect(arg.status).toEqual(["sent"]);
    expect(arg.sortBy).toBeUndefined();
  });

  it("invoice_get passes the id through as { id }", async () => {
    await tool("invoice_get").execute({ invoiceId: UUID_A }, ctx);
    expect(client.invoice.getById.query).toHaveBeenCalledWith({ id: UUID_A });
  });

  it("invoice_create forwards partyId, type and line items unchanged", async () => {
    const lineItems = [
      { itemName: "Web Design", quantity: "1.000", unitPrice: "15000.00", taxPercent: "18.00", itemId: UUID_B },
      { itemName: "Hosting", quantity: "12", unitPrice: "500.00" },
    ];

    const out = await tool("invoice_create").execute(
      { partyId: UUID_A, type: "sale", lineItems, dueDate: "2026-10-14T00:00:00.000Z" },
      ctx,
    );

    expect(client.invoice.create.mutate).toHaveBeenCalledTimes(1);
    const arg = client.invoice.create.mutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.partyId).toBe(UUID_A);
    expect(arg.type).toBe("sale");
    expect(arg.dueDate).toBe("2026-10-14T00:00:00.000Z");
    expect(arg.lineItems).toEqual([
      {
        itemName: "Web Design",
        quantity: "1.000",
        unitPrice: "15000.00",
        taxPercent: "18.00",
        discountPercent: undefined,
        itemId: UUID_B,
        description: undefined,
      },
      {
        itemName: "Hosting",
        quantity: "12",
        unitPrice: "500.00",
        taxPercent: undefined,
        discountPercent: undefined,
        itemId: undefined,
        description: undefined,
      },
    ]);
    expect(out).toEqual({ id: "inv-1", invoiceNumber: "INV-0001" });
  });

  it("invoice_create does not round, clamp or reformat money", async () => {
    await tool("invoice_create").execute(
      {
        partyId: UUID_A,
        type: "purchase",
        lineItems: [{ itemName: "Steel", quantity: "0.125", unitPrice: "9999999999999.99", taxPercent: "0" }],
        roundOff: "-0.25",
        invoiceDiscount: "10.00",
        invoiceDiscountType: "percent",
      },
      ctx,
    );
    const arg = client.invoice.create.mutate.mock.calls[0][0] as {
      lineItems: Array<Record<string, string>>;
      roundOff: string;
      invoiceDiscount: string;
      invoiceDiscountType: string;
    };
    expect(arg.lineItems[0].quantity).toBe("0.125");
    expect(arg.lineItems[0].unitPrice).toBe("9999999999999.99");
    expect(arg.roundOff).toBe("-0.25");
    expect(arg.invoiceDiscount).toBe("10.00");
    expect(arg.invoiceDiscountType).toBe("percent");
  });

  it("invoice_create refuses to call the API with no line items", async () => {
    await expect(
      tool("invoice_create").execute({ partyId: UUID_A, type: "sale", lineItems: [] }, ctx),
    ).rejects.toThrow(/line item/i);
    expect(client.invoice.create.mutate).not.toHaveBeenCalled();
  });

  it("invoice_update_status forwards id and status, and rejects an unknown status", async () => {
    await tool("invoice_update_status").execute({ invoiceId: UUID_A, status: "sent" }, ctx);
    expect(client.invoice.updateStatus.mutate).toHaveBeenCalledWith({ id: UUID_A, status: "sent" });

    await expect(
      tool("invoice_update_status").execute({ invoiceId: UUID_A, status: "void" }, ctx),
    ).rejects.toThrow(/status must be one of/);
    expect(client.invoice.updateStatus.mutate).toHaveBeenCalledTimes(1);
  });

  it("warns in its description that cancelling is hard to undo", () => {
    expect(tool("invoice_update_status").description).toMatch(/hard to undo/i);
  });
});

// ── parties ────────────────────────────────────────────────────

describe("party tools", () => {
  let client: FakeClient;
  let ctx: WebMcpToolContext;

  beforeEach(() => {
    client = makeClient();
    ctx = makeCtx(client).ctx;
  });

  it("party_list caps the page size and forwards the filter", async () => {
    await tool("party_list").execute({ filter: "outstanding", search: "acme", page: 3 }, ctx);
    expect(client.party.list.query).toHaveBeenCalledWith({
      type: undefined,
      filter: "outstanding",
      search: "acme",
      category: undefined,
      sortBy: undefined,
      sortDir: undefined,
      page: 3,
      limit: 25,
    });
  });

  it("party_get merges getById and getStats into a single response", async () => {
    const out = (await tool("party_get").execute({ partyId: UUID_A }, ctx)) as Record<string, unknown>;

    expect(client.party.getById.query).toHaveBeenCalledWith({ id: UUID_A });
    expect(client.party.getStats.query).toHaveBeenCalledWith({ id: UUID_A });
    expect(out).toEqual({
      party: { id: "p-1", name: "Acme", balance: "100.00" },
      stats: { invoiceCount: 12, paymentCount: 9 },
    });
  });

  it("party_get requires a party id", async () => {
    await expect(tool("party_get").execute({}, ctx)).rejects.toThrow(/partyId is required/);
    expect(client.party.getById.query).not.toHaveBeenCalled();
  });

  it("party_create forwards the identity fields and the numeric credit period", async () => {
    await tool("party_create").execute(
      {
        type: "customer",
        name: "Acme Traders",
        gstin: "22AAAAA0000A1Z5",
        creditPeriodDays: 30,
        openingBalance: "-500.00",
      },
      ctx,
    );
    const arg = client.party.create.mutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.type).toBe("customer");
    expect(arg.name).toBe("Acme Traders");
    expect(arg.gstin).toBe("22AAAAA0000A1Z5");
    expect(arg.creditPeriodDays).toBe(30);
    expect(arg.openingBalance).toBe("-500.00");
  });

  it("party_create rejects a bad type before touching the API", async () => {
    await expect(tool("party_create").execute({ type: "vendor", name: "X" }, ctx)).rejects.toThrow(
      /'customer' or 'supplier'/,
    );
    expect(client.party.create.mutate).not.toHaveBeenCalled();
  });
});

// ── items ──────────────────────────────────────────────────────

describe("item tools", () => {
  let client: FakeClient;
  let ctx: WebMcpToolContext;

  beforeEach(() => {
    client = makeClient();
    ctx = makeCtx(client).ctx;
  });

  it("item_list forwards the low-stock flag and caps the page size", async () => {
    await tool("item_list").execute({ search: "cement", lowStock: true, itemType: "product" }, ctx);
    expect(client.item.list.query).toHaveBeenCalledWith({
      search: "cement",
      category: undefined,
      itemType: "product",
      lowStock: true,
      page: 1,
      limit: 25,
    });
  });

  it("item_list leaves lowStock undefined when it is not a boolean", async () => {
    await tool("item_list").execute({ lowStock: "yes" }, ctx);
    const arg = client.item.list.query.mock.calls[0][0] as { lowStock?: boolean };
    expect(arg.lowStock).toBeUndefined();
  });

  it("item_get passes the id through as { id }", async () => {
    await tool("item_get").execute({ itemId: UUID_B }, ctx);
    expect(client.item.getById.query).toHaveBeenCalledWith({ id: UUID_B });
  });

  it("item_create forwards catalog fields verbatim", async () => {
    await tool("item_create").execute(
      {
        name: "OPC Cement 50kg",
        itemType: "product",
        unit: "bag",
        salePrice: "420.00",
        taxPercent: "28.00",
        stockQuantity: "100.000",
        taxInclusive: true,
      },
      ctx,
    );
    const arg = client.item.create.mutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.name).toBe("OPC Cement 50kg");
    expect(arg.unit).toBe("bag");
    expect(arg.salePrice).toBe("420.00");
    expect(arg.stockQuantity).toBe("100.000");
    expect(arg.taxInclusive).toBe(true);
  });

  it("item_create drops a unit outside the supported enum", async () => {
    await tool("item_create").execute({ name: "Widget", unit: "furlong" }, ctx);
    const arg = client.item.create.mutate.mock.calls[0][0] as { unit?: string };
    expect(arg.unit).toBeUndefined();
  });
});

// ── payments ───────────────────────────────────────────────────

describe("payment tools", () => {
  let client: FakeClient;
  let ctx: WebMcpToolContext;

  beforeEach(() => {
    client = makeClient();
    ctx = makeCtx(client).ctx;
  });

  it("payment_list caps the page size and forwards the party filter", async () => {
    await tool("payment_list").execute({ partyId: UUID_A, page: 2 }, ctx);
    expect(client.payment.list.query).toHaveBeenCalledWith({
      partyId: UUID_A,
      invoiceId: undefined,
      fromDate: undefined,
      toDate: undefined,
      search: undefined,
      page: 2,
      limit: 25,
    });
  });

  it("payment_unpaid_invoices returns the open set with a count", async () => {
    const out = (await tool("payment_unpaid_invoices").execute({ partyId: UUID_A }, ctx)) as Record<string, unknown>;
    expect(client.payment.unpaidInvoices.query).toHaveBeenCalledWith({ partyId: UUID_A });
    expect(out).toEqual({ data: [{ id: "inv-1", balance: "500.00" }], total: 1 });
  });

  it("payment_create sends a single-invoice payment with no allocations", async () => {
    await tool("payment_create").execute(
      { partyId: UUID_A, amount: "5000.00", mode: "upi", invoiceId: UUID_B, referenceNumber: "432198765432" },
      ctx,
    );
    const arg = client.payment.create.mutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.partyId).toBe(UUID_A);
    expect(arg.amount).toBe("5000.00");
    expect(arg.mode).toBe("upi");
    expect(arg.invoiceId).toBe(UUID_B);
    expect(arg.allocations).toBeUndefined();
    expect(arg.referenceNumber).toBe("432198765432");
  });

  it("payment_create sends a split payment as allocations", async () => {
    await tool("payment_create").execute(
      {
        partyId: UUID_A,
        amount: "12700.00",
        mode: "bank",
        allocations: [
          { invoiceId: UUID_B, amount: "7700.00" },
          { invoiceId: UUID_A, amount: "5000.00" },
        ],
      },
      ctx,
    );
    const arg = client.payment.create.mutate.mock.calls[0][0] as { allocations: unknown; invoiceId?: string };
    expect(arg.invoiceId).toBeUndefined();
    expect(arg.allocations).toEqual([
      { invoiceId: UUID_B, amount: "7700.00" },
      { invoiceId: UUID_A, amount: "5000.00" },
    ]);
  });

  it("payment_create rejects a missing amount or an unknown mode", async () => {
    await expect(tool("payment_create").execute({ partyId: UUID_A, mode: "upi" }, ctx)).rejects.toThrow(
      /amount is required/,
    );
    await expect(
      tool("payment_create").execute({ partyId: UUID_A, amount: "1.00", mode: "barter" }, ctx),
    ).rejects.toThrow(/mode must be one of/);
    expect(client.payment.create.mutate).not.toHaveBeenCalled();
  });

  it("explains single-invoice versus allocations in its description", () => {
    const d = tool("payment_create").description;
    expect(d).toMatch(/invoiceId/);
    expect(d).toMatch(/allocations/);
    expect(d).toMatch(/advance/i);
  });
});

// ── expenses ───────────────────────────────────────────────────

describe("expense tools", () => {
  let client: FakeClient;
  let ctx: WebMcpToolContext;

  beforeEach(() => {
    client = makeClient();
    ctx = makeCtx(client).ctx;
  });

  it("expense_list caps the page size and forwards the category", async () => {
    await tool("expense_list").execute({ category: "Rent", page: 2 }, ctx);
    expect(client.expense.list.query).toHaveBeenCalledWith({
      category: "Rent",
      search: undefined,
      fromDate: undefined,
      toDate: undefined,
      page: 2,
      limit: 25,
    });
  });

  it("expense_categories takes no arguments and returns the list with a count", async () => {
    const out = (await tool("expense_categories").execute({}, ctx)) as Record<string, unknown>;
    expect(client.expense.categories.query).toHaveBeenCalledWith();
    expect(out).toEqual({ categories: ["Rent", "Travel"], total: 2 });
    expect(tool("expense_categories").inputSchema.required).toEqual([]);
    expect(Object.keys(tool("expense_categories").inputSchema.properties ?? {})).toEqual([]);
  });

  it("expense_create forwards category, amount and mode", async () => {
    await tool("expense_create").execute(
      { category: "Rent", amount: "25000.00", mode: "bank", description: "Shop rent for September 2026" },
      ctx,
    );
    expect(client.expense.create.mutate).toHaveBeenCalledWith({
      category: "Rent",
      amount: "25000.00",
      mode: "bank",
      description: "Shop rent for September 2026",
      expenseDate: undefined,
      referenceNumber: undefined,
    });
  });

  it("expense_create rejects an empty category", async () => {
    await expect(
      tool("expense_create").execute({ category: "", amount: "1.00", mode: "cash" }, ctx),
    ).rejects.toThrow(/category is required/);
    expect(client.expense.create.mutate).not.toHaveBeenCalled();
  });
});
