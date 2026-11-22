/**
 * Pure tests for lib/gross-profit.ts. Amounts follow the P&L report's own
 * convention: income = credit - debit, expense = debit - credit.
 */
import { describe, it, expect } from "vitest";
import { computeGrossProfit } from "../lib/gross-profit.js";

const line = (accountCode: string, amount: string) => ({ accountCode, amount });

describe("computeGrossProfit", () => {
  it("is zero with no activity", () => {
    expect(computeGrossProfit([], [])).toBe("0.00");
  });

  it("sales minus purchases minus direct expenses", () => {
    expect(
      computeGrossProfit(
        [line("4000", "10000.00")],
        [line("5000", "6000.00"), line("5100", "500.00"), line("5200", "999.00")], // salaries are not direct
      ),
    ).toBe("3500.00");
  });

  it("sales returns (income account 4010, a debit so negative) reduce net sales: 10500 - 3000 = 7500", () => {
    expect(computeGrossProfit([line("4000", "10500.00"), line("4010", "-3000.00")], [])).toBe("7500.00");
  });

  it("purchase returns (expense account 5010, a credit so negative) reduce direct costs: 0 - (10000 - 2500) = -7500", () => {
    expect(computeGrossProfit([], [line("5000", "10000.00"), line("5010", "-2500.00")])).toBe("-7500.00");
  });

  it("combines all four", () => {
    // net sales 10000 - 1000 = 9000 ; net direct costs 6000 - 500 + 200 = 5700
    expect(
      computeGrossProfit(
        [line("4000", "10000.00"), line("4010", "-1000.00")],
        [line("5000", "6000.00"), line("5010", "-500.00"), line("5100", "200.00")],
      ),
    ).toBe("3300.00");
  });

  it("ignores round-off, discounts and other charges (they are not trading accounts)", () => {
    expect(
      computeGrossProfit(
        [line("4000", "1000.00"), line("4020", "25.00")],
        [line("5000", "400.00"), line("5020", "50.00"), line("5030", "0.55")],
      ),
    ).toBe("600.00");
  });

  it("reads 4010 / 5010 from whichever side the account sits on", () => {
    // 4010 typed as expense: a debit of 3000 is +3000 as an expense, i.e. -3000 of income
    expect(computeGrossProfit([line("4000", "10500.00")], [line("4010", "3000.00")])).toBe("7500.00");
    // 5010 typed as income: a credit of 2500 is +2500 as income, i.e. -2500 of cost
    expect(computeGrossProfit([line("5010", "2500.00")], [line("5000", "10000.00")])).toBe("-7500.00");
  });
});
