# Golden accounting suite

## Purpose

A **parity oracle for the posted-GL migration**.

Today the ledger is *virtual*: `src/lib/derive-ledger.ts` recomputes double-entry
journals at query time from invoices, payments, expenses, credit/debit notes and
manual journals, and the reports (`trialBalance`, `profitAndLoss`, `balanceSheet`,
`generalLedger`, `cashFlowStatement`, GSTR-3B, party balances) aggregate that.
The coming rewrite replaces it with a posted general ledger. This suite pins the
numbers the current system produces, so the rewrite can prove they do not change
(or change only where we decide they should).

Each scenario seeds a fresh business **through the real tRPC routers**
(`business.create`, `party.create`, `invoice.create`, `payment.create`,
`expense.create`, `journal.create`, `itc.recordUtilization`, ...), reads the
books back through the report procedures, and compares with **hand-computed
literals**. The arithmetic is written next to the expectation so a reviewer can
check it without running anything. Expected values are never computed by the
test itself.

## Scenarios

| File | Scenario | Status |
| --- | --- | --- |
| `01-intra-state-sale` | Intra-state B2B sale, CGST+SGST, full bank payment | pass |
| `02-inter-state-sale-partial` | Inter-state IGST sale, partial UPI then cash | pass |
| `03-purchase-input-gst` | Purchase with input GST, payment made | pass |
| `04-sale-with-tds` | Customer TDS on receipt (TDS receivable 1600) | pass |
| `05-credit-debit-notes` | Credit note, sales return, sale/purchase debit notes, purchase return | pass |
| `06-expenses` | 12 expense categories, keyword-mapped, cash and bank | pass |
| `07-manual-journals` | Capital, equipment, depreciation journals; void nets to zero | pass |
| `08-itc-utilisation` | `itc.recordUtilization` system journal | pass |
| `09-bank-movements-not-ledgered` | Bank transfer and manual "interest" deposit | **documented gap** |
| `10-opening-balances` | Party and bank opening balances | **documented gap** |
| `11-financial-year-boundary` | 31 Mar / 1 Apr, TB per FY, default FY derivation | pass (+ documented gaps) |
| `12-rounding` | 7-line invoice with paisa rounding; round-off/discount/charges | pass |
| `13-document-lifecycle` | Drafts, quotations, cancel, payment delete | pass |
| `14-purchase-side-reversals` | Credit note / sales return raised from a purchase invoice (`type = purchase`) | pass |
| `15-einvoice-supply-type` | IRP payload for domestic B2B sales: SupTyp `B2B` intra- and inter-state, place of supply, exports refused | pass |
| `16-gst-return-periods` | GSTR-1 JSON, GSTR-9 and CMP-08 periods are April-March for businesses whose books start in April, January or July; only the trial balance follows the books year | pass |
| `17-einvoice-hsn` | IRP payload HSN: missing HSN refused per line, 4/6/8 digits at exactly ₹5 Cr and a paisa either side | pass |
| `18-gstr1-hsn-summary` | GSTR-1 Table 12: one row per HSN + UQC + rate, real UQC, JSON `rt`, CSV section; ties to B2B + B2CS = GSTR-3B 3.1(a); exact quantities | pass |
| `19-month-windows` | Half-open IST month / quarter windows: GSTR-1, 3B, 9, 2B, CMP-08, ITC period, IRP date, dashboard; 23:59:59.500 and 00:00:00.000 either side of a month and of the FY | pass |
| `20-eway-bill-hsn` | e-way bill HSN: missing HSN refused per line before the NIC, 4/6/8 digits at exactly ₹5 Cr and a paisa either side | pass |
| `21-gstr1-hsn-missing` | GSTR-1 with a line that has no HSN: JSON export refused with the list to fix, report and CSV flag it; with an HSN everywhere the JSON carries `rt` and the real UQC | pass |
| `22-date-ranges` | Date presets and custom ranges on the IST calendar end to end (invoice list, daybook, month / FY buckets, trial-balance year, Tally file name); documents at 23:59:59.500 IST and 00:00:00 IST either side of a month and of the FY | pass |
| `23-recurring-ist` | Recurring run dates on the IST calendar: monthly on the 1st with no drift, month-end clamping (28/29/30/31, leap year), catch-up, anchored vs unanchored, end date inclusive | pass |
| `24-gstr1-json-dates` | GSTR-1 portal JSON, CSV and statement dates are the IST day (IST-midnight inputs); period upper bound takes microseconds | pass |
| `25-cmp08` | CMP-08 counts what GSTR-1 / 3B count: invoices only, net of credit notes and returns, no quotations / challans / deleted / cancelled; IST quarter edges | pass |
| `26-intra-inter-state` | one intra / inter-state decision in GSTR-1, GSTR-3B, the ledger, the IRP and the e-way bill: GSTIN-only parties, GSTIN beats a wrong stored code (IRP / EWB refuse it), Andhra Pradesh 28 = 37, invalid code `50` ignored, nothing on file = supplier's state | pass |

