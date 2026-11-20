import { describe, expect, it, vi } from "vitest";
import {
  businessLocalDate,
  ensureTdsReceivableAccount,
  isSectionEffectiveOn,
} from "../lib/tds-sections.js";
import { defaultTdsSectionConfigs, defaultTdsSectionRows } from "../lib/tds-seed.js";

describe("businessLocalDate (IST)", () => {
  it("maps instants to the Asia/Kolkata calendar date", () => {
    expect(businessLocalDate(new Date("2026-04-01T00:00:00.000Z"))).toBe("2026-04-01");
    // IST midnight of 1 Apr — what an IST browser sends for a date-only receipt.
    expect(businessLocalDate(new Date("2026-03-31T18:30:00.000Z"))).toBe("2026-04-01");
    expect(businessLocalDate(new Date("2026-03-31T18:29:59.999Z"))).toBe("2026-03-31");
    expect(businessLocalDate(new Date("2026-04-01T18:29:59.999Z"))).toBe("2026-04-01");
  });
});

describe("isSectionEffectiveOn", () => {
  // Registry seeds use 2026-04-01T00:00:00Z.
  const seeded = { effectiveFrom: new Date("2026-04-01T00:00:00.000Z"), effectiveTo: null };

  it("accepts a receipt dated 1 Apr 2026 IST (before 00:00Z on the UTC day)", () => {
    expect(isSectionEffectiveOn(seeded, new Date("2026-03-31T18:30:00.000Z"))).toBe(true);
    expect(isSectionEffectiveOn(seeded, new Date("2026-04-01T00:00:00.000Z"))).toBe(true);
    expect(isSectionEffectiveOn(seeded, new Date("2026-10-12T00:00:00.000Z"))).toBe(true);
  });

  it("rejects a receipt dated before the effective date", () => {
    expect(isSectionEffectiveOn(seeded, new Date("2026-03-31T18:29:59.000Z"))).toBe(false);
    expect(isSectionEffectiveOn(seeded, new Date("2026-03-15T00:00:00.000Z"))).toBe(false);
  });

  it("treats effectiveTo as inclusive of its IST day", () => {
    const ended = {
      effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-06-30T00:00:00.000Z"),
    };
    expect(isSectionEffectiveOn(ended, new Date("2026-06-30T10:00:00.000Z"))).toBe(true);
    expect(isSectionEffectiveOn(ended, new Date("2026-07-01T00:00:00.000Z"))).toBe(false);
  });
});

describe("registry-derived defaults", () => {
  const businessId = "00000000-0000-0000-0000-000000000001";

  it("covers every current code, active, version 1, effective 1 Apr 2026", () => {
    const rows = defaultTdsSectionRows(businessId);
    expect(rows).toHaveLength(39);
    expect(rows.every((r) => r.status === "active" && r.version === 1 && r.effectiveTo === null)).toBe(true);
    expect(rows.find((r) => r.sectionCode === "1027")?.effectiveFrom.toISOString())
      .toBe("2026-04-01T00:00:00.000Z");
  });

  it("returns list-shaped rows without persisting anything", () => {
    const configs = defaultTdsSectionConfigs(businessId);
    expect(configs).toHaveLength(39);
    const first = configs[0]!;
    expect(Object.keys(first).sort()).toEqual([
      "businessId", "createdAt", "effectiveFrom", "effectiveTo", "id",
      "sectionCode", "sectionLabel", "status", "updatedAt", "version",
    ]);
    expect(first.id).toBe(`registry:${first.sectionCode}`);
  });
});

/** Minimal fake of the drizzle chains ensureTdsReceivableAccount uses. */
function fakeTx(account: Record<string, unknown> | undefined) {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const tx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(account ? [account] : []) }),
      }),
    }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
  };
  return { tx, updateSet };
}

describe("ensureTdsReceivableAccount", () => {
  const businessId = "00000000-0000-0000-0000-000000000001";

  it("is a no-op for an active system asset account", async () => {
    const { tx } = fakeTx({ id: "a1", isSystem: true, isActive: true, accountType: "asset", name: "TDS Receivable" });
    await ensureTdsReceivableAccount(tx, businessId);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("reactivates a deactivated system account", async () => {
    const { tx, updateSet } = fakeTx({ id: "a1", isSystem: true, isActive: false, accountType: "asset", name: "TDS Receivable" });
    await ensureTdsReceivableAccount(tx, businessId);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it("rejects when 1600 is a user-created account", async () => {
    const { tx } = fakeTx({ id: "a2", isSystem: false, isActive: true, accountType: "asset", name: "Petty Cash 2" });
    await expect(ensureTdsReceivableAccount(tx, businessId)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Petty Cash 2"),
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("rejects when the 1600 row is not an asset account", async () => {
    const { tx } = fakeTx({ id: "a3", isSystem: true, isActive: true, accountType: "expense", name: "Odd" });
    await expect(ensureTdsReceivableAccount(tx, businessId)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
