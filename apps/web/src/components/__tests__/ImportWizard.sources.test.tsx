/**
 * ImportWizard — source picker (step 1).
 *
 * The server's import adapter registry only knows "mybillbook" and "hisaabo".
 * The wizard used to also offer "Tally" and "Generic CSV", which then failed on
 * the first import batch with "Unknown import source". Project rule: never show
 * a control that fails server-side, so only supported sources are listed.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { useMutation } = vi.hoisted(() => ({
  useMutation: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: { me: { useQuery: () => ({ data: { role: "owner", tenantId: "ten-1" } }) } },
    import: {
      importParties: { useMutation },
      importItems: { useMutation },
      importInvoices: { useMutation },
      importPayments: { useMutation },
      importTransfers: { useMutation },
      reconcileDirectPayments: { useMutation },
    },
    expense: { create: { useMutation } },
    item: { update: { useMutation } },
    useUtils: () => ({}),
  },
}));

vi.mock("@/hooks/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ImportWizard } from "../ImportWizard";

describe("ImportWizard source picker", () => {
  it("offers myBillBook only, not Tally or Generic CSV", () => {
    render(<ImportWizard open onClose={() => {}} />);

    expect(screen.getByText("myBillBook")).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();

    expect(screen.queryByText("Tally")).toBeNull();
    expect(screen.queryByText(/Tally ERP/)).toBeNull();
    expect(screen.queryByText("Generic CSV")).toBeNull();
  });

  it("describes the import as a myBillBook migration", () => {
    render(<ImportWizard open onClose={() => {}} />);
    expect(screen.getByText(/from myBillBook/)).toBeTruthy();
    expect(screen.queryByText(/any CSV source/)).toBeNull();
  });
});