Per scenario the suite asserts, as applicable: the trial balance (every touched
account, `debits == credits`), P&L totals, the balance-sheet equation
(`Assets = Liabilities + Equity`, and `= Liabilities + equity-before-profit +
profit`), party outstanding on several surfaces, GSTR-3B figures, and the
cash-flow statement where its classification is unambiguous (01, 02, 03, 04, 07).

## Running

Needs the test Postgres from `docker-compose.test.yml` (port 5433) with the schema
pushed, exactly as for the rest of the API integration tests:

```bash
docker compose -f docker-compose.test.yml up -d
export TEST_DATABASE_URL=postgresql://test:test@localhost:5433/hisaabo_test
DATABASE_URL=$TEST_DATABASE_URL pnpm db:push

# the whole golden suite
pnpm --filter @hisaabo/api exec vitest run src/__tests__/integration/golden

# one scenario
pnpm --filter @hisaabo/api exec vitest run src/__tests__/integration/golden/07
```

`API_TEST_WORKERS=1` runs everything serially against `TEST_DATABASE_URL` itself
(no per-worker database clones); see `docker-compose.test.yml` for details. The
suite takes ~8 s with the default workers.

Dates are fixed instants (FY 2025-26 and 2026-27), so results do not depend on
the day the suite runs. The one exception is the ITC utilisation journal, which
`itc.recordUtilization` dates `new Date()`; scenario 08 therefore reads the books
over `ALL_TIME`. The default-FY tests in scenario 11 derive the financial-year
start from the server's local midnight (UTC in CI).

## How to add a scenario

1. Copy the closest `NN-*.test.ts` and give it the next number.
2. Start with a header comment: the inputs, the **arithmetic**, and the journal
   lines you expect each document to post. Write this *before* running anything.
3. Build the world with the helpers in `golden-helpers.ts`:

   ```ts
   useGoldenDb();                                   // per-file teardown, call once
   w = await createGoldenWorld();                   // owner + tenant + business (MH, April FY)
   const cust = await addParty(w, "customer", "KA"); // "MH" same state, "KA" other state
   const inv = await addInvoice(w, "sale", cust.id,
     [{ name: "Widget", qty: "5", price: "2000.00", tax: "12" }],
     { date: "2025-07-05T10:00:00.000Z" });
   await addPayment(w, { partyId: cust.id, invoiceId: inv.id, amount: "5000.00",
     mode: "upi", bankAccountId: bank.id, date: "2025-07-15T10:00:00.000Z" });
   const b = await book(w);                         // TB + P&L + BS (ALL_TIME, or pass fy(2025))
   ```

   Anything the helpers do not cover (`expense.create`, `journal.create`,
   `bankAccount.transfer`, `itc.recordUtilization`, document routers, ...) is
   called straight on `w.caller`.
