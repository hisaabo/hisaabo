/**
 * App-level tools — orientation and navigation.
 *
 * These two are the only tools that touch no network: `hisaabo_context` answers
 * "where am I, who am I, what do dates and money look like here" from data the
 * SPA already holds, and `app_navigate` moves the user's tab so a human can see
 * what the agent is talking about. Everything else in the catalog is a tRPC call.
 */

import type { WebMcpToolDefinition } from "../types";
import { enumOf, localIsoDate, noInput, objectSchema, str, uuid } from "./shared";

/**
 * Sidebar routes (see `navSections` in `apps/web/src/routes/__root.tsx`) keyed
 * by the enum value the agent passes.
 *
 * `supportsId` marks the routes whose `validateSearch` accepts `?id=<uuid>` and
 * therefore open a specific record in the detail panel. The rest ignore search
 * params, so passing `id` for them is rejected rather than silently dropped.
 */
const PAGES = {
  dashboard: { path: "/", supportsId: false },
  invoices: { path: "/invoices", supportsId: true },
  quotations: { path: "/quotations", supportsId: true },
  "sales-returns": { path: "/sales-returns", supportsId: true },
  "credit-notes": { path: "/credit-notes", supportsId: true },
  "delivery-challans": { path: "/delivery-challans", supportsId: true },
  "proforma-invoices": { path: "/proforma-invoices", supportsId: true },
  "store-orders": { path: "/store-orders", supportsId: false },
  "automated-invoices": { path: "/automated-invoices", supportsId: false },
  parties: { path: "/parties", supportsId: false },
  items: { path: "/items", supportsId: false },
  payments: { path: "/payments", supportsId: true },
  "cash-and-bank": { path: "/cash-and-bank", supportsId: false },
  expenses: { path: "/expenses", supportsId: false },
  shipments: { path: "/shipments", supportsId: false },
  gst: { path: "/gst", supportsId: false },
  gstr2b: { path: "/gstr2b", supportsId: false },
  itc: { path: "/itc", supportsId: false },
  "eway-bills": { path: "/eway-bills", supportsId: false },
  reports: { path: "/reports", supportsId: false },
  settings: { path: "/settings", supportsId: false },
} as const;

export type PageKey = keyof typeof PAGES;

const PAGE_KEYS = Object.keys(PAGES) as PageKey[];

/** Pages that accept `?id=` — quoted in the tool description so the agent knows. */
const ID_PAGES = PAGE_KEYS.filter((k) => PAGES[k].supportsId);

/**
 * Indian financial year label for a date: April 1 – March 31, written the way
 * Indian accountants write it ("2026-27"). April 2026 → "2026-27";
 * March 2026 → "2025-26".
 */
export function indianFinancialYear(d: Date): string {
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Reverse-map the current SPA path to a page key, when it is one of ours. */
function pageKeyForPath(pathname: string): PageKey | null {
  return PAGE_KEYS.find((key) => PAGES[key].path === pathname) ?? null;
}

const hisaaboContext: WebMcpToolDefinition = {
  name: "hisaabo_context",
  title: "Hisaabo context",
  description: [
    "Read who is signed in, which business is active, what page they are on, and the conventions every other Hisaabo tool uses. Call this first in a session — before any other tool — so you do not have to guess the user's role, the current financial year, or the money format.",
    "Answers locally from the already-loaded app state: no network call, no permissions needed.",
    "Money everywhere in Hisaabo is a decimal string with exactly the digits you mean — '1500.00', never 1500, never '₹1,500'. Dates sent to tools are ISO 8601 date-times ('2026-04-01T00:00:00.000Z'); the Indian financial year runs 1 April to 31 March.",
    "Example response: { userName: 'Asha', role: 'owner', businessId: '…', businessName: 'Sharma Traders', currentPage: 'invoices', todayIso: '2026-09-14', indianFinancialYear: '2026-27', currency: 'INR', moneyFormat: \"decimal strings e.g. '1500.00'\", tips: [...] }",
  ].join(" "),
  inputSchema: noInput(),
  annotations: { readOnlyHint: true },
  execute: async (_input, ctx) => {
    const now = new Date();
    return {
      userName: ctx.userName,
      role: ctx.role,
      businessId: ctx.businessId,
      businessName: ctx.businessName,
      currentPage: pageKeyForPath(ctx.pathname) ?? ctx.pathname,
      currentPath: ctx.pathname,
      todayIso: localIsoDate(now),
      indianFinancialYear: indianFinancialYear(now),
      currency: "INR",
      moneyFormat: "decimal strings e.g. '1500.00'",
      tips: [
        "Resolve names to UUIDs first: party_list before invoice_create or payment_create, item_list before linking invoice line items.",
        "Never invent a UUID. If party_list finds no match, create the party with party_create (or ask the user) instead of guessing.",
        "Quantities allow 3 decimals ('7.500'); money and tax rates allow 2 ('18.00').",
        "Record money received with payment_create, not by forcing an invoice to 'paid' — payment_create updates the invoice status itself.",
        "Before allocating a payment, call payment_unpaid_invoices for that party to see the outstanding balance per invoice.",
        "List tools return at most 25 rows; page through with page+1 while 'hasMore' is true rather than widening filters.",
        "Use app_navigate to put the relevant screen in front of the user when you report a result they will want to check.",
      ],
    };
  },
};

const appNavigate: WebMcpToolDefinition = {
  name: "app_navigate",
  title: "Open a Hisaabo page",
  description: [
    "Move the user's open Hisaabo tab to a page, optionally opening one record. Use it when the user asks to 'show', 'open' or 'go to' something, and after a write so they can see what was created.",
    "This only changes the view — it reads and writes nothing. To get data, use the list/get tools instead; navigating does not return the page's contents.",
    `Only these pages open a specific record via 'id': ${ID_PAGES.join(", ")}. For any other page, omit 'id' (passing one is an error). The 'id' must be the UUID of a record of that page's own type — an invoice UUID for 'invoices', a payment UUID for 'payments'.`,
    "Example: { page: 'invoices', id: '3f1c2b90-4d2e-4a1b-9c77-0b2e9d5a1f44' } opens /invoices?id=3f1c…",
  ].join(" "),
  inputSchema: objectSchema(
    {
      page: {
        type: "string",
        enum: PAGE_KEYS,
        description:
          "Which Hisaabo screen to open. 'dashboard' is the home overview; 'gst' is GST returns / tax reports; 'reports' is business reports; 'cash-and-bank' is cash and bank accounts.",
      },
      id: uuid(
        `UUID of the record to open in the detail panel. Only valid for: ${ID_PAGES.join(", ")}.`,
      ),
    },
    ["page"],
  ),
  annotations: { readOnlyHint: true },
  execute: async (input, ctx) => {
    const key = enumOf(input.page, PAGE_KEYS);
    if (!key) {
      throw new Error(`Unknown page. Choose one of: ${PAGE_KEYS.join(", ")}.`);
    }
    const target = PAGES[key];
    const id = str(input.id);
    if (id && !target.supportsId) {
      throw new Error(
        `The '${key}' page cannot open a single record. Pages that accept 'id': ${ID_PAGES.join(", ")}.`,
      );
    }
    ctx.navigate(target.path, id ? { id } : undefined);
    return { navigatedTo: target.path, page: key, openedId: id ?? null };
  },
};

export const appTools: WebMcpToolDefinition[] = [hisaaboContext, appNavigate];
