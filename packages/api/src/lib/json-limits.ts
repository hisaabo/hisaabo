/**
 * Array-size guard for JSON request bodies.
 *
 * zod 3 validates every element of an array and keeps one issue object per
 * failing element, even when the schema has `.max()`: a 10 MB body of invalid
 * items exhausts the heap (GHSA-mrhx-c7xc-m3w5, fixed only in zod >= 4.6.6).
 * Until the API moves to zod 4, tRPC bodies are rejected before parsing when
 * any array, or all arrays together, exceed limits no real input comes near
 * (the largest legitimate input is a 5,000-row import).
 */

export const MAX_ARRAY_ITEMS = 10_000;
export const MAX_TOTAL_ARRAY_ITEMS = 200_000;

/** Bodies this small cannot hold an array of MAX_ARRAY_ITEMS ("1," per item). */
export const ARRAY_SCAN_MIN_BYTES = 16 * 1024;

/** True when `value` contains an oversized array or too many array items in total. */
export function exceedsArrayLimits(
  value: unknown,
  maxItems = MAX_ARRAY_ITEMS,
  maxTotal = MAX_TOTAL_ARRAY_ITEMS,
): boolean {
  let total = 0;
  // Iterative walk: deeply nested JSON must not overflow the stack.
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      if (v.length > maxItems) return true;
      total += v.length;
      if (total > maxTotal) return true;
      for (const item of v) if (item !== null && typeof item === "object") stack.push(item);
    } else if (v !== null && typeof v === "object") {
      for (const item of Object.values(v)) if (item !== null && typeof item === "object") stack.push(item);
    }
  }
  return false;
}
