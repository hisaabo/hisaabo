/**
 * Maps a ledger entry type (document type or "payment") to the list page that
 * opens its detail panel via `?id=`. Debit notes and purchase returns have no
 * dedicated page; their detail opens from the invoices page.
 */
const DOCUMENT_ROUTES = {
  payment: "/payments",
  invoice: "/invoices",
  purchase: "/invoices",
  credit_note: "/credit-notes",
  sales_return: "/sales-returns",
  purchase_return: "/invoices",
  debit_note: "/invoices",
} as const;

export type DocumentRoute = (typeof DOCUMENT_ROUTES)[keyof typeof DOCUMENT_ROUTES];

export function documentRouteFor(type: string): DocumentRoute {
  return (DOCUMENT_ROUTES as Record<string, DocumentRoute>)[type] ?? "/invoices";
}