4. Assert with literals:
   * `expect(tbRows(b)).toEqual([["1100", "11200.00", "5000.00"], ...])`: the
     **whole** trial balance as `[code, debit, credit]`, so an unexpected extra
     account fails the test; plus `b.tb.totalDebit` / `totalCredit` literals.
   * `plSummary(b)` and `bsSummary(b)` with `toEqual` (full literal).
   * `expectBooksBalance(b)` for the generic invariants (it takes the ALL_TIME book).
   * Party outstanding: `party.getById(...).balance`, `party.ledgerReport(...)`,
     `outstandingTotal(w, "receivable" | "payable")`.
   * GSTR-3B: `w.caller.gst.gstr3b({ year, month })`; its numbers are JS numbers,
     render with `fixed2()` before comparing to a string literal.
   * Cash flow: `cashFlow(w)` + `expectCashFlowReconciles(cf, b)`, and a literal
     only when every line is unambiguous.
5. Use mid-day UTC timestamps unless the boundary itself is what you are testing.
6. Run lint and typecheck: `pnpm lint && pnpm typecheck`.

### When the current behaviour is wrong

Write the test for the **correct** expectation and mark it `it.fails(...)` with a
`// BUG:` comment saying what is wrong, where, and what it does today. When someone
fixes the bug the test starts passing and `it.fails` turns red, which is the
prompt to delete the marker. Never pin a buggy number as if it were right.

### When the current behaviour is a deliberate gap

Scenarios 09 and 10 (and the carry-forward notes in 11) assert what happens **now**
(bank transfers, manual deposits and opening balances do not reach the ledger;
the trial balance is period activity with no brought-forward balances; the balance
sheet has no year-end close). They are labelled *documented gap* and **0.12.0 will
change these expectations**. When the posted GL lands, change those literals
deliberately, with the new numbers worked out by hand and reviewed, never
regenerated from output.

## Date ranges and the time zone

Everything about dates is on the business calendar (IST, UTC+05:30), so the date tests must not depend
on the zone of the machine. Run the date suites under three zones before changing any date code:

```bash
for tz in UTC Asia/Kolkata America/Los_Angeles; do
  TZ=$tz pnpm --filter @hisaabo/shared exec vitest run src/__tests__/business-time.test.ts
  TZ=$tz API_TEST_WORKERS=1 pnpm --filter @hisaabo/api exec vitest run \
    src/__tests__/integration/golden/16 src/__tests__/integration/golden/19 src/__tests__/integration/golden/22 src/__tests__/integration/golden/23
  TZ=$tz pnpm --filter @hisaabo/web exec vitest run src/hooks src/lib src/components/ui src/components/settings
  TZ=$tz pnpm --filter @hisaabo/mobile exec jest
  TZ=$tz pnpm --filter @hisaabo/cli test
done
```

Instants in these tests are written out as UTC literals with the IST time in a comment (IST midnight of
a day is 18:30 UTC of the day before).

## Isolation

The older plan (`docs/architecture/testing-plan.md`) describes per-test
transaction rollback. The suites that exist drive the routers, which open their
own transactions on their own pool, so a wrapping rollback is not possible; they
isolate with per-file `truncateAllTables()` plus, when more than one worker runs,
a cloned database per worker (`global-setup.ts`). This suite follows the existing
setup and adds one more layer: **every scenario creates its own tenant and
business**, and every query the reports run is scoped by `businessId`, so
scenarios (even ones sharing a file) cannot see each other's rows.

## Known bugs captured as `it.fails`

None. The nine production bugs this suite first marked with `it.fails` (an
unbalanced ledger for round-off / discount / charges, gross profit, GSTR-3B
input credit and output tax, the CGST/SGST odd paisa, GSTR-1 purchase-side debit
notes, party balances, the supplier opening-balance sign, and the doubled ITC
utilisation journal) were fixed, each with the same hand-computed literals, and
their markers removed. Their release note is the 0.10.1 section of
`docs/UPGRADING.md` ("Corrected accounting and GST figures").
