import type { EndpointGroup } from "./types";

export const targetEndpoints: EndpointGroup = {
  id: "target",
  title: "Sales Targets",
  description: "Create and track sales targets for team members. Targets can measure order count, total order value (INR), or quantity sold of a specific item. Progress is computed live against actual invoices created by the target user in the period.",
  endpoints: [
    {
      id: "target-create",
      method: "mutation",
      path: "target.create",
      title: "Create Target",
      description: "Assign a sales target to a user. Requires `admin` role. The target type determines what is measured: `order_count` (number of invoices), `order_value` (total INR), or `item_quantity` (units of a specific item sold). Provide `itemId` only for `item_quantity` targets.",
      auth: "business",
      input: [
        { name: "userId", type: "string (UUID)", required: true, description: "ID of the user being assigned the target" },
        { name: "targetType", type: "'order_count' | 'order_value' | 'item_quantity'", required: true, description: "What the target measures" },
        { name: "targetValue", type: "string (decimal)", required: true, description: "Target threshold, e.g. '50' for 50 orders or '500000.00' for ₹5 lakh" },
        { name: "itemId", type: "string (UUID)", required: false, description: "Required when targetType is 'item_quantity'. The specific item to track." },
        { name: "periodType", type: "'daily' | 'weekly' | 'monthly' | 'quarterly' | 'custom'", required: true, description: "Describes the period semantics (informational — actual dates are in periodStart/periodEnd)" },
        { name: "periodStart", type: "string (ISO datetime)", required: true, description: "Start of the target period (inclusive)" },
        { name: "periodEnd", type: "string (ISO datetime)", required: true, description: "End of the target period (inclusive)" },
        { name: "notes", type: "string", required: false, description: "Optional admin notes (max 500 chars)" },
      ],
      output: {
        description: "The created target record.",
        example: {
          id: "target-uuid",
          businessId: "biz-uuid",
          userId: "user-uuid",
          targetType: "order_value",
          targetValue: "500000.00",
          itemId: null,
          periodType: "monthly",
          periodStart: "2026-04-01T00:00:00.000Z",
          periodEnd: "2026-04-30T23:59:59.999Z",
          notes: "April stretch goal",
          createdByUserId: "admin-uuid",
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/target.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"userId":"user-uuid","targetType":"order_value","targetValue":"500000.00","periodType":"monthly","periodStart":"2026-04-01T00:00:00.000Z","periodEnd":"2026-04-30T23:59:59.999Z"}}'`,
        javascript: `const target = await trpc.target.create.mutate({
  userId: "user-uuid",
  targetType: "order_value",
  targetValue: "500000.00",
  periodType: "monthly",
  periodStart: "2026-04-01T00:00:00.000Z",
  periodEnd: "2026-04-30T23:59:59.999Z",
  notes: "April stretch goal",
});`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/target.create",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {
        "userId": "user-uuid",
        "targetType": "order_value",
        "targetValue": "500000.00",
        "periodType": "monthly",
        "periodStart": "2026-04-01T00:00:00.000Z",
        "periodEnd": "2026-04-30T23:59:59.999Z",
    }},
)`,
      },
      gotchas: [
        "`itemId` is required and validated when `targetType` is `item_quantity`. Providing it for other types is ignored.",
        "Returns BAD_REQUEST if `periodEnd` is not after `periodStart`.",
        "Progress tracking considers only invoices with `type = 'sale'`, `documentType = 'invoice'`, and `status NOT IN ('draft', 'cancelled')` created by the target user.",
      ],
    },
    {
      id: "target-list",
      method: "query",
      path: "target.list",
      title: "List Targets",
      description: "List all targets for the business. Filter by user, period type, or active status (targets where today is within the period). Pass `withProgress: true` to include live progress data — note this runs a DB query per target and can be slower for large lists.",
      auth: "business",
      input: [
        { name: "userId", type: "string (UUID)", required: false, description: "Filter to targets for a specific user" },
        { name: "periodType", type: "'daily' | 'weekly' | 'monthly' | 'quarterly' | 'custom'", required: false, description: "Filter by period type" },
        { name: "active", type: "boolean", required: false, description: "If true, only return targets whose period includes today" },
        { name: "withProgress", type: "boolean", required: false, description: "If true, attach live progress data to each target (default: false)" },
      ],
      output: {
        description: "Array of target records, optionally with progress attached.",
        example: [
          {
            id: "target-uuid",
            userId: "user-uuid",
            targetType: "order_value",
            targetValue: "500000.00",
            periodType: "monthly",
            periodStart: "2026-04-01T00:00:00.000Z",
            periodEnd: "2026-04-30T23:59:59.999Z",
            progress: {
              current: 320000,
              target: 500000,
              percentage: 64,
              remaining: 180000,
              unit: "₹",
              onTrack: true,
              daysTotal: 30,
              daysElapsed: 18,
              daysRemaining: 12,
            },
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/target.list?input=%7B%22json%22%3A%7B%22active%22%3Atrue%2C%22withProgress%22%3Atrue%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `// Get all active targets with live progress for admin dashboard
const targets = await trpc.target.list.query({
  active: true,
  withProgress: true,
});`,
        python: `import urllib.parse, json

