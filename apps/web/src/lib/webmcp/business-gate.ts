/**
 * The business WebMCP tools may write into. Every tool call sends
 * `x-business-id`, so tools register only once the app has resolved the active
 * business (and it still exists in the loaded list). No first-business
 * fallback: guessing could point an agent at the wrong books.
 */
export function resolveWebMcpBusinessId(
  currentBusinessId: string | null | undefined,
  businesses: ReadonlyArray<{ id: string }> | null | undefined,
): string | null {
  if (!currentBusinessId) return null;
  if (businesses && !businesses.some((b) => b.id === currentBusinessId)) return null;
  return currentBusinessId;
}
