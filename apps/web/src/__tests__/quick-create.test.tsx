/**
 * Quick Create Components Test Suite
 *
 * Tests the quick-create flow introduced for inline party and item creation
 * from Combobox dropdowns in invoice forms. Covers three areas:
 *
 *   1. Combobox `onCreateNew` prop — sticky "Create new" footer row
 *   2. QuickPartyCreate modal — name + phone required, type-based title
 *   3. QuickItemCreate modal — name + unit required, invoice-type-aware price label
 *
 * Follows the asterisk-counting pattern from form-validation.test.tsx.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox, type ComboboxOption } from "../components/ui/Combobox";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/trpc", () => ({
  trpc: {
    party: {
      create: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    item: {
      create: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    useUtils: () => ({
      party: { list: { invalidate: vi.fn() } },
      item: { list: { invalidate: vi.fn() } },
    }),
  },
}));

vi.mock("@/hooks/useToast", () => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  });
  return { toast, useToastListener: () => ({ toasts: [], dismiss: vi.fn() }) };
});

// Lazy-import the components that depend on mocked modules
// (they must be imported AFTER vi.mock calls are hoisted)
const { QuickPartyCreate } = await import(
  "../components/QuickPartyCreate"
);
const { QuickItemCreate } = await import(
  "../components/QuickItemCreate"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

const SAMPLE_OPTIONS: ComboboxOption[] = [
  { value: "1", label: "Gupta Enterprises" },
  { value: "2", label: "Sharma Traders" },
  { value: "3", label: "Patel & Sons" },
];

/** Count visible asterisks within a rendered container. */
function countAsterisks(container: HTMLElement): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let count = 0;
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent || "";
    const matches = text.match(/\*/g);
    if (matches) count += matches.length;
  }
  return count;
}

/** Open a Combobox by focusing its input. */
function openCombobox(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[role="combobox"]'
  )!;
  fireEvent.focus(input);
  return input;
}

// ── 1. Combobox onCreateNew prop ─────────────────────────────────────────────

describe("Combobox — onCreateNew prop", () => {
  it("does NOT render a create row when onCreateNew is not provided", () => {
    const { container } = render(
      <Combobox
        value=""
        onChange={() => {}}
        options={SAMPLE_OPTIONS}
        placeholder="Search..."
      />
    );

    openCombobox(container);

    expect(screen.queryByText(/Create new/)).toBeNull();
  });

  it("renders a create row when onCreateNew IS provided and dropdown is open", () => {
    const handleCreate = vi.fn();
    const { container } = render(
      <Combobox
        value=""
        onChange={() => {}}
        options={SAMPLE_OPTIONS}
        onCreateNew={handleCreate}
      />
    );

    openCombobox(container);

    expect(screen.getByText("Create new")).toBeInTheDocument();
  });

  it('shows Create new "query text" when the user types a query', async () => {
    const handleCreate = vi.fn();
    const { container } = render(
      <Combobox
        value=""
        onChange={() => {}}
        options={SAMPLE_OPTIONS}
        onCreateNew={handleCreate}
      />
    );

    const input = openCombobox(container);
    await userEvent.type(input, "Acme Corp");

    expect(screen.getByText(/Create new "Acme Corp"/)).toBeInTheDocument();
  });

  it('shows "No matches found" instead of emptyMessage when onCreateNew is provided and no options match', async () => {
    const handleCreate = vi.fn();
    const { container } = render(
      <Combobox
        value=""
        onChange={() => {}}
        options={SAMPLE_OPTIONS}
        onCreateNew={handleCreate}
        emptyMessage="Nothing here"
      />
    );

    const input = openCombobox(container);
    // Type something that matches no option
    await userEvent.type(input, "ZZZZZ");

    // Should show the create-specific "No matches found" message
    expect(screen.getByText("No matches found")).toBeInTheDocument();
    // Should NOT show the custom emptyMessage
    expect(screen.queryByText("Nothing here")).toBeNull();
  });

  it("fires onCreateNew with the current query when the create row is clicked", async () => {
    const handleCreate = vi.fn();
    const { container } = render(
      <Combobox
        value=""
        onChange={() => {}}
        options={SAMPLE_OPTIONS}
        onCreateNew={handleCreate}
      />
    );

    const input = openCombobox(container);
    await userEvent.type(input, "New Party");

    // The create row is an <li> — use mouseDown (as the component uses onMouseDown)
    const createRow = screen.getByText(/Create new "New Party"/);
    fireEvent.mouseDown(createRow);

    expect(handleCreate).toHaveBeenCalledOnce();
    expect(handleCreate).toHaveBeenCalledWith("New Party");
  });

  it("supports a custom createNewLabel", () => {
    const handleCreate = vi.fn();
    const { container } = render(
      <Combobox
        value=""
        onChange={() => {}}
        options={SAMPLE_OPTIONS}
        onCreateNew={handleCreate}
        createNewLabel="Add party"
      />
    );

    openCombobox(container);

    expect(screen.getByText("Add party")).toBeInTheDocument();
  });
});

