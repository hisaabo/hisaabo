import { describe, it, expect } from "vitest";
import { buildConfirmMappingInput, type BankMappingFields } from "../bank-recon-confirm";

const MAPPING: BankMappingFields = {
  date: "0",
  narration: "1",
  debit: "3",
  credit: "4",
  amount: "",
  type: "",
  reference: "2",
  balance: "5",
  dateFormat: "DD/MM/YYYY",
  skipRows: "1",
};

const base = { importId: "imp-1", csvContent: "a,b", mapping: MAPPING };

describe("buildConfirmMappingInput", () => {
  // The server default for skipDuplicates is off (so 0.10.0 clients that never
  // send it keep importing every line); this client must always say what it wants.
  it("always sends skipDuplicates explicitly, true or false", () => {
    const on = buildConfirmMappingInput({ ...base, skipDuplicates: true });
    const off = buildConfirmMappingInput({ ...base, skipDuplicates: false });

    expect("skipDuplicates" in on).toBe(true);
    expect(on.skipDuplicates).toBe(true);
    expect("skipDuplicates" in off).toBe(true);
    expect(off.skipDuplicates).toBe(false);
  });

  it("turns the form's string values into the numeric column mapping", () => {
    const input = buildConfirmMappingInput({ ...base, skipDuplicates: true });
    expect(input.columnMapping).toEqual({
      date: 0,
      narration: 1,
      debit: 3,
      credit: 4,
      amount: undefined,
      type: undefined,
      reference: 2,
      balance: 5,
      dateFormat: "DD/MM/YYYY",
      skipRows: 1,
    });
  });

  it("passes the template id only when one is chosen", () => {
    expect(buildConfirmMappingInput({ ...base, skipDuplicates: true, templateId: "tmpl-1" }).templateId).toBe("tmpl-1");
    expect(buildConfirmMappingInput({ ...base, skipDuplicates: true, templateId: "" }).templateId).toBeUndefined();
    expect(buildConfirmMappingInput({ ...base, skipDuplicates: true }).templateId).toBeUndefined();
  });
});
