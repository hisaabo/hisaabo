import { describe, it, expect } from "vitest";
import { renderOgPng, OG_WIDTH, OG_HEIGHT } from "../lib/og/render.js";
import type { OgModel } from "../lib/og/types.js";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Read the IHDR width/height from a PNG buffer. */
function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("renderOgPng (satori + resvg-wasm pipeline)", () => {
  it("renders a valid 1200×630 PNG, including a Devanagari name", async () => {
    const model: OgModel = {
      storeName: "मेरी बेकरी", // exercises the Devanagari font fallback
      tagline: "Fresh bread daily — हिसाब, पक्का",
      accentColor: "#5b5bd6",
      currency: "INR",
      logoDataUri: null,
      sellers: [
        { name: "Croissant", price: "₹120", imageDataUri: null },
        { name: "ब्रेड", price: "₹40", imageDataUri: null },
      ],
      storeUrl: "store.hisaabo.in/my-bakery",
    };

    const png = await renderOgPng(model);
    expect(png.length).toBeGreaterThan(1000);
    expect([...png.subarray(0, 8)]).toEqual(PNG_MAGIC);

    const { width, height } = pngSize(png);
    expect(width).toBe(OG_WIDTH);
    expect(height).toBe(OG_HEIGHT);
  });

  it("renders with no sellers (cold-start store)", async () => {
    const png = await renderOgPng({
      storeName: "New Shop",
      tagline: null,
      accentColor: "#0a7",
      currency: "INR",
      logoDataUri: null,
      sellers: [],
      storeUrl: "store.hisaabo.in/new-shop",
    });
    expect([...png.subarray(0, 8)]).toEqual(PNG_MAGIC);
  });
});