params = urllib.parse.quote(json.dumps({"json": {"active": True, "withProgress": True}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/target.list?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Using `withProgress: true` fires one query per target. Avoid on large un-filtered lists.",
        "Results are ordered by `createdAt` descending.",
      ],
    },
    {
      id: "target-get-progress",
      method: "query",
      path: "target.getProgress",
      title: "Get Target Progress",
      description: "Fetch a single target with its live progress data. The progress object includes current value, target value, percentage complete, remaining amount, days elapsed/remaining, and an `onTrack` boolean based on time-proportional expected progress.",
      auth: "business",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "ID of the target" },
      ],
      output: {
        description: "Target record with progress attached.",
        example: {
          id: "target-uuid",
          userId: "user-uuid",
          targetType: "order_count",
          targetValue: "50.00",
          periodType: "monthly",
          periodStart: "2026-04-01T00:00:00.000Z",
          periodEnd: "2026-04-30T23:59:59.999Z",
          progress: {
            current: 32,
            target: 50,
            percentage: 64,
            remaining: 18,
            unit: "orders",
            onTrack: true,
            daysTotal: 30,
            daysElapsed: 18,
            daysRemaining: 12,
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/target.getProgress?input=%7B%22json%22%3A%7B%22id%22%3A%22target-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { progress } = await trpc.target.getProgress.query({ id: "target-uuid" });
console.log(progress.percentage + "% complete, " + progress.daysRemaining + " days left");`,
        python: `params = urllib.parse.quote(json.dumps({"json": {"id": "target-uuid"}}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/target.getProgress?input={params}", ...)`,
      },
      gotchas: [
        "`onTrack` is true if `current >= (daysElapsed / daysTotal) * targetValue` or if the period has ended.",
        "Returns NOT_FOUND if the target ID does not belong to the active business.",
      ],
    },
    {
      id: "target-update",
      method: "mutation",
      path: "target.update",
      title: "Update Target",
      description: "Update the value, period, item, or notes on an existing target. Requires `admin` role. The `userId` and `targetType` cannot be changed after creation — create a new target instead.",
      auth: "business",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "ID of the target to update" },
        { name: "targetValue", type: "string (decimal)", required: false, description: "New target threshold" },
        { name: "itemId", type: "string (UUID) | null", required: false, description: "New item ID (for item_quantity targets)" },
        { name: "periodType", type: "'daily' | 'weekly' | 'monthly' | 'quarterly' | 'custom'", required: false, description: "New period type label" },
        { name: "periodStart", type: "string (ISO datetime)", required: false, description: "New period start" },
        { name: "periodEnd", type: "string (ISO datetime)", required: false, description: "New period end" },
        { name: "notes", type: "string | null", required: false, description: "New notes" },
      ],
      output: {
        description: "The updated target record.",
        example: {
          id: "target-uuid",
          targetValue: "600000.00",
          periodEnd: "2026-04-30T23:59:59.999Z",
          updatedAt: "2026-03-29T12:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/target.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"target-uuid","targetValue":"600000.00"}}'`,
        javascript: `await trpc.target.update.mutate({
  id: "target-uuid",
  targetValue: "600000.00",
  notes: "Revised upward after Q3 review",
});`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/target.update",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "target-uuid", "targetValue": "600000.00"}},
)`,
      },
      gotchas: [
        "Returns NOT_FOUND if the target does not exist in the active business.",
        "Cannot change `userId` or `targetType` — delete and recreate if you need to change these.",
      ],
    },
    {
      id: "target-delete",
      method: "mutation",
      path: "target.delete",
      title: "Delete Target",
      description: "Permanently delete a sales target. This is a hard delete — the record is removed from the database. Requires `admin` role.",
      auth: "business",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "ID of the target to delete" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/target.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"target-uuid"}}'`,
        javascript: `await trpc.target.delete.mutate({ id: "target-uuid" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/target.delete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "target-uuid"}},
)`,
      },
      gotchas: [
        "Hard delete — cannot be undone.",
        "Returns NOT_FOUND if the target does not exist in the active business.",
      ],
    },
    {
      id: "target-my-targets",
      method: "query",
      path: "target.myTargets",
      title: "My Active Targets",
      description: "Returns all active targets assigned to the currently authenticated user (where today is before `periodEnd`), with live progress data attached. Designed for a seller's personal dashboard — no admin role required.",
      auth: "business",
      input: [],
      output: {
        description: "Array of the caller's active targets with progress, ordered by period end ascending.",
        example: [
          {
            id: "target-uuid",
            targetType: "order_value",
            targetValue: "500000.00",
            periodType: "monthly",
            periodStart: "2026-04-01T00:00:00.000Z",
            periodEnd: "2026-04-30T23:59:59.999Z",
            progress: {
              current: 320000,
              target: 500000,
              percentage: 64,
              remaining: 180000,
              unit: "₹",
              onTrack: true,
              daysTotal: 30,
              daysElapsed: 18,
              daysRemaining: 12,
            },
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/target.myTargets" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `// Render progress bars for the logged-in seller
const myTargets = await trpc.target.myTargets.query();
myTargets.forEach(({ targetType, progress }) => {
  console.log(targetType, progress.percentage + "%", progress.onTrack ? "on track" : "behind");
});`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/target.myTargets",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)
my_targets = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Only returns targets where `periodEnd >= now`. Completed/past targets are excluded — use `target.list` with `userId` to see historical targets.",
        "All returned targets include `progress` — there is no option to skip it here.",
      ],
      relatedEndpoints: ["target-list", "target-get-progress"],
    },
  ],
};
