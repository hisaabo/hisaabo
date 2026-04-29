/**
 * RestoreOnboarding — split-host URL resolution regression guard.
 *
 * Background: the upload XHR used `${window.location.origin}${url}` to resolve
 * the relative selfImport URL returned by the server. In split-host prod
 * (app.hisaabo.in + api.hisaabo.in) that pointed at the SPA, not the API,
 * and the upload silently failed. The component now resolves through
 * `apiUrl(VITE_API_URL)` so split-host hits the API host correctly.
 *
 * These tests exercise the relative-vs-absolute URL branch by mocking
 * XMLHttpRequest and the selfImport mutation, then asserting xhr.open was
 * called with the expected URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ─── tRPC mock surface ────────────────────────────────────────────────────────

const { mutateAsync } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    selfImport: {
      request: {
        useMutation: () => ({ mutateAsync }),
      },
    },
    useUtils: () => ({ invalidate: vi.fn() }),
  },
}));

vi.mock("@/hooks/useToast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ConfirmDialog: render the confirm button immediately when `open` is true so
// the test can drive the flow without a real dialog interaction.
vi.mock("@/components/ui/ConfirmDialog", () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: () => void;
  }) =>
    open ? (
      <button data-testid="confirm-restore" onClick={onConfirm}>
        confirm
      </button>
    ) : null,
}));

import { RestoreOnboarding } from "../RestoreOnboarding";

// ─── XMLHttpRequest stub ──────────────────────────────────────────────────────
// Captures (method, url) from .open() and exposes a way to fire `load` so the
// component's promise resolves and the test can complete cleanly.

interface FakeXhr {
  open: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  setRequestHeader: ReturnType<typeof vi.fn>;
  addEventListener: (event: string, cb: () => void) => void;
  upload: { addEventListener: () => void };
  withCredentials: boolean;
  status: number;
  responseText: string;
}

function installXhrStub(): { instances: FakeXhr[]; fireLoad: (i?: number) => void } {
  const instances: FakeXhr[] = [];
  const handlers: Record<number, Record<string, () => void>> = {};

  class StubXhr implements FakeXhr {
    open = vi.fn();
    send = vi.fn();
    setRequestHeader = vi.fn();
    upload = { addEventListener: vi.fn() };
    withCredentials = false;
    status = 200;
    responseText = JSON.stringify({
      status: "complete",
      rowsInserted: 0,
      warnings: [],
      errors: [],
      durationMs: 1,
    });
    private idx: number;
    constructor() {
      this.idx = instances.length;
      instances.push(this);
      handlers[this.idx] = {};
    }
    addEventListener(event: string, cb: () => void): void {
      handlers[this.idx][event] = cb;
    }
  }

  vi.stubGlobal("XMLHttpRequest", StubXhr as unknown as typeof XMLHttpRequest);

  return {
    instances,
    fireLoad: (i = 0) => handlers[i]?.load?.(),
  };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function selectFile(): void {
  const file = new File(["x"], "backup.tar.gz", { type: "application/gzip" });
  const input = document.querySelector(
    "input[type=file]",
  ) as HTMLInputElement | null;
  if (!input) throw new Error("file input not found");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

async function runRestoreFlow(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /restore from backup/i }));
  // ConfirmDialog stub renders the confirm button synchronously
  fireEvent.click(await screen.findByTestId("confirm-restore"));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RestoreOnboarding — upload URL resolution (split-host regression)", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("relative URL from server is resolved against VITE_API_URL", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.hisaabo.in");
    mutateAsync.mockResolvedValue({
      url: "/api/selfImport/ten-1?token=tok-1",
      token: "tok-1",
      expiresAt: "2026-04-29T08:39:21.127Z",
    });
    const xhr = installXhrStub();

    render(<RestoreOnboarding tenantId="ten-1" onBack={() => {}} />);
    selectFile();
    await runRestoreFlow();

    await waitFor(() => expect(xhr.instances).toHaveLength(1));
    expect(xhr.instances[0].open).toHaveBeenCalledWith(
      "POST",
      "https://api.hisaabo.in/api/selfImport/ten-1?token=tok-1",
    );

    // Resolve the upload promise so React state settles before teardown.
    await act(async () => {
      xhr.fireLoad(0);
    });
  });

  it("absolute URL from server is used as-is (back-compat)", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.hisaabo.in");
    mutateAsync.mockResolvedValue({
      url: "https://legacy.example.com/api/selfImport/ten-1?token=tok-1",
      token: "tok-1",
      expiresAt: "2026-04-29T08:39:21.127Z",
    });
    const xhr = installXhrStub();

    render(<RestoreOnboarding tenantId="ten-1" onBack={() => {}} />);
    selectFile();
    await runRestoreFlow();

    await waitFor(() => expect(xhr.instances).toHaveLength(1));
    expect(xhr.instances[0].open).toHaveBeenCalledWith(
      "POST",
      "https://legacy.example.com/api/selfImport/ten-1?token=tok-1",
    );

    await act(async () => {
      xhr.fireLoad(0);
    });
  });

  it("relative URL stays same-origin when VITE_API_URL is unset (single-origin deploy)", async () => {
    vi.stubEnv("VITE_API_URL", "");
    mutateAsync.mockResolvedValue({
      url: "/api/selfImport/ten-1?token=tok-1",
      token: "tok-1",
      expiresAt: "2026-04-29T08:39:21.127Z",
    });
    const xhr = installXhrStub();

    render(<RestoreOnboarding tenantId="ten-1" onBack={() => {}} />);
    selectFile();
    await runRestoreFlow();

    await waitFor(() => expect(xhr.instances).toHaveLength(1));
    expect(xhr.instances[0].open).toHaveBeenCalledWith(
      "POST",
      "/api/selfImport/ten-1?token=tok-1",
    );

    await act(async () => {
      xhr.fireLoad(0);
    });
  });
});
