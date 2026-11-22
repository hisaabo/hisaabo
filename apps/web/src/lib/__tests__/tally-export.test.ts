import { describe, it, expect } from "vitest";
import {
  TALLY_EXPORT_ALL_TIME_FROM,
  countTallyVouchers,
  resolveTallyRange,
  tallyXmlBlob,
} from "../tally-export";

describe("resolveTallyRange", () => {
  const now = new Date("2026-11-22T08:15:00.000Z");

  it("passes explicit bounds through untouched", () => {
    const range = { fromDate: "2026-04-01T00:00:00.000Z", toDate: "2027-03-31T23:59:59.999Z" };
    expect(resolveTallyRange(range, now)).toEqual(range);
  });

  it("fills both bounds for the 'All' preset (no dates)", () => {
    expect(resolveTallyRange({}, now)).toEqual({
      fromDate: TALLY_EXPORT_ALL_TIME_FROM,
      toDate: "2026-11-22T23:59:59.999Z",
    });
  });

  it("fills only the missing bound", () => {
    expect(resolveTallyRange({ fromDate: "2026-04-01T00:00:00.000Z" }, now)).toEqual({
      fromDate: "2026-04-01T00:00:00.000Z",
      toDate: "2026-11-22T23:59:59.999Z",
    });
    expect(resolveTallyRange({ toDate: "2026-06-30T23:59:59.999Z" }, now)).toEqual({
      fromDate: TALLY_EXPORT_ALL_TIME_FROM,
      toDate: "2026-06-30T23:59:59.999Z",
    });
  });

  it("treats empty strings (an unfilled custom range) like missing bounds", () => {
    expect(resolveTallyRange({ fromDate: "", toDate: "" }, now).fromDate).toBe(TALLY_EXPORT_ALL_TIME_FROM);
  });

  it("produces datetimes the server schema (z.string().datetime()) accepts", () => {
    const { fromDate, toDate } = resolveTallyRange({}, now);
    for (const v of [fromDate, toDate]) {
      expect(new Date(v).toISOString()).toBe(v);
    }
  });

  it("ends 'today' on the UTC day, even late in the evening UTC", () => {
    expect(resolveTallyRange({}, new Date("2026-11-22T23:30:00.000Z")).toDate).toBe("2026-11-22T23:59:59.999Z");
  });
});

describe("countTallyVouchers", () => {
  it("counts VOUCHER elements and ignores ledger masters", () => {
    const xml = [
      '<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Cash" ACTION="Create"></LEDGER></TALLYMESSAGE>',
      '<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Create"></VOUCHER></TALLYMESSAGE>',
      '<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Receipt" ACTION="Create"></VOUCHER></TALLYMESSAGE>',
    ].join("\n");
    expect(countTallyVouchers(xml)).toBe(2);
  });

  it("does not count VOUCHERTYPENAME / VOUCHERNUMBER tags", () => {
    const xml = "<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>1</VOUCHERNUMBER>";
    expect(countTallyVouchers(xml)).toBe(0);
  });

  it("is zero for an empty export", () => {
    expect(countTallyVouchers("<ENVELOPE></ENVELOPE>")).toBe(0);
  });
});

describe("tallyXmlBlob", () => {
  it("is an XML blob with the document untouched (no BOM before the XML prolog)", async () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE></ENVELOPE>';
    const blob = tallyXmlBlob(xml);
    expect(blob.type).toBe("application/xml;charset=utf-8");
    // jsdom's Blob has no .text()
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(text).toBe(xml);
  });
});
