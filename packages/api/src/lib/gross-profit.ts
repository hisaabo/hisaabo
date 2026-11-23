import { money } from "@hisaabo/shared";

export interface PlLine {
  accountCode: string;
  amount: string;
}

/**
 * Gross profit from the P&L account lines of `reports.profitAndLoss`.
 *
 *   net sales        = 4000 Sales + 4010 Sales Returns
 *   net direct costs = 5000 Purchases + 5010 Purchase Returns + 5100 Direct Expenses
 *   gross profit     = net sales - net direct costs
 *
 * Amounts are already signed by the account's nature: an INCOME line is
 * credit - debit, an EXPENSE line is debit - credit. 4010 is seeded as income
 * (returns are a debit, so its amount is negative and REDUCES net sales) and
 * 5010 as expense (returns are a credit, so its amount is negative and REDUCES
 * direct costs). A line is read from whichever side the account sits on and
 * flipped into the side we need, so a chart where these were typed the other
 * way round still adds up.
 */
export function computeGrossProfit(income: PlLine[], expenses: PlLine[]): string {
  const asIncome = (code: string): string => {
    const inIncome = income.find((a) => a.accountCode === code)?.amount;
    if (inIncome !== undefined) return inIncome;
    const inExpenses = expenses.find((a) => a.accountCode === code)?.amount;
    return inExpenses !== undefined ? money.sub("0", inExpenses) : "0.00";
  };
  const asExpense = (code: string): string => {
    const inExpenses = expenses.find((a) => a.accountCode === code)?.amount;
    if (inExpenses !== undefined) return inExpenses;
    const inIncome = income.find((a) => a.accountCode === code)?.amount;
    return inIncome !== undefined ? money.sub("0", inIncome) : "0.00";
  };

  const netSales = money.add(asIncome("4000"), asIncome("4010"));
  const netDirectCosts = money.sum([asExpense("5000"), asExpense("5010"), asExpense("5100")]);
  return money.sub(netSales, netDirectCosts);
}
