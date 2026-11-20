import type { WebMcpToolDefinition } from "../types";
import { noInput } from "./shared";

const tdsSectionList: WebMcpToolDefinition = {
  name: "tds_section_list",
  title: "List active TDS sections",
  description: [
    "List active receivable-side TDS section configurations for the active business.",
    "Use this before payment_create when recording TDS so the allocation uses a valid section code.",
    "Only active, tenant-scoped sections are returned; section labels and rates are data from the business books.",
  ].join(" "),
  inputSchema: noInput(),
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  requires: { resource: "Payment", action: "read" },
  execute: async (_input, ctx) => ctx.client.tdsSection.list.query({}),
};

export const tdsSectionTools: WebMcpToolDefinition[] = [tdsSectionList];
