import { describe, expect, it } from "vitest";
import { accentInk, accentTokens, contrastRatio, parseHex, textOnAccent, type Rgb } from "./color";

const WHITE: Rgb = [255, 255, 255];

describe("parseHex", () => {
  it("reads 6- and 3-digit hex and rejects the rest", () => {
    expect(parseHex("#2f7d4f")).toEqual([47, 125, 79]);
    expect(parseHex("#FFF")).toEqual([255, 255, 255]);
    expect(parseHex("red")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex(undefined)).toBeNull();
  });
});

describe("accent tokens", () => {
  it("picks dark text on a light accent and white text on a dark one", () => {
    expect(textOnAccent(parseHex("#f5c518")!)).not.toBe("#ffffff");
    expect(textOnAccent(parseHex("#1e3a8a")!)).toBe("#ffffff");
  });

  it("makes the accent readable as text on white for any accent", () => {
    for (const hex of ["#f5c518", "#ffd166", "#7dd3fc", "#5b5bd6", "#2f7d4f", "#e11d48", "#00ff00"]) {
      const ink = parseHex(accentInk(parseHex(hex)!))!;
      expect(contrastRatio(ink, WHITE), hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("leaves an accent that already reads well alone", () => {
    expect(accentInk(parseHex("#1e3a8a")!)).toBe("#1e3a8a");
  });

  it("keeps text on the accent at AA for any accent", () => {
    for (const hex of ["#f5c518", "#7dd3fc", "#5b5bd6", "#2f7d4f", "#e11d48", "#ff8800"]) {
      const accent = parseHex(hex)!;
      const text = parseHex(textOnAccent(accent))!;
      expect(contrastRatio(accent, text), hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("builds a full token set, or none for a non-hex colour", () => {
    expect(accentTokens("#2f7d4f")).toMatchObject({ accent: "#2f7d4f", text: "#ffffff" });
    expect(accentTokens("rebeccapurple")).toBeNull();
  });
});
