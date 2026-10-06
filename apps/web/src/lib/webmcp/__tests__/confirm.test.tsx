import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { buildBrowserTool } from "../runtime";
import { requestConfirmation, summarizeInput, isConfirmHostMounted } from "../confirm";
import { resolveWebMcpBusinessId } from "../business-gate";
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
