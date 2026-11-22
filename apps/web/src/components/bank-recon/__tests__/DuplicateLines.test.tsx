import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  DuplicateLinesNotice,
  SkipDuplicatesToggle,
  importSummaryMessage,
  type SkippedDuplicateLine,
} from "../DuplicateLines";

describe("importSummaryMessage", () => {
  const base = { totalLines: 5, matchedLines: 2, unmatchedLines: 3 };

  it("keeps the original wording when nothing was skipped", () => {
    expect(importSummaryMessage({ ...base, duplicatesSkipped: 0 })).toBe(
      "Parsed 5 lines. 2 auto-matched, 3 unmatched.",
    );
  });

  it("appends the duplicate count (singular and plural)", () => {
    expect(importSummaryMessage({ ...base, duplicatesSkipped: 1 })).toBe(
      "Parsed 5 lines. 2 auto-matched, 3 unmatched. 1 duplicate line skipped.",
    );
    expect(importSummaryMessage({ ...base, duplicatesSkipped: 4 })).toContain("4 duplicate lines skipped.");
  });
});

describe("DuplicateLinesNotice", () => {
  it("renders nothing when no duplicates were skipped", () => {
    const { container } = render(<DuplicateLinesNotice count={0} importedLines={12} />);
    expect(container.firstChild).toBeNull();
  });

  it("announces how many lines were skipped", () => {
    render(<DuplicateLinesNotice count={3} importedLines={7} />);
    expect(screen.getByRole("status").textContent).toContain("3 duplicate lines were skipped");
    expect(screen.queryByText(/Nothing new was imported/)).toBeNull();
  });

  it("uses singular wording for one line", () => {
    render(<DuplicateLinesNotice count={1} importedLines={7} />);
    expect(screen.getByRole("status").textContent).toContain("1 duplicate line was skipped");
  });

  it("says nothing new was imported when every line was a duplicate", () => {
    render(<DuplicateLinesNotice count={9} importedLines={0} />);
    expect(screen.getByText(/Nothing new was imported from this file/)).toBeTruthy();
  });
});

describe("DuplicateLinesNotice: skipped-line review list", () => {
  const lines: SkippedDuplicateLine[] = [
    {
      lineNumber: 1,
      transactionDate: new Date("2026-04-02T00:00:00.000Z"),
      debit: "0.00",
      credit: "50000.00",
      referenceNumber: "NEFT222",
      narration: "NEFT/SALARY/ACME",
      existingImportId: "imp-1",
      existingImportFileName: "hdfc-jan-mar.csv",
    },
    {
      lineNumber: 4,
      transactionDate: "2026-04-03T00:00:00.000Z",
      debit: "2000.00",
      credit: "0.00",
      referenceNumber: null,
      narration: "ATM/WDL/HDFC",
      existingImportId: "imp-2",
      existingImportFileName: "hdfc-mar.csv",
    },
  ];

  it("lists each skipped line with its date, amounts, narration and the import that holds it", () => {
    render(<DuplicateLinesNotice count={2} importedLines={5} lines={lines} />);

    expect(screen.getByText("Review skipped lines")).toBeTruthy();
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows).toHaveLength(2);

    const first = within(rows[0]!);
    expect(first.getByText("1")).toBeTruthy();
    expect(first.getByText("NEFT/SALARY/ACME")).toBeTruthy();
    expect(first.getByText("Ref NEFT222")).toBeTruthy();
    expect(first.getByText(/50,000\.00/)).toBeTruthy(); // credit; debit shows an em dash
    expect(first.getByText("hdfc-jan-mar.csv")).toBeTruthy();

    const second = within(rows[1]!);
    expect(second.getByText(/2,000\.00/)).toBeTruthy();
    expect(second.queryByText(/^Ref /)).toBeNull();
    expect(second.getByText("hdfc-mar.csv")).toBeTruthy();
  });

  it("says when the list is shorter than the count (the server caps it)", () => {
    render(<DuplicateLinesNotice count={520} importedLines={0} lines={lines} />);
    expect(screen.getByText("Showing the first 2 of 520 skipped lines.")).toBeTruthy();
  });

  it("does not claim truncation when every skipped line is listed", () => {
    render(<DuplicateLinesNotice count={2} importedLines={5} lines={lines} />);
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it("shows only the summary when there is no list", () => {
    render(<DuplicateLinesNotice count={2} importedLines={5} />);
    expect(screen.queryByText(/Review skipped/)).toBeNull();
    render(<DuplicateLinesNotice count={2} importedLines={5} lines={[]} />);
    expect(screen.queryByText(/Review skipped/)).toBeNull();
  });
});

describe("SkipDuplicatesToggle", () => {
  it("reflects the checked state and reports changes", () => {
    const onChange = vi.fn();
    render(<SkipDuplicatesToggle checked onChange={onChange} />);

    const box = screen.getByRole("checkbox", { name: /Skip lines already imported/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);

    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
