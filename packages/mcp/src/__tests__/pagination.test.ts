import { describe, it, expect } from "vitest";
import { withPaginationMeta, pageInput, MAX_PAGE_SIZE } from "../lib/pagination.js";

describe("withPaginationMeta", () => {
  it("sets hasMore=true when total exceeds current page window", () => {
    const result = withPaginationMeta({
      data: Array.from({ length: 25 }, (_, i) => i),
      total: 60,
      page: 1,
      limit: 25,
    });

    expect(result.hasMore).toBe(true);
    expect(result.total).toBe(60);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(25);
  });

  it("sets hasMore=false when total fits within current page window", () => {
    const result = withPaginationMeta({
      data: Array.from({ length: 10 }, (_, i) => i),
      total: 10,
      page: 1,
      limit: 25,
    });

    expect(result.hasMore).toBe(false);
  });

  it("sets hasMore=false on the last page", () => {
    // 50 total, page 2 with limit 25 means page*limit = 50, which is not > 50
    const result = withPaginationMeta({
      data: Array.from({ length: 25 }, (_, i) => i),
      total: 50,
      page: 2,
      limit: 25,
    });

    expect(result.hasMore).toBe(false);
  });

  it("sets hasMore=true when one more page is needed", () => {
    // 51 total, page 2 with limit 25 means page*limit = 50, and 51 > 50
    const result = withPaginationMeta({
      data: Array.from({ length: 25 }, (_, i) => i),
      total: 51,
      page: 2,
      limit: 25,
    });

    expect(result.hasMore).toBe(true);
  });

  it("preserves the original data array", () => {
    const data = [{ id: "a" }, { id: "b" }];
    const result = withPaginationMeta({ data, total: 2, page: 1, limit: 25 });

    expect(result.data).toEqual(data);
  });
});

describe("pageInput", () => {
  it("returns the given page number with MAX_PAGE_SIZE as limit", () => {
    const input = pageInput(3);

    expect(input).toEqual({ page: 3, limit: MAX_PAGE_SIZE });
  });

  it("returns page 1 with the enforced page size", () => {
    const input = pageInput(1);

    expect(input.page).toBe(1);
    expect(input.limit).toBe(MAX_PAGE_SIZE);
  });
});

describe("MAX_PAGE_SIZE", () => {
  it("is a positive number no greater than 50", () => {
    expect(MAX_PAGE_SIZE).toBeGreaterThan(0);
    expect(MAX_PAGE_SIZE).toBeLessThanOrEqual(50);
  });
});
