/**
 * gst-state.ts: the ONE decision about which state a record is in and whether a supply is intra- or
 * inter-state. GSTIN state first, then the stored code, then the name; legacy codes mapped (28 -> 37,
 * 25 -> 26); invalid codes ignored; a code that disagrees with the GSTIN is reported as a conflict.
 */
import { describe, it, expect } from "vitest";
import {
  GST_STATE_NAMES,
  isValidStateCode,
  canonicalStateCode,
  stateCodeOfGstin,
  stateCodeOfName,
  resolveState,
  supplyKind,
  isIntraStateSupply,
} from "../gst-state.js";
import { createPartySchema, createBusinessSchema } from "../validators.js";

describe("the state code table", () => {
  it.each(["01", "07", "19", "24", "26", "27", "29", "30", "33", "36", "37", "38", "96", "97", "25", "28"])("%s is valid", (code) => {
    expect(isValidStateCode(code)).toBe(true);
  });

  it.each(["00", "39", "40", "50", "99", "1", "7", "ab", "2a", "", " ", "270"])("%j is not", (code) => {
    expect(isValidStateCode(code)).toBe(false);
  });

  it("null and undefined are not valid", () => {
    expect(isValidStateCode(null)).toBe(false);
    expect(isValidStateCode(undefined)).toBe(false);
  });

  it("has every state and UT of 01-38 except the two legacy codes, plus 96 and 97", () => {
    const codes = Object.keys(GST_STATE_NAMES);
    for (let n = 1; n <= 38; n++) {
      const c = String(n).padStart(2, "0");
      if (c === "25" || c === "28") expect(codes).not.toContain(c);
      else expect(codes).toContain(c);
    }
    expect(codes).toContain("96");
    expect(codes).toContain("97");
  });

  it("maps the legacy codes to the current ones: 28 (Andhra Pradesh before the division) is 37, 25 (Daman & Diu) is 26", () => {
    expect(canonicalStateCode("28")).toBe("37");
    expect(canonicalStateCode("37")).toBe("37");
    expect(canonicalStateCode("25")).toBe("26");
    expect(canonicalStateCode("26")).toBe("26");
    expect(canonicalStateCode("27")).toBe("27");
    expect(canonicalStateCode("50")).toBeNull();
    expect(canonicalStateCode("00")).toBeNull();
  });
});

describe("the state of a GSTIN and of a name", () => {
  it.each([
    ["29AABCG0000R1ZM", "29"],
    ["27aabcu9603r1zm", "27"],
    ["28AABCA0000R1ZM", "37"], // legacy Andhra Pradesh GSTIN
    ["37AABCA0000R1ZM", "37"],
    ["96AABCG0000R1ZM", "96"],
    ["URP", null],
    ["", null],
    ["00AABCG0000R1ZM", null],
    ["50AABCG0000R1ZM", null],
    ["XXAABCG0000R1ZM", null],
    [null, null],
  ])("GSTIN %j -> %j", (gstin, code) => {
    expect(stateCodeOfGstin(gstin)).toBe(code);
  });

  it.each([
    ["Maharashtra", "27"],
    ["  maharashtra ", "27"],
    ["Andhra Pradesh", "37"],
    ["Andhra Pradesh (New)", "37"],
    ["Orissa", "21"],
    ["Jammu & Kashmir", "01"],
    ["Jammu and Kashmir", "01"],
    ["Daman & Diu", "26"],
    ["Andaman & Nicobar Islands", "35"],
    ["Other Country", "96"],
    ["Narnia", null],
    ["", null],
    [null, null],
  ])("name %j -> %j", (name, code) => {
    expect(stateCodeOfName(name)).toBe(code);
  });
});

describe("resolveState: GSTIN, then stored code, then name", () => {
  it("the GSTIN wins; the stored code is not needed", () => {
    expect(resolveState({ gstin: "29AABCG0000R1ZM" })).toMatchObject({ code: "29", source: "gstin", conflict: null });
  });

  it("a stored code that disagrees with the GSTIN is a conflict, and the GSTIN still decides", () => {
    const r = resolveState({ gstin: "29AABCG0000R1ZM", stateCode: "27" });
    expect(r.code).toBe("29");
    expect(r.conflict).toEqual({ gstinCode: "29", storedCode: "27" });
  });

  it("a legacy stored code is not a conflict with the current GSTIN code: 28 and 37 are the same state", () => {
    expect(resolveState({ gstin: "37AABCA0000R1ZM", stateCode: "28" })).toMatchObject({ code: "37", conflict: null });
    expect(resolveState({ gstin: "28AABCA0000R1ZM", stateCode: "37" })).toMatchObject({ code: "37", conflict: null });
  });

  it("falls back to the stored code, then to the name", () => {
    expect(resolveState({ stateCode: "27", state: "Karnataka" })).toMatchObject({ code: "27", source: "stateCode" });
    expect(resolveState({ state: "Karnataka" })).toMatchObject({ code: "29", source: "stateName" });
    expect(resolveState({})).toMatchObject({ code: null, source: null });
    expect(resolveState(null)).toMatchObject({ code: null, source: null });
  });

  it("an invalid stored code is ignored and reported ('00', '50'), never compared", () => {
    expect(resolveState({ stateCode: "50", state: "Maharashtra" })).toMatchObject({ code: "27", source: "stateName", invalidStoredCode: "50" });
    expect(resolveState({ gstin: "29AABCG0000R1ZM", stateCode: "00" })).toMatchObject({ code: "29", invalidStoredCode: "00", conflict: null });
    expect(resolveState({ stateCode: "00" })).toMatchObject({ code: null, invalidStoredCode: "00" });
  });

  it("rawCode is what the record carries (sent to the IRP / NIC), code is what is compared: a legacy 28 stays 28 in rawCode, is 37 in code", () => {
    expect(resolveState({ gstin: "28AABCA0000R1ZM" })).toMatchObject({ code: "37", rawCode: "28" });
    expect(resolveState({ stateCode: "28" })).toMatchObject({ code: "37", rawCode: "28" });
    expect(resolveState({ gstin: "29AABCG0000R1ZM", stateCode: "27" })).toMatchObject({ code: "29", rawCode: "29" });
    expect(resolveState({ state: "Orissa" })).toMatchObject({ code: "21", rawCode: "21" });
    expect(resolveState({})).toMatchObject({ code: null, rawCode: null });
  });

  it("96 is foreign, from the GSTIN or the stored code", () => {
    expect(resolveState({ stateCode: "96" }).foreign).toBe(true);
    expect(resolveState({ gstin: "96AABCG0000R1ZM" }).foreign).toBe(true);
    expect(resolveState({ stateCode: "27" }).foreign).toBe(false);
  });
});

