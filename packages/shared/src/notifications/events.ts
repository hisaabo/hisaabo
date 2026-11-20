// Notification event catalog. Every event type belongs to exactly one channel
// and declares who may receive it. See docs/architecture/notifications.md §3.
//
// Adding an event type: add it here, add its payload type to EventPayloads, and
// add en + hi templates in templates.ts (a unit test fails otherwise).

import type { Action, Resource, RoleName } from "../permissions.js";
import type { ChannelId, Locale } from "./channels.js";

/** Where a notification's tap should take the user. Clients map kinds to screens. */
export type NotificationTarget =
  | { kind: "invoice"; id: string }
  | { kind: "payment"; id: string }
  | { kind: "store_order"; id: string }
  | { kind: "team" }
  | { kind: "api_keys" }
  | { kind: "inbox" };

export interface EventPayloads {
  "payment.received": {
    paymentId: string;
    paymentNumber: string | null;
    amount: string;
    partyName: string;
    invoiceId: string | null;
    invoiceNumber: string | null;
    invoiceFullyPaid: boolean;
  };
  "payment.made": {
    paymentId: string;
    paymentNumber: string | null;
    amount: string;
    partyName: string;
  };
  "invoice.due_today": {
    invoiceId: string;
    invoiceNumber: string;
    partyName: string;
    amountDue: string;
  };
  "invoice.overdue": {
    invoiceId: string;
    invoiceNumber: string;
    partyName: string;
    amountDue: string;
    daysOverdue: number;
  };
  "store.order_placed": {
    orderId: string;
    orderNumber: string;
    customerName: string;
    totalAmount: string;
    itemCount: number;
  };
  "einvoice.failed": {
    invoiceId: string;
    invoiceNumber: string;
    error: string;
  };
  "team.member_joined": {
    memberUserId: string;
    memberName: string;
    role: string;
  };
  "team.role_changed": {
    memberUserId: string;
    memberName: string;
    fromRole: string;
    toRole: string;
  };
  "api_key.created": {
    keyName: string;
    keyPrefix: string;
    createdByName: string;
  };
  "general.announcement": {
    title: Record<Locale, string>;
    body: Record<Locale, string>;
  };
}

export type EventType = keyof EventPayloads;

/**
 * Who is a candidate recipient before eligibility and preferences apply.
 *  - business: every member of the tenant who can access the business
 *  - admins:   members who can manage the team (owner/admin)
 *  - subject:  only the user named by the event's subjectUserId
 *  - subject_and_admins: both of the above
 */
export type Audience = "business" | "admins" | "subject" | "subject_and_admins";

export interface EventDef {
  type: EventType;
  channel: ChannelId;
  audience: Audience;
  /** Recipient must hold ALL of these abilities. Empty = everyone in the audience. */
  requires: ReadonlyArray<readonly [Action, Resource]>;
  /**
   * Roles for which this event cannot be muted: it always reaches the inbox and
   * sends an email copy, and bypasses quiet hours. "all" = every eligible role.
   */
  lockedFor: readonly RoleName[] | "all" | null;
  /** Bypasses quiet hours and per-user caps (security, locked compliance). */
  urgent: boolean;
  /** The payload carries an amount (rupees) that thresholds apply to. */
  amountField: string | null;
  target: (payload: never) => NotificationTarget;
}

const ADMIN_LIKE: readonly RoleName[] = ["superadmin", "admin"];

function def<T extends EventType>(
  type: T,
  d: Omit<EventDef, "type" | "target"> & { target: (p: EventPayloads[T]) => NotificationTarget },
): EventDef {
  return { type, ...d, target: d.target as (payload: never) => NotificationTarget };
}

export const EVENTS: Record<EventType, EventDef> = {
  "payment.received": def("payment.received", {
    channel: "money_in",
    audience: "business",
    requires: [["read", "Payment"]],
    lockedFor: null,
    urgent: false,
    amountField: "amount",
    target: (p) => ({ kind: "payment", id: p.paymentId }),
  }),
  "payment.made": def("payment.made", {
    channel: "payables",
    audience: "business",
    requires: [["read", "Expense"], ["read", "Payment"]],
    lockedFor: null,
    urgent: false,
    amountField: "amount",
    target: (p) => ({ kind: "payment", id: p.paymentId }),
  }),
  "invoice.due_today": def("invoice.due_today", {
    channel: "collections",
    audience: "business",
    requires: [["read", "Invoice"], ["read", "Party"]],
    lockedFor: null,
    urgent: false,
    amountField: "amountDue",
    target: (p) => ({ kind: "invoice", id: p.invoiceId }),
  }),
  "invoice.overdue": def("invoice.overdue", {
    channel: "collections",
    audience: "business",
    requires: [["read", "Invoice"], ["read", "Party"]],
    lockedFor: null,
    urgent: false,
    amountField: "amountDue",
    target: (p) => ({ kind: "invoice", id: p.invoiceId }),
  }),
  "store.order_placed": def("store.order_placed", {
    channel: "store",
    audience: "business",
    requires: [["read", "Store"]],
    lockedFor: null,
    urgent: false,
    amountField: "totalAmount",
    target: (p) => ({ kind: "store_order", id: p.orderId }),
  }),
  "einvoice.failed": def("einvoice.failed", {
    channel: "compliance",
    audience: "business",
    requires: [["read", "EInvoice"]],
    lockedFor: [...ADMIN_LIKE, "accountant"],
    urgent: true,
    amountField: null,
    target: (p) => ({ kind: "invoice", id: p.invoiceId }),
  }),
  "team.member_joined": def("team.member_joined", {
    channel: "security",
    audience: "admins",
    requires: [],
    lockedFor: "all",
    urgent: true,
    amountField: null,
    target: () => ({ kind: "team" }),
  }),
  "team.role_changed": def("team.role_changed", {
    channel: "security",
    audience: "subject_and_admins",
    requires: [],
    lockedFor: "all",
    urgent: true,
    amountField: null,
    target: () => ({ kind: "team" }),
  }),
  "api_key.created": def("api_key.created", {
    channel: "security",
    audience: "subject_and_admins",
    requires: [],
    lockedFor: "all",
    urgent: true,
    amountField: null,
    target: () => ({ kind: "api_keys" }),
  }),
  "general.announcement": def("general.announcement", {
    channel: "general",
    audience: "business",
    requires: [],
    lockedFor: null,
    urgent: false,
    amountField: null,
    target: () => ({ kind: "inbox" }),
  }),
};

export const EVENT_TYPES = Object.keys(EVENTS) as EventType[];

export function isEventType(value: string): value is EventType {
  return Object.prototype.hasOwnProperty.call(EVENTS, value);
}

export function targetFor<T extends EventType>(type: T, payload: EventPayloads[T]): NotificationTarget {
  return (EVENTS[type].target as (p: EventPayloads[T]) => NotificationTarget)(payload);
}
