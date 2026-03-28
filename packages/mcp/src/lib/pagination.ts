/**
 * Pagination helpers for MCP tool responses.
 *
 * AI agents process the full result set returned by a tool call, so list tools
 * enforce a hard cap per page to keep context window usage bounded. See ADR-005.
 *
 * The default cap is 25 records. Operators may raise it (max 50) via the
 * HISAABO_MCP_PAGE_SIZE environment variable.
 */

const envCap = parseInt(process.env.HISAABO_MCP_PAGE_SIZE ?? "25", 10);

/** Maximum records per tool call response. */
export const MAX_PAGE_SIZE = Math.min(Math.max(isNaN(envCap) ? 25 : envCap, 1), 50);

/**
 * Add pagination metadata to a list result so agents know whether to
 * call the tool again with a higher page number.
 */
export function withPaginationMeta<T>(
  result: { data: T[]; total: number; page: number; limit: number },
): { data: T[]; total: number; page: number; limit: number; hasMore: boolean } {
  return {
    ...result,
    hasMore: result.total > result.page * result.limit,
  };
}

/**
 * Build the input for a list call with the enforced page size.
 * Agents pass page (1-indexed); this returns the full input object.
 */
export function pageInput(page: number): { page: number; limit: number } {
  return { page, limit: MAX_PAGE_SIZE };
}
