import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { buildBrowserTool, resetWriteThrottle } from "../runtime";
import { requestConfirmation, summarizeInput, isConfirmHostMounted } from "../confirm";
import { resolveWebMcpBusinessId } from "../business-gate";
import { resetWriteBudget } from "../budget";
import { WebMcpConfirmHost } from "@/components/webmcp/WebMcpConfirmHost";
import type { WebMcpToolContext, WebMcpToolDefinition } from "../types";

const ctx = { invalidate: vi.fn() } as unknown as WebMcpToolContext;
const opts = () => ({ signal: new AbortController().signal });

function writeDef(execute = vi.fn(async () => "created")): WebMcpToolDefinition {
  return {
    name: "party_create",
    title: "Create party",
    description: "Create a party.",
    inputSchema: { type: "object", properties: {} },
    annotations: { consequentialHint: true },
    execute,
  } as unknown as WebMcpToolDefinition;
}

beforeEach(() => {
  resetWriteBudget();
  resetWriteThrottle();
});
afterEach(() => vi.restoreAllMocks());

describe("summarizeInput", () => {
  it("renders readable key: value pairs without raw JSON", () => {
    const text = summarizeInput({ partyName: "Acme", amount: 500, lines: [1, 2] });
    expect(text).toBe("party name: Acme; amount: 500; lines: 2 items");
  });

  it("clips long values and caps the number of fields", () => {
    const text = summarizeInput({ note: "x".repeat(500), a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 });
    expect(text).toContain("…");
    expect(text).toContain("more field");
    expect(text.length).toBeLessThanOrEqual(321);
  });
});

