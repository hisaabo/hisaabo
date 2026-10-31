import { describe, expect, it } from "vitest";
import { money } from "@hisaabo/shared";

describe("Party statement accounting with TDS", () => {
  it("reconciles customer closing balance to 0 when an invoice is settled with cash and TDS", () => {
    const openingBalance = "0.00";
    const invoice = {
      date: new Date("2026-10-01"),
      totalAmount: "10000.00",
      type: "sale" as const,
    };
    const payment = {
      date: new Date("2026-10-05"),
      amount: "9000.00", // net cash received
      tdsAmount: "1000.00", // TDS deducted by customer
      mode: "bank",
    };

    const invoiceEntry = {
      date: invoice.date,
      debit: invoice.totalAmount,
      credit: "0.00",
    };

    const totalSettled = money.add(payment.amount, payment.tdsAmount);
    const paymentEntry = {
      date: payment.date,
      debit: "0.00",
      credit: totalSettled,
    };

    const entries = [invoiceEntry, paymentEntry];
    let runningBalance = openingBalance;
    const entriesWithBalance = entries.map((e) => {
      runningBalance = money.add(money.sub(runningBalance, e.credit), e.debit);
      return { ...e, runningBalance };
    });

    const totalDebit = money.sum(entries.map((e) => e.debit));
    const totalCredit = money.sum(entries.map((e) => e.credit));
    const closingBalance = money.add(money.sub(openingBalance, totalCredit), totalDebit);

    expect(totalDebit).toBe("10000.00");
    expect(totalCredit).toBe("10000.00");
    expect(closingBalance).toBe("0.00");
    expect(entriesWithBalance[0].runningBalance).toBe("10000.00");
    expect(entriesWithBalance[1].runningBalance).toBe("0.00");
    expect(money.compare(closingBalance, "0") >= 0).toBe(true);
  });

  it("handles multiple allocations with partial TDS without double-counting", () => {
    const openingBalance = "0.00";
    const invoices = [
      { date: new Date("2026-10-01"), totalAmount: "6000.00", type: "sale" as const },
      { date: new Date("2026-10-02"), totalAmount: "4000.00", type: "sale" as const },
    ];
    // Payment covering both: 9000 cash + 1000 TDS across allocations
    const payment = {
      date: new Date("2026-10-05"),
      amount: "9000.00",
      tdsAmount: "1000.00", // aggregated across allocations
      mode: "bank",
    };

    const invoiceEntries = invoices.map((inv) => ({
      date: inv.date,
      debit: inv.totalAmount,
      credit: "0.00",
    }));

    const totalSettled = money.add(payment.amount, payment.tdsAmount);
    const paymentEntry = {
      date: payment.date,
      debit: "0.00",
      credit: totalSettled,
    };

    const entries = [...invoiceEntries, paymentEntry];
    let runningBalance = openingBalance;
    entries.forEach((e) => {
      runningBalance = money.add(money.sub(runningBalance, e.credit), e.debit);
    });

    const totalDebit = money.sum(entries.map((e) => e.debit));
    const totalCredit = money.sum(entries.map((e) => e.credit));
    const closingBalance = money.add(money.sub(openingBalance, totalCredit), totalDebit);

    expect(totalDebit).toBe("10000.00");
    expect(totalCredit).toBe("10000.00");
    expect(closingBalance).toBe("0.00");
  });

  it("leaves accurate outstanding balance when TDS payment is partial", () => {
    const openingBalance = "0.00";
    const invoice = {
      date: new Date("2026-10-01"),
      totalAmount: "10000.00",
      type: "sale" as const,
    };
    // Partial payment: gross 5000 settled, 4500 cash + 500 TDS
    const payment = {
      date: new Date("2026-10-05"),
      amount: "4500.00",
      tdsAmount: "500.00",
      mode: "bank",
    };

    const totalSettled = money.add(payment.amount, payment.tdsAmount);
    const entries = [
      { date: invoice.date, debit: invoice.totalAmount, credit: "0.00" },
      { date: payment.date, debit: "0.00", credit: totalSettled },
    ];

    let runningBalance = openingBalance;
    const entriesWithBalance = entries.map((e) => {
      runningBalance = money.add(money.sub(runningBalance, e.credit), e.debit);
      return { ...e, runningBalance };
    });

    const totalDebit = money.sum(entries.map((e) => e.debit));
    const totalCredit = money.sum(entries.map((e) => e.credit));
    const closingBalance = money.add(money.sub(openingBalance, totalCredit), totalDebit);

    expect(totalDebit).toBe("10000.00");
    expect(totalCredit).toBe("5000.00");
    expect(closingBalance).toBe("5000.00");
    expect(entriesWithBalance[1].runningBalance).toBe("5000.00");
  });
});
