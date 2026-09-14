/**
 * The WebMCP tool catalog.
 *
 * `webMcpTools` is the full, ordered list the runtime registers with
 * `document.modelContext`. Order matters a little: browser agents read the tool
 * list top-down, so orientation comes first (`hisaabo_context`, `app_navigate`),
 * then the one-call overview (`dashboard_summary`), then the domains in the
 * order a business actually works through them — invoice a party, keep the
 * party and item catalogs, take the money, book the costs.
 *
 * Every tool is read-only or explicitly consequential, carries the
 * `resource:action` it needs (`requires`), and hands back plain JSON. There are
 * deliberately no delete tools, no settings/team/tenant tools and no PDF or
 * download tools: an agent should not be able to destroy records, change who
 * can sign in, or exfiltrate documents on a single prompt.
 */

import type { WebMcpToolDefinition } from "../types";
import { appTools } from "./app";
import { dashboardTools } from "./dashboard";
import { invoiceTools } from "./invoice";
import { partyTools } from "./party";
import { itemTools } from "./item";
import { paymentTools } from "./payment";
import { expenseTools } from "./expense";

export { appTools } from "./app";
export { dashboardTools } from "./dashboard";
export { invoiceTools } from "./invoice";
export { partyTools } from "./party";
export { itemTools } from "./item";
export { paymentTools } from "./payment";
export { expenseTools } from "./expense";

export const webMcpTools: WebMcpToolDefinition[] = [
  ...appTools,
  ...dashboardTools,
  ...invoiceTools,
  ...partyTools,
  ...itemTools,
  ...paymentTools,
  ...expenseTools,
];
