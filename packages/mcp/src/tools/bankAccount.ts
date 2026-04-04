/**
 * Bank account tools — manage bank/cash accounts and transactions.
 *
 * Tools registered:
 *   bank_account_list         — list all bank and cash accounts with balances
 *   bank_account_get          — get account details with recent transactions
 *   bank_account_create       — create a new bank or cash account
 *   bank_account_transfer     — transfer funds between two accounts
 *   bank_account_transactions — list transactions for an account
 *   bank_account_summary      — get total balance across all accounts
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import { MAX_PAGE_SIZE, withPaginationMeta } from "../lib/pagination.js";

const ACCOUNT_TYPES = ["savings", "current", "cash", "credit", "other"] as const;

export function registerBankAccountTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "bank_account_list",
    [
      "List all bank and cash accounts for the active business, including current balances.",
      "Use this to find account UUIDs before recording payments or transfers.",
      "The 'currentBalance' field reflects the running balance after all recorded transactions.",
      "The default account (isDefault=true) is used automatically when no account is specified in payment_create.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const accounts = await client.bankAccount.list();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(accounts, null, 2),
        }],
      };
    })
  );

  server.tool(
    "bank_account_get",
    [
      "Get details of a single bank account including its 20 most recent transactions.",
      "Use this to check an account's running balance and recent activity.",
    ].join(" "),
    {
      account_id: z.string().uuid()
        .describe("Bank account UUID from bank_account_list."),
    },
    wrapTool(async (input) => {
      const account = await client.bankAccount.get(input.account_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(account, null, 2),
        }],
      };
    })
  );

  server.tool(
    "bank_account_create",
    [
      "Create a new bank account or cash account for the business.",
      "Use account_type='cash' for a physical cash register/petty cash account.",
      "Use account_type='savings' or 'current' for bank accounts.",
      "opening_balance sets the starting balance (e.g. the balance when you started using Hisaabo).",
      "Set is_default=true to make this the default account for payment recording.",
    ].join(" "),
    {
      account_name: z.string().min(1).max(200)
        .describe("Display name, e.g. 'HDFC Current Account' or 'Petty Cash'."),
      account_type: z.enum(ACCOUNT_TYPES)
        .describe("'savings', 'current', 'cash' (petty cash/physical cash), 'credit', or 'other'."),
      account_number: z.string().max(34).optional()
        .describe("Bank account number (not required for cash accounts)."),
      ifsc: z.string().max(11).optional()
        .describe("IFSC code, e.g. 'HDFC0001234'. Required for bank transfers."),
      bank_name: z.string().max(200).optional()
        .describe("Bank name, e.g. 'HDFC Bank', 'State Bank of India'."),
      opening_balance: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional()
        .describe("Opening balance as decimal string. Default '0'. Use the current account balance when onboarding."),
      is_default: z.boolean().optional()
        .describe("If true, this becomes the default account. Any previous default is cleared."),
    },
    wrapTool(async (input) => {
      const account = await client.bankAccount.create({
        accountName: input.account_name,
        accountType: input.account_type,
        accountNumber: input.account_number,
        ifsc: input.ifsc,
        bankName: input.bank_name,
        openingBalance: input.opening_balance,
        isDefault: input.is_default,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(account, null, 2),
        }],
      };
    })
  );

  server.tool(
    "bank_account_transfer",
    [
      "Transfer funds between two of the business's bank/cash accounts.",
      "Creates a withdrawal transaction on the source account and a deposit on the destination.",
      "Use this to record moving cash to the bank, or inter-account transfers.",
      "Example: transfer from 'Petty Cash' to 'HDFC Current Account' to replenish cash.",
    ].join(" "),
    {
      from_account_id: z.string().uuid()
        .describe("UUID of the source account (funds leave this account)."),
      to_account_id: z.string().uuid()
        .describe("UUID of the destination account (funds arrive here). Must differ from from_account_id."),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/)
        .describe("Transfer amount as decimal string, e.g. '5000.00'."),
      description: z.string().max(500).optional()
        .describe("Description of the transfer, e.g. 'Monthly cash deposit to bank'."),
      transaction_date: z.string().datetime().optional()
        .describe("Date of the transfer (ISO 8601). Defaults to today."),
    },
    wrapTool(async (input) => {
      const result = await client.bankAccount.transfer({
        fromAccountId: input.from_account_id,
        toAccountId: input.to_account_id,
        amount: input.amount,
        description: input.description,
        transactionDate: input.transaction_date,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "bank_account_transactions",
    [
      "List transactions for a specific bank or cash account with date and type filters.",
      "Each transaction includes a 'balanceAfter' field showing the running balance.",
      "Use type='deposit' to see only incoming funds, 'withdrawal' for outgoing, 'transfer' for inter-account moves.",
    ].join(" "),
    {
      account_id: z.string().uuid()
        .describe("Bank account UUID from bank_account_list."),
      from_date: z.string().datetime().optional()
        .describe("Start date (ISO 8601)."),
      to_date: z.string().datetime().optional()
        .describe("End date (ISO 8601)."),
      type: z.enum(["deposit", "withdrawal", "transfer"]).optional()
        .describe("Filter by transaction type."),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination."),
    },
    wrapTool(async (input) => {
      const result = await client.bankAccount.listTransactions({
        bankAccountId: input.account_id,
        fromDate: input.from_date,
        toDate: input.to_date,
        type: input.type,
        page: input.page,
        limit: MAX_PAGE_SIZE,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(withPaginationMeta(result), null, 2),
        }],
      };
    })
  );

  server.tool(
    "bank_account_summary",
    [
      "Get a summary of total funds across all bank and cash accounts.",
      "Returns totalBalance (all accounts), cashInHand (cash-type accounts only), bankBalance (non-cash accounts), and account count.",
      "Use this to quickly answer 'How much money do we have in total?' or 'What is our cash in hand?'",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const summary = await client.bankAccount.summary();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(summary, null, 2),
        }],
      };
    })
  );

  server.tool(
    "bank_account_gateway_config",
    [
      "Get the payment gateway configuration for a bank account.",
      "Returns charge rates per payment mode (credit_card, debit_card, upi, net_banking, wallet, default),",
      "the settlement account ID, expense category, and auto-settle flag.",
      "Returns null if the account has no gateway configuration.",
      "Use this before recording payments through a gateway to preview charge rates.",
    ].join(" "),
    {
      bank_account_id: z.string().uuid()
        .describe("Bank account UUID of the payment gateway account."),
    },
    wrapTool(async (input) => {
      const config = await client.bankAccount.getGatewayConfig(input.bank_account_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(config, null, 2),
        }],
      };
    })
  );

  server.tool(
    "bank_account_update_gateway",
    [
      "Create or update the payment gateway charge configuration for a bank account.",
      "The bank account must be of type 'payment_gateway'.",
      "charge_config maps payment modes to charge rates. Each rate has a type ('percentage' or 'flat') and a value (decimal string).",
      "Example: { credit_card: { type: 'percentage', value: '2' }, upi: { type: 'percentage', value: '0' }, default: { type: 'percentage', value: '2' } }",
      "settlement_account_id is the bank account where net amounts are settled after deducting charges.",
      "If the config already exists, it is replaced entirely with the new values.",
    ].join(" "),
    {
      bank_account_id: z.string().uuid()
        .describe("Bank account UUID of the payment gateway account."),
      settlement_account_id: z.string().uuid()
        .describe("UUID of the bank account where net settlements are deposited. Must not be a payment_gateway type."),
      charge_config: z.object({
        credit_card: z.object({ type: z.enum(["percentage", "flat"]), value: z.string() }).optional()
          .describe("Charge rate for credit card payments."),
        debit_card: z.object({ type: z.enum(["percentage", "flat"]), value: z.string() }).optional()
          .describe("Charge rate for debit card payments."),
        upi: z.object({ type: z.enum(["percentage", "flat"]), value: z.string() }).optional()
          .describe("Charge rate for UPI payments."),
        net_banking: z.object({ type: z.enum(["percentage", "flat"]), value: z.string() }).optional()
          .describe("Charge rate for net banking payments."),
        wallet: z.object({ type: z.enum(["percentage", "flat"]), value: z.string() }).optional()
          .describe("Charge rate for wallet payments."),
        default: z.object({ type: z.enum(["percentage", "flat"]), value: z.string() }).optional()
          .describe("Default charge rate used when a specific mode is not configured."),
      }).describe("Charge rates per payment mode. Each has type ('percentage' or 'flat') and value (decimal string)."),
      expense_category: z.string().min(1).max(100).optional()
        .describe("Expense category for gateway charges. Defaults to 'Payment Gateway Charges'."),
      auto_settle: z.boolean().optional()
        .describe("If true (default), net amount is automatically transferred to the settlement account on each payment."),
    },
    wrapTool(async (input) => {
      const config = await client.bankAccount.upsertGatewayConfig({
        bankAccountId: input.bank_account_id,
        settlementAccountId: input.settlement_account_id,
        chargeConfig: input.charge_config,
        expenseCategory: input.expense_category,
        autoSettle: input.auto_settle,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(config, null, 2),
        }],
      };
    })
  );
}
