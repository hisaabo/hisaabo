import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DuplicateLinesNotice,
  SkipDuplicatesToggle,
  importSummaryMessage,
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
