import { describe, it, expect } from "vitest";
import { UQC_CODES, UQC_SERVICE, unitToUqc } from "../uqc.js";
import { units } from "../validators.js";

describe("unitToUqc", () => {
  it("every unit Hisaabo offers maps to a code on the UQC list", () => {
    const list: readonly string[] = UQC_CODES;
    for (const u of units) expect(list, u).toContain(unitToUqc(u));
  });

  it("the codes, by hand", () => {
    const expected: Record<(typeof units)[number], string> = {
      pcs: "NOS", kg: "KGS", g: "GMS", l: "LTR", ml: "MLT", m: "MTR", cm: "CMS", ft: "OTH", in: "OTH",
      box: "BOX", dozen: "DOZ", pair: "PRS", set: "SET", pkt: "PAC", bun: "BUN", pouch: "OTH", jar: "OTH",
      btl: "BTL", bag: "BAG", ton: "TON", pack: "PAC", pet: "NOS", person: "NOS", other: "OTH",
    };
    for (const u of units) expect(unitToUqc(u), u).toBe(expected[u]);
  });

  it("is case-insensitive and trims; no unit or an unknown unit is null", () => {
    expect(unitToUqc(" KG ")).toBe("KGS");
    expect(unitToUqc("Litres")).toBe("LTR");
    expect(unitToUqc(null)).toBeNull();
    expect(unitToUqc("")).toBeNull();
    expect(unitToUqc("carton")).toBeNull();
  });

  it("the list has no feet or inches, a service is NA, bunches and bundles are different codes", () => {
    const list: readonly string[] = UQC_CODES;
    expect(list).not.toContain("FTS");
    expect(list).not.toContain("FT");
    expect(list).not.toContain("INH");
    expect(list).toContain("BUN");
    expect(list).toContain("BDL");
    expect(UQC_SERVICE).toBe("NA");
    expect(new Set(list).size).toBe(list.length);
  });
});