// ── 2. QuickPartyCreate ──────────────────────────────────────────────────────

describe("QuickPartyCreate", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onCreated: vi.fn(),
  };

  it('renders with title "New Customer" when defaultType is customer', () => {
    render(<QuickPartyCreate {...defaultProps} defaultType="customer" />);
    expect(screen.getByText("New Customer")).toBeInTheDocument();
  });

  it('renders with title "New Supplier" when defaultType is supplier', () => {
    render(<QuickPartyCreate {...defaultProps} defaultType="supplier" />);
    expect(screen.getByText("New Supplier")).toBeInTheDocument();
  });

  it('defaults to "New Customer" when defaultType is not specified', () => {
    render(<QuickPartyCreate {...defaultProps} />);
    expect(screen.getByText("New Customer")).toBeInTheDocument();
  });

  it('"Create & Select" button is disabled when name is empty', () => {
    render(<QuickPartyCreate {...defaultProps} />);
    const btn = screen.getByText("Create & Select");
    expect(btn).toBeDisabled();
  });

  it('"Create & Select" button is disabled when phone is empty', async () => {
    render(<QuickPartyCreate {...defaultProps} />);

    // Fill name but leave phone empty
    const nameInput = screen.getByPlaceholderText("Party name");
    await userEvent.type(nameInput, "Test Party");

    const btn = screen.getByText("Create & Select");
    expect(btn).toBeDisabled();
  });

  it('"Create & Select" button is enabled when both name and phone are filled', async () => {
    render(<QuickPartyCreate {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("Party name"), "Test Party");
    await userEvent.type(screen.getByPlaceholderText("Phone number"), "9876543210");

    const btn = screen.getByText("Create & Select");
    expect(btn).toBeEnabled();
  });

  it("renders exactly one asterisk per required field (Name, Phone = 2 total)", () => {
    const { baseElement } = render(<QuickPartyCreate {...defaultProps} />);
    // The modal is portalled to document.body, so we need to search the full baseElement
    const dialog = baseElement.querySelector('[role="dialog"]')!;
    expect(countAsterisks(dialog as HTMLElement)).toBe(2);
  });
});

// ── 3. QuickItemCreate ───────────────────────────────────────────────────────

describe("QuickItemCreate", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onCreated: vi.fn(),
  };

  it('renders with title "New Item"', () => {
    render(<QuickItemCreate {...defaultProps} />);
    expect(screen.getByText("New Item")).toBeInTheDocument();
  });

  it('shows "Sale Price" label when invoiceType is sale', () => {
    render(<QuickItemCreate {...defaultProps} invoiceType="sale" />);
    expect(screen.getByText("Sale Price")).toBeInTheDocument();
  });

  it('shows "Purchase Price" label when invoiceType is purchase', () => {
    render(<QuickItemCreate {...defaultProps} invoiceType="purchase" />);
    expect(screen.getByText("Purchase Price")).toBeInTheDocument();
  });

  it('defaults to "Sale Price" when invoiceType is not specified', () => {
    render(<QuickItemCreate {...defaultProps} />);
    expect(screen.getByText("Sale Price")).toBeInTheDocument();
  });

  it('"Create & Select" button is disabled when name is empty', () => {
    render(<QuickItemCreate {...defaultProps} />);
    const btn = screen.getByText("Create & Select");
    expect(btn).toBeDisabled();
  });

  it('"Create & Select" button is disabled when unit is not selected', async () => {
    render(<QuickItemCreate {...defaultProps} />);

    // Fill name but leave unit at placeholder
    await userEvent.type(screen.getByPlaceholderText("Item name"), "Test Item");

    const btn = screen.getByText("Create & Select");
    expect(btn).toBeDisabled();
  });

  it('"Create & Select" button is enabled when both name and unit are filled', async () => {
    render(<QuickItemCreate {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("Item name"), "Test Item");

    // Select a unit from the dropdown
    const unitSelect = screen.getByDisplayValue("Select unit...");
    await userEvent.selectOptions(unitSelect, "pcs");

    const btn = screen.getByText("Create & Select");
    expect(btn).toBeEnabled();
  });

  it('unit select starts with "Select unit..." placeholder', () => {
    render(<QuickItemCreate {...defaultProps} />);
    expect(screen.getByDisplayValue("Select unit...")).toBeInTheDocument();
  });

  it("renders exactly one asterisk per required field (Name, Unit = 2 total)", () => {
    const { baseElement } = render(<QuickItemCreate {...defaultProps} />);
    const dialog = baseElement.querySelector('[role="dialog"]')!;
    expect(countAsterisks(dialog as HTMLElement)).toBe(2);
  });
});
