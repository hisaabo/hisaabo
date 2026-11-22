/**
 * Confirmation fatigue: the per-session write budget.
 *
 * Twenty approved writes and the agent is told to ask the user; only a
 * deliberate re-enable (or a reload) starts a new session. There is no
 * "always allow" anywhere.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WRITE_BUDGET,
  consumeWrite,
  isWriteBudgetExhausted,
  resetWriteBudget,
  writeBudgetExhaustedMessage,
  writesRemaining,
  writesUsed,
} from "../budget";
import { buildBrowserTool } from "../runtime";
import { setAgentAccessEnabled } from "../preferences";
import type { WebMcpToolContext, WebMcpToolDefinition } from "../types";

const opts = () => ({ signal: new AbortController().signal });
const text = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text;

function ctx(): WebMcpToolContext {
  return {
    signal: new AbortController().signal,
    activeBusinessId: () => "biz-1",
    businessId: "biz-1",
    businessName: "Acme",
    invalidate: vi.fn(),
  } as unknown as WebMcpToolContext;
}

function writeDef(execute: WebMcpToolDefinition["execute"] = async () => ({ id: "1" })): WebMcpToolDefinition {
  return {
    name: "party_create",
    description: "d",
    inputSchema: { type: "object", properties: {} },
    annotations: { consequentialHint: true },
    execute,
  };
}

beforeEach(() => resetWriteBudget());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("write budget", () => {
  it("is 20 writes", () => {
    expect(WRITE_BUDGET).toBe(20);
    expect(writesRemaining()).toBe(20);
  });

  it("counts down and refuses once spent", () => {
    for (let i = 0; i < WRITE_BUDGET; i++) expect(consumeWrite()).toBe(true);
    expect(isWriteBudgetExhausted()).toBe(true);
    expect(consumeWrite()).toBe(false);
    expect(writesUsed()).toBe(WRITE_BUDGET);
    expect(writesRemaining()).toBe(0);
  });

  it("tells the agent to ask the user, and how the user can allow more", () => {
    const message = writeBudgetExhaustedMessage();
    expect(message).toMatch(/Nothing was changed/);
    expect(message).toMatch(/Tell the user/);
    expect(message).toMatch(/off and on again/);
  });
});

describe("write budget in the runtime", () => {
  it("stops the agent after 20 approved writes, without prompting for the 21st", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const execute = vi.fn(async () => ({ id: "1" }));
    const tool = buildBrowserTool(writeDef(execute), ctx());

    for (let i = 0; i < WRITE_BUDGET; i++) {
      const result = await tool.execute({ name: `P${i}` }, opts());
      expect(result).not.toMatchObject({ isError: true });
    }
    expect(execute).toHaveBeenCalledTimes(WRITE_BUDGET);
    expect(confirm).toHaveBeenCalledTimes(WRITE_BUDGET);

    const refused = await tool.execute({ name: "one too many" }, opts());
    expect(refused).toMatchObject({ isError: true });
    expect(text(refused)).toMatch(/used its 20 writes/);
    expect(execute).toHaveBeenCalledTimes(WRITE_BUDGET);
    expect(confirm).toHaveBeenCalledTimes(WRITE_BUDGET);
  });

  it("never limits reads", async () => {
    for (let i = 0; i < WRITE_BUDGET; i++) consumeWrite();
    const read = buildBrowserTool(
      { ...writeDef(), name: "party_list", annotations: { readOnlyHint: true } },
      ctx(),
    );
    const result = await read.execute({}, opts());
    expect(result).not.toMatchObject({ isError: true });
  });

  it("spends a write on approval even if the API then rejects it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const tool = buildBrowserTool(
      writeDef(async () => {
        throw new Error("rejected by the server");
      }),
      ctx(),
    );
    await tool.execute({}, opts());
    expect(writesUsed()).toBe(1);
  });

  it("does not spend a write when the user declines", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const tool = buildBrowserTool(writeDef(), ctx());
    await tool.execute({}, opts());
    expect(writesUsed()).toBe(0);
  });

  it("does not spend a write when the call was cancelled by a reset after the prompt", async () => {
    const controller = new AbortController();
    vi.spyOn(window, "confirm").mockImplementation(() => {
      controller.abort();
      return true;
    });
    const tool = buildBrowserTool(writeDef(), { ...ctx(), signal: controller.signal });
    await tool.execute({}, opts());
    expect(writesUsed()).toBe(0);
  });

  it("starts a fresh session when the user turns agent access back on (and not before)", async () => {
    for (let i = 0; i < WRITE_BUDGET; i++) consumeWrite();
    expect(isWriteBudgetExhausted()).toBe(true);

    setAgentAccessEnabled(false);
    expect(isWriteBudgetExhausted()).toBe(true);

    setAgentAccessEnabled(true);
    expect(isWriteBudgetExhausted()).toBe(false);
    expect(writesRemaining()).toBe(WRITE_BUDGET);
  });
});
