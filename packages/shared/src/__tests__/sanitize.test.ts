import { describe, it, expect } from "vitest";
import { csvCell, csvRow, stripControlChars } from "../sanitize.js";

describe("csvCell", () => {
  it("quotes and doubles embedded quotes", () => {
    expect(csvCell('Smith, "Bob"')).toBe('"Smith, ""Bob"""');
  });
  it("neutralises formula prefixes", () => {
    for (const v of ["=1+1", "+cmd", "-cmd", "@SUM(A1)", "\tx", "\rx"]) {
      expect(csvCell(v).startsWith(`"'`)).toBe(true);
    }
  });
  it("leaves plain negative numbers alone", () => {
    expect(csvCell(-5)).toBe('"-5"');
    expect(csvCell("-12.50")).toBe('"-12.50"');
  });
  it("handles null/undefined", () => {
    expect(csvRow([null, undefined, "a"])).toBe('"","","a"');
  });
});

describe("stripControlChars", () => {
  it("removes escape sequences introducers and bidi overrides", () => {
    expect(stripControlChars("a\x1b]52;c;Zm9v\x07b")).not.toContain("\x1b");
    expect(stripControlChars("a‮b")).toBe("a�b");
    expect(stripControlChars("tab\there\nnl")).toBe("tab\there\nnl");
  });
});
