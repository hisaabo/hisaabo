import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, hasColor } from "../../output.js";
import { formatDate, formatAmount, formatStatus } from "../../format.js";
import chalk from "chalk";

export async function storeOrderGetCommand(
  id: string,
  opts: { json?: boolean },
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const order = await client.store.getOrder(id);

    if (!order) {
      fatalError(`Order not found: ${id}`, EXIT.NOT_FOUND);
    }

    if (opts.json) {
      outputJSON(order);
      return;
    }

    const sep = "─".repeat(40);
    const title = `Order #${order.orderNumber}`;

    if (hasColor()) {
      process.stdout.write(`\n  ${chalk.bold(title)}\n`);
    } else {
      process.stdout.write(`\n  ${title}\n`);
    }
    process.stdout.write(`  ${sep}\n`);
    process.stdout.write(`  Customer:  ${order.customerName}\n`);
    process.stdout.write(`  Date:      ${formatDate(order.createdAt)}\n`);
    process.stdout.write(`  Status:    ${formatStatus(order.status)}\n`);
    process.stdout.write(`  Total:     ₹${formatAmount(order.totalAmount)}\n`);

    if (order.shippingAddress) {
      process.stdout.write(`  Address:   ${order.shippingAddress}\n`);
    }
    if (order.notes) {
      process.stdout.write(`  Notes:     ${order.notes}\n`);
    }

    if (order.items && order.items.length > 0) {
      process.stdout.write(`\n  Items:\n`);
      for (const item of order.items) {
        process.stdout.write(
          `    • ${item.name}  qty: ${item.quantity}  ₹${formatAmount(item.price)}\n`,
        );
      }
    }

    process.stdout.write("\n");
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Order not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