describe("confirmation host", () => {
  it("falls back to window.confirm when no host is mounted", async () => {
    expect(isConfirmHostMounted()).toBe(false);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const execute = vi.fn(async () => "created");
    const tool = buildBrowserTool(writeDef(execute), ctx);
    await tool.execute({ name: "Acme" }, opts());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalled();
  });

  it("shows the ConfirmDialog with tool name and summary; accept runs the tool", async () => {
    const confirm = vi.spyOn(window, "confirm");
    render(<WebMcpConfirmHost />);
    const execute = vi.fn(async () => "created");
    const tool = buildBrowserTool(writeDef(execute), ctx);
    let pending!: Promise<unknown>;
    act(() => {
      pending = tool.execute({ name: "Acme" }, opts()) as Promise<unknown>;
    });
    expect(await screen.findByText(/Create party/)).toBeInTheDocument();
    expect(screen.getByText(/name: Acme/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await pending;
    expect(execute).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("decline returns a clear 'user declined' result and does not run the tool", async () => {
    render(<WebMcpConfirmHost />);
    const execute = vi.fn(async () => "created");
    const tool = buildBrowserTool(writeDef(execute), ctx);
    let pending!: Promise<unknown>;
    act(() => {
      pending = tool.execute({ name: "Acme" }, opts()) as Promise<unknown>;
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    const result = (await pending) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/user declined/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it("queues concurrent requests", async () => {
    render(<WebMcpConfirmHost />);
    let a!: Promise<boolean>;
    let b!: Promise<boolean>;
    act(() => {
      a = requestConfirmation({ title: "First", description: "one" });
      b = requestConfirmation({ title: "Second", description: "two" });
    });
    expect(await screen.findByText("First")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await expect(a).resolves.toBe(true);
    await waitFor(() => expect(screen.getByText("Second")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(b).resolves.toBe(false);
  });

  it("unmounting the host denies in-flight requests and restores the fallback", async () => {
    const { unmount } = render(<WebMcpConfirmHost />);
    let p!: Promise<boolean>;
    act(() => {
      p = requestConfirmation({ title: "T", description: "d" });
    });
    unmount();
    await expect(p).resolves.toBe(false);
    expect(isConfirmHostMounted()).toBe(false);
  });
});

describe("confirmation host — informed summary", () => {
  it("shows the business in the title and the resolved summary, with the before → after of an update", async () => {
    render(<WebMcpConfirmHost scopeKey="k" />);
    const def = {
      ...writeDef(),
      title: "Change invoice status",
      summarize: async () => ({
        headline: "Change the status of INV-0042 for Acme Traders",
        details: ["Invoice total: ₹17,700.00"],
        changes: [{ field: "Status", before: "draft", after: "sent" }],
      }),
    } as WebMcpToolDefinition;
    const execute = vi.fn();
    const tool = buildBrowserTool(
      { ...def, execute },
      { ...ctx, businessName: "Sharma Traders", businessId: "biz-1", activeBusinessId: () => "biz-1" } as WebMcpToolContext,
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = tool.execute({ invoiceId: "x" }, opts()) as Promise<unknown>;
    });

    const dialog = await screen.findByTestId("webmcp-confirm");
    expect(dialog).toHaveTextContent("Allow AI agent: Change invoice status in Sharma Traders?");
    expect(dialog).toHaveTextContent("Change the status of INV-0042 for Acme Traders");
    expect(dialog).toHaveTextContent("Invoice total: ₹17,700.00");
    expect(dialog).toHaveTextContent("Status:");
    expect(screen.getByText("draft")).toHaveClass("line-through");
    expect(screen.getByText("sent")).toBeInTheDocument();
    // The raw input summary is not shown when a resolved one exists.
    expect(dialog).not.toHaveTextContent("invoice id: x");

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await pending;
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("shows the plain input summary for a tool without summarize", async () => {
    render(<WebMcpConfirmHost scopeKey="k" />);
    const tool = buildBrowserTool(writeDef(), { ...ctx, businessName: "Sharma Traders" } as WebMcpToolContext);
    act(() => {
      void tool.execute({ name: "Acme" }, opts());
    });
    const dialog = await screen.findByTestId("webmcp-confirm");
    expect(dialog).toHaveTextContent("Allow AI agent: Create party in Sharma Traders?");
    expect(dialog).toHaveTextContent("name: Acme");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
});

describe("confirmation host — fatigue controls", () => {
  it("shows no counter and no Deny all for a single prompt", async () => {
    render(<WebMcpConfirmHost scopeKey="k" />);
    let p!: Promise<boolean>;
    act(() => {
      p = requestConfirmation({ title: "Only one", description: "d" });
    });
    await screen.findByText("Only one");
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deny all" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(p).resolves.toBe(false);
  });

  it("shows an N pending count that follows the queue", async () => {
    render(<WebMcpConfirmHost scopeKey="k" />);
    const results: Promise<boolean>[] = [];
    act(() => {
      for (let i = 1; i <= 3; i++) results.push(requestConfirmation({ title: `Prompt ${i}`, description: "d" }));
    });
    expect(await screen.findByText("3 pending")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(await screen.findByText("2 pending")).toBeInTheDocument();
    expect(screen.getByText("Prompt 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // One left: the counter goes away.
    await waitFor(() => expect(screen.queryByText(/pending/)).not.toBeInTheDocument());
    expect(screen.getByText("Prompt 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(Promise.all(results)).resolves.toEqual([true, false, false]);
  });

  it("Deny all denies the open prompt and every queued one at once", async () => {
    render(<WebMcpConfirmHost scopeKey="k" />);
    const results: Promise<boolean>[] = [];
    act(() => {
      for (let i = 1; i <= 4; i++) results.push(requestConfirmation({ title: `Prompt ${i}`, description: "d" }));
    });
    expect(await screen.findByText("4 pending")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Deny all" }));

    await expect(Promise.all(results)).resolves.toEqual([false, false, false, false]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument());
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });

  it("an agent that was denied all can still prompt again afterwards", async () => {
    render(<WebMcpConfirmHost scopeKey="k" />);
    act(() => {
      void requestConfirmation({ title: "A", description: "d" });
      void requestConfirmation({ title: "B", description: "d" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Deny all" }));
    let again!: Promise<boolean>;
    act(() => {
      again = requestConfirmation({ title: "Later", description: "d" });
    });
    expect(await screen.findByText("Later")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await expect(again).resolves.toBe(true);
  });

  it("shows how many agent writes are left this session", async () => {
    render(<WebMcpConfirmHost scopeKey="k" />);
    act(() => {
      void requestConfirmation({ title: "T", description: "d", writesLeft: 17 });
    });
    expect(await screen.findByText("17 of 20 agent writes left this session.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });

  it("offers no 'always allow' control", async () => {
    render(<WebMcpConfirmHost scopeKey="k" />);
    act(() => {
      void requestConfirmation({ title: "T", description: "d" });
    });
    await screen.findByRole("button", { name: "Allow" });
    expect(screen.queryByText(/always/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel", "Allow"]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
});

describe("confirmation host — the context the prompt was raised for changes", () => {
  it("denies the open and the queued prompts when the scope (user / tenant / business) changes", async () => {
    const { rerender } = render(<WebMcpConfirmHost scopeKey="user-1:tenant-1:biz-A" />);
    let open!: Promise<boolean>;
    let queued!: Promise<boolean>;
    act(() => {
      open = requestConfirmation({ title: "Create invoice", description: "for Acme" });
      queued = requestConfirmation({ title: "Create party", description: "Acme" });
    });
    expect(await screen.findByText("Create invoice")).toBeInTheDocument();

    // The user switches to business B while the dialog is open.
    rerender(<WebMcpConfirmHost scopeKey="user-1:tenant-1:biz-B" />);

    await expect(open).resolves.toBe(false);
    await expect(queued).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument());
    expect(screen.queryByText("Create party")).not.toBeInTheDocument();
  });

  it("denies everything when the user signs out (scope becomes null)", async () => {
    const { rerender } = render(<WebMcpConfirmHost scopeKey="user-1:tenant-1:biz-A" />);
    let p!: Promise<boolean>;
    act(() => {
      p = requestConfirmation({ title: "Record payment", description: "Rs. 500" });
    });
    await screen.findByText("Record payment");
    rerender(<WebMcpConfirmHost scopeKey={null} />);
    await expect(p).resolves.toBe(false);
  });

  it("still shows prompts raised after the scope changed", async () => {
    const { rerender } = render(<WebMcpConfirmHost scopeKey="biz-A" />);
    rerender(<WebMcpConfirmHost scopeKey="biz-B" />);
    let p!: Promise<boolean>;
    act(() => {
      p = requestConfirmation({ title: "Fresh prompt", description: "d" });
    });
    expect(await screen.findByText("Fresh prompt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await expect(p).resolves.toBe(true);
  });

  it("denies a prompt and closes its dialog when the registration that raised it is aborted", async () => {
    render(<WebMcpConfirmHost scopeKey="k" />);
    const controller = new AbortController();
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = requestConfirmation({ title: "Prompt A", description: "a", signal: controller.signal });
      second = requestConfirmation({ title: "Prompt B", description: "b" });
    });
    expect(await screen.findByText("Prompt A")).toBeInTheDocument();

    act(() => controller.abort());

    await expect(first).resolves.toBe(false);
    // The next request in the queue takes over the dialog.
    expect(await screen.findByText("Prompt B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await expect(second).resolves.toBe(true);
  });

  it("removes a queued prompt whose registration was aborted before it was shown", async () => {
    render(<WebMcpConfirmHost scopeKey="k" />);
    const controller = new AbortController();
    let open!: Promise<boolean>;
    let queued!: Promise<boolean>;
    act(() => {
      open = requestConfirmation({ title: "Open one", description: "a" });
      queued = requestConfirmation({ title: "Queued one", description: "b", signal: controller.signal });
    });
    await screen.findByText("Open one");
    act(() => controller.abort());
    await expect(queued).resolves.toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await expect(open).resolves.toBe(true);
    // Nothing left to show: the aborted prompt did not resurface.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument());
  });

  it("denies at once when the signal was already aborted", async () => {
    render(<WebMcpConfirmHost scopeKey="k" />);
    const controller = new AbortController();
    controller.abort();
    await expect(requestConfirmation({ title: "T", description: "d", signal: controller.signal })).resolves.toBe(false);
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });
});

describe("resolveWebMcpBusinessId", () => {
  const list = [{ id: "b1" }, { id: "b2" }];
  it("does not fall back to the first business", () => {
    expect(resolveWebMcpBusinessId(null, list)).toBeNull();
    expect(resolveWebMcpBusinessId(undefined, list)).toBeNull();
  });
  it("returns the resolved id when it is in the loaded list or the list is not loaded", () => {
    expect(resolveWebMcpBusinessId("b2", list)).toBe("b2");
    expect(resolveWebMcpBusinessId("b2", undefined)).toBe("b2");
  });
  it("rejects an id that is no longer in the list", () => {
    expect(resolveWebMcpBusinessId("gone", list)).toBeNull();
  });
});