describe("supplyKind / isIntraStateSupply", () => {
  const mh = { gstin: "27AABCU9603R1ZM", stateCode: "27", state: "Maharashtra" };

  it("same state is intra, different is inter", () => {
    expect(supplyKind(mh, { stateCode: "27" })).toBe("intra");
    expect(supplyKind(mh, { stateCode: "29" })).toBe("inter");
    expect(isIntraStateSupply(mh, { stateCode: "27" })).toBe(true);
    expect(isIntraStateSupply(mh, { stateCode: "29" })).toBe(false);
  });

  it("a party with a GSTIN and no state data is decided by the GSTIN", () => {
    expect(supplyKind(mh, { gstin: "27AABCM0000R1ZM" })).toBe("intra");
    expect(supplyKind(mh, { gstin: "29AABCG0000R1ZM" })).toBe("inter");
    expect(supplyKind({ gstin: "27AABCU9603R1ZM" }, { gstin: "27AABCM0000R1ZM" })).toBe("intra"); // a business with only a GSTIN
  });

  it("the GSTIN beats a wrong stored code on either side", () => {
    expect(supplyKind(mh, { gstin: "29AABCG0000R1ZM", stateCode: "27" })).toBe("inter");
    expect(supplyKind({ gstin: "27AABCU9603R1ZM", stateCode: "29" }, { stateCode: "27" })).toBe("intra");
  });

  it("Andhra Pradesh: the legacy 28 and the current 37 are one state", () => {
    expect(supplyKind({ stateCode: "37" }, { stateCode: "28" })).toBe("intra");
    expect(supplyKind({ stateCode: "28" }, { stateCode: "37" })).toBe("intra");
    expect(supplyKind({ stateCode: "28" }, { gstin: "37AABCA0000R1ZM" })).toBe("intra");
    expect(supplyKind({ state: "Andhra Pradesh" }, { stateCode: "28" })).toBe("intra");
    expect(supplyKind({ stateCode: "37" }, { stateCode: "36" })).toBe("inter"); // Telangana
  });

  it("names settle it when there is no code", () => {
    expect(supplyKind({ state: "Maharashtra" }, { state: "MAHARASHTRA" })).toBe("intra");
    expect(supplyKind({ state: "Maharashtra" }, { state: "Delhi" })).toBe("inter");
    expect(supplyKind({ state: "Narnia" }, { state: "narnia" })).toBe("intra"); // unknown names: compared as text
    expect(supplyKind({ state: "Narnia" }, { state: "Archenland" })).toBe("inter");
  });

  it("an undecidable supply is intra-state, the supplier's own state (the place of supply when the recipient's location is not on record)", () => {
    expect(supplyKind(mh, {})).toBe("unknown");
    expect(supplyKind(mh, null)).toBe("unknown");
    expect(supplyKind({}, {})).toBe("unknown");
    expect(isIntraStateSupply(mh, {})).toBe(true);
  });

  it("for clean data (valid codes, no GSTIN) the answer is exactly 'the codes are equal after mapping legacy ones', for every pair", () => {
    const codes = [...Object.keys(GST_STATE_NAMES), "25", "28"].filter((c) => c !== "96" && c !== "97");
    for (const a of codes) {
      for (const b of codes) {
        expect(isIntraStateSupply({ stateCode: a }, { stateCode: b })).toBe(canonicalStateCode(a) === canonicalStateCode(b));
      }
    }
  });
});

describe("validators reject a state code that is not in the table", () => {
  const party = { type: "customer" as const, name: "P" };
  it.each(["00", "50", "99", "39", "ab"])("party stateCode %j is rejected", (stateCode) => {
    expect(createPartySchema.safeParse({ ...party, stateCode }).success).toBe(false);
  });
  it.each(["27", "28", "37", "38", "97", "96", "25", ""])("party stateCode %j is accepted", (stateCode) => {
    expect(createPartySchema.safeParse({ ...party, stateCode }).success).toBe(true);
  });
  it("business stateCode too", () => {
    const biz = { name: "B", pan: "AABCU9603R", phone: "9876543210", address: "1 Road" };
    expect(createBusinessSchema.safeParse({ ...biz, stateCode: "50" }).success).toBe(false);
    expect(createBusinessSchema.safeParse({ ...biz, stateCode: "27" }).success).toBe(true);
  });
});
