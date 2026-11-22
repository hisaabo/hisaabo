import { describe, it, expect } from "vitest";
import {
  TALLY_EXPORT_UNBOUNDED_FROM,
  TALLY_EXPORT_UNBOUNDED_TO,
  countTallyVouchers,
  resolveTallyRange,
  tallyExportFilename,
  tallyXmlBlob,
} from "../tally-export";

describe("resolveTallyRange", () => {
  it("passes explicit bounds through untouched", () => {
    const range = { fromDate: "2026-04-01T00:00:00.000Z", toDate: "2027-03-31T23:59:59.999Z" };
    expect(resolveTallyRange(range)).toEqual(range);
  });

  it("makes the 'All' preset (no dates) unbounded on both sides", () => {
    expect(resolveTallyRange({})).toEqual({
      fromDate: TALLY_EXPORT_UNBOUNDED_FROM,
      toDate: TALLY_EXPORT_UNBOUNDED_TO,
    });
  });

  it("leaves nothing out: the unbounded range covers future-dated entries too", () => {
    const { toDate, fromDate } = resolveTallyRange({});
    // Not "end of today": a voucher dated years ahead is inside the range.
    expect(new Date(toDate).getTime()).toBeGreaterThan(new Date("2100-01-01").getTime());
    expect(new Date(fromDate).getTime()).toBeLessThan(new Date("1971-01-01").getTime());
  });

  it("opens only the missing side", () => {
    expect(resolveTallyRange({ fromDate: "2026-04-01T00:00:00.000Z" })).toEqual({
      fromDate: "2026-04-01T00:00:00.000Z",
      toDate: TALLY_EXPORT_UNBOUNDED_TO,
    });
    expect(resolveTallyRange({ toDate: "2026-06-30T23:59:59.999Z" })).toEqual({
      fromDate: TALLY_EXPORT_UNBOUNDED_FROM,
      toDate: "2026-06-30T23:59:59.999Z",
    });
  });

  it("treats empty strings (an unfilled custom range) like missing bounds", () => {
    expect(resolveTallyRange({ fromDate: "", toDate: "" })).toEqual(resolveTallyRange({}));
  });

  it("produces datetimes the server schema (z.string().datetime()) accepts", () => {
    const { fromDate, toDate } = resolveTallyRange({});
    for (const v of [fromDate, toDate]) {
      expect(new Date(v).toISOString()).toBe(v);
    }
  });
});

describe("tallyExportFilename", () => {
  const server = "tally-export-2026-04-01-to-2027-03-31.xml";

  it("keeps the server's name when both bounds were given", () => {
    expect(
      tallyExportFilename({ fromDate: "2026-04-01T00:00:00.000Z", toDate: "2027-03-31T23:59:59.999Z" }, server),
    ).toBe(server);
  });

  it("names an unbounded 'All' export plainly instead of 1900-01-01-to-9999-12-31", () => {
    expect(tallyExportFilename({}, "tally-export-1900-01-01-to-9999-12-31.xml")).toBe("tally-export-all.xml");
    expect(tallyExportFilename({ fromDate: "", toDate: "" }, "x.xml")).toBe("tally-export-all.xml");
  });

  it("names a half-open range after the side that was given", () => {
    expect(tallyExportFilename({ fromDate: "2026-04-01T00:00:00.000Z" }, "x.xml")).toBe(
      "tally-export-2026-04-01-to-latest.xml",
    );
    expect(tallyExportFilename({ toDate: "2026-06-30T23:59:59.999Z" }, "x.xml")).toBe(
      "tally-export-start-to-2026-06-30.xml",
    );
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
