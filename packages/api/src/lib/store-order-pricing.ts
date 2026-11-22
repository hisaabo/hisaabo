/**
 * Pricing of an online-store order's lines (the public `POST /store/:slug/order`).
 *
 * The store prices a line from the item's SAVED price, which may INCLUDE GST ("Price includes
 * tax"). The order total the customer sees is computed on that inclusive price, exactly
 * (`calcLineItem` with `taxInclusive`, integer paise): the order and its invoice carry the
 * inclusive total. The invoice LINE, however, must hold the tax-exclusive rate, like every other
 * bill line: the invoice editor, the PDF and `invoice.update` all take `unit_price` as the taxable
 * rate and add the GST on top. Storing the inclusive price there (what 0.10.0 did) made any later
 * edit of the invoice (say a quantity change) tax the price a second time.
 *
 * So each row keeps the exact inclusive `taxAmount` / `totalAmount` (totals unchanged) and gets
 * `unitPrice` = the exclusive rate of the saved price at the line's GST rate
 * (118.00 incl. 18% -> 100.00; see shared/inclusive-price.ts). Tax-exclusive items are untouched.
 */
import { billRateFromItemPrice, calcInvoiceTotals, calcLineItem, type InvoiceTotals } from "@hisaabo/shared";

export interface StoreOrderLineInput {
  itemId: string;
  quantity: string;
  /** The saved price used for this line: store price, sale price, unit's or variant's price. */
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
  /** The saved price includes tax. */
  taxInclusive: boolean;
  name: string;
  selectedUnit?: string;
  conversionFactor?: string;
  variantId?: string;
}

export interface StoreOrderInvoiceLine {
  itemId: string;
  itemName: string;
  description: null;
  quantity: string;
  /** The tax-exclusive rate: GST is added on top of it when the invoice is edited. */
  unitPrice: string;
  taxPercent: string;
  taxAmount: string;
  discountPercent: string;
  totalAmount: string;
  conversionFactor: string;
  selectedUnit: string | null;
  variantId: string | null;
}

export function priceStoreOrderLines(lines: readonly StoreOrderLineInput[]): {
  totals: InvoiceTotals;
  rows: StoreOrderInvoiceLine[];
} {
  const totals = calcInvoiceTotals({
    lineItems: lines.map((li) => ({
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      taxPercent: li.taxPercent,
      discountPercent: li.discountPercent,
      taxInclusive: li.taxInclusive,
    })),
  });

  const rows = lines.map((li) => {
    const calc = calcLineItem({
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      taxPercent: li.taxPercent,
      discountPercent: li.discountPercent,
      taxInclusive: li.taxInclusive,
    });
    const rate = billRateFromItemPrice({ price: li.unitPrice, inclusive: li.taxInclusive, taxPercent: li.taxPercent }).rate;
    return {
      itemId: li.itemId,
      // Online store orders: snapshot the item name into the required itemName column. Notes stay
      // null: store customers don't submit per-line comments.
      itemName: li.name,
      description: null,
      quantity: li.quantity,
      unitPrice: rate,
      taxPercent: li.taxPercent,
      taxAmount: calc.taxAmount,
      discountPercent: "0",
      totalAmount: calc.total,
      conversionFactor: li.conversionFactor ?? "1",
      selectedUnit: li.selectedUnit ?? null,
      variantId: li.variantId ?? null,
    };
  });

  return { totals, rows };
}
