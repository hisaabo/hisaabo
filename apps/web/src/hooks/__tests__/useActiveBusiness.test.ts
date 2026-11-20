/**
 * Tests for useActiveBusiness (hooks/useActiveBusiness.ts): pages must follow
 * the business selected in the sidebar, not businesses[0], and re-render when
 * the user switches business.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const mockListQuery = vi.fn();
vi.mock("@/lib/trpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trpc")>();
  return {
    getBusinessId: actual.getBusinessId,
    setBusinessId: actual.setBusinessId,
    subscribeBusinessId: actual.subscribeBusinessId,
    trpc: { business: { list: { useQuery: () => mockListQuery() } } },
  };
});

import { setBusinessId } from "@/lib/trpc";
import { isGstRegisteredBusiness, useActiveBusiness } from "@/hooks/useActiveBusiness";

const businesses = [
  { id: "biz-gst", name: "GST Co", gstRegistrationType: "regular", gstin: "27AAAAA0000A1Z5" },
  { id: "biz-plain", name: "Plain Co", gstRegistrationType: "unregistered", gstin: null },
];

describe("useActiveBusiness", () => {
  beforeEach(() => {
    mockListQuery.mockReturnValue({ data: businesses, isLoading: false });
    setBusinessId(null);
  });

  it("falls back to the first business before one is selected", () => {
    const { result } = renderHook(() => useActiveBusiness());
    expect(result.current.businessId).toBe("biz-gst");
    expect(result.current.isGstRegistered).toBe(true);
  });

  it("returns the selected business, not businesses[0]", () => {
    setBusinessId("biz-plain");
    const { result } = renderHook(() => useActiveBusiness());
    expect(result.current.business?.name).toBe("Plain Co");
    expect(result.current.isGstRegistered).toBe(false);
  });

  it("re-renders when the business is switched", () => {
    setBusinessId("biz-gst");
    const { result } = renderHook(() => useActiveBusiness());
    expect(result.current.isGstRegistered).toBe(true);
    act(() => setBusinessId("biz-plain"));
    expect(result.current.businessId).toBe("biz-plain");
    expect(result.current.isGstRegistered).toBe(false);
  });
});

describe("isGstRegisteredBusiness", () => {
  it("treats a business with a GSTIN as registered", () => {
    expect(isGstRegisteredBusiness({ gstRegistrationType: "unregistered", gstin: "X" })).toBe(true);
  });
  it("treats unregistered without GSTIN as not registered", () => {
    expect(isGstRegisteredBusiness({ gstRegistrationType: "unregistered", gstin: null })).toBe(false);
  });
  it("defaults to registered while loading", () => {
    expect(isGstRegisteredBusiness(undefined)).toBe(true);
  });
});
