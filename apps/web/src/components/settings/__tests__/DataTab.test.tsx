/**
 * DataTab — settings component tests
 *
 * Covers:
 * - Visibility gating: FullBackupSection is only shown for owner/superadmin with tenantId
 * - Always-visible sections: ImportSection and CsvExportSection regardless of role
 * - ImportWizard opens on "Start import" click
 * - CSV export: clicking "Export CSV bundle" calls exportData mutate
 * - Full backup: clicking "Download backup" calls selfExport mutate with tenantId
 * - Full backup: error toast variants for FORBIDDEN, TOO_MANY_REQUESTS, and generic errors
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ─── tRPC mock surface ────────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file, so references inside
// them must be established via vi.hoisted() which also runs before the hoisting.

const {
  exportDataMutate,
  selfExportMutate,
  lastSelfExportOpts,
  lastExportDataOpts,
  authMeReturn,
} = vi.hoisted(() => ({
  exportDataMutate: vi.fn(),
  selfExportMutate: vi.fn(),
  lastSelfExportOpts: { current: null as any },
  lastExportDataOpts: { current: null as any },
  authMeReturn: {
    // typed as any so tests can freely assign null without TSC narrowing issues
    current: { data: { role: "owner", tenantId: "ten-1" } } as any,
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    business: {
      exportData: {
        useMutation: (opts: any) => {
          lastExportDataOpts.current = opts;
          return { mutate: exportDataMutate, isPending: false };
        },
      },
    },
    selfExport: {
      request: {
        useMutation: (opts: any) => {
          lastSelfExportOpts.current = opts;
          return { mutate: selfExportMutate, isPending: false };
        },
      },
    },
    auth: {
      me: {
        useQuery: () => authMeReturn.current,
      },
    },
    useUtils: () => ({}),
  },
}));

vi.mock("@/hooks/useToast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/ImportWizard", () => ({
  ImportWizard: ({ open }: { open: boolean }) =>
    open ? <div data-testid="import-wizard" /> : null,
}));

// jszip is used by CsvExportSection.onSuccess — not exercised here but mock
// prevents any accidental import-time failures.
vi.mock("jszip", () => ({
  default: class {
    file() {}
    generateAsync = async () => new Blob();
  },
}));

// Import component AFTER mocks so it picks up stubbed dependencies.
import { DataTab } from "../DataTab";
import { toast } from "@/hooks/useToast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderTab() {
  return render(<DataTab />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DataTab — visibility gating (FullBackupSection)", () => {
  beforeEach(() => {
    exportDataMutate.mockClear();
    selfExportMutate.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    // Reset to owner defaults before each test
    authMeReturn.current = { data: { role: "owner", tenantId: "ten-1" } };
    lastSelfExportOpts.current = null;
    lastExportDataOpts.current = null;
  });

  it("member role: 'Download backup' button and 'Full backup' heading are NOT rendered", () => {
    authMeReturn.current = { data: { role: "member", tenantId: "ten-1" } };
    renderTab();

    expect(screen.queryByRole("button", { name: /download backup/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/full backup \(restorable\)/i)).not.toBeInTheDocument();
  });

  it("accountant role: 'Download backup' button and 'Full backup' heading are NOT rendered", () => {
    authMeReturn.current = { data: { role: "accountant", tenantId: "ten-1" } };
    renderTab();

    expect(screen.queryByRole("button", { name: /download backup/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/full backup \(restorable\)/i)).not.toBeInTheDocument();
  });

  it("owner role with tenantId: 'Download backup' button IS rendered", () => {
    authMeReturn.current = { data: { role: "owner", tenantId: "ten-1" } };
    renderTab();

    expect(
      screen.getByRole("button", { name: /export tenant data/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/full backup \(restorable\)/i)).toBeInTheDocument();
  });

  it("owner role but tenantId is null: Full backup section is NOT rendered", () => {
    authMeReturn.current = { data: { role: "owner", tenantId: null } };
    renderTab();

    expect(screen.queryByRole("button", { name: /download backup/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/full backup \(restorable\)/i)).not.toBeInTheDocument();
  });

  it("superadmin role counts as owner — Full backup section IS rendered", () => {
    authMeReturn.current = { data: { role: "superadmin", tenantId: "ten-1" } };
    renderTab();

    expect(
      screen.getByRole("button", { name: /export tenant data/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/full backup \(restorable\)/i)).toBeInTheDocument();
  });
});

describe("DataTab — always-visible sections", () => {
  beforeEach(() => {
    exportDataMutate.mockClear();
    selfExportMutate.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    authMeReturn.current = { data: { role: "member", tenantId: "ten-1" } };
    lastSelfExportOpts.current = null;
    lastExportDataOpts.current = null;
  });

  it("'Import data' heading and 'Start import' button are visible regardless of role", () => {
    renderTab();

    expect(screen.getByText("Import data")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start import/i })).toBeInTheDocument();
  });

  it("'Export as CSV' heading and 'Export CSV bundle' button are visible regardless of role", () => {
    renderTab();

    expect(screen.getByText("Export as CSV")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export csv bundle/i })).toBeInTheDocument();
  });
});

describe("DataTab — ImportSection", () => {
  beforeEach(() => {
    exportDataMutate.mockClear();
    selfExportMutate.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    authMeReturn.current = { data: { role: "owner", tenantId: "ten-1" } };
    lastSelfExportOpts.current = null;
    lastExportDataOpts.current = null;
  });

  it("clicking 'Start import' opens the ImportWizard (data-testid present)", () => {
    renderTab();

    // Wizard should NOT be visible initially
    expect(screen.queryByTestId("import-wizard")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    expect(screen.getByTestId("import-wizard")).toBeInTheDocument();
  });
});

describe("DataTab — CsvExportSection", () => {
  beforeEach(() => {
    exportDataMutate.mockClear();
    selfExportMutate.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    authMeReturn.current = { data: { role: "owner", tenantId: "ten-1" } };
    lastSelfExportOpts.current = null;
    lastExportDataOpts.current = null;
  });

  it("clicking 'Export CSV bundle' calls exportData mutate exactly once", () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /export csv bundle/i }));

    expect(exportDataMutate).toHaveBeenCalledTimes(1);
  });
});

describe("DataTab — FullBackupSection", () => {
  beforeEach(() => {
    exportDataMutate.mockClear();
    selfExportMutate.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    authMeReturn.current = { data: { role: "owner", tenantId: "ten-1" } };
    lastSelfExportOpts.current = null;
    lastExportDataOpts.current = null;
  });

  it("clicking 'Download backup' calls selfExport mutate once with { tenantId: 'ten-1' }", () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /export tenant data/i }));

    expect(selfExportMutate).toHaveBeenCalledTimes(1);
    expect(selfExportMutate).toHaveBeenCalledWith({ tenantId: "ten-1" });
  });

  it("FORBIDDEN error → toast.error called with message containing 'must be a tenant owner'", () => {
    renderTab();

    // Trigger the component to register its onError callback via useMutation
    // (it runs on render). Now invoke the callback manually.
    lastSelfExportOpts.current.onError({
      data: { code: "FORBIDDEN" },
      message: "nope",
    });

    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringContaining("must be a tenant owner")
    );
  });

  it("TOO_MANY_REQUESTS error → toast.error called with title 'Export limit reached'", () => {
    renderTab();

    lastSelfExportOpts.current.onError({
      data: { code: "TOO_MANY_REQUESTS" },
      message: "rate",
    });

    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    // The component calls toast.error(title, description) — assert on the first arg.
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe("Export limit reached");
  });

  it("generic error → toast.error called with title containing 'Failed to start export' and message as description", () => {
    renderTab();

    lastSelfExportOpts.current.onError({
      data: { code: "INTERNAL_SERVER_ERROR" },
      message: "boom",
    });

    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain("Failed to start export");
    expect(vi.mocked(toast.error).mock.calls[0][1]).toBe("boom");
  });

  // ── URL resolution (split-host prod regression guard) ──────────────────────
  // Background: the server used to return an absolute URL built from APP_URL
  // (the frontend host), so the anchor click went to app.hisaabo.in instead
  // of api.hisaabo.in and silently failed. Server now returns a relative URL
  // and this component resolves it via apiUrl(VITE_API_URL).

  it("relative URL is resolved against VITE_API_URL in split-host mode", () => {
    vi.stubEnv("VITE_API_URL", "https://api.hisaabo.in");
    try {
      // Spy on createElement so we can capture the anchor the component creates
      // without disturbing the rest of the render path.
      const createElement = document.createElement.bind(document);
      const anchors: HTMLAnchorElement[] = [];
      const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = createElement(tag);
        if (tag === "a") {
          // Stub click — jsdom would otherwise try to navigate
          (el as HTMLAnchorElement).click = vi.fn();
          anchors.push(el as HTMLAnchorElement);
        }
        return el;
      });

      renderTab();
      lastSelfExportOpts.current.onSuccess({
        token: "tok-1",
        url: "/api/export/ten-1?token=tok-1",
        expiresAt: "2026-04-29T08:39:21.127Z",
      });

      expect(anchors).toHaveLength(1);
      // jsdom resolves anchor.href against the document base URL when assigned
      // from a relative href, so we compare on .href directly which reflects
      // exactly what the browser would navigate to.
      expect(anchors[0].href).toBe("https://api.hisaabo.in/api/export/ten-1?token=tok-1");

      spy.mockRestore();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("absolute URL from server is used as-is (back-compat with older servers)", () => {
    vi.stubEnv("VITE_API_URL", "https://api.hisaabo.in");
    try {
      const createElement = document.createElement.bind(document);
      const anchors: HTMLAnchorElement[] = [];
      const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = createElement(tag);
        if (tag === "a") {
          (el as HTMLAnchorElement).click = vi.fn();
          anchors.push(el as HTMLAnchorElement);
        }
        return el;
      });

      renderTab();
      lastSelfExportOpts.current.onSuccess({
        token: "tok-1",
        url: "https://legacy.example.com/api/export/ten-1?token=tok-1",
        expiresAt: "2026-04-29T08:39:21.127Z",
      });

      expect(anchors[0].href).toBe("https://legacy.example.com/api/export/ten-1?token=tok-1");
      spy.mockRestore();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
