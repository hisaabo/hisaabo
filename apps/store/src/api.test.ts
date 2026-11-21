import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchItemsByIds } from "./api";
import type { StoreItem } from "./types";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mkItem = (id: string): StoreItem => ({
  id,
  name: `Item ${id}`,
  price: "1.00",
  unit: "pcs",
  inStock: true,
  sortOrder: 0,
  itemMode: "simple",
});
const page = (items: StoreItem[]) => ({ business: { name: "S", currency: "INR" }, items, categories: [], total: items.length, page: 1, limit: 24 });
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: URL) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(new URL(String(input), "http://store.test")));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const requestedIds = (url: URL) => (url.searchParams.get("ids") ?? "").split(",");

describe("fetchItemsByIds", () => {
  it("asks for the ids and returns the matching items", async () => {
    const fetchMock = stubFetch((url) => jsonResponse(page(requestedIds(url).map(mkItem))));
    const items = await fetchItemsByIds("shop", [uuid(1), uuid(2)]);
    expect(items.map((i) => i.id)).toEqual([uuid(1), uuid(2)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]![0]), "http://store.test");
    expect(url.pathname).toMatch(/\/shop\/catalog\.json$/);
    expect(url.searchParams.get("ids")).toBe(`${uuid(1)},${uuid(2)}`);
  });

  it("sorts the ids in the URL, so the same set is the same cache key", async () => {
    const fetchMock = stubFetch((url) => jsonResponse(page(requestedIds(url).map(mkItem))));
    await fetchItemsByIds("shop", [uuid(9), uuid(2), uuid(5)]);
    await fetchItemsByIds("shop", [uuid(5), uuid(9), uuid(2)]);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe(urls[1]);
    expect(new URL(urls[0]!, "http://store.test").searchParams.get("ids")).toBe([uuid(2), uuid(5), uuid(9)].join(","));
  });

  it("filters to the requested ids when the API ignores ids and returns its first page", async () => {
    const firstPage = Array.from({ length: 24 }, (_, i) => mkItem(uuid(i + 100)));
    stubFetch(() => jsonResponse(page(firstPage)));
    expect(await fetchItemsByIds("shop", [uuid(1)])).toEqual([]);
    expect((await fetchItemsByIds("shop", [uuid(103), uuid(1)])).map((i) => i.id)).toEqual([uuid(103)]);
  });

  it("splits more than 50 ids into several requests and combines the results", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => uuid(i));
    const fetchMock = stubFetch((url) => jsonResponse(page(requestedIds(url).map(mkItem))));
    const items = await fetchItemsByIds("shop", ids);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const url = new URL(String(call[0]), "http://store.test");
      expect(requestedIds(url).length).toBeLessThanOrEqual(50);
    }
    expect(items.map((i) => i.id).sort()).toEqual([...ids].sort());
  });

  it("makes no request for no ids", async () => {
    const fetchMock = stubFetch(() => jsonResponse(page([])));
    expect(await fetchItemsByIds("shop", [])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when any request fails", async () => {
    stubFetch(() => jsonResponse({ error: "nope" }, 500));
    await expect(fetchItemsByIds("shop", [uuid(1)])).rejects.toThrow();
  });
});
