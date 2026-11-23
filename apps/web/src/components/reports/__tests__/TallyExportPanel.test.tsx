/**
 * TallyExportPanel — Reports > Tally Export.
 *
 * Covers: downloads Tally Prime XML from reports.tallyExport (never the
 * deprecated CSV procedure party.tallyExport), nothing is fetched until the
 * button is clicked, the "All" preset gets the bounds the server requires,
 * and the empty / error outcomes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { fetchTallyExport, toastApi, createdBlobs } = vi.hoisted(() => ({
  fetchTallyExport: vi.fn(),
  toastApi: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  createdBlobs: [] as Blob[],
}));

// Only reports.tallyExport exists on this mock: touching party.tallyExport
// (the deprecated CSV endpoint) would throw.
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ reports: { tallyExport: { fetch: fetchTallyExport } } }),
  },
}));

vi.mock("@/hooks/useToast", () => ({ toast: toastApi }));

import { TallyExportPanel } from "../TallyExportPanel";
import { TALLY_EXPORT_UNBOUNDED_FROM, TALLY_EXPORT_UNBOUNDED_TO } from "@/lib/tally-export";

const XML_ONE_VOUCHER = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<ENVELOPE>",
  '<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Cash" ACTION="Create"></LEDGER></TALLYMESSAGE>',
  '<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Create"></VOUCHER></TALLYMESSAGE>',
  "</ENVELOPE>",
].join("\n");

let anchorClick: ReturnType<typeof vi.spyOn>;
let downloadedAs: string | null;

// jsdom's Blob has no .text()
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  createdBlobs.length = 0;
  downloadedAs = null;
  localStorage.clear();

  URL.createObjectURL = vi.fn((blob: Blob) => {
    createdBlobs.push(blob);
    return "blob:tally";
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  anchorClick = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      downloadedAs = this.download;
    });
});

afterEach(() => {
  anchorClick.mockRestore();
});

describe("TallyExportPanel", () => {
  it("describes the export as Tally Prime XML, not CSV", () => {
    render(<TallyExportPanel />);
    expect(screen.getByText("Tally Prime XML")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download Tally XML/ })).toBeTruthy();
    expect(screen.queryByText(/CSV/)).toBeNull();
  });

  it("fetches nothing until the button is clicked", () => {
    render(<TallyExportPanel />);
    expect(fetchTallyExport).not.toHaveBeenCalled();
  });

  it("downloads the XML returned by reports.tallyExport under the server's filename", async () => {
    fetchTallyExport.mockResolvedValue({ xml: XML_ONE_VOUCHER, filename: "tally-export-2026-04-01-to-2026-11-22.xml" });
    render(<TallyExportPanel />);

    fireEvent.click(screen.getByRole("button", { name: /Download Tally XML/ }));

    await waitFor(() => expect(toastApi.success).toHaveBeenCalledTimes(1));
    expect(toastApi.success.mock.calls[0]![0]).toBe("Tally export downloaded — 1 voucher");

    // Default preset is "This FY": both bounds are explicit ISO datetimes.
    const arg = fetchTallyExport.mock.calls[0]![0] as { fromDate: string; toDate: string };
    expect(arg.fromDate).toMatch(/^\d{4}-03-31T18:30:00\.000Z$/); // 1 April 00:00 IST
    expect(new Date(arg.toDate).toISOString()).toBe(arg.toDate);

    expect(downloadedAs).toBe("tally-export-2026-04-01-to-2026-11-22.xml");
    expect(createdBlobs).toHaveLength(1);
    expect(createdBlobs[0]!.type).toBe("application/xml;charset=utf-8");
    expect(await readBlob(createdBlobs[0]!)).toBe(XML_ONE_VOUCHER);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:tally");
  });

  it("'All' is unbounded on both sides (future-dated vouchers included) and is saved as tally-export-all.xml", async () => {
    localStorage.setItem("hisaabo-daterange-tally-export", "all");
    fetchTallyExport.mockResolvedValue({
      xml: XML_ONE_VOUCHER,
      filename: "tally-export-1900-01-01-to-9999-12-31.xml",
    });
    render(<TallyExportPanel />);
    expect(screen.getByText(/Every voucher on record, including future-dated entries/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Download Tally XML/ }));

    await waitFor(() => expect(fetchTallyExport).toHaveBeenCalledTimes(1));
    expect(fetchTallyExport.mock.calls[0]![0]).toEqual({
      fromDate: TALLY_EXPORT_UNBOUNDED_FROM,
      toDate: TALLY_EXPORT_UNBOUNDED_TO,
    });
    await waitFor(() => expect(downloadedAs).toBe("tally-export-all.xml"));
  });

  it("does not show the 'every voucher' note for a bounded preset", () => {
    render(<TallyExportPanel />); // default preset: This FY
    expect(screen.queryByText(/Every voucher on record/)).toBeNull();
  });

  it("does not download an empty export, and says why", async () => {
    fetchTallyExport.mockResolvedValue({
      xml: '<ENVELOPE><TALLYMESSAGE><LEDGER NAME="Cash"></LEDGER></TALLYMESSAGE></ENVELOPE>',
      filename: "x.xml",
    });
    render(<TallyExportPanel />);

    fireEvent.click(screen.getByRole("button", { name: /Download Tally XML/ }));

    await waitFor(() => expect(toastApi.info).toHaveBeenCalledTimes(1));
    expect(toastApi.info.mock.calls[0]![0]).toBe("No vouchers found");
    expect(anchorClick).not.toHaveBeenCalled();
    expect(toastApi.success).not.toHaveBeenCalled();
  });

  it("shows an error toast and re-enables the button when the export fails", async () => {
    fetchTallyExport.mockRejectedValue(new Error("boom"));
    render(<TallyExportPanel />);

    const button = screen.getByRole("button", { name: /Download Tally XML/ });
    fireEvent.click(button);

    await waitFor(() => expect(toastApi.error).toHaveBeenCalledWith("Export failed"));
    expect((screen.getByRole("button", { name: /Download Tally XML/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(anchorClick).not.toHaveBeenCalled();
  });
});
