/**
 * Quantity formatting shared across web, mobile, desktop and PDF generation.
 *
 * WHY THIS FILE EXISTS:
 * Line-item quantities are stored as fixed-precision numeric strings (e.g.
 * "2.000", "2.500", "0.125"). Rendering the raw string puts trailing zeros in
 * front of the user on every invoice — "2.000 kg" reads as noise. We want the
 * quantity to read like a human would write it:
 *   - a whole number shows no decimals       (2.000  → "2")
 *   - a fractional number shows only what it needs, up to 3 places, with
 *     trailing zeros trimmed                  (2.500  → "2.5", 0.125 → "0.125")
 *   - more than 3 decimals round to 3         (2.1256 → "2.126")
 * Three decimals matches the column precision the rest of the app stores
 * (e.g. stock adjustments use toFixed(3)).
 *
 * WHY Intl.NumberFormat (not toLocaleString / toFixed):
 * Intl.NumberFormat("en-IN") is already the engine path the currency
 * formatters use on every platform — crucially it is reliable on Hermes
 * (Android release builds), where Number.prototype.toLocaleString with a
 * locale argument is not. It also gives us Indian-style grouping for free, so
 * large quantities read as "10,000" rather than "10000", consistent with how
 * money is shown.
 */

const quantityFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

export function formatQuantity(quantity: string | number): string {
  const num = typeof quantity === "string" ? parseFloat(quantity) : quantity;
  if (!Number.isFinite(num)) return "0";
  return quantityFormatter.format(num);
}
