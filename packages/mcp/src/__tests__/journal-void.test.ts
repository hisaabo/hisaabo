import { describe, it, expect, afterEach } from "vitest";
import { registerWith, callTool, recordingClient, writeAdmin, UUID } from "./helpers.js";

/**
 * Journal entries are never deleted: the MCP surface offers journal_void only,
 * and journal_void says what it does (a reversing entry, both entries kept).
 * Server side, journal.delete is an alias of journal.void (see
 * packages/api/src/__tests__/integration/journal.test.ts).
 */

let restore: (() => void) | undefined;
afterEach(() => restore?.());

function setup() {
  const rec = recordingClient(() => ({ voidedEntry: { entryNumber: "JE-00001" }, reversingEntry: { entryNumber: "JE-00002" } }));
  restore = rec.restore;
  const { tools } = registerWith(writeAdmin, rec.client);
  return { ...rec, tools };
}

describe("journal_void", () => {
  it("is the only way to take a journal entry out of effect (no delete tool)", () => {
    const { tools } = setup();
    expect(tools.has("journal_void")).toBe(true);
    expect([...tools.keys()].filter((n) => /^journal_(delete|remove)/.test(n))).toEqual([]);
  });

  it("explains that a reversing entry is posted and both entries are kept", () => {
    const { tools } = setup();
    const description = tools.get("journal_void")!.description;
    expect(description).toMatch(/reversing entry/i);
    expect(description).toMatch(/never deleted/i);
  });

  it("is destructive-tier: needs confirm, then calls journal.void", async () => {
    const { tools, calls } = setup();

    const refused = await callTool(tools.get("journal_void")!, { id: UUID });
    expect(refused.isError).toBe(true);
    expect(calls).toHaveLength(0);

    await callTool(tools.get("journal_void")!, { id: UUID, confirm: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname.endsWith("journal.void")).toBe(true);
    expect(calls[0].body).toEqual({ id: UUID });
  });
});
